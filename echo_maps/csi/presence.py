"""CSI presence detection from per-window motion features.

The Illy Bridge (ESP32-S3) captures real WiFi CSI continuously and reduces each
~1 s window of frames to a handful of motion features. This module turns that
feature stream into a present / not-present decision per sensing zone.

Principle: an empty space has a stable multipath channel — CSI amplitude barely
fluctuates and consecutive frames stay highly correlated. A person moving
through the space perturbs the multipath, which raises temporal amplitude
variation and decorrelates frames. We learn each link's *own* quiet baseline
(robust median + MAD) and flag windows that rise well above it, so no manual
calibration scan is needed. Nothing here is simulated: with no data a zone
reports "offline", never "empty".
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from statistics import median
from typing import Deque

# Windows (≈1 s each) of quiet data needed before the baseline is trusted.
LEARN_WINDOWS = 30
# Baseline history length (windows). Only quiet windows are added to it.
BASELINE_WINDOWS = 600
# Minimum frames in a window for it to count (guards against a starved link).
MIN_FRAMES = 5
# A window is "active" if score > baseline + K * max(MAD, floor).
K_SIGMA = 4.0
MAD_FLOOR = 0.01
# Enter "present" after N active windows out of the last M; leave after HOLD_S quiet.
ENTER_HITS, ENTER_OF = 2, 3
HOLD_S = 12.0
# Device is offline if no window arrived within this many seconds.
OFFLINE_AFTER_S = 15.0
# ...and forgotten entirely after this long without a window.
GHOST_AFTER_S = 3600.0

# Breathing: the bridge reports a spectral estimate every ~5 s. A rate is only shown once
# several recent readings agree, so a single noisy peak never reads as a person breathing.
BREATH_MIN_SNR = 3.5            # spectral peak vs background; below this the reading is noise
BREATH_RANGE_BPM = (6.0, 30.0)  # plausible resting/active adult range
BREATH_WINDOW_S = 40.0
BREATH_GOOD_READINGS = 4
BREATH_SPREAD_BPM = 3.0         # readings must sit within this of their median to count as steady
BREATH_STEADY_BPM = 1.5
# A breathing "signature" is a peak that keeps showing up at about the same rate. Peaks within
# SIG_TOL_BPM are one signature; it must persist for SIG_MIN_READINGS analyses (~5 s each).
SIG_TOL_BPM = 2.0
SIG_MIN_READINGS = 4
SIG_MAX = 3
SIG_FAST_BPM = 20.0   # above this is "faster": typical of small animals or an active person
# Nearby-BLE summary is stale (and hidden) after this long.
BLE_STALE_S = 30.0
# Sensing strategies a bridge can run (see the firmware's sensing state machine). In "macro" mode the
# radio is left to the wide, low-power device census and no CSI windows are produced, so a silent CSI
# stream there means "not measuring", never "empty". The last CSI verdict is held this long (it covers
# the short macro slice of an auto-sweep), after which the zone reads "standby".
STRATEGIES = ("macro", "micro", "auto", "smart")
MODES = ("macro", "micro")
MACRO_HOLD_S = 20.0
# Wide sweep (macro mode): the bridge hops across the 2.4 GHz channels and reports motion features of
# the traffic it hears on each. Each channel learns its own quiet baseline, like a home-channel link.
SWEEP_STALE_S = 180.0
SWEEP_LEARN = 5            # sweeps of quiet data before a channel can be called active
SWEEP_BASELINE = 60
SWEEP_MIN_FRAMES = 8


def window_score(amp_cv: float, decorr: float, rssi_std: float) -> float:
    """Combine window features into one motion score (≈0 when the link is still).

    amp_cv   — mean over subcarriers of temporal std/mean of amplitude
    decorr   — mean (1 - correlation) between consecutive amplitude vectors
    rssi_std — std of RSSI (dB) over the window
    """
    return amp_cv + 2.0 * decorr + 0.02 * rssi_std


@dataclass
class ZoneState:
    zone: str
    device_id: str
    bridge_name: str = ""
    ip: str = ""
    present: bool = False
    state: str = "offline"  # offline | learning | empty | present
    confidence: float = 0.0
    score: float = 0.0
    baseline: float = 0.0
    threshold: float = 0.0
    activity: str = "none"  # none | low | moderate | high
    last_seen: float = 0.0  # unix seconds of last window received
    last_contact: float = 0.0  # unix seconds of the last upload of any kind (windows or BLE-only)
    strategy: str = ""  # what the dashboard asked for: macro | micro | auto | smart ("" = old firmware)
    mode: str = ""  # what the radio is doing right now: macro | micro
    last_present: float = 0.0
    windows_total: int = 0
    frames_total: int = 0
    rssi: float = 0.0
    history: Deque[tuple[float, float, bool]] = field(default_factory=lambda: deque(maxlen=120))
    ratio: float = 0.0  # (score - baseline) / (threshold - baseline): 0 = still, 1 = detection threshold
    breath_snr: float = 0.0
    ble: dict | None = None
    ble_ts: float = 0.0
    sweep: dict | None = None
    _sweep_base: dict = field(default_factory=dict)  # channel -> deque of quiet scores
    _breath: Deque[tuple[float, float, float]] = field(default_factory=lambda: deque(maxlen=24))  # (ts, bpm, snr)
    _peaks: Deque[tuple[float, float, float]] = field(default_factory=lambda: deque(maxlen=150))  # every peak: (ts, bpm, snr)

    # internals
    _baseline: Deque[float] = field(default_factory=lambda: deque(maxlen=BASELINE_WINDOWS))
    _recent: Deque[bool] = field(default_factory=lambda: deque(maxlen=ENTER_OF))

    def touch(self, ts: float, strategy: str = "", mode: str = "") -> None:
        """The bridge is alive (it uploaded something), whether or not CSI windows came with it."""
        self.last_contact = ts
        if strategy in STRATEGIES:
            self.strategy = strategy
        if mode in MODES:
            self.mode = mode

    def update(self, ts: float, n: int, rssi_mean: float, rssi_std: float, amp_cv: float, decorr: float) -> None:
        self.last_seen = ts
        self.last_contact = max(self.last_contact, ts)
        self.windows_total += 1
        self.frames_total += max(n, 0)
        if n > 0:  # an empty window carries no RSSI; don't let it read as 0 dBm
            self.rssi = rssi_mean
        if n < MIN_FRAMES:
            return  # starved window: count liveness, don't judge

        score = window_score(amp_cv, decorr, rssi_std)
        self.score = score

        learning = len(self._baseline) < LEARN_WINDOWS
        base = median(self._baseline) if self._baseline else score
        mad = median(abs(x - base) for x in self._baseline) if self._baseline else 0.0
        self.baseline = base
        self.threshold = base + K_SIGMA * max(1.4826 * mad, MAD_FLOOR)
        active = (not learning) and score > self.threshold

        if learning:
            # While learning we assume the space is quiet; a person present during
            # the first minute is absorbed into baseline (documented limitation).
            self._baseline.append(score)
            self.state = "learning"
            self.present = False
        else:
            self._recent.append(active)
            if active:
                self.last_present = ts
            hits = sum(self._recent)
            if not self.present and hits >= ENTER_HITS:
                self.present = True
            elif self.present and (ts - self.last_present) > HOLD_S:
                self.present = False
            # Only quiet windows refine the baseline, so a lingering person
            # doesn't get learned as "empty".
            if not active and not self.present:
                self._baseline.append(score)
            self.state = "present" if self.present else "empty"

        span = max(self.threshold - self.baseline, 1e-6)
        ratio = (score - self.baseline) / span  # 0 = baseline, 1 = threshold
        self.ratio = ratio
        if self.state == "present":
            self.confidence = max(0.5, min(0.99, 0.5 + 0.12 * ratio))
        elif self.state == "empty":
            self.confidence = max(0.5, min(0.99, 0.99 - 0.4 * max(ratio, 0.0)))
        else:
            self.confidence = 0.0
        self.activity = (
            "none" if not self.present else "high" if ratio > 4 else "moderate" if ratio > 2 else "low"
        )
        self.history.append((ts, score, self.present))

    def update_breathing(self, ts: float, bpm: float, snr: float, ok: bool, peaks: tuple = ()) -> None:
        self.breath_snr = snr
        lo, hi = BREATH_RANGE_BPM
        for pbpm, psnr in peaks:
            if psnr >= BREATH_MIN_SNR and lo <= pbpm <= hi:
                self._peaks.append((ts, pbpm, psnr))
        lo, hi = BREATH_RANGE_BPM
        if ok and snr >= BREATH_MIN_SNR and lo <= bpm <= hi:
            self._breath.append((ts, bpm, snr))

    def set_sweep(self, ts: float, channels: list[dict]) -> None:
        """Fold one wide-sweep pass in: per channel, score the motion features against that channel's
        own quiet history. A channel is `active` when it rises well above it; it is `learning` until
        it has SWEEP_LEARN quiet passes. Other people's traffic cannot make a channel look active
        unless it also changes the multipath, which is what the score measures."""
        out = []
        for c in channels:
            row = {"ch": c["ch"], "n": c["n"], "all": c["all"], "rssi": c["rssi"],
                   "score": 0.0, "active": False, "learning": False, "measured": c["n"] >= SWEEP_MIN_FRAMES}
            if row["measured"]:
                score = window_score(c["amp_cv"], c["decorr"], 0.0)
                row["score"] = round(score, 4)
                base = self._sweep_base.setdefault(c["ch"], deque(maxlen=SWEEP_BASELINE))
                if len(base) < SWEEP_LEARN:
                    row["learning"] = True
                    base.append(score)
                else:
                    med = median(base)
                    mad = median(abs(x - med) for x in base)
                    row["active"] = score > med + K_SIGMA * max(1.4826 * mad, MAD_FLOOR)
                    if not row["active"]:
                        base.append(score)
            out.append(row)
        self.sweep = {"ts": ts, "channels": out}

    def set_ble(self, ts: float, summary: dict) -> None:
        self.ble = summary
        self.ble_ts = ts

    def signatures(self, now: float) -> list[dict]:
        """Distinct breathing rates that have persisted, strongest first (at most SIG_MAX)."""
        clusters: list[dict] = []
        for t, b, s in sorted((p for p in self._peaks if now - p[0] <= BREATH_WINDOW_S), key=lambda p: p[1]):
            for c in clusters:
                if abs(b - c["sum_b"] / c["n"]) <= SIG_TOL_BPM:
                    c["sum_b"] += b; c["sum_s"] += s; c["n"] += 1; c["ts"].add(t); c["pts"].append((t, b))
                    break
            else:
                clusters.append({"sum_b": b, "sum_s": s, "n": 1, "ts": {t}, "pts": [(t, b)]})
        sigs = []
        for c in clusters:
            if len(c["ts"]) < SIG_MIN_READINGS:
                continue
            series = [round(b, 1) for _, b in sorted(c["pts"])][-12:]  # oldest first
            sigs.append({
                "bpm": round(c["sum_b"] / c["n"], 1),
                "snr": round(c["sum_s"] / c["n"], 1),
                "readings": len(c["ts"]),
                "min": min(series),
                "max": max(series),
                "series": series,
            })
        sigs.sort(key=lambda g: g["snr"] * g["readings"], reverse=True)
        for g in sigs:
            g["kind"] = "faster" if g["bpm"] > SIG_FAST_BPM else "slower"
        return sigs[:SIG_MAX]

    def breathing_snapshot(self, now: float) -> dict:
        recent = [(t, b) for t, b, _ in self._breath if now - t <= BREATH_WINDOW_S]
        sigs = self.signatures(now)
        if len(recent) < 2:
            return {"state": "none", "bpm": None, "snr": round(self.breath_snr, 1), "readings": len(recent), "pattern": None, "signatures": sigs}
        bpms = [b for _, b in recent]
        med = median(bpms)
        spread = max(abs(b - med) for b in bpms)
        if len(recent) >= BREATH_GOOD_READINGS and spread <= BREATH_SPREAD_BPM:
            pattern = "steady" if spread <= BREATH_STEADY_BPM else "variable"
            state = "good"
        else:
            pattern, state = None, "weak"
        return {"state": state, "bpm": round(med, 1), "snr": round(self.breath_snr, 1), "readings": len(recent), "pattern": pattern, "signatures": sigs}

    def _sweep_snapshot(self, now: float, offline: bool) -> dict | None:
        if offline or not self.sweep or now - self.sweep["ts"] > SWEEP_STALE_S:
            return None
        ch = self.sweep["channels"]
        measured = [c for c in ch if c["measured"]]
        busiest = max(ch, key=lambda c: c["all"], default=None)
        return {
            "age_s": round(now - self.sweep["ts"], 1),
            "channels": ch,
            "measured": len(measured),
            "active": sum(1 for c in measured if c["active"]),
            "learning": any(c["learning"] for c in measured),
            "busiest": busiest["ch"] if busiest and busiest["all"] else None,
        }

    def snapshot(self, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        csi_age = now - self.last_seen if self.last_seen else float("inf")
        contact_age = now - self.last_contact if self.last_contact else float("inf")
        # Alive = the bridge uploaded recently. Outside macro mode that also needs CSI windows,
        # exactly as before: a bridge that should be measuring but is not is offline.
        offline = contact_age > OFFLINE_AFTER_S or (self.mode != "macro" and csi_age > OFFLINE_AFTER_S)
        standby = not offline and csi_age > (MACRO_HOLD_S if self.mode == "macro" else OFFLINE_AFTER_S)
        quiet = offline or standby
        return {
            "zone": self.zone,
            "device_id": self.device_id,
            "bridge_name": self.bridge_name,
            "ip": self.ip,
            "strategy": self.strategy,
            "mode": self.mode,
            "csi_active": not quiet,
            "state": "offline" if offline else "standby" if standby else self.state,
            "present": False if quiet else self.present,
            "confidence": 0.0 if quiet else round(self.confidence, 3),
            "activity": "none" if quiet else self.activity,
            "activity_ratio": 0.0 if quiet else round(max(self.ratio, 0.0), 2),
            "breathing": (
                {"state": "none", "bpm": None, "snr": 0.0, "readings": 0, "pattern": None, "signatures": []}
                if quiet else self.breathing_snapshot(now)
            ),
            "ble": (
                {**self.ble, "age_s": round(now - self.ble_ts, 1)}
                if self.ble and not offline and now - self.ble_ts <= BLE_STALE_S else None
            ),
            "sweep": self._sweep_snapshot(now, offline),
            "score": round(self.score, 4),
            "baseline": round(self.baseline, 4),
            "threshold": round(self.threshold, 4),
            "rssi": round(self.rssi, 1),
            "last_seen": self.last_seen,
            "last_present": self.last_present,
            "age_s": None if self.last_contact == 0 else round(now - self.last_contact, 1),
            "windows": self.windows_total,
            "frames": self.frames_total,
            "learning_progress": min(1.0, len(self._baseline) / LEARN_WINDOWS),
            "history": [{"t": t, "score": round(s, 4), "present": p} for t, s, p in list(self.history)[-60:]],
        }


class PresenceRegistry:
    """Holds one detector per (device, zone). In-memory; rebuilds on restart."""

    def __init__(self) -> None:
        self._zones: dict[tuple[str, str], ZoneState] = {}

    def zone(self, device_id: str, zone: str) -> ZoneState:
        key = (device_id, zone)
        if key not in self._zones:
            # A bridge senses one place at a time: when it reports under a new
            # zone name, its earlier zone entries are stale and are dropped.
            for old in [k for k in self._zones if k[0] == device_id]:
                del self._zones[old]
            self._zones[key] = ZoneState(zone=zone, device_id=device_id)
        return self._zones[key]

    def snapshots(self) -> list[dict]:
        now = time.time()
        # A zone silent for over an hour is a ghost (renamed, retired or test device), not an
        # offline sensor worth showing; a bridge that comes back simply reappears.
        for key in [k for k, z in self._zones.items() if z.last_seen and now - z.last_seen > GHOST_AFTER_S]:
            del self._zones[key]
        return [z.snapshot(now) for z in self._zones.values()]

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
    last_present: float = 0.0
    windows_total: int = 0
    frames_total: int = 0
    rssi: float = 0.0
    history: Deque[tuple[float, float, bool]] = field(default_factory=lambda: deque(maxlen=120))
    ratio: float = 0.0  # (score - baseline) / (threshold - baseline): 0 = still, 1 = detection threshold
    breath_snr: float = 0.0
    ble: dict | None = None
    ble_ts: float = 0.0
    _breath: Deque[tuple[float, float, float]] = field(default_factory=lambda: deque(maxlen=24))  # (ts, bpm, snr)
    _peaks: Deque[tuple[float, float, float]] = field(default_factory=lambda: deque(maxlen=150))  # every peak: (ts, bpm, snr)

    # internals
    _baseline: Deque[float] = field(default_factory=lambda: deque(maxlen=BASELINE_WINDOWS))
    _recent: Deque[bool] = field(default_factory=lambda: deque(maxlen=ENTER_OF))

    def update(self, ts: float, n: int, rssi_mean: float, rssi_std: float, amp_cv: float, decorr: float) -> None:
        self.last_seen = ts
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

    def snapshot(self, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        offline = self.last_seen == 0 or (now - self.last_seen) > OFFLINE_AFTER_S
        return {
            "zone": self.zone,
            "device_id": self.device_id,
            "bridge_name": self.bridge_name,
            "ip": self.ip,
            "state": "offline" if offline else self.state,
            "present": False if offline else self.present,
            "confidence": 0.0 if offline else round(self.confidence, 3),
            "activity": "none" if offline else self.activity,
            "activity_ratio": 0.0 if offline else round(max(self.ratio, 0.0), 2),
            "breathing": (
                {"state": "none", "bpm": None, "snr": 0.0, "readings": 0, "pattern": None, "signatures": []}
                if offline else self.breathing_snapshot(now)
            ),
            "ble": (
                {**self.ble, "age_s": round(now - self.ble_ts, 1)}
                if self.ble and not offline and now - self.ble_ts <= BLE_STALE_S else None
            ),
            "score": round(self.score, 4),
            "baseline": round(self.baseline, 4),
            "threshold": round(self.threshold, 4),
            "rssi": round(self.rssi, 1),
            "last_seen": self.last_seen,
            "last_present": self.last_present,
            "age_s": None if self.last_seen == 0 else round(now - self.last_seen, 1),
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

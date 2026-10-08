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

    def snapshot(self, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        offline = self.last_seen == 0 or (now - self.last_seen) > OFFLINE_AFTER_S
        return {
            "zone": self.zone,
            "device_id": self.device_id,
            "bridge_name": self.bridge_name,
            "state": "offline" if offline else self.state,
            "present": False if offline else self.present,
            "confidence": 0.0 if offline else round(self.confidence, 3),
            "activity": "none" if offline else self.activity,
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
        return [z.snapshot(now) for z in self._zones.values()]

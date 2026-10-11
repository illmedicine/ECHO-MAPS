"""Link rotating BLE ids back into physical devices.

Phones, watches and earbuds hide behind private BLE addresses that change every ~15 minutes, so
one device shows up as a series of unrelated ids. The bridge only reports salted, truncated
hashes, so the real address (and with it any address prefix) is never available. What *is*
observable is how the ids behave when a device rotates:

  * The old id stops being heard at the very moment a new id starts being heard.
  * Both are at about the same signal strength (the device did not move).
  * Both carry the same manufacturer, read from the BLE company id inside the advertisement
    (Apple, Samsung, Google, ...), which survives rotation. Addresses themselves do not share a
    prefix once they rotate; that is the point of rotating them.

Two ids are linked into one device when the first ends and the second begins within a few seconds,
their signal strength agrees, and the manufacturers do not contradict each other. A matching
manufacturer is strong evidence; with an unknown manufacturer on either side only a tighter time
and signal match is accepted; two known but different manufacturers are never linked.

Counting does not need the pairing to be perfect: every accepted link removes exactly one id from
the device count, so a crowd rotating at once can still be paired wrongly without changing how
many devices there are.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field

MAX_GAP_S = 10.0          # new id may start up to this long after the old one stops
MAX_OVERLAP_S = 3.0       # ...or up to this long before (timestamp quantisation)
MAX_RSSI_DELTA = 15       # dB between the old id's last and the new id's first signal
UNKNOWN_MFR_GAP_S = 5.0   # tighter limits when a manufacturer cannot confirm the match
UNKNOWN_MFR_RSSI = 10
MIN_SAMPLES = 2           # an id heard once is a blip, not a device

# BLE company ids (Bluetooth SIG assigned numbers) that commonly show up in phones, wearables and
# accessories. Anything else is reported as "Other".
MFR_NAMES = {
    "004c": "Apple",
    "0006": "Microsoft",
    "0075": "Samsung",
    "00e0": "Google",
    "0087": "Garmin",
    "012d": "Sony",
    "009e": "Bose",
    "038f": "Xiaomi",
    "027d": "Huawei",
    "0171": "Amazon",
    "0002": "Intel",
    "000a": "Qualcomm",
}


def mfr_name(code: str | None) -> str:
    if not code:
        return "Unknown"
    return MFR_NAMES.get(code.lower(), "Other")


@dataclass
class Chain:
    """One physical device inferred from one or more ids."""
    ids: list[dict] = field(default_factory=list)
    first_seen: int = 0
    last_seen: int = 0
    mfr: str = ""

    @property
    def linked(self) -> int:
        return len(self.ids) - 1


def _compatible(a: dict, b: dict) -> bool:
    ma, mb = (a.get("mfr") or "").lower(), (b.get("mfr") or "").lower()
    return not (ma and mb and ma != mb)


def _score(a: dict, b: dict) -> float | None:
    """How well id `b` continues id `a`, or None if it cannot be the same device."""
    gap = b["first_seen"] - a["last_seen"]
    if gap > MAX_GAP_S or gap < -MAX_OVERLAP_S:
        return None
    dr = abs(a["rssi_last"] - b["rssi_first"])
    if dr > MAX_RSSI_DELTA:
        return None
    if not _compatible(a, b):
        return None                                   # two different known manufacturers
    ma, mb = (a.get("mfr") or "").lower(), (b.get("mfr") or "").lower()
    confirmed = bool(ma and mb)                       # compatible + both known => equal
    if not confirmed and (max(gap, 0) > UNKNOWN_MFR_GAP_S or dr > UNKNOWN_MFR_RSSI):
        return None                                   # nothing but timing to go on: be strict
    score = 1.0 - max(gap, 0) / MAX_GAP_S             # simultaneous is best
    score += 0.5 if confirmed else 0.0
    score += 0.25 * (1.0 - dr / MAX_RSSI_DELTA)
    return score


def link_rotating(rows: list[dict], *, min_samples: int = MIN_SAMPLES) -> list[Chain]:
    """Group rotating-address sightings into devices. `rows` are sightings of one or more
    bridges; ids are only ever linked within the same bridge."""
    chains: list[Chain] = []
    by_bridge: dict[str, list[dict]] = {}
    for r in rows:
        if r.get("rotating") and r.get("samples", 0) >= min_samples:
            by_bridge.setdefault(r["device_id"], []).append(r)

    for sightings in by_bridge.values():
        order = sorted(range(len(sightings)), key=lambda i: sightings[i]["first_seen"])
        firsts = [sightings[i]["first_seen"] for i in order]
        pairs: list[tuple[float, int, int]] = []
        for ai, a in enumerate(sightings):
            lo = bisect_left(firsts, a["last_seen"] - MAX_OVERLAP_S)
            hi = bisect_right(firsts, a["last_seen"] + MAX_GAP_S)
            for pos in range(lo, hi):
                bi = order[pos]
                if bi == ai:
                    continue
                b = sightings[bi]
                if b["last_seen"] <= a["last_seen"] and b["first_seen"] <= a["first_seen"]:
                    continue                          # b is not a continuation, it is earlier
                sc = _score(a, b)
                if sc is not None:
                    pairs.append((sc, ai, bi))
        pairs.sort(reverse=True)
        succ: dict[int, int] = {}
        has_pred: set[int] = set()
        for _sc, ai, bi in pairs:
            if ai in succ or bi in has_pred:
                continue
            succ[ai] = bi
            has_pred.add(bi)

        for start in range(len(sightings)):
            if start in has_pred:
                continue
            ids, i = [], start
            while True:
                ids.append(sightings[i])
                if i not in succ:
                    break
                i = succ[i]
            mfr = next((x["mfr"].lower() for x in ids if x.get("mfr")), "")
            chains.append(Chain(
                ids=ids,
                first_seen=min(x["first_seen"] for x in ids),
                last_seen=max(x["last_seen"] for x in ids),
                mfr=mfr,
            ))
    return chains


def peak_concurrent(intervals: list[tuple[int, int]]) -> int:
    """Most intervals overlapping at any instant: a floor on how many devices there were."""
    events = []
    for s, e in intervals:
        events.append((s, 1))
        events.append((e + 1, -1))
    events.sort()
    cur = best = 0
    for _t, d in events:
        cur += d
        best = max(best, cur)
    return best

"""Estimates and statistics from recorded history.

Everything here is an *estimate*, and says so. The sensors cannot count individual people:

  * BLE devices - ids that rotate are linked back into devices (see linking.py); ids that do not
    rotate count once each. Always-present stable devices (TVs, hubs, beacons) are reported
    separately and left out of the people estimate.
  * People - from the device estimate (people carry about DEVICES_PER_PERSON advertising devices)
    and from distinct breathing signatures, bounded by how many were ever seen at once and by how
    many separate signature episodes there were.
  * Pets - from distinct fast breathing signatures. A fast breather could also be a child or someone
    who just exercised.

Every figure carries a low/high range and a plain-language basis, and the whole summary reports how
much of the window actually had data, so a quiet number is never mistaken for an empty hallway.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from statistics import median
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from echo_maps.history.linking import Chain, link_rotating, mfr_name, peak_concurrent

# Advertising BLE devices carried per person (phone, watch, earbuds...). Apple users very often add
# a Watch and AirPods that advertise separately, so the ratio rises with the Apple share of the
# visiting devices: ~1.3 with none, ~1.5 when about half are Apple (a typical hotel crowd).
DEVICES_PER_PERSON = 1.3
DEVICES_PER_PERSON_APPLE_BOOST = 0.4
DEVICES_PER_PERSON_MAX = 1.6
# A stable (non-rotating) address is almost never a modern phone: it is a TV, printer, desktop, POS
# or beacon. One that is present for most of the time we have data for is treated as equipment and
# left out of the visitor and people counts. The span needed is deliberately short, because the
# front-desk printer is obvious after 10 minutes and should not inflate the count while we wait an hour.
FIXTURE_SHARE = 0.7
FIXTURE_MIN_WINDOW_S = 600
RECURRING_VISITS = 3         # a stable device that came back this many times is a regular
PERSON_BPM_TOL = 1.5         # breathing signatures this close are the same occupant
PET_BPM_TOL = 2.5
OCCUPANCY_MERGE_GAP_S = 120  # occupied minutes closer together than this are one stay
NEAR_RSSI = -70


def _tz(name: str | None):
    try:
        return ZoneInfo(name) if name else timezone.utc
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def occupancy_periods(buckets: list[dict]) -> list[tuple[int, int]]:
    """Stays: runs of minutes in which the area was occupied, bridged across short silences."""
    minutes = sorted(b["ts"] for b in buckets if b["present_samples"] > 0)
    periods: list[list[int]] = []
    for m in minutes:
        if periods and m - periods[-1][1] <= OCCUPANCY_MERGE_GAP_S + 60:
            periods[-1][1] = m
        else:
            periods.append([m, m])
    return [(s, e + 60) for s, e in periods]


def _cluster(values: list[float], tol: float) -> int:
    """Number of groups when sorted values are split wherever the gap exceeds `tol`."""
    if not values:
        return 0
    vs = sorted(values)
    groups, start = 1, vs[0]
    for v in vs[1:]:
        if v - start > tol:
            groups += 1
            start = v
    return groups


def _confidence(coverage: float, signal: int) -> str:
    """Rough trust in an estimate from how much of the window had data and how much was seen."""
    if coverage >= 0.8 and signal >= 10:
        return "high"
    if coverage >= 0.4 and signal >= 3:
        return "medium"
    return "low"


def _round(x: float) -> int:
    return int(x + 0.5)


def _pct(frac: float) -> str:
    v = frac * 100
    return "<1%" if 0 < v < 1 else f"{round(v)}%"


def _span(low: int, high: int) -> str:
    return f"{low}" if low == high else f"{low}–{high}"


def estimate(
    buckets: list[dict],
    sightings: list[dict],
    episodes: list[dict],
    start: float,
    end: float,
    *,
    tz: str | None = None,
) -> dict:
    window_s = max(end - start, 60.0)
    minutes_total = max(int(window_s // 60), 1)
    data_minutes = len({b["ts"] for b in buckets if b["samples"] > 0})
    coverage = min(1.0, data_minutes / minutes_total)

    # ── devices ──
    near = [s for s in sightings if s.get("near_samples", 0) > 0 and s.get("samples", 0) >= 2]
    stable = [s for s in near if not s["rotating"]]
    rotating = [s for s in near if s["rotating"]]
    span_s = min(window_s, max(data_minutes * 60, 1))     # time we actually have data for
    long_window = span_s >= FIXTURE_MIN_WINDOW_S
    fixtures = [s for s in stable if long_window and s["seconds"] >= FIXTURE_SHARE * span_s]
    visitors_stable = [s for s in stable if s not in fixtures]
    chains: list[Chain] = link_rotating(near)
    linked = sum(c.linked for c in chains)
    peak_rot = peak_concurrent([(c.first_seen, c.last_seen) for c in chains])
    dev_point = len(visitors_stable) + len(chains)
    dev_low = len(visitors_stable) + (peak_rot if chains else 0)
    dev_high = len(visitors_stable) + len(rotating)
    mfr_counts: Counter[str] = Counter()
    for s in visitors_stable:
        mfr_counts[mfr_name(s.get("mfr"))] += 1
    for c in chains:
        mfr_counts[mfr_name(c.mfr)] += 1
    peak_near = max((b["ble_near_max"] for b in buckets), default=0)

    # ── occupancy / visits ──
    periods = occupancy_periods(buckets)
    dwell = [e - s for s, e in periods]
    occupied_s = sum(min(1.0, b["present_samples"] / max(b["samples"], 1)) * 60 for b in buckets)

    # ── people ──
    person_eps = [e for e in episodes if e["kind"] == "slower"]
    person_clusters = _cluster([e["bpm_mean"] for e in person_eps], PERSON_BPM_TOL)
    people_peak = max((b["people_max"] for b in buckets), default=0)
    p_low = max(people_peak, 1 if periods else 0)
    apple = mfr_counts.get("Apple", 0)
    apple_share = apple / dev_point if dev_point else 0.0
    per_person = min(DEVICES_PER_PERSON_MAX, DEVICES_PER_PERSON + DEVICES_PER_PERSON_APPLE_BOOST * apple_share)
    from_devices = dev_point / per_person
    p_high = max(_round(dev_high), len(person_eps), p_low)
    p_point = min(max(_round(max(from_devices, person_clusters)), p_low), p_high)
    people_basis = [
        f"{dev_point} estimated device(s) ÷ {per_person:.2f} devices per person ≈ {_round(from_devices)} "
        f"({_pct(apple_share)} Apple, which tends to mean a Watch or earbuds as well)",
        f"{person_clusters} distinct breathing signature(s) across {len(person_eps)} episode(s)",
        f"{people_peak} seen breathing at the same time; {len(periods)} separate occupied period(s)",
    ]

    # ── regulars vs one-time visitors (stable-id devices only) ──
    recurring = [s for s in visitors_stable if s["visits"] >= RECURRING_VISITS]
    share = len(recurring) / len(visitors_stable) if visitors_stable else 0.0
    guests_point = max(0, _round(p_point * (1 - share)))

    # ── pets ──
    pet_eps = [e for e in episodes if e["kind"] == "faster"]
    pet_clusters = _cluster([e["bpm_mean"] for e in pet_eps], PET_BPM_TOL)
    pets_peak = max((b["pets_max"] for b in buckets), default=0)
    pt_low = max(pets_peak, 1 if pet_eps else 0)
    pt_high = max(len(pet_eps), pt_low)
    pt_point = min(max(pet_clusters, pt_low), pt_high)

    people_conf = _confidence(coverage, dev_point + len(person_eps))
    pets_conf = _confidence(coverage, len(pet_eps) * 3)

    return {
        "window": {
            "start": int(start), "end": int(end), "hours": round(window_s / 3600, 2),
            "data_minutes": data_minutes, "coverage": round(coverage, 3),
            "first_data": min((b["ts"] for b in buckets), default=None),
            "last_data": max((b["ts"] for b in buckets), default=None),
            "tz": tz or "UTC",
        },
        "devices": {
            "estimate": dev_point, "low": dev_low, "high": dev_high,
            "stable": len(visitors_stable), "rotating_ids": len(rotating), "linked": linked,
            "rotating_devices": len(chains), "fixtures": len(fixtures), "peak_nearby": peak_near,
            "by_manufacturer": [{"name": n, "count": c} for n, c in mfr_counts.most_common()],
            "confidence": _confidence(coverage, dev_point),
            "basis": [
                f"{len(visitors_stable)} device(s) with a fixed identity",
                f"{len(rotating)} rotating id(s) linked into {len(chains)} device(s) "
                f"({linked} link(s): an id vanishing as another appears at the same moment and signal)",
                f"{len(fixtures)} always-present device(s) excluded (likely equipment)",
            ],
        },
        "people": {"estimate": p_point, "low": p_low, "high": p_high, "confidence": people_conf, "basis": people_basis},
        "guests": {
            "estimate": guests_point, "regulars": max(0, p_point - guests_point),
            "recurring_devices": len(recurring),
            "basis": [f"Assumes devices that came back {RECURRING_VISITS}+ times are regulars (staff/residents); "
                      f"{len(recurring)} of {len(visitors_stable)} fixed-identity device(s) did"],
        },
        "pets": {
            "estimate": pt_point, "low": pt_low, "high": pt_high, "confidence": pets_conf,
            "basis": [f"{pet_clusters} distinct fast breathing signature(s) across {len(pet_eps)} episode(s)",
                      "A fast breather could also be a child or someone who just exercised"],
        },
        "visits": {
            "count": len(periods),
            "occupied_minutes": round(occupied_s / 60, 1),
            "occupied_pct": round(100 * occupied_s / (data_minutes * 60), 1) if data_minutes else 0.0,
            "median_dwell_s": int(median(dwell)) if dwell else 0,
            "mean_dwell_s": int(sum(dwell) / len(dwell)) if dwell else 0,
            "longest_s": max(dwell, default=0),
        },
    }


def hourly(buckets: list[dict], start: float, end: float) -> list[dict]:
    """One entry per clock hour in the window, in UTC hour starts (the UI localises them)."""
    first = int(start // 3600) * 3600
    out: dict[int, dict] = {}
    for h in range(first, int(end) + 1, 3600):
        out[h] = {"t": h, "occupied_pct": 0.0, "devices_max": 0, "people_max": 0, "pets_max": 0, "minutes": 0, "_occ": 0.0}
    for b in buckets:
        h = int(b["ts"] // 3600) * 3600
        o = out.get(h)
        if o is None:
            continue
        o["minutes"] += 1
        o["_occ"] += min(1.0, b["present_samples"] / max(b["samples"], 1))
        o["devices_max"] = max(o["devices_max"], b["ble_near_max"])
        o["people_max"] = max(o["people_max"], b["people_max"])
        o["pets_max"] = max(o["pets_max"], b["pets_max"])
    rows = []
    for h in sorted(out):
        o = out[h]
        o["occupied_pct"] = round(100 * o.pop("_occ") / o["minutes"], 1) if o["minutes"] else 0.0
        rows.append(o)
    return rows


def by_area(buckets: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for b in buckets:
        groups.setdefault(b.get("area") or "Unknown area", []).append(b)
    rows = []
    for area, bs in groups.items():
        minutes = len({b["ts"] for b in bs})
        occ = sum(min(1.0, b["present_samples"] / max(b["samples"], 1)) for b in bs)
        rows.append({
            "area": area, "minutes": minutes,
            "occupied_pct": round(100 * occ / minutes, 1) if minutes else 0.0,
            "devices_peak": max(b["ble_near_max"] for b in bs),
            "people_peak": max(b["people_max"] for b in bs),
            "pets_peak": max(b["pets_max"] for b in bs),
        })
    rows.sort(key=lambda r: -r["occupied_pct"])
    return rows


def _fmt_hour(epoch: int, tz) -> str:
    """e.g. "Tue 2 PM" in the viewer's timezone (no platform-specific strftime flags)."""
    dt = datetime.fromtimestamp(epoch, tz)
    return f"{dt.strftime('%a')} {dt.hour % 12 or 12} {'AM' if dt.hour < 12 else 'PM'}"


def _dur(seconds: int) -> str:
    if seconds < 90:
        return f"{seconds}s"
    if seconds < 5400:
        return f"{round(seconds / 60)} min"
    return f"{seconds / 3600:.1f} h"


def rule_insights(summary: dict, series: list[dict], areas: list[dict], tz_name: str | None = None) -> list[dict]:
    """Plain observations that need no AI: always available, and the fallback when no AI key is set."""
    tz = _tz(tz_name)
    w, d, p, pt, v = summary["window"], summary["devices"], summary["people"], summary["pets"], summary["visits"]
    out: list[dict] = []

    if w["data_minutes"] == 0:
        return [{"title": "No data in this period", "detail": "No bridge reported during the selected window. History is recorded from the moment this feature went live.", "confidence": "high"}]

    out.append({
        "title": "Traffic summary",
        "detail": (f"About {p['estimate']} people (likely {_span(p['low'], p['high'])}) and {d['estimate']} devices "
                   f"(likely {_span(d['low'], d['high'])}) came near the sensor over {w['hours']} h; "
                   f"{v['count']} separate occupied period(s), occupied {v['occupied_pct']}% of recorded time."),
        "confidence": p["confidence"],
    })
    busy = [r for r in series if r["minutes"] >= 10]
    if busy:
        top = max(busy, key=lambda r: (r["occupied_pct"], r["devices_max"]))
        if top["occupied_pct"] > 0:
            out.append({
                "title": "Busiest hour",
                "detail": f"{_fmt_hour(top['t'], tz)} was busiest: occupied {top['occupied_pct']}% of the hour with up to "
                          f"{top['devices_max']} nearby device(s).",
                "confidence": "medium",
            })
        quiet = [r for r in busy if r["occupied_pct"] == 0]
        if quiet:
            out.append({"title": "Quiet periods", "detail": f"{len(quiet)} recorded hour(s) saw no occupancy at all.", "confidence": "medium"})
    if v["count"]:
        out.append({
            "title": "How long people stay",
            "detail": f"Typical stay {_dur(v['median_dwell_s'])} (median), longest {_dur(v['longest_s'])}. "
                      + ("Short stays suggest people passing through." if v["median_dwell_s"] < 120 else "Longer stays suggest people lingering or waiting."),
            "confidence": "medium",
        })
    if pt["estimate"]:
        out.append({
            "title": "Pets",
            "detail": f"About {pt['estimate']} pet(s) (likely {_span(pt['low'], pt['high'])}) were detected by fast breathing signatures. "
                      "Treat this as a hint: a fast breather may also be a child or someone who just exercised.",
            "confidence": pt["confidence"],
        })
    if d["fixtures"]:
        out.append({"title": "Always-on devices", "detail": f"{d['fixtures']} device(s) were present almost the whole time, likely equipment, and are not counted as visitors.", "confidence": "medium"})
    if d["rotating_ids"] > d["rotating_devices"]:
        out.append({
            "title": "Rotating addresses merged",
            "detail": f"{d['rotating_ids']} rotating Bluetooth ids were merged into {d['rotating_devices']} devices by matching "
                      "ids that vanished and appeared at the same moment and signal strength.",
            "confidence": "medium",
        })
    if len(areas) > 1:
        a = areas[0]
        out.append({"title": "Most active area", "detail": f"{a['area']} was occupied {a['occupied_pct']}% of the time.", "confidence": "medium"})
    if w["coverage"] < 0.6:
        out.append({
            "title": "Limited data",
            "detail": f"Only {_pct(w['coverage'])} of this window has sensor data, so counts are likely too low.",
            "confidence": "high",
        })
    return out

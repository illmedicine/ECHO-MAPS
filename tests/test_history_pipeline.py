"""Recorder -> store -> analytics over a simulated three-hour afternoon in a hallway.

The sensors are simulated (there is no real input to replay); everything that processes their output is
the production code, not a stand-in.
"""

import asyncio

from echo_maps.history import analytics
from echo_maps.history.recorder import Recorder
from echo_maps.history.store import HistoryService, MemoryStore

APPLE, SAMSUNG = "004c", "0075"
T0 = 1_800_000_000          # arbitrary fixed start (a multiple of 3600)
DEV = "bridge-1"


class Scene:
    """Drives a Recorder the way the ingest route does: one observation every 2 s."""

    def __init__(self, hours: float = 3.0):
        self.rec = Recorder()
        self.end = T0 + int(hours * 3600)

    def run(self, devices, sigs=lambda t: [], present=lambda t: False):
        for t in range(T0, self.end, 2):
            devs = []
            for d in devices:
                if d["from"] <= t < d["to"]:
                    devs.append({"id": d["id"], "rssi": d.get("rssi", -55), "t": 1 if d.get("rotating") else 0,
                                 "p": 0, "age": 0, "fa": t - d["from"], **({"m": d["m"]} if d.get("m") else {})})
            ble = {"count": len(devs), "near": len(devs), "persistent": 0,
                   "stable": sum(1 for d in devs if not d["t"]), "devices": devs}
            self.rec.observe(device_id=DEV, area="Floor 3 Hallway", bridge_name="Illy Bridge 1", ts=t,
                             present=present(t), ratio=2.0 if present(t) else 0.0,
                             signatures=sigs(t), ble=ble, uptime_s=t - T0 + 5)

    async def report(self):
        svc = HistoryService(sql=None)
        svc.recorder = self.rec
        batch = await svc.query(DEV, T0, self.end)
        buckets = [b for b in batch.buckets if T0 - 60 <= b["ts"] <= self.end]
        return analytics.estimate(buckets, batch.sightings, batch.episodes, T0, self.end), buckets, batch


def minutes(m):
    return T0 + m * 60


def test_afternoon_in_the_hallway():
    # a guest's Apple phone rotates its address at minute 25, exactly as the old id stops
    guest = [
        dict(id="a00001", rotating=True, m=APPLE, **{"from": minutes(20), "to": minutes(25)}),
        dict(id="a00002", rotating=True, m=APPLE, **{"from": minutes(25), "to": minutes(40)}),
    ]
    # a second guest, Samsung, passes through quickly
    guest2 = [dict(id="b00001", rotating=True, m=SAMSUNG, rssi=-62, **{"from": minutes(100), "to": minutes(108)})]
    # staff phone with a fixed identity returns three times
    staff = [dict(id="c00001", rotating=False, **{"from": minutes(a), "to": minutes(a) + 420}) for a in (30, 90, 150)]
    # one id, wearing the same id each time (stable), so it is a single device with 3 visits
    for s in staff:
        s["id"] = "c00001"
    # a smart TV: stable and present the whole time -> fixture, not a visitor
    tv = [dict(id="d00001", rotating=False, **{"from": T0, "to": T0 + 3 * 3600})]

    scene = Scene()
    scene.run(
        guest + guest2 + staff + tv,
        present=lambda t: minutes(20) <= t < minutes(40) or minutes(100) <= t < minutes(108) or any(minutes(a) <= t < minutes(a) + 420 for a in (30, 90, 150)),
        sigs=lambda t: ([{"kind": "slower", "bpm": 14.2, "snr": 9.0, "readings": 6}] if minutes(22) <= t < minutes(38) else [])
        + ([{"kind": "faster", "bpm": 28.0, "snr": 7.0, "readings": 6}] if minutes(60) <= t < minutes(70) else []),
    )
    summary, buckets, batch = asyncio.run(scene.report())

    d = summary["devices"]
    assert d["fixtures"] == 1                                   # the TV
    assert d["stable"] == 1                                     # the staff phone, counted once
    assert d["rotating_ids"] == 3 and d["rotating_devices"] == 2   # guest's two ids merged; Samsung separate
    assert d["linked"] == 1
    assert d["estimate"] == 3 and d["low"] <= 3 <= d["high"]    # staff + 2 rotating devices
    assert {m["name"]: m["count"] for m in d["by_manufacturer"]} == {"Apple": 1, "Samsung": 1, "Unknown": 1}

    p = summary["people"]
    assert p["low"] <= p["estimate"] <= p["high"] and p["estimate"] >= 2

    g = summary["guests"]
    assert g["recurring_devices"] == 1                          # the staff phone came back 3 times
    assert g["estimate"] < p["estimate"]                        # regulars are not guests

    assert summary["pets"]["estimate"] == 1 and summary["pets"]["low"] == 1

    v = summary["visits"]
    assert v["count"] >= 3 and v["longest_s"] >= 20 * 60
    assert summary["window"]["coverage"] > 0.99


def test_empty_hallway_reports_zero_not_nothing():
    scene = Scene(hours=1)
    scene.run([])
    summary, *_ = asyncio.run(scene.report())
    assert summary["devices"]["estimate"] == 0 and summary["people"]["estimate"] == 0
    assert summary["pets"]["estimate"] == 0 and summary["visits"]["count"] == 0
    assert summary["window"]["data_minutes"] > 0


def test_no_data_at_all_is_flagged_as_no_data():
    s = analytics.estimate([], [], [], T0, T0 + 3600)
    assert s["window"]["data_minutes"] == 0 and s["window"]["coverage"] == 0
    obs = analytics.rule_insights(s, [], [])
    assert obs[0]["title"] == "No data in this period"


def test_salt_epoch_survives_a_server_restart_and_splits_on_reboot():
    a, b = Recorder(), Recorder()
    a.observe(device_id=DEV, area="x", bridge_name="", ts=T0 + 100, present=False, ratio=0, signatures=[], ble=None, uptime_s=100)
    b.observe(device_id=DEV, area="x", bridge_name="", ts=T0 + 5000, present=False, ratio=0, signatures=[], ble=None, uptime_s=4902)  # ~2 s skew
    assert a.salt_epoch(DEV, T0 + 100) // 1000 == b.salt_epoch(DEV, T0 + 5000) // 1000    # same boot
    b.observe(device_id=DEV, area="x", bridge_name="", ts=T0 + 9000, present=False, ratio=0, signatures=[], ble=None, uptime_s=30)    # rebooted
    assert b.salt_epoch(DEV, T0 + 9000) // 1000 != a.salt_epoch(DEV, T0 + 100) // 1000


def test_visits_count_separate_stays_of_one_id():
    rec = Recorder()
    for t in list(range(T0, T0 + 120, 2)) + list(range(T0 + 1000, T0 + 1120, 2)):    # gone ~16 min in between
        rec.observe(device_id=DEV, area="x", bridge_name="", ts=t, present=False, ratio=0, signatures=[], uptime_s=t - T0 + 1,
                    ble={"count": 1, "near": 1, "persistent": 0, "stable": 1, "devices": [{"id": "cc0001", "rssi": -50, "t": 0, "p": 0, "age": 0, "fa": 0}]})
    (s,) = rec.drain().sightings
    assert s["visits"] == 2 and s["near_samples"] == s["samples"] and not s["rotating"]


def test_signature_episodes_continue_then_close():
    rec = Recorder()
    sig = lambda bpm: [{"kind": "slower", "bpm": bpm, "snr": 8.0, "readings": 5}]  # noqa: E731
    for t in range(T0, T0 + 60, 2):
        rec.observe(device_id=DEV, area="x", bridge_name="", ts=t, present=True, ratio=1, signatures=sig(14.0 + (t % 3) * 0.2), ble=None)
    for t in range(T0 + 600, T0 + 660, 2):                       # 10 minutes later the same rate returns: a new episode
        rec.observe(device_id=DEV, area="x", bridge_name="", ts=t, present=True, ratio=1, signatures=sig(14.1), ble=None)
    eps = rec.drain().episodes
    assert len(eps) == 2 and all(abs(e["bpm_mean"] - 14.1) < 0.5 for e in eps)


def test_memory_fallback_keeps_data_and_queries_merge_sources():
    async def go():
        svc = HistoryService(sql=None)          # no database configured: memory only
        svc.recorder.observe(device_id=DEV, area="x", bridge_name="", ts=T0, present=True, ratio=1, signatures=[], ble=None)
        await svc.flush()
        assert svc._mem.size() == 1
        svc.recorder.observe(device_id=DEV, area="x", bridge_name="", ts=T0 + 120, present=False, ratio=0, signatures=[], ble=None)
        batch = await svc.query(DEV, T0 - 60, T0 + 300)             # one flushed row + one still in the recorder
        assert {b["ts"] for b in batch.buckets} == {T0, T0 + 120}
        assert await svc.first_ts(DEV) == T0
        return svc.persistence

    assert asyncio.run(go()) == "memory"


def test_equipment_is_recognised_after_ten_minutes_not_an_hour():
    # A 20-minute look at the lobby: a printer's fixed address is there the whole time, a staff phone
    # (also fixed, but only passing) is there for a few minutes. The printer must not count as a visitor.
    printer = [dict(id="f00001", rotating=False, rssi=-64, **{"from": T0, "to": T0 + 20 * 60})]
    staff = [dict(id="f00002", rotating=False, **{"from": minutes(5), "to": minutes(9)})]
    scene = Scene(hours=20 / 60)
    scene.run(printer + staff)
    summary, _b, _batch = asyncio.run(scene.report())
    d = summary["devices"]
    assert d["fixtures"] == 1 and d["stable"] == 1
    assert d["estimate"] == 1


def test_people_per_device_rises_with_the_apple_share():
    def people_basis(mfrs):
        devs = [dict(id=f"a{i:05x}", rotating=True, m=m, rssi=-55 - 5 * i, **{"from": minutes(10 * i), "to": minutes(10 * i + 8)})
                for i, m in enumerate(mfrs)]
        scene = Scene(hours=2)
        scene.run(devs)
        return asyncio.run(scene.report())[0]["people"]["basis"][0]

    assert "1.30 devices per person" in people_basis([SAMSUNG] * 4)
    assert "1.60 devices per person" in people_basis([APPLE] * 4)      # capped
    assert "1.50 devices per person" in people_basis([APPLE, APPLE, SAMSUNG, SAMSUNG])   # half Apple

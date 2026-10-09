import random
import time

from fastapi.testclient import TestClient

from echo_maps.csi.presence import ZoneState


def _quiet(z, t, rnd):
    z.update(t, 50, -55, 0.5 + rnd.random() * 0.2, 0.03 + rnd.random() * 0.01, 0.02 + rnd.random() * 0.01)


def _moving(z, t, rnd):
    z.update(t, 50, -55, 2.5, 0.20 + rnd.random() * 0.05, 0.25 + rnd.random() * 0.05)


def test_learns_then_detects_then_clears():
    rnd = random.Random(1)
    z = ZoneState(zone="Hallway", device_id="d")
    t = 1000.0
    for _ in range(40):
        _quiet(z, t, rnd); t += 1
    assert z.state == "empty" and not z.present
    for _ in range(4):
        _moving(z, t, rnd); t += 1
    assert z.present and z.state == "present"
    for _ in range(20):
        _quiet(z, t, rnd); t += 1
    assert not z.present and z.state == "empty"


def test_no_false_positive_on_quiet_noise():
    rnd = random.Random(2)
    z = ZoneState(zone="Hallway", device_id="d")
    for i in range(300):
        _quiet(z, 1000.0 + i, rnd)
        assert not z.present


def test_offline_when_no_data():
    z = ZoneState(zone="Hallway", device_id="d")
    assert z.snapshot()["state"] == "offline"
    z.update(time.time() - 100, 50, -55, 0.5, 0.03, 0.02)
    assert z.snapshot()["state"] == "offline"


def test_device_zone_rename_drops_stale_zone():
    from echo_maps.csi.presence import PresenceRegistry
    r = PresenceRegistry()
    r.zone("esp1", "Hallway").bridge_name = "Illy Bridge 1"
    r.zone("esp2", "Outdoor Pool")
    r.zone("esp1", "Floor 3 Hallway").bridge_name = "Illy Bridge 1"
    zones = {(s["device_id"], s["zone"]): s for s in r.snapshots()}
    assert set(zones) == {("esp1", "Floor 3 Hallway"), ("esp2", "Outdoor Pool")}
    assert zones[("esp1", "Floor 3 Hallway")]["bridge_name"] == "Illy Bridge 1"


def test_facility_areas_publish_and_read(monkeypatch):
    monkeypatch.setenv("PRESENCE_INGEST_KEY", "k" * 20)
    import echo_maps.config as cfg
    cfg._settings = None
    from echo_maps.api.app import create_app
    from echo_maps.api.deps import get_current_user
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: object()
    c = TestClient(app)
    h = {"X-Device-Key": "k" * 20}
    assert c.get("/api/presence/areas").status_code == 401  # bridges need the device key
    published = ["Floor 1 Hallway", "Floor 2 Hallway", "Front Desk / Lobby", "Room 304", "Bad<name>", "Floor 1 Hallway"]
    assert c.put("/api/presence/areas", json={"areas": published}).status_code == 200
    # private rooms, unsafe names and duplicates never reach a bridge's dropdown
    assert c.get("/api/presence/areas", headers=h).json()["areas"] == [
        "Floor 1 Hallway", "Floor 2 Hallway", "Front Desk / Lobby"]


def test_dashboard_configures_a_bridge_remotely(monkeypatch):
    monkeypatch.setenv("PRESENCE_INGEST_KEY", "k" * 20)
    import echo_maps.config as cfg
    cfg._settings = None
    from echo_maps.api.app import create_app
    from echo_maps.api.deps import get_current_user
    from echo_maps.api.routes import presence as routes
    routes._registry.__init__()
    routes._desired.clear()
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: object()
    c = TestClient(app)
    h = {"X-Device-Key": "k" * 20}
    win = [{"n": 40, "amp_cv": 0.03, "decorr": 0.02}]
    report = lambda zone, name: c.post("/api/presence/ingest", headers=h, json={  # noqa: E731
        "device_id": "bridge-1", "zone": zone, "bridge_name": name, "ip": "10.0.0.7", "windows": win}).json()

    c.put("/api/presence/areas", json={"areas": ["Floor 1 Hallway", "Floor 3 Hallway", "Outdoor Pool"]})
    cfg_url = "/api/presence/bridges/bridge-1/config"
    assert c.put(cfg_url, json={"area": "Outdoor Pool"}).status_code == 404  # never reported

    assert "config" not in report("Unassigned", "Illy Bridge")
    b = c.get("/api/presence/bridges").json()["bridges"][0]
    assert (b["device_id"], b["area"], b["ip"], b["pending"]) == ("bridge-1", "Unassigned", "10.0.0.7", None)

    assert c.put(cfg_url, json={"area": "Floor 4 Hallway"}).status_code == 422   # not in this facility
    assert c.put(cfg_url, json={"area": "Room 304"}).status_code == 403          # private
    assert c.put(cfg_url, json={"bridge_name": "bad<name>"}).status_code == 422
    assert c.put(cfg_url, json={}).status_code == 422

    assert c.put(cfg_url, json={"bridge_name": "Illy Bridge 1", "area": "Floor 3 Hallway"}).status_code == 200
    assert c.get("/api/presence/bridges").json()["bridges"][0]["pending"]["area"] == "Floor 3 Hallway"
    # the bridge is told on its next upload, and keeps being told until it reports the change
    assert report("Unassigned", "Illy Bridge")["config"] == {"bridge_name": "Illy Bridge 1", "area": "Floor 3 Hallway"}
    assert "config" in report("Unassigned", "Illy Bridge")
    assert "config" not in report("Floor 3 Hallway", "Illy Bridge 1")
    b = c.get("/api/presence/bridges").json()["bridges"][0]
    assert (b["area"], b["bridge_name"], b["pending"]) == ("Floor 3 Hallway", "Illy Bridge 1", None)
    assert [z["zone"] for z in routes._registry.snapshots()] == ["Floor 3 Hallway"]  # old zone dropped


def test_breathing_needs_agreeing_readings():
    z = ZoneState(zone="Floor 3 Hallway", device_id="d")
    now = time.time()
    assert z.breathing_snapshot(now)["state"] == "none"
    z.update_breathing(now - 20, 14.0, 6.0, True)
    assert z.breathing_snapshot(now)["state"] == "none"          # one reading is not enough
    for i, bpm in enumerate((14.4, 13.8, 14.1)):
        z.update_breathing(now - 15 + 5 * i, bpm, 5.0, True)
    b = z.breathing_snapshot(now)
    assert (b["state"], b["pattern"], b["readings"]) == ("good", "steady", 4)
    assert 13.9 <= b["bpm"] <= 14.2
    # noise and out-of-range readings are never recorded
    z2 = ZoneState(zone="z", device_id="d")
    z2.update_breathing(now, 14.0, 2.0, True)    # below the SNR floor
    z2.update_breathing(now, 45.0, 9.0, True)    # not a plausible breathing rate
    z2.update_breathing(now, 14.0, 9.0, False)   # device says it did not detect one
    assert z2.breathing_snapshot(now)["readings"] == 0
    # readings that disagree are 'weak', and old readings age out
    z3 = ZoneState(zone="z", device_id="d")
    for i, bpm in enumerate((8.0, 20.0, 12.0, 25.0)):
        z3.update_breathing(now - 12 + 3 * i, bpm, 6.0, True)
    assert z3.breathing_snapshot(now)["state"] == "weak"
    assert z3.breathing_snapshot(now + 100)["state"] == "none"


def test_breathing_signatures_count_distinct_steady_rates():
    z = ZoneState(zone="z", device_id="d")
    now = time.time()
    # six analyses (~5 s apart): a steady ~14/min, a steady ~24/min, and one stray blip at 9/min
    for i in range(6):
        t = now - 30 + 5 * i
        peaks = [(14.0 + 0.3 * (i % 2), 9.0), (24.0 - 0.4 * (i % 3), 6.0)]
        if i == 2:
            peaks.append((9.0, 4.0))
        z.update_breathing(t, peaks[0][0], peaks[0][1], True, tuple(peaks))
    sigs = z.breathing_snapshot(now)["signatures"]
    assert [(round(g["bpm"]), g["kind"]) for g in sigs] == [(14, "slower"), (24, "faster")]   # strongest first
    assert all(g["readings"] >= 4 for g in sigs)                       # the 9/min blip never persisted
    assert all(g["min"] <= g["bpm"] <= g["max"] and len(g["series"]) >= 4 for g in sigs)  # history for the trend chart
    # peaks that are weak or implausible never become signatures
    z2 = ZoneState(zone="z", device_id="d")
    for i in range(6):
        z2.update_breathing(now - 30 + 5 * i, 0, 2.0, False, ((14.0, 2.0), (45.0, 9.0)))
    assert z2.breathing_snapshot(now)["signatures"] == []
    # and they age out once the person leaves
    assert z.breathing_snapshot(now + 100)["signatures"] == []


def test_ble_summary_is_sanitised_and_goes_stale():
    from echo_maps.api.routes.presence import _parse_ble
    good = {"count": 5, "near": 2, "persistent": 1, "stable": 3, "devices": [
        {"id": "68fc76", "rssi": -50, "t": 1, "p": 0, "age": 3},
        {"id": "AA:BB:CC:DD:EE:FF", "rssi": -40, "t": 0, "p": 0, "age": 1},   # a real MAC must never get through
        {"id": "zzzzzz", "rssi": -40, "t": 0, "p": 0, "age": 1},
        {"id": "5850c6", "rssi": "loud", "t": 0, "p": 0, "age": 1},
    ]}
    parsed = _parse_ble(good)
    assert [d["id"] for d in parsed["devices"]] == ["68fc76"]
    assert (parsed["count"], parsed["near"], parsed["persistent"]) == (5, 2, 1)
    assert _parse_ble({"count": "many"}) is None and _parse_ble(None) is None
    z = ZoneState(zone="z", device_id="d")
    now = time.time()
    z.update(now, 40, -50, 1.0, 0.03, 0.02)
    z.set_ble(now, parsed)
    assert z.snapshot(now)["ble"]["count"] == 5
    assert z.snapshot(now + 31)["ble"] is None   # stale summaries are hidden, not shown as current


def test_bad_extras_never_cost_us_the_presence_windows(monkeypatch):
    monkeypatch.setenv("PRESENCE_INGEST_KEY", "k" * 20)
    import echo_maps.config as cfg
    cfg._settings = None
    from echo_maps.api.app import create_app
    from echo_maps.api.routes import presence as routes
    routes._registry.__init__()
    c = TestClient(create_app())
    h = {"X-Device-Key": "k" * 20}
    body = {"device_id": "b1", "zone": "Floor 3 Hallway", "windows": [{"n": 40, "amp_cv": 0.03, "decorr": 0.02}],
            "breathing": {"bpm": "NaN", "snr": "x"}, "ble": {"count": -4, "devices": "nope"}}
    assert c.post("/api/presence/ingest", json=body, headers=h).status_code == 200
    body["breathing"] = {"bpm": 14.2, "snr": 6.1, "ok": 1}
    body["ble"] = {"count": 3, "near": 1, "persistent": 0, "stable": 2, "devices": [{"id": "68fc76", "rssi": -50, "t": 1, "p": 0, "age": 2}]}
    assert c.post("/api/presence/ingest", json=body, headers=h).status_code == 200
    snap = routes._registry.snapshots()[0]
    assert snap["ble"]["count"] == 3 and snap["breathing"]["readings"] == 1
    assert "activity_ratio" in snap


def test_ingest_endpoint(monkeypatch):
    monkeypatch.setenv("PRESENCE_INGEST_KEY", "k" * 20)
    from echo_maps.config import get_settings
    import echo_maps.config as cfg
    cfg._settings = None
    from echo_maps.api.app import create_app
    c = TestClient(create_app())
    w = {"device_id": "esp1", "zone": "Hallway 1", "windows": [{"n": 40, "amp_cv": 0.03, "decorr": 0.02}]}
    assert c.post("/api/presence/ingest", json=w).status_code == 401
    h = {"X-Device-Key": "k" * 20}
    assert c.post("/api/presence/ingest", json=w, headers=h).status_code == 200
    w["zone"] = "Room 304"
    assert c.post("/api/presence/ingest", json=w, headers=h).status_code == 403
    assert c.get("/api/presence/zones").status_code in (401, 403)

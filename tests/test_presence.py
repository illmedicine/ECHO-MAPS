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

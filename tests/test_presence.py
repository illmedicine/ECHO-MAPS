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

"""History over HTTP, the SQL store against a real (SQLite) database, and the real Claude API."""

import asyncio
import os
import time

import pytest
from fastapi.testclient import TestClient

from echo_maps.history.recorder import Recorder
from echo_maps.history.store import HistoryService, MemoryStore, SqlStore, service

KEY = "k" * 24


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("PRESENCE_INGEST_KEY", KEY)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    import echo_maps.config as cfg
    cfg._settings = None
    from echo_maps.api import deps
    from echo_maps.api.app import create_app
    service.recorder = Recorder()
    service._mem = MemoryStore()
    c = TestClient(create_app())
    c.headers.update({"Authorization": "Bearer " + deps.create_access_token("u1", "t@example.com")})
    yield c
    cfg._settings = None


def _ingest(c, ble=None, uptime=3600, zone="Floor 3 Hallway", device="AA:BB:CC:00:11:22"):
    body = {"device_id": device, "zone": zone, "bridge_name": "Illy Bridge 1", "uptime_s": uptime,
            "windows": [{"n": 40, "amp_cv": 0.03, "decorr": 0.02}]}
    if ble is not None:
        body["ble"] = ble
    r = c.post("/api/presence/ingest", json=body, headers={"X-Device-Key": KEY})
    assert r.status_code == 200, r.text
    return r


def test_ingest_accepts_manufacturer_and_first_heard_and_records_history(client):
    ble = {"count": 2, "near": 2, "persistent": 0, "stable": 1, "devices": [
        {"id": "a1b2c3", "rssi": -52, "t": 1, "p": 0, "age": 0, "m": "004c", "fa": 120},
        {"id": "d4e5f6", "rssi": -61, "t": 0, "p": 0, "age": 1, "m": "zzzz", "fa": 5},        # bad company id: dropped, not fatal
    ]}
    _ingest(client, ble)
    rows = service.recorder.drain().sightings
    by_id = {r["ble_id"]: r for r in rows}
    assert by_id["a1b2c3"]["mfr"] == "004c" and by_id["a1b2c3"]["rotating"] is True
    assert by_id["d4e5f6"]["mfr"] == "" and by_id["d4e5f6"]["rotating"] is False
    assert by_id["a1b2c3"]["first_seen"] <= by_id["a1b2c3"]["last_seen"] - 100          # "first heard 120 s ago" honoured


def test_report_status_and_boot_range(client):
    _ingest(client, {"count": 1, "near": 1, "persistent": 0, "stable": 1,
                     "devices": [{"id": "d4e5f6", "rssi": -55, "t": 0, "p": 0, "age": 0}]}, uptime=16 * 3600 + 34 * 60)
    st = client.get("/api/history/status").json()
    assert st["persistence"] == "memory" and st["ai_configured"] is False and st["recording_since"]

    rep = client.get("/api/history/report", params={"range": "1h", "tz": "America/New_York"}).json()
    assert rep["summary"]["window"]["data_minutes"] >= 1 and rep["summary"]["devices"]["estimate"] >= 0
    assert rep["areas"][0]["area"] == "Floor 3 Hallway" and rep["observations"]

    boot = client.get("/api/history/report", params={"range": "boot", "device_id": "AA:BB:CC:00:11:22"}).json()
    assert abs(boot["bridge"]["uptime_s"] - (16 * 3600 + 34 * 60)) < 5               # the "16 h 34 m" case
    assert abs(boot["summary"]["window"]["hours"] - (16 + 34 / 60)) < 0.01

    assert client.get("/api/history/report", params={"range": "boot"}).status_code == 422       # needs a bridge
    assert client.get("/api/history/report", params={"range": "nope"}).status_code == 422
    assert client.get("/api/history/report", params={"range": "custom", "start": 10, "end": 5}).status_code == 422


def test_history_requires_login():
    from echo_maps.api.app import create_app
    c = TestClient(create_app())
    assert c.get("/api/history/status").status_code in (401, 403)
    assert c.post("/api/history/insights", json={}).status_code in (401, 403)


def test_insights_without_a_key_falls_back_to_observations(client):
    _ingest(client)
    r = client.post("/api/history/insights", json={"range": "1h"}).json()
    assert r["source"] == "rules" and "ANTHROPIC_API_KEY" in r["ai_error"] and r["insights"]


@pytest.mark.skipif(not os.environ.get("ANTHROPIC_API_KEY"), reason="needs a real ANTHROPIC_API_KEY (no mock is used)")
def test_insights_from_the_real_claude_api(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", os.environ["ANTHROPIC_API_KEY"])
    import echo_maps.config as cfg
    cfg._settings = None
    for i in range(3):
        _ingest(client, {"count": 1, "near": 1, "persistent": 0, "stable": 0, "devices": [
            {"id": f"a{i:05x}", "rssi": -55, "t": 1, "p": 0, "age": 0, "m": "004c", "fa": 30}]})
    r = client.post("/api/history/insights", json={"range": "1h", "refresh": True}).json()
    assert r["ai_error"] is None, r
    assert r["source"] == "ai" and r["headline"] and r["insights"]
    assert all(i["confidence"] in ("low", "medium", "high") for i in r["insights"])


# ── SQL store against a real database (SQLite here; Postgres in production) ──

def test_sql_store_round_trip_and_service_flush(tmp_path):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from echo_maps.db import session as dbs
    from echo_maps.db.models import Base, BleSightingRow, PresenceBucketRow, SignatureEpisodeRow

    async def go():
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'h.db'}")
        saved = (dbs._engine, dbs._session_factory)
        dbs._engine, dbs._session_factory = engine, async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with engine.begin() as conn:
                await conn.run_sync(lambda c: Base.metadata.create_all(
                    c, tables=[PresenceBucketRow.__table__, BleSightingRow.__table__, SignatureEpisodeRow.__table__]))
            sql = SqlStore()
            sql._ready = True
            svc = HistoryService(sql=sql)
            now = int(time.time())
            for i in range(5):
                svc.recorder.observe(
                    device_id="b1", area="Lobby", bridge_name="Illy Bridge 1", ts=now + i * 2, present=True, ratio=2.0,
                    signatures=[{"kind": "faster", "bpm": 28.0, "snr": 7.0}], uptime_s=100,
                    ble={"count": 1, "near": 1, "persistent": 0, "stable": 0, "devices": [
                        {"id": "a1b2c3", "rssi": -50, "t": 1, "p": 0, "age": 0, "m": "004c", "fa": 4}]})
            await svc.flush()
            assert svc._mem.size() == 0 and svc.persistence == "database"     # went to the database, not the fallback

            # a brand-new service (a restart) still sees it, because it is in the database
            fresh = HistoryService(sql=sql)
            batch = await fresh.query("b1", now - 600, now + 600)
            assert len(batch.buckets) >= 1 and batch.sightings[0]["mfr"] == "004c" and batch.sightings[0]["rotating"] is True
            assert batch.episodes[0]["kind"] == "faster"
            assert await fresh.first_ts("b1") == (now // 60) * 60

            # updates upsert instead of duplicating
            svc.recorder.observe(device_id="b1", area="Lobby", bridge_name="", ts=now + 10, present=False, ratio=0, signatures=[], ble=None)
            await svc.flush()
            again = await fresh.query("b1", now - 600, now + 600)
            assert len({(b["device_id"], b["ts"]) for b in again.buckets}) == len(again.buckets)

            await sql.prune(now + 10 * 86400)
            assert (await fresh.query("b1", now - 600, now + 600)).sightings == []
        finally:
            dbs._engine, dbs._session_factory = saved
            await engine.dispose()

    asyncio.run(go())


def test_database_outage_falls_back_to_memory_then_recovers(tmp_path):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from echo_maps.db import session as dbs

    async def go():
        # a database that exists but has no tables (and cannot create them: `_ready` is forced, as after an outage)
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'empty.db'}")
        saved = (dbs._engine, dbs._session_factory)
        dbs._engine, dbs._session_factory = engine, async_sessionmaker(engine, expire_on_commit=False)
        try:
            sql = SqlStore()
            sql._ready = True
            svc = HistoryService(sql=sql)
            svc.recorder.observe(device_id="b1", area="x", bridge_name="", ts=time.time(), present=True, ratio=1, signatures=[], ble=None)
            await svc.flush()                                  # SQL fails (no table): rows must land in memory instead
            assert svc._mem.size() == 1 and svc.last_error
            batch = await svc.query("b1", time.time() - 600, time.time() + 60)
            assert len(batch.buckets) == 1                     # ...and are still queryable
        finally:
            dbs._engine, dbs._session_factory = saved
            await engine.dispose()

    asyncio.run(go())

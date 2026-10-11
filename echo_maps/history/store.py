"""Where history lives: Postgres when a database is configured, memory otherwise.

If the database is unreachable the rows go to memory and are copied over once it is back, so a
brief outage does not lose history. Reads combine both, plus the recorder's not-yet-flushed rows.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import structlog

from echo_maps.history.recorder import Batch, Recorder

log = structlog.get_logger()

_B_KEY = lambda r: (r["device_id"], r["ts"])                       # noqa: E731
_S_KEY = lambda r: (r["device_id"], r["ble_id"], r["epoch"])        # noqa: E731
_E_KEY = lambda r: (r["device_id"], r["kind"], r["first_seen"])     # noqa: E731
MEMORY_RETENTION_DAYS = 7      # the memory fallback is not a database; keep it small


class MemoryStore:
    kind = "memory"

    def __init__(self) -> None:
        self.buckets: dict[tuple, dict] = {}
        self.sightings: dict[tuple, dict] = {}
        self.episodes: dict[tuple, dict] = {}

    async def write(self, batch: Batch) -> None:
        for r in batch.buckets:
            self.buckets[_B_KEY(r)] = dict(r)
        for r in batch.sightings:
            self.sightings[_S_KEY(r)] = dict(r)
        for r in batch.episodes:
            self.episodes[_E_KEY(r)] = dict(r)

    async def query(self, device_id: str | None, start: float, end: float) -> Batch:
        ok = lambda d: device_id is None or d == device_id  # noqa: E731
        return Batch(
            buckets=[dict(r) for r in self.buckets.values() if ok(r["device_id"]) and start - 60 <= r["ts"] <= end],
            sightings=[dict(r) for r in self.sightings.values() if ok(r["device_id"]) and r["last_seen"] >= start and r["first_seen"] <= end],
            episodes=[dict(r) for r in self.episodes.values() if ok(r["device_id"]) and r["last_seen"] >= start and r["first_seen"] <= end],
        )

    async def first_ts(self, device_id: str | None) -> int | None:
        ts = [r["ts"] for r in self.buckets.values() if device_id is None or r["device_id"] == device_id]
        return min(ts) if ts else None

    async def prune(self, before: int) -> None:
        before = max(before, int(time.time()) - MEMORY_RETENTION_DAYS * 86400)
        self.buckets = {k: r for k, r in self.buckets.items() if r["ts"] >= before}
        self.sightings = {k: r for k, r in self.sightings.items() if r["last_seen"] >= before}
        self.episodes = {k: r for k, r in self.episodes.items() if r["last_seen"] >= before}

    def take_all(self) -> Batch:
        b = Batch(list(self.buckets.values()), list(self.sightings.values()), list(self.episodes.values()))
        self.buckets, self.sightings, self.episodes = {}, {}, {}
        return b

    def __bool__(self) -> bool:  # truthy even when empty so `store or other` never skips it
        return True

    def size(self) -> int:
        return len(self.buckets) + len(self.sightings) + len(self.episodes)


def _row_dict(row: Any) -> dict:
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


class SqlStore:
    kind = "database"

    def __init__(self) -> None:
        self._ready = False

    async def _ensure(self) -> None:
        if self._ready:
            return
        from echo_maps.db.session import create_tables
        await create_tables()           # idempotent; also covers a startup that could not reach the DB
        self._ready = True

    async def write(self, batch: Batch) -> None:
        from echo_maps.db.models import BleSightingRow, PresenceBucketRow, SignatureEpisodeRow
        from echo_maps.db.session import get_session
        await self._ensure()
        async with get_session() as session:
            for r in batch.buckets:
                await session.merge(PresenceBucketRow(**r))
            for r in batch.sightings:
                await session.merge(BleSightingRow(**r))
            for r in batch.episodes:
                await session.merge(SignatureEpisodeRow(**r))
            await session.commit()

    async def query(self, device_id: str | None, start: float, end: float) -> Batch:
        from sqlalchemy import select
        from echo_maps.db.models import BleSightingRow, PresenceBucketRow, SignatureEpisodeRow
        from echo_maps.db.session import get_session
        await self._ensure()
        async with get_session() as session:
            qb = select(PresenceBucketRow).where(PresenceBucketRow.ts >= int(start) - 60, PresenceBucketRow.ts <= int(end))
            qs = select(BleSightingRow).where(BleSightingRow.last_seen >= int(start), BleSightingRow.first_seen <= int(end))
            qe = select(SignatureEpisodeRow).where(SignatureEpisodeRow.last_seen >= int(start), SignatureEpisodeRow.first_seen <= int(end))
            if device_id:
                qb = qb.where(PresenceBucketRow.device_id == device_id)
                qs = qs.where(BleSightingRow.device_id == device_id)
                qe = qe.where(SignatureEpisodeRow.device_id == device_id)
            return Batch(
                buckets=[_row_dict(r) for r in (await session.execute(qb)).scalars()],
                sightings=[_row_dict(r) for r in (await session.execute(qs)).scalars()],
                episodes=[_row_dict(r) for r in (await session.execute(qe)).scalars()],
            )

    async def first_ts(self, device_id: str | None) -> int | None:
        from sqlalchemy import func, select
        from echo_maps.db.models import PresenceBucketRow
        from echo_maps.db.session import get_session
        await self._ensure()
        async with get_session() as session:
            q = select(func.min(PresenceBucketRow.ts))
            if device_id:
                q = q.where(PresenceBucketRow.device_id == device_id)
            return (await session.execute(q)).scalar_one_or_none()

    async def prune(self, before: int) -> None:
        from sqlalchemy import delete
        from echo_maps.db.models import BleSightingRow, PresenceBucketRow, SignatureEpisodeRow
        from echo_maps.db.session import get_session
        await self._ensure()
        async with get_session() as session:
            await session.execute(delete(PresenceBucketRow).where(PresenceBucketRow.ts < before))
            await session.execute(delete(BleSightingRow).where(BleSightingRow.last_seen < before))
            await session.execute(delete(SignatureEpisodeRow).where(SignatureEpisodeRow.last_seen < before))
            await session.commit()


def _merge(*batches: Batch) -> Batch:
    """Union by primary key; later batches win (fresher)."""
    b: dict = {}; s: dict = {}; e: dict = {}
    for batch in batches:
        for r in batch.buckets:
            b[_B_KEY(r)] = r
        for r in batch.sightings:
            s[_S_KEY(r)] = r
        for r in batch.episodes:
            e[_E_KEY(r)] = r
    return Batch(list(b.values()), list(s.values()), list(e.values()))


class HistoryService:
    """Recorder + persistence + queries, with a background flush loop."""

    def __init__(self, sql: SqlStore | None = None) -> None:
        self.recorder = Recorder()
        self._mem = MemoryStore()
        self._sql: SqlStore | None = sql if sql is not None else SqlStore()
        self._sql_ok_after = 0.0       # do not retry a failing database before this time
        self._last_prune = 0.0
        self.last_error = ""

    def _db_configured(self) -> bool:
        if self._sql is None:
            return False
        try:
            from echo_maps.db import session as dbs
            return dbs._session_factory is not None
        except Exception:
            return False

    @property
    def persistence(self) -> str:
        return "database" if self._db_configured() and time.time() >= self._sql_ok_after and not self.last_error else "memory"

    async def flush(self) -> None:
        batch = self.recorder.drain()
        if batch and not await self._try_sql(batch):
            await self._mem.write(batch)
        elif not batch and self._mem.size() and self._db_configured():
            # database is back: move whatever the memory fallback holds across
            held = self._mem.take_all()
            if not await self._try_sql(held):
                await self._mem.write(held)
        self.recorder.prune_memory(time.time())

    async def _try_sql(self, batch: Batch) -> bool:
        if not self._db_configured() or time.time() < self._sql_ok_after:
            return False
        try:
            await self._sql.write(batch)            # type: ignore[union-attr]
            self.last_error = ""
            return True
        except Exception as exc:  # database down, tables missing, etc.: keep the rows in memory
            self.last_error = f"{type(exc).__name__}: {exc}"[:200]
            self._sql_ok_after = time.time() + 60
            log.warning("history_flush_failed", error=self.last_error)
            return False

    async def maintain(self, retention_days: int) -> None:
        now = time.time()
        if now - self._last_prune < 3600:
            return
        self._last_prune = now
        cutoff = int(now - retention_days * 86400)
        await self._mem.prune(cutoff)
        if self._db_configured():
            try:
                await self._sql.prune(cutoff)       # type: ignore[union-attr]
            except Exception as exc:
                log.warning("history_prune_failed", error=str(exc)[:200])

    async def run(self, flush_seconds: int, retention_days: int) -> None:
        while True:
            await asyncio.sleep(flush_seconds)
            try:
                await self.flush()
                await self.maintain(retention_days)
            except Exception as exc:  # never let the loop die
                log.warning("history_loop_error", error=str(exc)[:200])

    async def query(self, device_id: str | None, start: float, end: float) -> Batch:
        parts = [await self._mem.query(device_id, start, end)]
        if self._db_configured() and time.time() >= self._sql_ok_after:
            try:
                parts.insert(0, await self._sql.query(device_id, start, end))   # type: ignore[union-attr]
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"[:200]
                self._sql_ok_after = time.time() + 60
        parts.append(self.recorder.overlay(device_id, start, end))
        return _merge(*parts)

    async def first_ts(self, device_id: str | None) -> int | None:
        cands = [await self._mem.first_ts(device_id)]
        cands += [min((b.ts for b in self.recorder._buckets.values() if device_id is None or b.device_id == device_id), default=None)]
        if self._db_configured() and time.time() >= self._sql_ok_after:
            try:
                cands.append(await self._sql.first_ts(device_id))   # type: ignore[union-attr]
            except Exception:
                pass
        vals = [c for c in cands if c is not None]
        return min(vals) if vals else None


service = HistoryService()

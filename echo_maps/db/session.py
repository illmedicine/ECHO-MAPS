"""Async database session management."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_engine = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


async def init_db(database_url: str) -> None:
    """Initialize the async database engine and session factory."""
    global _engine, _session_factory  # noqa: PLW0603
    _engine = create_async_engine(
        database_url,
        pool_size=5,
        max_overflow=5,
        pool_pre_ping=True,
        pool_timeout=10,
        connect_args={"timeout": 10},
    )
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


async def close_db() -> None:
    global _engine  # noqa: PLW0603
    if _engine:
        await _engine.dispose()
        _engine = None


async def create_tables() -> None:
    """Create all tables if they don't exist (for initial deploy)."""
    from echo_maps.db.models import Base  # noqa: E402

    if _engine is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@asynccontextmanager
async def get_session() -> AsyncIterator[AsyncSession]:
    """Provide a transactional async session scope."""
    if _session_factory is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    async with _session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise

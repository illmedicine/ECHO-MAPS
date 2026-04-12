"""FastAPI application factory."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from echo_maps.api.routes import auth, bridge, calibration, environments, health, live
from echo_maps.api.routes import room_scan
from echo_maps.api.routes import settings as settings_routes
from echo_maps.config import get_settings
from echo_maps.db.session import init_db, close_db, create_tables, get_session
from sqlalchemy import text


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    import structlog
    log = structlog.get_logger()
    log.info("app_starting", msg="Echo Maps API starting up...")
    settings = get_settings()
    try:
        await asyncio.wait_for(
            _init_database(settings.async_database_url),
            timeout=10,
        )
        log.info("db_ready", msg="Database connected")
    except Exception as exc:
        log.warning("db_init_skipped", error=str(exc), msg="Database not available — running in demo mode")
    log.info("app_ready", msg="Echo Maps API ready to serve requests")
    yield
    try:
        await close_db()
    except Exception:
        pass


async def _apply_schema_fixes() -> None:
    """One-time schema fixes for deployed databases."""
    try:
        async with get_session() as session:
            # Make RF signature columns nullable (they were incorrectly NOT NULL)
            for col in ("signature_vector", "gait_embedding", "breathing_embedding", "mass_reflection"):
                await session.execute(
                    text(f"ALTER TABLE user_settings ALTER COLUMN {col} DROP NOT NULL")
                )
            await session.commit()
    except Exception:
        pass  # Table may not exist yet or columns already nullable


async def _init_database(database_url: str) -> None:
    """Initialize DB with a hard timeout so the app starts regardless."""
    await init_db(database_url)
    await create_tables()
    await _apply_schema_fixes()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Echo Maps API",
        description="Privacy-first environmental digital twin via WiFi CSI — by Illy Robotics",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.app_env != "production" else None,
    )

    # CORS — allow GitHub Pages and local development
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "https://illmedicine.github.io",
            "https://echomaps.illyrobotics.com",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
        max_age=86400,  # Cache preflight for 24h — avoids repeated OPTIONS requests
    )

    # Routes
    app.include_router(health.router, tags=["health"])
    app.include_router(auth.router, prefix="/auth", tags=["auth"])
    app.include_router(environments.router, prefix="/api/environments", tags=["environments"])
    app.include_router(calibration.router, prefix="/api/calibration", tags=["calibration"])
    app.include_router(bridge.router, prefix="/api/bridge", tags=["bridge"])
    app.include_router(live.router, prefix="/api/live", tags=["live"])
    app.include_router(room_scan.router, prefix="/api/room-scan", tags=["room-scan"])
    app.include_router(settings_routes.router, prefix="/api", tags=["settings"])

    return app

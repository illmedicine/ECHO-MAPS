"""FastAPI application factory."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from echo_maps.api.routes import auth, calibration, environments, health, live, settings
from echo_maps.config import get_settings
from echo_maps.db.session import init_db, close_db, create_tables


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    import structlog
    log = structlog.get_logger()
    settings = get_settings()
    try:
        await asyncio.wait_for(
            _init_database(settings.async_database_url),
            timeout=15,
        )
        log.info("db_ready", msg="Database connected")
    except asyncio.TimeoutError:
        log.warning("db_init_timeout", msg="Database connection timed out — running in demo mode")
    except Exception as exc:
        log.warning("db_init_failed", msg=f"Database not available — running in demo mode: {exc}")
    yield
    try:
        await close_db()
    except Exception:
        pass


async def _init_database(database_url: str) -> None:
    """Initialize DB with a hard timeout so the app starts regardless."""
    await init_db(database_url)
    await create_tables()


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
    app.include_router(live.router, prefix="/api/live", tags=["live"])
    app.include_router(settings.router, prefix="/api", tags=["settings"])

    return app

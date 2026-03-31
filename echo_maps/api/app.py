"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from echo_maps.api.routes import auth, calibration, environments, health, live
from echo_maps.config import get_settings
from echo_maps.db.session import init_db, close_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    await init_db(settings.database_url)
    yield
    await close_db()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Echo Maps API",
        description="Privacy-first environmental digital twin via WiFi CSI — by Illy Robotics",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.app_env != "production" else None,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "https://echomaps.illyrobotics.com"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routes
    app.include_router(health.router, tags=["health"])
    app.include_router(auth.router, prefix="/auth", tags=["auth"])
    app.include_router(environments.router, prefix="/api/environments", tags=["environments"])
    app.include_router(calibration.router, prefix="/api/calibration", tags=["calibration"])
    app.include_router(live.router, prefix="/api/live", tags=["live"])

    return app

"""Live CSI presence routes.

  POST /api/presence/ingest   — Illy Bridge pushes per-second CSI motion features
                                (device-key auth; no user login on the ESP32).
  GET  /api/presence/zones    — current per-zone presence state for the dashboard.

Privacy: ingest is accepted for public/common areas only. Zone names that look
like private guest rooms are rejected here, server-side, regardless of what the
device or UI says.
"""

from __future__ import annotations

import hmac
import re
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from echo_maps.api.deps import TokenPayload, get_current_user
from echo_maps.config import get_settings
from echo_maps.csi.presence import PresenceRegistry

router = APIRouter()
_registry = PresenceRegistry()

_PRIVATE = re.compile(r"(^\s*room\s*\d+|suite\s*\d+|guest\s*room|bedroom|bathroom|restroom)", re.I)
MAX_WINDOWS_PER_POST = 60
MAX_AREAS = 64


class CSIWindow(BaseModel):
    ts: float | None = None  # unix seconds; server time used if omitted
    n: int = Field(ge=0, le=100000)  # CSI frames in window
    rssi_mean: float = 0.0
    rssi_std: float = Field(default=0.0, ge=0)
    amp_cv: float = Field(ge=0)
    decorr: float = Field(ge=0, le=2)


class IngestBody(BaseModel):
    device_id: str = Field(min_length=1, max_length=64)
    zone: str = Field(min_length=1, max_length=63)  # the public area this bridge monitors
    bridge_name: str = Field(default="", max_length=63)  # label for the device itself
    windows: list[CSIWindow] = Field(min_length=1, max_length=MAX_WINDOWS_PER_POST)


class AreasBody(BaseModel):
    areas: list[str] = Field(max_length=MAX_AREAS)


# Public areas of this facility, published by the dashboard (which owns the
# property layout) so each bridge's area dropdown matches the real building.
# In memory: the dashboard republishes on load, and bridges cache the last list.
_areas: list[str] = []
_AREA_OK = re.compile(r"^[A-Za-z0-9 \-_.,'/#()]{1,47}$")  # same charset the firmware accepts


def _check_device_key(key: str | None) -> None:
    expected = get_settings().presence_ingest_key
    if not expected:
        raise HTTPException(status_code=503, detail="Presence ingest not configured (set PRESENCE_INGEST_KEY)")
    if not key or not hmac.compare_digest(key, expected):
        raise HTTPException(status_code=401, detail="Invalid device key")


@router.post("/ingest")
async def ingest(body: IngestBody, x_device_key: str | None = Header(default=None)) -> dict:
    _check_device_key(x_device_key)
    if _PRIVATE.search(body.zone):
        raise HTTPException(status_code=403, detail="Sensing is restricted to public areas")
    zone = _registry.zone(body.device_id, body.zone)
    zone.bridge_name = body.bridge_name
    now = time.time()
    for w in body.windows:
        ts = w.ts if w.ts and abs(w.ts - now) < 3600 else now  # ESP32 may have no RTC
        zone.update(ts, w.n, w.rssi_mean, w.rssi_std, w.amp_cv, w.decorr)
    return {"status": "ok", "state": zone.snapshot()["state"]}


@router.put("/areas")
async def put_areas(body: AreasBody, user: TokenPayload = Depends(get_current_user)) -> dict:
    """Dashboard publishes the facility's public areas. Private-room names and
    anything the bridge could not display are dropped."""
    cleaned: list[str] = []
    for raw in body.areas:
        name = " ".join(raw.split())
        if _AREA_OK.match(name) and not _PRIVATE.search(name) and name not in cleaned:
            cleaned.append(name)
    _areas[:] = cleaned
    return {"areas": cleaned}


@router.get("/areas")
async def get_areas(x_device_key: str | None = Header(default=None)) -> dict:
    """Bridges (device-key auth) read the facility's selectable public areas."""
    _check_device_key(x_device_key)
    return {"areas": list(_areas)}


@router.get("/zones")
async def zones(user: TokenPayload = Depends(get_current_user)) -> dict:
    snaps = _registry.snapshots()
    return {
        "server_time": time.time(),
        "zones": snaps,
        "people_zones": sum(1 for s in snaps if s["present"]),
    }

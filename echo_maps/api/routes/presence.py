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
from echo_maps.csi.presence import MACRO_HOLD_S, STRATEGIES, PresenceRegistry
from echo_maps.history.store import service as history

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
    ip: str = Field(default="", max_length=45)  # bridge's LAN address, for its local setup page
    uptime_s: float | None = Field(default=None, ge=0, le=1e9)  # seconds since the bridge booted
    # Optional extras are parsed leniently (see _parse_*): a malformed extra must never
    # cost us the presence windows in the same request.
    breathing: dict | None = None
    ble: dict | None = None
    sweep: list | None = None   # macro mode: per-channel motion features, no addresses
    # Sensing strategy the bridge is running and what its radio is doing this instant. Old firmware
    # sends neither. In macro mode a bridge uploads its BLE census with no CSI windows.
    strategy: str = Field(default="", max_length=16)
    mode: str = Field(default="", max_length=16)
    windows: list[CSIWindow] = Field(default_factory=list, max_length=MAX_WINDOWS_PER_POST)


class AreasBody(BaseModel):
    areas: list[str] = Field(max_length=MAX_AREAS)


class BridgeConfigBody(BaseModel):
    bridge_name: str | None = Field(default=None, max_length=47)
    area: str | None = Field(default=None, max_length=47)
    # macro: wide low-power device census only | micro: continuous high-resolution CSI only |
    # auto: alternate micro and macro on a timer | smart: macro until a crowd appears, then micro
    strategy: str | None = Field(default=None, max_length=16)


# Public areas of this facility, published by the dashboard (which owns the
# property layout) so each bridge's area dropdown matches the real building.
# In memory: the dashboard republishes on load, and bridges cache the last list.
_areas: list[str] = []
_AREA_OK = re.compile(r"^[A-Za-z0-9 \-_.,'/#()]{1,47}$")  # same charset the firmware accepts

# Configuration the dashboard wants a bridge to adopt. Handed to the bridge in the
# reply to its next upload and dropped once the bridge reports it. A bridge keeps
# what it applied in its own flash, so losing this on a restart is harmless.
_desired: dict[str, dict[str, str]] = {}


_BLE_ID = re.compile(r"^[0-9a-f]{6}$")
_BLE_MFR = re.compile(r"^[0-9a-f]{4}$")   # Bluetooth SIG company id from the advertisement


def _num(v: object, lo: float, hi: float) -> float | None:
    try:
        x = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return x if lo <= x <= hi else None  # also rejects NaN


def _parse_breathing(raw: dict | None) -> tuple[float, float, bool, tuple] | None:
    if not raw:
        return None
    bpm, snr = _num(raw.get("bpm"), 0, 200), _num(raw.get("snr"), 0, 1e6)
    if bpm is None or snr is None:
        return None
    peaks = []
    for p in (raw.get("peaks") or [])[:3]:
        if isinstance(p, dict):
            pb, ps = _num(p.get("bpm"), 0, 200), _num(p.get("snr"), 0, 1e6)
            if pb is not None and ps is not None:
                peaks.append((pb, ps))
    return bpm, snr, bool(raw.get("ok")), tuple(peaks)


def _parse_ble(raw: dict | None) -> dict | None:
    """Keep only counts and anonymised ids; drop anything that is not exactly that shape."""
    if not raw:
        return None
    counts = {k: _num(raw.get(k), 0, 1000) for k in ("count", "near", "persistent", "stable")}
    if any(v is None for v in counts.values()):
        return None
    devices = []
    for d in (raw.get("devices") or [])[:12]:
        if not isinstance(d, dict) or not _BLE_ID.match(str(d.get("id", ""))):
            continue
        rssi, age = _num(d.get("rssi"), -127, 20), _num(d.get("age"), 0, 86400)
        if rssi is None or age is None:
            continue
        dev = {"id": d["id"], "rssi": int(rssi), "t": 1 if d.get("t") else 0, "p": 1 if d.get("p") else 0, "age": int(age)}
        mfr = str(d.get("m", "")).lower()
        if _BLE_MFR.match(mfr):
            dev["m"] = mfr
        fa = _num(d.get("fa"), 0, 86400)      # seconds since this id was first heard
        if fa is not None:
            dev["fa"] = int(fa)
        devices.append(dev)
    return {**{k: int(v) for k, v in counts.items()}, "devices": devices}  # type: ignore[arg-type]


def _parse_sweep(raw: list | None) -> list[dict]:
    """Per-channel physical-layer features only. Anything else in an entry is dropped."""
    out = []
    seen: set[int] = set()
    for c in (raw or [])[:14]:
        if not isinstance(c, dict):
            continue
        ch = _num(c.get("ch"), 1, 14)
        n, allf = _num(c.get("n"), 0, 100000), _num(c.get("all"), 0, 100000)
        if ch is None or n is None or allf is None or int(ch) in seen:
            continue
        rssi = _num(c.get("rssi", 0), -127, 0)
        cv, de = _num(c.get("amp_cv", 0), 0, 10), _num(c.get("decorr", 0), 0, 2)
        if rssi is None or cv is None or de is None:
            continue
        seen.add(int(ch))
        out.append({"ch": int(ch), "n": int(n), "all": int(allf), "rssi": int(rssi), "amp_cv": cv, "decorr": de})
    return out


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
    zone.ip = body.ip
    now = time.time()
    if not body.windows and body.mode != "macro":
        # Only a bridge in macro mode legitimately uploads without CSI windows.
        raise HTTPException(status_code=422, detail="windows required unless mode is macro")
    zone.touch(now, body.strategy, body.mode)
    breath = _parse_breathing(body.breathing)
    if breath:
        zone.update_breathing(now, *breath)
    ble = _parse_ble(body.ble)
    if ble is not None:
        zone.set_ble(now, ble)
    sweep = _parse_sweep(body.sweep)
    if sweep:
        zone.set_sweep(now, sweep)
    for w in body.windows:
        ts = w.ts if w.ts and abs(w.ts - now) < 3600 else now  # ESP32 may have no RTC
        zone.update(ts, w.n, w.rssi_mean, w.rssi_std, w.amp_cv, w.decorr)
    # While the bridge is in macro mode no CSI is measured: its old verdict must not keep counting as
    # "occupied" in history (the BLE census it uploads is still recorded in full).
    csi_live = zone.mode != "macro" or (now - zone.last_seen) <= MACRO_HOLD_S
    try:   # history must never cost the bridge its presence upload
        history.recorder.observe(
            device_id=body.device_id, area=body.zone, bridge_name=body.bridge_name, ts=now,
            present=zone.present and csi_live, ratio=max(zone.ratio, 0.0) if csi_live else 0.0,
            signatures=zone.breathing_snapshot(now)["signatures"] if csi_live else [],
            ble=ble, uptime_s=body.uptime_s,
        )
    except Exception:
        pass
    resp: dict = {"status": "ok", "state": zone.snapshot()["state"]}
    want = _desired.get(body.device_id)
    if want:
        if _config_applied(want, body.zone, body.bridge_name, zone.strategy):
            _desired.pop(body.device_id, None)  # the bridge has adopted it
        else:
            resp["config"] = want
    return resp


def _config_applied(want: dict[str, str], area: str, name: str, strategy: str = "") -> bool:
    return (want.get("area", area) == area and want.get("bridge_name", name) == name
            and want.get("strategy", strategy) == strategy)


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


@router.get("/bridges")
async def bridges(user: TokenPayload = Depends(get_current_user)) -> dict:
    """Every bridge that has reported, with any configuration still waiting to be applied."""
    out = []
    for z in _registry.snapshots():
        want = _desired.get(z["device_id"])
        out.append({
            "device_id": z["device_id"],
            "bridge_name": z["bridge_name"],
            "area": z["zone"],
            "ip": z["ip"],
            "state": z["state"],
            "strategy": z["strategy"],
            "mode": z["mode"],
            "age_s": z["age_s"],
            "pending": want if want and not _config_applied(want, z["zone"], z["bridge_name"], z["strategy"]) else None,
        })
    out.sort(key=lambda b: (b["bridge_name"] or "~", b["device_id"]))
    return {"server_time": time.time(), "bridges": out}


@router.put("/bridges/{device_id}/config")
async def configure_bridge(device_id: str, body: BridgeConfigBody, user: TokenPayload = Depends(get_current_user)) -> dict:
    """Dashboard sets a bridge's name and/or area. The bridge applies it on its next upload."""
    if not any(z["device_id"] == device_id for z in _registry.snapshots()):
        raise HTTPException(status_code=404, detail="Unknown bridge (it has not reported yet)")
    want: dict[str, str] = {}
    if body.bridge_name is not None:
        name = " ".join(body.bridge_name.split())
        if not _AREA_OK.match(name):
            raise HTTPException(status_code=422, detail="bridge_name must be 1-47 chars: letters, digits, space - _ . , ' / # ( )")
        want["bridge_name"] = name
    if body.area is not None:
        area = " ".join(body.area.split())
        if _PRIVATE.search(area):
            raise HTTPException(status_code=403, detail="Sensing is restricted to public areas")
        if _areas and area not in _areas:
            raise HTTPException(status_code=422, detail="area is not one of this facility's public areas")
        if not _AREA_OK.match(area):
            raise HTTPException(status_code=422, detail="Invalid area name")
        want["area"] = area
    if body.strategy is not None:
        if body.strategy not in STRATEGIES:
            raise HTTPException(status_code=422, detail=f"strategy must be one of {', '.join(STRATEGIES)}")
        want["strategy"] = body.strategy
    if not want:
        raise HTTPException(status_code=422, detail="Send bridge_name, area and/or strategy")
    _desired[device_id] = {**_desired.get(device_id, {}), **want}
    return {"device_id": device_id, "pending": _desired[device_id]}


@router.get("/zones")
async def zones(user: TokenPayload = Depends(get_current_user)) -> dict:
    snaps = _registry.snapshots()
    return {
        "server_time": time.time(),
        "zones": snaps,
        "people_zones": sum(1 for s in snaps if s["present"]),
    }

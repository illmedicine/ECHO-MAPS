"""Historical presence, BLE and pet analytics, plus AI insights.

  GET  /api/history/status    — what is recording, where it is stored, whether AI is configured
  GET  /api/history/report    — estimates, hourly series and rule-based observations for a period
  POST /api/history/insights  — Claude-written insights for the same period (aggregated data only)

A period is a preset (1h, 6h, 24h, 7d, 30d), "boot" (since the bridge last restarted) or custom
start/end epochs. History starts when recording started: it cannot be reconstructed for earlier time.
"""

from __future__ import annotations

import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from echo_maps.api.deps import TokenPayload, get_current_user
from echo_maps.config import get_settings
from echo_maps.history import ai as ai_mod
from echo_maps.history import analytics
from echo_maps.history.store import service

router = APIRouter()

PRESETS = {"1h": 3600, "6h": 6 * 3600, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}
MAX_SPAN_S = 120 * 86400
AI_CACHE_TTL_S = 600
AI_MIN_INTERVAL_S = 20

_ai_cache: dict[tuple, tuple[float, dict]] = {}


def _window(range_: str, start: float | None, end: float | None, device_id: str | None) -> tuple[float, float]:
    now = time.time()
    if range_ == "custom":
        if start is None or end is None or end <= start:
            raise HTTPException(status_code=422, detail="custom range needs start < end (unix seconds)")
        if end - start > MAX_SPAN_S:
            raise HTTPException(status_code=422, detail="range too long (max 120 days)")
        return float(start), float(end)
    if range_ == "boot":
        if not device_id:
            raise HTTPException(status_code=422, detail="'since restart' needs a specific bridge")
        boot = service.recorder.boot_time(device_id)
        if boot is None:
            raise HTTPException(status_code=409, detail="That bridge has not reported its uptime yet (it needs the updated firmware)")
        return boot, now
    if range_ not in PRESETS:
        raise HTTPException(status_code=422, detail=f"range must be one of {sorted(PRESETS)}, 'boot' or 'custom'")
    return now - PRESETS[range_], now


async def _build(device_id: str | None, start: float, end: float, tz: str | None) -> dict:
    batch = await service.query(device_id, start, end)
    window_buckets = [b for b in batch.buckets if start - 60 <= b["ts"] <= end]
    summary = analytics.estimate(window_buckets, batch.sightings, batch.episodes, start, end, tz=tz)
    series = analytics.hourly(window_buckets, start, end)
    areas = analytics.by_area(window_buckets)
    rules = analytics.rule_insights(summary, series, areas, tz)
    return {"summary": summary, "hourly": series, "areas": areas, "observations": rules}


@router.get("/status")
async def status(user: TokenPayload = Depends(get_current_user)) -> dict:
    s = get_settings()
    return {
        "server_time": time.time(),
        "persistence": service.persistence,         # "database" survives restarts; "memory" does not
        "last_error": service.last_error or None,
        "ai_configured": bool(s.anthropic_api_key),
        "ai_model": s.anthropic_model if s.anthropic_api_key else None,
        "recording_since": await service.first_ts(None),
        "retention_days": s.history_retention_days,
    }


@router.get("/report")
async def report(
    device_id: str | None = Query(default=None, max_length=64),
    range: str = Query(default="24h"),
    start: float | None = None,
    end: float | None = None,
    tz: str | None = Query(default=None, max_length=64),
    user: TokenPayload = Depends(get_current_user),
) -> dict:
    s, e = _window(range, start, end, device_id)
    out = await _build(device_id, s, e, tz)
    boot = service.recorder.boot_time(device_id) if device_id else None
    out["bridge"] = {
        "device_id": device_id,
        "uptime_s": int(time.time() - boot) if boot else None,
        "recording_since": await service.first_ts(device_id),
    }
    out["range"] = range
    return out


class InsightsBody(BaseModel):
    device_id: str | None = None
    range: str = "24h"
    start: float | None = None
    end: float | None = None
    tz: str | None = None
    refresh: bool = False


@router.post("/insights")
async def insights(body: InsightsBody, user: TokenPayload = Depends(get_current_user)) -> dict:
    """AI insights for a period. Falls back to rule-based observations if the AI layer is unavailable."""
    s, e = _window(body.range, body.start, body.end, body.device_id)
    built = await _build(body.device_id, s, e, body.tz)
    key = (body.device_id, body.range, int(s // 300), int(e // 300), body.tz)
    now = time.time()
    cached = _ai_cache.get(key)
    if cached and (not body.refresh and now - cached[0] < AI_CACHE_TTL_S or now - cached[0] < AI_MIN_INTERVAL_S):
        return {**cached[1], "cached": True}

    cfg = get_settings()
    result: dict
    if built["summary"]["window"]["data_minutes"] == 0:
        result = {"source": "rules", "headline": "No data in this period", "insights": built["observations"],
                  "recommendations": [], "caveats": [], "ai_error": None}
    else:
        payload = ai_mod.build_payload(built["summary"], built["hourly"], built["areas"], built["observations"], analytics._tz(body.tz))
        try:
            result = await ai_mod.generate(payload, api_key=cfg.anthropic_api_key, model=cfg.anthropic_model)
            result["ai_error"] = None
        except ai_mod.InsightsUnavailable as exc:
            result = {
                "source": "rules", "model": None, "headline": "Observations from the recorded data",
                "insights": built["observations"], "recommendations": [], "caveats": [],
                "ai_error": str(exc),
            }
    result["generated_at"] = now
    if result["source"] == "ai":
        _ai_cache[key] = (now, result)          # only cache real AI answers
        if len(_ai_cache) > 64:
            for k in sorted(_ai_cache, key=lambda k: _ai_cache[k][0])[:16]:
                _ai_cache.pop(k, None)
    return {**result, "cached": False}

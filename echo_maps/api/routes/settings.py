"""User settings sync endpoint — stores all frontend state as a JSON blob.

This enables cross-device persistence: the frontend pushes its entire
localStorage payload here on every change, and pulls it on login.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select

from echo_maps.api.deps import TokenPayload, get_current_user
from echo_maps.db.models import UserSettings
from echo_maps.db.session import get_session

router = APIRouter()


class SettingsPayload(BaseModel):
    settings: dict
    version: int
    updatedAt: str


class SettingsResponse(BaseModel):
    settings: dict
    version: int
    updatedAt: str


@router.get("/settings", response_model=SettingsResponse)
async def get_user_settings(
    user: TokenPayload = Depends(get_current_user),
):
    async with get_session() as session:
        result = await session.execute(
            select(UserSettings).where(UserSettings.user_id == user.user_id)
        )
        record = result.scalar_one_or_none()

        if not record:
            return SettingsResponse(settings={}, version=0, updatedAt="")

        return SettingsResponse(
            settings=record.settings_json,
            version=record.version,
            updatedAt=record.updated_at.isoformat() if record.updated_at else "",
        )


@router.put("/settings", response_model=SettingsResponse)
async def save_user_settings(
    payload: SettingsPayload,
    user: TokenPayload = Depends(get_current_user),
):
    async with get_session() as session:
        result = await session.execute(
            select(UserSettings).where(UserSettings.user_id == user.user_id)
        )
        record = result.scalar_one_or_none()
        now = datetime.now(timezone.utc)

        if record:
            # Only update if incoming version is newer
            if payload.version >= record.version:
                record.settings_json = payload.settings
                record.version = payload.version
                record.updated_at = now
        else:
            record = UserSettings(
                user_id=user.user_id,
                settings_json=payload.settings,
                version=payload.version,
                updated_at=now,
            )
            session.add(record)

        await session.commit()

        return SettingsResponse(
            settings=record.settings_json,
            version=record.version,
            updatedAt=record.updated_at.isoformat() if record.updated_at else "",
        )

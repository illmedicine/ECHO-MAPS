"""Environment management routes — CRUD for Places."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from echo_maps.api.deps import TokenPayload, get_current_user
from echo_maps.db.models import Environment
from echo_maps.db.session import get_session

router = APIRouter()


class EnvironmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, examples=["Home Office"])


class EnvironmentOut(BaseModel):
    id: str
    name: str
    is_calibrated: bool
    calibration_confidence: float
    created_at: str

    model_config = {"from_attributes": True}


class EnvironmentList(BaseModel):
    environments: list[EnvironmentOut]


# ── Tier limits ──
TIER_LIMITS = {
    "personal": 2,
    "pro": 5,
}


@router.post("", response_model=EnvironmentOut, status_code=201)
async def create_environment(
    body: EnvironmentCreate,
    user: TokenPayload = Depends(get_current_user),
) -> EnvironmentOut:
    """Create a new Place (environment) for the current user."""
    async with get_session() as session:
        # Check tier limit
        count = await Environment.count_for_user(session, user.user_id)
        # Default to personal tier limit
        limit = TIER_LIMITS.get("personal", 2)
        if count >= limit:
            raise HTTPException(
                status_code=403,
                detail=f"Environment limit reached ({limit}). Upgrade to Pro for more.",
            )

        env = Environment(
            user_id=UUID(user.user_id),
            name=body.name,
        )
        session.add(env)
        await session.commit()
        await session.refresh(env)

    return EnvironmentOut(
        id=str(env.id),
        name=env.name,
        is_calibrated=env.is_calibrated,
        calibration_confidence=env.calibration_confidence,
        created_at=env.created_at.isoformat(),
    )


@router.get("", response_model=EnvironmentList)
async def list_environments(
    user: TokenPayload = Depends(get_current_user),
) -> EnvironmentList:
    """List all Places for the current user."""
    async with get_session() as session:
        envs = await Environment.get_all_for_user(session, user.user_id)
    return EnvironmentList(
        environments=[
            EnvironmentOut(
                id=str(e.id),
                name=e.name,
                is_calibrated=e.is_calibrated,
                calibration_confidence=e.calibration_confidence,
                created_at=e.created_at.isoformat(),
            )
            for e in envs
        ]
    )


@router.get("/{env_id}", response_model=EnvironmentOut)
async def get_environment(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> EnvironmentOut:
    """Get a specific Place."""
    async with get_session() as session:
        env = await Environment.get_by_id_and_user(session, env_id, user.user_id)
        if env is None:
            raise HTTPException(status_code=404, detail="Environment not found")
    return EnvironmentOut(
        id=str(env.id),
        name=env.name,
        is_calibrated=env.is_calibrated,
        calibration_confidence=env.calibration_confidence,
        created_at=env.created_at.isoformat(),
    )

"""SQLAlchemy models for Echo Maps."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Self

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, select, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    google_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    subscription_tier: Mapped[str] = mapped_column(String(20), default="personal")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    environments: Mapped[list[Environment]] = relationship(back_populates="user")

    @classmethod
    async def get_by_google_id(cls, session: AsyncSession, google_id: str) -> Self | None:
        result = await session.execute(select(cls).where(cls.google_id == google_id))
        return result.scalar_one_or_none()

    @classmethod
    async def get_by_id(cls, session: AsyncSession, user_id: str) -> Self | None:
        result = await session.execute(select(cls).where(cls.id == uuid.UUID(user_id)))
        return result.scalar_one_or_none()


class Environment(Base):
    __tablename__ = "environments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    is_calibrated: Mapped[bool] = mapped_column(Boolean, default=False)
    calibration_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    user: Mapped[User] = relationship(back_populates="environments")
    activity_logs: Mapped[list[ActivityLog]] = relationship(back_populates="environment")

    @classmethod
    async def count_for_user(cls, session: AsyncSession, user_id: str) -> int:
        result = await session.execute(
            select(func.count()).where(cls.user_id == uuid.UUID(user_id))
        )
        return result.scalar_one()

    @classmethod
    async def get_all_for_user(cls, session: AsyncSession, user_id: str) -> list[Self]:
        result = await session.execute(
            select(cls).where(cls.user_id == uuid.UUID(user_id)).order_by(cls.created_at)
        )
        return list(result.scalars().all())

    @classmethod
    async def get_by_id_and_user(
        cls, session: AsyncSession, env_id: str, user_id: str
    ) -> Self | None:
        result = await session.execute(
            select(cls).where(cls.id == uuid.UUID(env_id), cls.user_id == uuid.UUID(user_id))
        )
        return result.scalar_one_or_none()


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    environment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("environments.id"), index=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    activity: Mapped[str] = mapped_column(String(50))
    breathing_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    heart_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    occupancy_count: Mapped[int] = mapped_column(default=0)

    environment: Mapped[Environment] = relationship(back_populates="activity_logs")


class RFSignatureRecord(Base):
    """Persisted RF Signature for a tracked person in an environment.

    Stores the 512-dim combined vector extracted during Phase 2 (Anchor Extraction)
    so the system can re-identify returning users without re-calibration.
    """
    __tablename__ = "rf_signatures"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    environment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("environments.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    user_tag: Mapped[str] = mapped_column(String(50))  # "User_A", "User_B", etc.


class UserSettings(Base):
    """Stores the entire frontend settings blob per user for cross-device sync."""
    __tablename__ = "user_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # matches User.google_id or JWT sub
    settings_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    signature_vector: Mapped[bytes] = mapped_column()   # 512 × float32 = 2048 bytes
    gait_embedding: Mapped[bytes] = mapped_column()     # 64 × float32 = 256 bytes
    breathing_embedding: Mapped[bytes] = mapped_column() # 32 × float32 = 128 bytes
    mass_reflection: Mapped[bytes] = mapped_column()    # 16 × float32 = 64 bytes
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    @classmethod
    async def get_for_environment(
        cls, session: AsyncSession, environment_id: str
    ) -> list[Self]:
        result = await session.execute(
            select(cls).where(
                cls.environment_id == uuid.UUID(environment_id),
                cls.is_active == True,
            )
        )
        return list(result.scalars().all())

    @classmethod
    async def delete_for_environment(
        cls, session: AsyncSession, environment_id: str
    ) -> None:
        """Soft-delete all signatures for an environment (re-calibration)."""
        from sqlalchemy import update
        await session.execute(
            update(cls)
            .where(cls.environment_id == uuid.UUID(environment_id))
            .values(is_active=False)
        )

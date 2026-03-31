"""Calibration types — lightweight, no ML dependencies."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class CalibrationStage(str, Enum):
    SETUP = "setup"
    TRACE = "trace"
    TRAINING = "training"
    CONFIDENCE = "confidence"
    LIVE = "live"
    FAILED = "failed"


@dataclass
class CalibrationState:
    """Tracks the state of an environment calibration session."""

    environment_id: str
    user_id: str
    stage: CalibrationStage = CalibrationStage.SETUP
    pose_match_accuracy: float = 0.0
    confidence_threshold: float = 0.95
    training_epoch: int = 0
    max_epochs: int = 500
    csi_frames_collected: int = 0
    vision_frames_collected: int = 0
    started_at: float = field(default_factory=time.time)
    completed_at: float | None = None
    error: str | None = None

"""Calibration types — lightweight, no ML dependencies."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class CalibrationStage(str, Enum):
    SETUP = "setup"
    TRACE = "trace"                           # Phase 1: Visual Handshake
    ANCHOR_EXTRACTION = "anchor_extraction"   # Phase 2: Building RF Signatures
    TRAINING = "training"                     # Phase 3: GAN training
    CONFIDENCE = "confidence"                 # Phase 3: RF-only hits 90%+
    HANDOFF = "handoff"                       # Phase 3: "Environment Synced"
    LIVE = "live"                             # Phase 3→4: Active Sonar Mode
    FAILED = "failed"


class TrackingConfidence(str, Enum):
    """Phase 5: Per-track confidence state."""
    FULL = "full"           # 90%+ confidence
    DEGRADED = "degraded"   # 70–90% — still tracking but lower certainty
    GHOSTED = "ghosted"     # <70% — approximate location, translucent avatar
    LOST = "lost"           # 0% — track pruned


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

    # Phase 2: Anchor Extraction
    rf_signatures_extracted: int = 0
    walking_samples_collected: int = 0
    stationary_samples_collected: int = 0

    # Phase 3: RF Handoff
    rf_only_accuracy: float = 0.0
    rf_sustained_frames: int = 0
    rf_required_frames: int = 1000  # 10s at 100Hz
    handoff_triggered: bool = False
    camera_terminated: bool = False

    # Phase 4–5: Active tracking
    active_tracks: int = 0
    ghosted_tracks: int = 0

    # Room Scan — visual mapping phase (mobile phone camera)
    room_scan_active: bool = False
    room_scan_confidence: float = 0.0
    room_scan_objects_detected: int = 0
    room_scan_coverage_degrees: float = 0.0
    room_dimensions_mapped: bool = False
    floor_plan_generated: bool = False

"""Calibration session routes — full Visual Handshake to RF Handoff pipeline."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from echo_maps.api.deps import TokenPayload, get_current_user, verify_token
from echo_maps.calibration.types import CalibrationStage

router = APIRouter()

# Singleton engine (in production, use dependency injection / factory)
_engine = None


def get_engine():
    global _engine  # noqa: PLW0603
    if _engine is None:
        from echo_maps.calibration import CalibrationEngine
        _engine = CalibrationEngine()
    return _engine


class CalibrationStart(BaseModel):
    environment_id: str


class CalibrationStatus(BaseModel):
    environment_id: str
    stage: str
    pose_match_accuracy: float
    training_epoch: int
    csi_frames_collected: int
    vision_frames_collected: int
    message: str
    # Phase 2
    rf_signatures_extracted: int = 0
    walking_samples: int = 0
    stationary_samples: int = 0
    # Phase 3
    rf_only_accuracy: float = 0.0
    rf_sustained_frames: int = 0
    handoff_triggered: bool = False
    camera_terminated: bool = False
    # Phase 4–5
    active_tracks: int = 0
    ghosted_tracks: int = 0


class SignatureResult(BaseModel):
    track_id: str
    user_tag: str
    status: str
    vector_dim: int = 0


@router.post("/start", response_model=CalibrationStatus)
async def start_calibration(
    body: CalibrationStart,
    user: TokenPayload = Depends(get_current_user),
) -> CalibrationStatus:
    """Phase 1 Setup: Start a new calibration session for an environment."""
    engine = get_engine()
    state = engine.create_session(body.environment_id, user.user_id)
    return _state_to_status(state)


@router.get("/status/{env_id}", response_model=CalibrationStatus)
async def get_calibration_status(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> CalibrationStatus:
    """Get the current calibration state for an environment."""
    engine = get_engine()
    state = engine.get_session(env_id)
    if state is None:
        raise HTTPException(status_code=404, detail="No calibration session found")
    if state.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    return _state_to_status(state)


@router.post("/extract-signatures/{env_id}", response_model=list[SignatureResult])
async def extract_signatures(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> list[SignatureResult]:
    """Phase 2: Extract RF Signatures for all tracked persons."""
    engine = get_engine()
    state = engine.get_session(env_id)
    if state is None:
        raise HTTPException(status_code=404, detail="No calibration session found")
    if state.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    results = engine.extract_signatures(env_id)
    return [SignatureResult(**r) for r in results]


@router.get("/tracks/{env_id}")
async def get_tracking_snapshot(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> dict:
    """Get current multi-person tracking snapshot (Phases 4–5)."""
    engine = get_engine()
    state = engine.get_session(env_id)
    if state is None:
        raise HTTPException(status_code=404, detail="No calibration session found")
    if state.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    return {
        "environment_id": env_id,
        "phase": engine.tracker.phase.value,
        "tracks": engine.get_tracking_snapshot(),
    }


@router.websocket("/stream/{env_id}")
async def calibration_stream(websocket: WebSocket, env_id: str) -> None:
    """WebSocket for streaming paired CSI + vision frames during calibration.

    Client sends JSON messages:
    {
        "token": "jwt...",      // first message only
        "csi_amplitude": [...],
        "csi_phase": [...],
        "skeletal_keypoints": [[x,y,z], ...],  // 33 points
    }

    Server responds with full calibration status including:
    - Current phase (visual_handshake → anchor_extraction → training → handoff → live)
    - Pose-match accuracy
    - RF signature extraction progress
    - Tracking snapshot with confidence and ghost states
    """
    await websocket.accept()
    engine = get_engine()

    try:
        # First message must include auth token
        init_msg = await websocket.receive_json()
        token = init_msg.get("token", "")
        user = verify_token(token)

        state = engine.get_session(env_id)
        if state is None or state.user_id != user.user_id:
            await websocket.close(code=4003, reason="Invalid session")
            return

        while True:
            data = await websocket.receive_json()

            import numpy as np

            csi_amp = np.array(data["csi_amplitude"], dtype=np.float32)
            csi_phase = np.array(data["csi_phase"], dtype=np.float32)
            keypoints = np.array(data["skeletal_keypoints"], dtype=np.float32)

            state = await engine.process_paired_frame(
                env_id, csi_amp, csi_phase, keypoints
            )

            await websocket.send_json({
                "stage": state.stage.value,
                "pose_match_accuracy": state.pose_match_accuracy,
                "csi_frames_collected": state.csi_frames_collected,
                "rf_signatures_extracted": state.rf_signatures_extracted,
                "walking_samples": state.walking_samples_collected,
                "stationary_samples": state.stationary_samples_collected,
                "rf_only_accuracy": state.rf_only_accuracy,
                "handoff_triggered": state.handoff_triggered,
                "camera_terminated": state.camera_terminated,
                "active_tracks": state.active_tracks,
                "ghosted_tracks": state.ghosted_tracks,
                "tracks": engine.get_tracking_snapshot(),
            })

    except WebSocketDisconnect:
        pass


def _state_to_status(state: CalibrationState) -> CalibrationStatus:
    """Convert CalibrationState to API response."""
    messages = {
        CalibrationStage.SETUP: "Ready to begin Visual Handshake.",
        CalibrationStage.TRACE: "Phase 1: Visual Handshake — collecting paired vision + CSI frames...",
        CalibrationStage.ANCHOR_EXTRACTION: "Phase 2: Extracting RF Signatures (gait, breathing, mass)...",
        CalibrationStage.TRAINING: f"Phase 3: Training GAN... Epoch {state.training_epoch}",
        CalibrationStage.CONFIDENCE: "Phase 3: RF-only accuracy verified at 90%+.",
        CalibrationStage.HANDOFF: "Environment Synced. Camera feed terminated.",
        CalibrationStage.LIVE: "Active Sonar Mode — CSI-only monitoring.",
        CalibrationStage.FAILED: state.error or "Calibration failed.",
    }

    return CalibrationStatus(
        environment_id=state.environment_id,
        stage=state.stage.value,
        pose_match_accuracy=state.pose_match_accuracy,
        training_epoch=state.training_epoch,
        csi_frames_collected=state.csi_frames_collected,
        vision_frames_collected=state.vision_frames_collected,
        message=messages.get(state.stage, ""),
        rf_signatures_extracted=state.rf_signatures_extracted,
        walking_samples=state.walking_samples_collected,
        stationary_samples=state.stationary_samples_collected,
        rf_only_accuracy=state.rf_only_accuracy,
        rf_sustained_frames=state.rf_sustained_frames,
        handoff_triggered=state.handoff_triggered,
        camera_terminated=state.camera_terminated,
        active_tracks=state.active_tracks,
        ghosted_tracks=state.ghosted_tracks,
    )

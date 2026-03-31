"""Calibration session routes — start, stream paired data, monitor progress."""

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


@router.post("/start", response_model=CalibrationStatus)
async def start_calibration(
    body: CalibrationStart,
    user: TokenPayload = Depends(get_current_user),
) -> CalibrationStatus:
    """Step 1: Start a new calibration session for an environment."""
    engine = get_engine()
    state = engine.create_session(body.environment_id, user.user_id)
    return CalibrationStatus(
        environment_id=state.environment_id,
        stage=state.stage.value,
        pose_match_accuracy=0.0,
        training_epoch=0,
        csi_frames_collected=0,
        vision_frames_collected=0,
        message="Calibration session created. Begin 2D3D Map Trace.",
    )


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

    messages = {
        CalibrationStage.SETUP: "Ready to begin 2D3D Map Trace.",
        CalibrationStage.TRACE: "Collecting paired vision + CSI frames...",
        CalibrationStage.TRAINING: f"Training... Epoch {state.training_epoch}",
        CalibrationStage.CONFIDENCE: "Environment Synced. Camera no longer required.",
        CalibrationStage.LIVE: "Live CSI-only monitoring active.",
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
    )


@router.websocket("/stream/{env_id}")
async def calibration_stream(websocket: WebSocket, env_id: str) -> None:
    """WebSocket endpoint for streaming paired CSI + vision frames during calibration.

    Client sends JSON messages:
    {
        "token": "jwt...",
        "csi_amplitude": [...],
        "csi_phase": [...],
        "skeletal_keypoints": [[x,y,z], ...],  // 33 points
    }

    Server responds with calibration status updates.
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
            })

    except WebSocketDisconnect:
        pass

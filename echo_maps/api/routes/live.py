"""Live mode routes — CSI-only real-time monitoring after RF Handoff (Phase 4–5)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from echo_maps.api.deps import TokenPayload, get_current_user, verify_token

router = APIRouter()


def _get_engine():
    from echo_maps.api.routes.calibration import get_engine
    return get_engine()


class LivePose(BaseModel):
    keypoints: list[list[float]]   # (33, 3)
    activity: str
    breathing_rate: float | None = None
    heart_rate: float | None = None


class TrackedPersonOut(BaseModel):
    track_id: str
    user_tag: str
    position: list[float]          # [x, y, z]
    velocity: list[float]          # [vx, vy, vz]
    speed: float
    confidence: float
    is_registered: bool
    is_ghosted: bool
    last_activity: str
    breathing_rate: float | None = None
    heart_rate: float | None = None


@router.websocket("/stream/{env_id}")
async def live_stream(websocket: WebSocket, env_id: str) -> None:
    """WebSocket for real-time CSI-only monitoring (post-RF-Handoff).

    Phase 4–5: Active Sonar Mode with multi-person tracking.

    Client sends:
    {
        "token": "jwt...",  // first message only
        "csi_amplitude": [...],
        "csi_phase": [...]
    }

    Server responds with pose + vitals + tracking state:
    {
        "keypoints": [[x,y,z], ...],
        "activity": "walking",
        "breathing_rate": 16.2,
        "heart_rate": 72.0,
        "tracks": [
            {
                "track_id": "track_User_A_...",
                "user_tag": "User_A",
                "position": [x, y, z],
                "confidence": 0.95,
                "is_ghosted": false,
                ...
            }
        ]
    }
    """
    await websocket.accept()
    engine = _get_engine()

    try:
        # Auth
        init_msg = await websocket.receive_json()
        token = init_msg.get("token", "")
        user = verify_token(token)

        state = engine.get_session(env_id)
        if state is None:
            await websocket.close(code=4004, reason="Environment not calibrated")
            return
        if state.user_id != user.user_id:
            await websocket.close(code=4003, reason="Unauthorized")
            return

        while True:
            data = await websocket.receive_json()

            import numpy as np

            csi_amp = np.array(data["csi_amplitude"], dtype=np.float32)
            csi_phase = np.array(data["csi_phase"], dtype=np.float32)

            # Phase 4: Infer pose from CSI only
            keypoints = engine.infer_pose(csi_amp, csi_phase)

            # Phase 4–5: Update multi-person tracking
            rf_centroid = engine._estimate_rf_centroid(csi_amp, csi_phase)
            engine.update_live_tracking(
                env_id,
                rf_blob_centroids={"blob_0": rf_centroid},
            )

            # Get full tracking snapshot
            tracks = engine.get_tracking_snapshot()

            await websocket.send_json({
                "keypoints": keypoints.tolist(),
                "activity": "idle",
                "breathing_rate": None,
                "heart_rate": None,
                "tracks": tracks,
                "phase": engine.tracker.phase.value,
            })

    except WebSocketDisconnect:
        pass


@router.get("/status/{env_id}")
async def live_status(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> dict:
    """Check whether an environment is ready for live mode."""
    engine = _get_engine()
    state = engine.get_session(env_id)

    if state is None:
        raise HTTPException(status_code=404, detail="No calibration found for this environment")

    return {
        "environment_id": env_id,
        "stage": state.stage.value,
        "is_live": state.stage.value in ("live", "handoff"),
        "confidence": state.pose_match_accuracy,
        "rf_only_accuracy": state.rf_only_accuracy,
        "handoff_triggered": state.handoff_triggered,
        "camera_terminated": state.camera_terminated,
        "active_tracks": state.active_tracks,
        "ghosted_tracks": state.ghosted_tracks,
        "phase": engine.tracker.phase.value,
    }


@router.get("/tracks/{env_id}")
async def live_tracks(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> dict:
    """Get current multi-person tracking snapshot for live mode."""
    engine = _get_engine()
    state = engine.get_session(env_id)

    if state is None:
        raise HTTPException(status_code=404, detail="No calibration found for this environment")
    if state.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    return {
        "environment_id": env_id,
        "phase": engine.tracker.phase.value,
        "tracks": engine.get_tracking_snapshot(),
        "active_tracks": state.active_tracks,
        "ghosted_tracks": state.ghosted_tracks,
    }

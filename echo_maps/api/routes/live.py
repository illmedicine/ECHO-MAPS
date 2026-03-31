"""Live mode routes — CSI-only real-time monitoring after calibration."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from echo_maps.api.deps import TokenPayload, get_current_user, verify_token
from echo_maps.api.routes.calibration import get_engine

router = APIRouter()


class LivePose(BaseModel):
    keypoints: list[list[float]]   # (33, 3)
    activity: str
    breathing_rate: float | None = None
    heart_rate: float | None = None


@router.websocket("/stream/{env_id}")
async def live_stream(websocket: WebSocket, env_id: str) -> None:
    """WebSocket for real-time CSI-only monitoring (post-calibration).

    Client sends:
    {
        "token": "jwt...",  // first message only
        "csi_amplitude": [...],
        "csi_phase": [...]
    }

    Server responds with pose + vitals:
    {
        "keypoints": [[x,y,z], ...],
        "activity": "walking",
        "breathing_rate": 16.2,
        "heart_rate": 72.0
    }
    """
    await websocket.accept()
    engine = get_engine()

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

            # Infer pose from CSI only
            keypoints = engine.infer_pose(csi_amp, csi_phase)

            await websocket.send_json({
                "keypoints": keypoints.tolist(),
                "activity": "idle",  # TODO: integrate WaveFormer activity head
                "breathing_rate": None,
                "heart_rate": None,
            })

    except WebSocketDisconnect:
        pass


@router.get("/status/{env_id}")
async def live_status(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> dict:
    """Check whether an environment is ready for live mode."""
    engine = get_engine()
    state = engine.get_session(env_id)

    if state is None:
        raise HTTPException(status_code=404, detail="No calibration found for this environment")

    return {
        "environment_id": env_id,
        "stage": state.stage.value,
        "is_live": state.stage.value == "live",
        "confidence": state.pose_match_accuracy,
    }

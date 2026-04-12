"""Room scan routes — mobile phone camera visual mapping for enhanced calibration.

Endpoints for the room scan workflow:
  POST   /start/{env_id}       — Begin a new room scan session
  GET    /status/{env_id}      — Get current scan session state
  POST   /frame/{env_id}       — Submit client-side detections for a frame
  POST   /finalise/{env_id}    — Finalise scan and generate floor plan
  GET    /floor-plan/{env_id}  — Get the generated floor plan with objects
  WS     /stream/{env_id}      — Real-time scan streaming via WebSocket
"""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from echo_maps.api.deps import TokenPayload, get_current_user, verify_token

router = APIRouter()

# Singleton scanner (in production, use DI)
_scanner = None
_generator = None


def get_scanner():
    global _scanner  # noqa: PLW0603
    if _scanner is None:
        from echo_maps.vision.room_scanner import RoomScanner
        _scanner = RoomScanner()
    return _scanner


def get_generator():
    global _generator  # noqa: PLW0603
    if _generator is None:
        from echo_maps.vision.floor_plan_generator import FloorPlanGenerator
        _generator = FloorPlanGenerator()
    return _generator


# ── Request / Response models ──────────────────────────────────────────────

class DetectionItem(BaseModel):
    category: str
    confidence: float = 0.5
    bbox: list[float] = Field(default_factory=lambda: [0, 0, 1, 1])
    distance: float | None = None
    bearing: float | None = None


class DeviceOrientation(BaseModel):
    alpha: float = 0.0   # compass heading (0–360)
    beta: float = 0.0    # front-back tilt (-180–180)
    gamma: float = 0.0   # left-right tilt (-90–90)


class FrameSubmission(BaseModel):
    detections: list[DetectionItem]
    orientation: DeviceOrientation | None = None
    frame_index: int = 0


class ScanStatusResponse(BaseModel):
    id: str
    environment_id: str
    phase: str
    frames_captured: int
    coverage_degrees: float
    target_coverage: float
    objects_detected: int
    room_dimensions: dict
    scan_confidence: float
    calibration_boost: float
    message: str


class FloorPlanObjectOut(BaseModel):
    id: str
    category: str
    label: str
    x: float
    y: float
    width: float
    height: float
    rotation: float
    confidence: float


class FloorPlanResponse(BaseModel):
    environment_id: str
    room_width: float
    room_length: float
    room_height: float
    objects: list[FloorPlanObjectOut]
    walls: list[dict]
    doors: list[dict]
    windows: list[dict]
    is_fully_mapped: bool
    scan_confidence: float
    dimensions_confidence: float


# ── Routes ─────────────────────────────────────────────────────────────────

@router.post("/start/{env_id}", response_model=ScanStatusResponse)
async def start_room_scan(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> ScanStatusResponse:
    """Begin a new room scan session for an environment.

    The user should stand in the centre of the room and slowly
    pan their phone camera 360° to capture all objects and walls.
    """
    scanner = get_scanner()
    session = scanner.create_session(env_id, user.user_id)
    return _session_to_response(session)


@router.get("/status/{env_id}", response_model=ScanStatusResponse)
async def get_scan_status(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> ScanStatusResponse:
    """Get the current room scan session state."""
    scanner = get_scanner()
    session = scanner.get_session(env_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No scan session found")
    if session.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")
    return _session_to_response(session)


@router.post("/frame/{env_id}", response_model=ScanStatusResponse)
async def submit_frame_detections(
    env_id: str,
    body: FrameSubmission,
    user: TokenPayload = Depends(get_current_user),
) -> ScanStatusResponse:
    """Submit client-side object detections for a single camera frame.

    The mobile app runs TensorFlow.js COCO-SSD locally on the phone
    and sends detected objects + device orientation to this endpoint.
    """
    scanner = get_scanner()
    session = scanner.get_session(env_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No scan session found — call /start first")
    if session.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    orientation = None
    if body.orientation:
        orientation = {
            "alpha": body.orientation.alpha,
            "beta": body.orientation.beta,
            "gamma": body.orientation.gamma,
        }

    detections = [
        {
            "category": d.category,
            "confidence": d.confidence,
            "bbox": d.bbox,
            "distance": d.distance,
            "bearing": d.bearing,
        }
        for d in body.detections
    ]

    session = scanner.process_client_detections(env_id, detections, orientation)

    # If scan just completed, auto-generate floor plan
    if session.phase.value == "complete":
        _auto_generate_floor_plan(env_id, session)

    return _session_to_response(session)


@router.post("/finalise/{env_id}", response_model=FloorPlanResponse)
async def finalise_scan(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> FloorPlanResponse:
    """Finalise the room scan and generate the floor plan.

    Call this when the user is done scanning (even if coverage < 100%).
    Generates a floor plan with all detected objects positioned spatially.
    If all objects and room dimensions are successfully mapped, the
    calibration confidence can reach 100%.
    """
    scanner = get_scanner()
    session = scanner.get_session(env_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No scan session found")
    if session.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    session = scanner.finalise_scan(env_id)
    plan = _auto_generate_floor_plan(env_id, session)
    plan_dict = plan.to_dict()

    return FloorPlanResponse(**plan_dict)


@router.get("/floor-plan/{env_id}", response_model=FloorPlanResponse)
async def get_generated_floor_plan(
    env_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> FloorPlanResponse:
    """Get the auto-generated floor plan with detected objects.

    Returns the floor plan created by the room scan, including all
    furniture/fixtures positioned on the 2D layout.
    """
    scanner = get_scanner()
    session = scanner.get_session(env_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No scan session — run a room scan first")

    generator = get_generator()
    plan = generator.generate(session)
    plan_dict = plan.to_dict()
    return FloorPlanResponse(**plan_dict)


# ── WebSocket for real-time scanning ───────────────────────────────────────

@router.websocket("/stream/{env_id}")
async def room_scan_stream(websocket: WebSocket, env_id: str) -> None:
    """WebSocket for real-time room scan streaming from mobile.

    Client sends JSON messages:
    {
        "token": "jwt...",         // first message only
        "detections": [...],       // COCO-SSD results from TF.js
        "orientation": { alpha, beta, gamma },
        "frame_index": 0
    }

    Server responds with full scan status including:
    - Current phase (capturing → processing → complete)
    - Detected objects with positions
    - Room dimensions and coverage
    - Scan confidence and calibration boost
    """
    await websocket.accept()
    scanner = get_scanner()

    try:
        # First message must include auth token
        init_msg = await websocket.receive_json()
        token = init_msg.get("token", "")
        user = verify_token(token)

        session = scanner.get_session(env_id)
        if session is None:
            # Auto-create session for convenience
            session = scanner.create_session(env_id, user.user_id)

        if session.user_id != user.user_id:
            await websocket.close(code=4003, reason="Not your session")
            return

        while True:
            data = await websocket.receive_json()

            detections = data.get("detections", [])
            orientation = data.get("orientation", None)

            session = scanner.process_client_detections(
                env_id, detections, orientation,
            )

            # Auto-generate floor plan on complete
            floor_plan_data = None
            if session.phase.value == "complete":
                plan = _auto_generate_floor_plan(env_id, session)
                floor_plan_data = plan.to_dict()

            await websocket.send_json({
                "phase": session.phase.value,
                "frames_captured": session.frames_captured,
                "coverage_degrees": round(session.coverage_degrees, 1),
                "objects": [o.to_dict() for o in session.objects],
                "room_dimensions": session.room_dimensions.to_dict(),
                "scan_confidence": round(session.scan_confidence, 3),
                "calibration_boost": round(session.calibration_boost, 3),
                "floor_plan": floor_plan_data,
            })

    except WebSocketDisconnect:
        pass


# ── Helpers ────────────────────────────────────────────────────────────────

def _auto_generate_floor_plan(env_id: str, session) -> object:
    """Generate floor plan and update calibration state."""
    generator = get_generator()
    plan = generator.generate(session)

    # Update calibration session if one exists
    try:
        from echo_maps.api.routes.calibration import get_engine
        engine = get_engine()
        cal_state = engine.get_session(env_id)
        if cal_state is not None:
            cal_state.room_scan_active = False
            cal_state.room_scan_confidence = session.scan_confidence
            cal_state.room_scan_objects_detected = len(session.objects)
            cal_state.room_scan_coverage_degrees = session.coverage_degrees
            cal_state.room_dimensions_mapped = session.room_dimensions.confidence > 0.7
            cal_state.floor_plan_generated = True

            # Boost calibration confidence based on scan quality
            # Full scan + CSI data = potential 100% calibration
            if plan.is_fully_mapped:
                cal_state.pose_match_accuracy = min(
                    1.0,
                    cal_state.pose_match_accuracy + session.calibration_boost,
                )
    except Exception:
        pass  # calibration engine may not be initialised yet

    return plan


def _session_to_response(session) -> ScanStatusResponse:
    phase_messages = {
        "idle": "Ready to begin room scan. Point your camera around the room.",
        "capturing": f"Scanning... {session.coverage_degrees:.0f}° of {session.target_coverage:.0f}° covered. "
                     f"{len(session.objects)} objects detected.",
        "processing": "Processing frame...",
        "mapping": "Building spatial map...",
        "complete": f"Scan complete! {len(session.objects)} objects mapped. "
                    f"Calibration boost: +{session.calibration_boost * 100:.0f}%",
        "failed": session.error or "Scan failed.",
    }

    return ScanStatusResponse(
        id=session.id,
        environment_id=session.environment_id,
        phase=session.phase.value,
        frames_captured=session.frames_captured,
        coverage_degrees=round(session.coverage_degrees, 1),
        target_coverage=session.target_coverage,
        objects_detected=len(session.objects),
        room_dimensions=session.room_dimensions.to_dict(),
        scan_confidence=round(session.scan_confidence, 3),
        calibration_boost=round(session.calibration_boost, 3),
        message=phase_messages.get(session.phase.value, ""),
    )

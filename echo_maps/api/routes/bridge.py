"""Bridge device management routes — discovery, binding, and room calibration.

Provides endpoints for:
  - Discovering Illy Bridge devices on the local network
  - Binding/unbinding bridges to Echo Vue user accounts
  - Initiating room calibration and presence detection scans
  - Streaming calibration data (camera + mic + CSI) to the cloud AI engine
  - Monitoring bridge status and calibration progress
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from echo_maps.api.deps import TokenPayload, get_current_user, verify_token

router = APIRouter()

# Singleton bridge manager
_bridge_manager = None


def get_bridge_manager():
    global _bridge_manager  # noqa: PLW0603
    if _bridge_manager is None:
        from echo_maps.bridge.manager import BridgeManager
        _bridge_manager = BridgeManager()
    return _bridge_manager


# ── Request / Response Models ──


class BridgeDiscoverRequest(BaseModel):
    """Report a bridge discovered via mDNS on the local network."""
    device_id: str
    ip_address: str
    model: str = "FNK0086"
    firmware_version: str = "2.0.0"
    has_camera: bool = True
    has_mic: bool = True
    has_speaker: bool = True
    has_lcd: bool = True


class BridgeBindRequest(BaseModel):
    device_id: str


class BridgeOut(BaseModel):
    device_id: str
    model: str = "FNK0086"
    firmware_version: str = "2.0.0"
    status: str
    is_bound: bool
    ip_address: str = ""
    has_camera: bool = True
    has_mic: bool = True
    has_speaker: bool = True
    has_lcd: bool = True
    current_room: str = ""
    rooms_calibrated: list[str] = []


class RoomCalibrationRequest(BaseModel):
    device_id: str
    environment_id: str
    room_name: str = Field(..., min_length=1, max_length=63)


class CalibrationProgressOut(BaseModel):
    device_id: str
    status: str
    current_room: str
    rooms_calibrated: list[str]
    environment_id: str | None
    is_bound: bool


# ── Discovery ──

@router.get("/discover")
async def discover_bridges(
    user: TokenPayload = Depends(get_current_user),
) -> list[dict]:
    """Discover Illy Bridge devices available on the network.

    The frontend first performs local mDNS discovery for _illybridge._tcp,
    then reports found devices via POST /report-discovered.
    This endpoint returns all known bridges.
    """
    manager = get_bridge_manager()
    return await manager.discover_bridges()


@router.post("/report-discovered")
async def report_discovered_bridge(
    body: BridgeDiscoverRequest,
    user: TokenPayload = Depends(get_current_user),
) -> dict:
    """Report a bridge discovered via local mDNS scan.

    Called by the Echo Vue frontend when it finds an Illy Bridge
    on the same WiFi network via _illybridge._tcp mDNS service.
    """
    manager = get_bridge_manager()
    manager.report_discovered(body.model_dump())
    return {"status": "ok", "device_id": body.device_id}


# ── Binding ──

@router.post("/bind", response_model=BridgeOut)
async def bind_bridge(
    body: BridgeBindRequest,
    user: TokenPayload = Depends(get_current_user),
) -> BridgeOut:
    """Bind a discovered bridge to the current Echo Vue user account.

    After discovery, the user selects a bridge and binds it.
    This associates the bridge with their account so they can
    manage calibrations and send commands remotely.
    """
    manager = get_bridge_manager()
    device = manager.bind_device(body.device_id, user.user_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Bridge not found — ensure it's on the same network")
    return _device_to_out(device)


@router.post("/unbind")
async def unbind_bridge(
    body: BridgeBindRequest,
    user: TokenPayload = Depends(get_current_user),
) -> dict:
    """Unbind a bridge from the current user."""
    manager = get_bridge_manager()
    success = manager.unbind_device(body.device_id)
    if not success:
        raise HTTPException(status_code=404, detail="Bridge not found")
    return {"status": "unbound", "device_id": body.device_id}


# ── Device Listing ──

@router.get("/devices", response_model=list[BridgeOut])
async def list_bridges(
    user: TokenPayload = Depends(get_current_user),
) -> list[BridgeOut]:
    """List all bridges bound to the current user."""
    manager = get_bridge_manager()
    devices = manager.get_devices_for_user(user.user_id)
    return [_device_to_out(d) for d in devices]


@router.get("/devices/{device_id}", response_model=BridgeOut)
async def get_bridge(
    device_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> BridgeOut:
    """Get a specific bridge device."""
    manager = get_bridge_manager()
    device = manager.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Bridge not found")
    if device.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your bridge")
    return _device_to_out(device)


# ── Room Calibration ──

@router.post("/calibrate/start", response_model=CalibrationProgressOut)
async def start_room_calibration(
    body: RoomCalibrationRequest,
    user: TokenPayload = Depends(get_current_user),
) -> CalibrationProgressOut:
    """Start a room calibration scan using the bridge's camera + mic + CSI.

    The user walks into a room with the bridge and initiates calibration.
    Camera captures visual data for skeleton extraction, mic captures room
    acoustics, and CSI provides RF fingerprinting — all sent to the cloud
    AI engine for processing.
    """
    manager = get_bridge_manager()
    device = manager.get_device(body.device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Bridge not found")
    if device.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your bridge")

    success = await manager.start_room_calibration(
        body.device_id, body.environment_id, body.room_name
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to start calibration")

    progress = manager.get_calibration_progress(body.device_id)
    return CalibrationProgressOut(**progress)


@router.post("/calibrate/presence", response_model=CalibrationProgressOut)
async def start_presence_scan(
    body: RoomCalibrationRequest,
    user: TokenPayload = Depends(get_current_user),
) -> CalibrationProgressOut:
    """Start a presence detection scan (CSI + mic, no camera).

    Used for detecting occupancy and movement patterns in a room
    without the visual component.
    """
    manager = get_bridge_manager()
    device = manager.get_device(body.device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Bridge not found")
    if device.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your bridge")

    success = await manager.start_presence_scan(
        body.device_id, body.environment_id, body.room_name
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to start presence scan")

    progress = manager.get_calibration_progress(body.device_id)
    return CalibrationProgressOut(**progress)


@router.post("/calibrate/stop")
async def stop_calibration(
    body: BridgeBindRequest,
    user: TokenPayload = Depends(get_current_user),
) -> dict:
    """Stop the current room calibration or presence scan on a bridge."""
    manager = get_bridge_manager()
    device = manager.get_device(body.device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Bridge not found")
    if device.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Not your bridge")

    success = await manager.stop_room_scan(body.device_id)
    return {"status": "stopped" if success else "failed", "device_id": body.device_id}


@router.get("/calibrate/progress/{device_id}", response_model=CalibrationProgressOut)
async def get_calibration_progress(
    device_id: str,
    user: TokenPayload = Depends(get_current_user),
) -> CalibrationProgressOut:
    """Get room calibration progress for a bridge."""
    manager = get_bridge_manager()
    progress = manager.get_calibration_progress(device_id)
    if progress is None:
        raise HTTPException(status_code=404, detail="Bridge not found")
    return CalibrationProgressOut(**progress)


# ── WebSocket: Real-time bridge data stream ──

@router.websocket("/stream/{device_id}")
async def bridge_data_stream(websocket: WebSocket, device_id: str) -> None:
    """WebSocket for streaming bridge calibration data to the cloud.

    The bridge sends camera frames, audio samples, and CSI data.
    The cloud AI engine processes this data and pushes results back
    to the Echo Vue web interface.

    Client (bridge) sends binary IL protocol packets.
    Server responds with JSON status updates.
    """
    await websocket.accept()
    manager = get_bridge_manager()

    try:
        # Auth
        init_msg = await websocket.receive_json()
        token = init_msg.get("token", "")
        user = verify_token(token)

        device = manager.get_device(device_id)
        if device is None:
            await websocket.close(code=4004, reason="Bridge not found")
            return
        if device.user_id != user.user_id:
            await websocket.close(code=4003, reason="Unauthorized")
            return

        from echo_maps.bridge.protocol import BridgePacket

        while True:
            # Receive binary IL packet from bridge
            data = await websocket.receive_bytes()
            try:
                packet = BridgePacket.deserialize(data)
                result = manager.handle_packet(device_id, packet)

                # Send status update back
                progress = manager.get_calibration_progress(device_id) or {}
                await websocket.send_json({
                    "status": "ok",
                    "event": packet.event.name,
                    "progress": progress,
                    "has_data": result is not None,
                })
            except ValueError as e:
                await websocket.send_json({"status": "error", "detail": str(e)})

    except WebSocketDisconnect:
        pass


# ── Helpers ──

def _device_to_out(device) -> BridgeOut:
    return BridgeOut(
        device_id=device.device_id,
        model=device.model,
        firmware_version=device.firmware_version,
        status=device.status.name.lower(),
        is_bound=device.is_bound,
        ip_address=device.ip_address,
        has_camera=device.has_camera,
        has_mic=device.has_mic,
        has_speaker=device.has_speaker,
        has_lcd=device.has_lcd,
        current_room=device.current_room,
        rooms_calibrated=device.rooms_calibrated,
    )

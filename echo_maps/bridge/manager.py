"""Illy Bridge device manager — handles TLS connections, provisioning, and OTA.

Manages the lifecycle of connected Illy Bridge hardware nodes (FNK0086),
including device registration, CSI stream management, room calibration,
camera/audio data relay, and LED status control.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone

import structlog

from echo_maps.bridge.protocol import (
    BridgeCommand,
    BridgeEvent,
    BridgePacket,
    BridgeStatus,
    build_command_packet,
    parse_camera_frame_payload,
    parse_audio_sample_payload,
    parse_csi_payload,
)

logger = structlog.get_logger()


@dataclass
class BridgeDevice:
    """Represents a connected Illy Bridge hardware node (FNK0086)."""

    device_id: str
    user_id: str
    environment_id: str | None = None
    firmware_version: str = "0.0.0"
    status: BridgeStatus = BridgeStatus.OFFLINE
    sample_rate_hz: int = 100
    last_seen: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    ip_address: str = ""
    # FNK0086 capabilities
    model: str = "FNK0086"
    has_camera: bool = True
    has_mic: bool = True
    has_speaker: bool = True
    has_lcd: bool = True
    # Binding state
    is_bound: bool = False
    # Room calibration state
    current_room: str = ""
    rooms_calibrated: list[str] = field(default_factory=list)
    calibration_data: dict = field(default_factory=dict)


class BridgeManager:
    """Manages connected Illy Bridge devices (FNK0086).

    Handles device discovery, registration, user binding, command dispatch,
    room calibration orchestration, camera/audio data relay, and CSI stream routing.
    """

    def __init__(self) -> None:
        self._devices: dict[str, BridgeDevice] = {}
        self._csi_callbacks: dict[str, list] = {}
        self._camera_callbacks: dict[str, list] = {}
        self._audio_callbacks: dict[str, list] = {}
        self._discovered: dict[str, dict] = {}  # Devices found via local scan

    def register_device(
        self,
        device_id: str,
        user_id: str,
        firmware_version: str = "1.0.0",
        ip_address: str = "",
    ) -> BridgeDevice:
        """Register a new Illy Bridge device."""
        device = BridgeDevice(
            device_id=device_id,
            user_id=user_id,
            firmware_version=firmware_version,
            status=BridgeStatus.IDLE,
            ip_address=ip_address,
        )
        self._devices[device_id] = device
        logger.info("bridge_registered", device_id=device_id, user_id=user_id)
        return device

    def get_device(self, device_id: str) -> BridgeDevice | None:
        return self._devices.get(device_id)

    def get_devices_for_user(self, user_id: str) -> list[BridgeDevice]:
        return [d for d in self._devices.values() if d.user_id == user_id]

    async def send_command(
        self,
        device_id: str,
        command: BridgeCommand,
        payload: bytes = b"",
    ) -> bool:
        """Send a command to an Illy Bridge device.

        In production, this transmits over the TLS 1.3 connection.
        """
        device = self._devices.get(device_id)
        if device is None:
            logger.warning("bridge_not_found", device_id=device_id)
            return False

        packet = build_command_packet(command, payload)
        logger.info(
            "bridge_command_sent",
            device_id=device_id,
            command=command.name,
            payload_size=len(payload),
        )

        # Update device status based on command
        if command == BridgeCommand.START_CALIBRATION:
            device.status = BridgeStatus.CALIBRATING
        elif command == BridgeCommand.START_CSI_STREAM:
            device.status = BridgeStatus.MONITORING
        elif command == BridgeCommand.STOP_CSI_STREAM:
            device.status = BridgeStatus.IDLE

        return True

    async def start_csi_stream(
        self,
        device_id: str,
        environment_id: str,
        sample_rate_hz: int = 100,
    ) -> bool:
        """Start CSI streaming from a bridge to the cloud."""
        device = self._devices.get(device_id)
        if device is None:
            return False

        device.environment_id = environment_id
        device.sample_rate_hz = sample_rate_hz

        # Set sample rate
        rate_payload = sample_rate_hz.to_bytes(1, "big")
        await self.send_command(device_id, BridgeCommand.SET_SAMPLE_RATE, rate_payload)

        # Start streaming
        await self.send_command(device_id, BridgeCommand.START_CSI_STREAM)
        return True

    async def stop_csi_stream(self, device_id: str) -> bool:
        """Stop CSI streaming from a bridge."""
        return await self.send_command(device_id, BridgeCommand.STOP_CSI_STREAM)

    def handle_packet(self, device_id: str, packet: BridgePacket) -> dict | None:
        """Process an incoming packet from a bridge device.

        Returns parsed CSI data if packet is a CSI_FRAME, None otherwise.
        """
        device = self._devices.get(device_id)
        if device is None:
            return None

        device.last_seen = datetime.now(timezone.utc)

        if packet.event == BridgeEvent.CSI_FRAME:
            return parse_csi_payload(packet.payload)

        if packet.event == BridgeEvent.STATUS_REPORT:
            if len(packet.payload) >= 1:
                device.status = BridgeStatus(packet.payload[0])
            return None

        if packet.event == BridgeEvent.MOTION_DETECTED:
            logger.info("motion_detected", device_id=device_id)
            return None

        if packet.event == BridgeEvent.VITAL_ALERT:
            logger.warning("vital_alert", device_id=device_id)
            return None

        if packet.event == BridgeEvent.CAMERA_FRAME:
            data = parse_camera_frame_payload(packet.payload)
            logger.debug(
                "camera_frame_received",
                device_id=device_id,
                room=data.get("room_name"),
                jpeg_size=data.get("jpeg_size"),
            )
            # Notify camera callbacks
            for cb in self._camera_callbacks.get(device_id, []):
                asyncio.get_event_loop().call_soon(cb, data)
            return data

        if packet.event == BridgeEvent.AUDIO_SAMPLE:
            data = parse_audio_sample_payload(packet.payload)
            logger.debug(
                "audio_sample_received",
                device_id=device_id,
                room=data.get("room_name"),
                n_samples=data.get("n_samples"),
            )
            for cb in self._audio_callbacks.get(device_id, []):
                asyncio.get_event_loop().call_soon(cb, data)
            return data

        if packet.event == BridgeEvent.ROOM_SCAN_COMPLETE:
            logger.info("room_scan_complete", device_id=device_id)
            if device is not None:
                device.status = BridgeStatus.IDLE
                if device.current_room and device.current_room not in device.rooms_calibrated:
                    device.rooms_calibrated.append(device.current_room)
            return None

        return None

    # ──────────────────────────────────────────────
    # Discovery — find bridges on the local network
    # ──────────────────────────────────────────────

    async def discover_bridges(self, timeout_s: float = 5.0) -> list[dict]:
        """Discover Illy Bridge devices on the local network via mDNS/HTTP scan.

        In production, the Echo Vue frontend performs mDNS query for
        _illybridge._tcp and then hits GET /api/bridge/info on each found IP.
        This server-side method supports the cloud-relay discovery path.
        """
        discovered = list(self._discovered.values())
        # Also include any already-registered devices
        for device in self._devices.values():
            if device.ip_address and device.device_id not in self._discovered:
                discovered.append({
                    "device_id": device.device_id,
                    "ip_address": device.ip_address,
                    "model": device.model,
                    "firmware_version": device.firmware_version,
                    "status": device.status.name.lower(),
                    "is_bound": device.is_bound,
                    "has_camera": device.has_camera,
                    "has_mic": device.has_mic,
                    "has_speaker": device.has_speaker,
                    "has_lcd": device.has_lcd,
                })
        return discovered

    def report_discovered(self, device_info: dict) -> None:
        """Called by the frontend when it discovers a bridge on the local network."""
        device_id = device_info.get("device_id", "")
        if device_id:
            self._discovered[device_id] = device_info
            logger.info("bridge_discovered", device_id=device_id, ip=device_info.get("ip_address"))

    # ──────────────────────────────────────────────
    # Binding — associate bridge with Echo Vue user
    # ──────────────────────────────────────────────

    def bind_device(self, device_id: str, user_id: str) -> BridgeDevice | None:
        """Bind a discovered bridge to an Echo Vue user account."""
        device = self._devices.get(device_id)
        if device is None:
            # Auto-register if discovered but not yet registered
            disc = self._discovered.get(device_id)
            if disc:
                device = self.register_device(
                    device_id=device_id,
                    user_id=user_id,
                    firmware_version=disc.get("firmware_version", "2.0.0"),
                    ip_address=disc.get("ip_address", ""),
                )
            else:
                return None

        device.user_id = user_id
        device.is_bound = True
        logger.info("bridge_bound", device_id=device_id, user_id=user_id)
        return device

    def unbind_device(self, device_id: str) -> bool:
        """Unbind a bridge from its user."""
        device = self._devices.get(device_id)
        if device is None:
            return False
        device.is_bound = False
        device.user_id = ""
        logger.info("bridge_unbound", device_id=device_id)
        return True

    # ──────────────────────────────────────────────
    # Room Calibration — walk-through room scanning
    # ──────────────────────────────────────────────

    async def start_room_calibration(
        self,
        device_id: str,
        environment_id: str,
        room_name: str,
    ) -> bool:
        """Start a room calibration scan (camera + mic + CSI) on a bridge."""
        device = self._devices.get(device_id)
        if device is None or not device.is_bound:
            return False

        device.environment_id = environment_id
        device.current_room = room_name
        device.status = BridgeStatus.ROOM_SCANNING

        # Send room name then start command
        room_payload = room_name.encode("utf-8")[:63]
        await self.send_command(device_id, BridgeCommand.SET_ROOM_NAME, room_payload)
        await self.send_command(device_id, BridgeCommand.START_ROOM_SCAN)

        logger.info(
            "room_calibration_started",
            device_id=device_id,
            environment_id=environment_id,
            room=room_name,
        )
        return True

    async def start_presence_scan(
        self,
        device_id: str,
        environment_id: str,
        room_name: str,
    ) -> bool:
        """Start a presence detection scan (CSI + mic, no camera) on a bridge."""
        device = self._devices.get(device_id)
        if device is None or not device.is_bound:
            return False

        device.environment_id = environment_id
        device.current_room = room_name
        device.status = BridgeStatus.PRESENCE_SCANNING

        room_payload = room_name.encode("utf-8")[:63]
        await self.send_command(device_id, BridgeCommand.SET_ROOM_NAME, room_payload)
        await self.send_command(device_id, BridgeCommand.START_PRESENCE_SCAN)

        logger.info(
            "presence_scan_started",
            device_id=device_id,
            environment_id=environment_id,
            room=room_name,
        )
        return True

    async def stop_room_scan(self, device_id: str) -> bool:
        """Stop any active room scan or presence detection."""
        device = self._devices.get(device_id)
        if device is None:
            return False

        await self.send_command(device_id, BridgeCommand.STOP_ROOM_SCAN)
        device.status = BridgeStatus.IDLE

        if device.current_room and device.current_room not in device.rooms_calibrated:
            device.rooms_calibrated.append(device.current_room)

        logger.info("room_scan_stopped", device_id=device_id, room=device.current_room)
        return True

    def get_calibration_progress(self, device_id: str) -> dict | None:
        """Get room calibration progress for a bridge."""
        device = self._devices.get(device_id)
        if device is None:
            return None

        return {
            "device_id": device_id,
            "status": device.status.name.lower(),
            "current_room": device.current_room,
            "rooms_calibrated": device.rooms_calibrated,
            "environment_id": device.environment_id,
            "is_bound": device.is_bound,
        }

    # ──────────────────────────────────────────────
    # Callbacks for camera/audio data
    # ──────────────────────────────────────────────

    def on_camera_frame(self, device_id: str, callback) -> None:
        """Register a callback for camera frames from a bridge."""
        self._camera_callbacks.setdefault(device_id, []).append(callback)

    def on_audio_sample(self, device_id: str, callback) -> None:
        """Register a callback for audio samples from a bridge."""
        self._audio_callbacks.setdefault(device_id, []).append(callback)

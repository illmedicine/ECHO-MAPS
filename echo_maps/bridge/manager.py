"""Illy Bridge device manager — handles TLS connections, provisioning, and OTA.

Manages the lifecycle of connected Illy Bridge hardware nodes,
including device registration, CSI stream management, and LED status control.
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
    parse_csi_payload,
)

logger = structlog.get_logger()


@dataclass
class BridgeDevice:
    """Represents a connected Illy Bridge hardware node."""

    device_id: str
    user_id: str
    environment_id: str | None = None
    firmware_version: str = "0.0.0"
    status: BridgeStatus = BridgeStatus.OFFLINE
    sample_rate_hz: int = 100
    last_seen: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    ip_address: str = ""


class BridgeManager:
    """Manages connected Illy Bridge devices.

    Handles device registration, command dispatch, and CSI stream routing.
    In production, this would maintain persistent TLS 1.3 connections
    to each bridge node.
    """

    def __init__(self) -> None:
        self._devices: dict[str, BridgeDevice] = {}
        self._csi_callbacks: dict[str, list] = {}

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

        return None

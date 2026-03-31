"""Illy Bridge communication protocol.

Defines the TLS 1.3 encrypted binary protocol between the ESP32-S3
Illy Bridge hardware node and the Echo Maps cloud backend.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from enum import IntEnum

import numpy as np


class BridgeCommand(IntEnum):
    """Commands sent from cloud → bridge."""

    PING = 0x01
    START_CSI_STREAM = 0x10
    STOP_CSI_STREAM = 0x11
    SET_SAMPLE_RATE = 0x12
    START_CALIBRATION = 0x20
    STOP_CALIBRATION = 0x21
    GET_STATUS = 0x30
    OTA_UPDATE = 0xF0
    REBOOT = 0xFF


class BridgeStatus(IntEnum):
    """Status codes reported by the bridge."""

    IDLE = 0x00
    CALIBRATING = 0x01        # Blue LED — camera paired
    MONITORING = 0x02         # Green LED — CSI-only mode
    OFFLINE = 0x03            # Red LED
    OTA_IN_PROGRESS = 0x04
    ERROR = 0xFF


class BridgeEvent(IntEnum):
    """Events sent from bridge → cloud."""

    CSI_FRAME = 0x01
    STATUS_REPORT = 0x02
    MOTION_DETECTED = 0x03
    VITAL_ALERT = 0x04
    ERROR_REPORT = 0x05


@dataclass(frozen=True, slots=True)
class BridgePacket:
    """Parsed packet from the Illy Bridge.

    Wire format (big-endian):
        [magic(2B)][version(1B)][event(1B)][seq(4B)][payload_len(4B)][payload][crc32(4B)]
    """

    MAGIC = 0x494C  # "IL" for Illy

    version: int
    event: BridgeEvent
    sequence: int
    payload: bytes

    def serialize(self) -> bytes:
        """Serialize packet to wire format."""
        import zlib

        header = struct.pack(
            ">HBBI",
            self.MAGIC,
            self.version,
            self.event,
            self.sequence,
        )
        payload_len = struct.pack(">I", len(self.payload))
        body = header + payload_len + self.payload
        crc = struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        return body + crc

    @classmethod
    def deserialize(cls, data: bytes) -> BridgePacket:
        """Parse a wire-format packet."""
        import zlib

        if len(data) < 16:
            raise ValueError(f"Packet too short: {len(data)} bytes")

        magic, version, event, sequence = struct.unpack(">HBBI", data[0:8])
        if magic != cls.MAGIC:
            raise ValueError(f"Invalid magic: 0x{magic:04X}")

        payload_len = struct.unpack(">I", data[8:12])[0]

        if len(data) < 16 + payload_len:
            raise ValueError(f"Incomplete packet: need {16 + payload_len}, got {len(data)}")

        payload = data[12 : 12 + payload_len]
        received_crc = struct.unpack(">I", data[12 + payload_len : 16 + payload_len])[0]

        body = data[: 12 + payload_len]
        computed_crc = zlib.crc32(body) & 0xFFFFFFFF
        if received_crc != computed_crc:
            raise ValueError(f"CRC mismatch: {received_crc:#x} != {computed_crc:#x}")

        return cls(
            version=version,
            event=BridgeEvent(event),
            sequence=sequence,
            payload=payload,
        )


def build_command_packet(command: BridgeCommand, payload: bytes = b"", seq: int = 0) -> bytes:
    """Build a command packet to send to the bridge."""
    pkt = BridgePacket(
        version=1,
        event=BridgeEvent(command),
        sequence=seq,
        payload=payload,
    )
    return pkt.serialize()


def parse_csi_payload(payload: bytes) -> dict:
    """Parse a CSI_FRAME event payload from the bridge.

    Payload format:
        [timestamp_us(8B)][rssi(1B)][n_sub(1B)][sample_rate_hz(1B)]
        [antenna_config(1B)][csi_ant0(n_sub*2 int8)][csi_ant1(n_sub*2 int8)]
    """
    if len(payload) < 12:
        raise ValueError(f"CSI payload too short: {len(payload)} bytes")

    timestamp_us = struct.unpack("<Q", payload[0:8])[0]
    rssi = struct.unpack("<b", payload[8:9])[0]
    n_sub = payload[9]
    sample_rate_hz = payload[10]
    antenna_config = payload[11]  # 0x22 = 2x2 MIMO

    n_antennas = (antenna_config >> 4) & 0x0F
    expected_csi_bytes = n_sub * 2 * n_antennas
    if len(payload) < 12 + expected_csi_bytes:
        raise ValueError("CSI payload incomplete")

    antennas = {}
    offset = 12
    for ant in range(n_antennas):
        raw = np.frombuffer(payload[offset : offset + n_sub * 2], dtype=np.int8)
        pairs = raw.reshape(n_sub, 2).astype(np.float32)
        imag, real = pairs[:, 0], pairs[:, 1]
        antennas[f"ant{ant}"] = {
            "amplitude": np.sqrt(real**2 + imag**2),
            "phase": np.arctan2(imag, real),
        }
        offset += n_sub * 2

    return {
        "timestamp_us": timestamp_us,
        "rssi": rssi,
        "n_subcarriers": n_sub,
        "sample_rate_hz": sample_rate_hz,
        "antenna_config": antenna_config,
        "antennas": antennas,
    }

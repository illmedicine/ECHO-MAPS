"""CSI packet parser for ESP32-S3 and WiFi 6 NIC raw frames.

Parses raw CSI byte streams from the Illy Bridge into structured
amplitude/phase matrices suitable for the AI engine.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

import numpy as np


class CSISource(IntEnum):
    ESP32_S3 = 1
    WIFI6_NIC = 2


@dataclass(frozen=True, slots=True)
class CSIFrame:
    """A single parsed CSI measurement frame."""

    timestamp_us: int
    rssi: int
    source: CSISource
    n_subcarriers: int
    amplitude: np.ndarray  # (n_subcarriers,)
    phase: np.ndarray      # (n_subcarriers,)
    mac_src: str
    mac_dst: str


def parse_esp32_csi(raw: bytes, mac_src: str = "", mac_dst: str = "") -> CSIFrame:
    """Parse a raw CSI packet from ESP32-S3 firmware.

    ESP32 CSI format: [timestamp(8B)][rssi(1B)][n_sub(1B)][csi_data(n_sub*2 int8 pairs)]
    Each subcarrier is encoded as (imaginary, real) int8 pair.
    """
    if len(raw) < 10:
        raise ValueError(f"CSI packet too short: {len(raw)} bytes")

    timestamp_us = int.from_bytes(raw[0:8], "little", signed=False)
    rssi = int.from_bytes(raw[8:9], "little", signed=True)
    n_sub = raw[9]

    expected_len = 10 + n_sub * 2
    if len(raw) < expected_len:
        raise ValueError(f"Expected {expected_len} bytes, got {len(raw)}")

    csi_bytes = np.frombuffer(raw[10:expected_len], dtype=np.int8)
    # Reshape into (n_sub, 2) => columns are (imaginary, real)
    csi_pairs = csi_bytes.reshape(n_sub, 2).astype(np.float32)
    imag = csi_pairs[:, 0]
    real = csi_pairs[:, 1]

    amplitude = np.sqrt(real**2 + imag**2)
    phase = np.arctan2(imag, real)

    return CSIFrame(
        timestamp_us=timestamp_us,
        rssi=rssi,
        source=CSISource.ESP32_S3,
        n_subcarriers=n_sub,
        amplitude=amplitude,
        phase=phase,
        mac_src=mac_src,
        mac_dst=mac_dst,
    )


def parse_wifi6_csi(raw: bytes, mac_src: str = "", mac_dst: str = "") -> CSIFrame:
    """Parse CSI from a WiFi 6 NIC (802.11ax) — 242 OFDMA subcarriers.

    Format: [timestamp(8B)][rssi(2B)][n_sub(2B)][csi_data(n_sub*4 float16 pairs)]
    Each subcarrier as (real, imaginary) float16 pair.
    """
    if len(raw) < 12:
        raise ValueError(f"CSI packet too short: {len(raw)} bytes")

    timestamp_us = int.from_bytes(raw[0:8], "little", signed=False)
    rssi = int.from_bytes(raw[8:10], "little", signed=True)
    n_sub = int.from_bytes(raw[10:12], "little", signed=False)

    expected_len = 12 + n_sub * 4
    if len(raw) < expected_len:
        raise ValueError(f"Expected {expected_len} bytes, got {len(raw)}")

    csi_data = np.frombuffer(raw[12:expected_len], dtype=np.float16).astype(np.float32)
    csi_pairs = csi_data.reshape(n_sub, 2)
    real = csi_pairs[:, 0]
    imag = csi_pairs[:, 1]

    amplitude = np.sqrt(real**2 + imag**2)
    phase = np.arctan2(imag, real)

    return CSIFrame(
        timestamp_us=timestamp_us,
        rssi=rssi,
        source=CSISource.WIFI6_NIC,
        n_subcarriers=n_sub,
        amplitude=amplitude,
        phase=phase,
        mac_src=mac_src,
        mac_dst=mac_dst,
    )

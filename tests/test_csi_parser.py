"""Tests for CSI parser."""

import numpy as np
import pytest

from echo_maps.csi.parser import CSIFrame, CSISource, parse_esp32_csi, parse_wifi6_csi


def _make_esp32_packet(n_sub: int = 64, rssi: int = -50) -> bytes:
    timestamp = (1000000).to_bytes(8, "little")
    rssi_b = rssi.to_bytes(1, "little", signed=True)
    n_sub_b = n_sub.to_bytes(1, "little")
    # Generate random CSI data: (imaginary, real) int8 pairs
    rng = np.random.default_rng(42)
    csi = rng.integers(-128, 127, size=n_sub * 2, dtype=np.int8)
    return timestamp + rssi_b + n_sub_b + csi.tobytes()


def test_parse_esp32_basic():
    raw = _make_esp32_packet(n_sub=64)
    frame = parse_esp32_csi(raw)
    assert isinstance(frame, CSIFrame)
    assert frame.source == CSISource.ESP32_S3
    assert frame.n_subcarriers == 64
    assert frame.amplitude.shape == (64,)
    assert frame.phase.shape == (64,)
    assert frame.rssi == -50


def test_parse_esp32_amplitude_positive():
    raw = _make_esp32_packet()
    frame = parse_esp32_csi(raw)
    assert np.all(frame.amplitude >= 0)


def test_parse_esp32_too_short():
    with pytest.raises(ValueError, match="too short"):
        parse_esp32_csi(b"\x00" * 5)


def test_parse_esp32_incomplete():
    raw = _make_esp32_packet(n_sub=64)
    with pytest.raises(ValueError, match="Expected"):
        parse_esp32_csi(raw[:20])


def _make_wifi6_packet(n_sub: int = 242) -> bytes:
    timestamp = (2000000).to_bytes(8, "little")
    rssi = (-40).to_bytes(2, "little", signed=True)
    n_sub_b = n_sub.to_bytes(2, "little")
    rng = np.random.default_rng(99)
    csi = rng.standard_normal(n_sub * 2).astype(np.float16)
    return timestamp + rssi + n_sub_b + csi.tobytes()


def test_parse_wifi6_basic():
    raw = _make_wifi6_packet(242)
    frame = parse_wifi6_csi(raw)
    assert frame.source == CSISource.WIFI6_NIC
    assert frame.n_subcarriers == 242
    assert frame.amplitude.shape == (242,)

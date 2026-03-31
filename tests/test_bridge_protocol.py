"""Tests for the Bridge protocol — packet serialization and CSI parsing."""

import struct

import numpy as np
import pytest

from echo_maps.bridge.protocol import (
    BridgeCommand,
    BridgeEvent,
    BridgePacket,
    parse_csi_payload,
)


def test_packet_roundtrip():
    pkt = BridgePacket(
        version=1,
        event=BridgeEvent.STATUS_REPORT,
        sequence=42,
        payload=b"\x02",
    )
    data = pkt.serialize()
    parsed = BridgePacket.deserialize(data)
    assert parsed.version == 1
    assert parsed.event == BridgeEvent.STATUS_REPORT
    assert parsed.sequence == 42
    assert parsed.payload == b"\x02"


def test_packet_crc_validation():
    pkt = BridgePacket(version=1, event=BridgeEvent.CSI_FRAME, sequence=1, payload=b"test")
    data = bytearray(pkt.serialize())
    # Corrupt the CRC
    data[-1] ^= 0xFF
    with pytest.raises(ValueError, match="CRC mismatch"):
        BridgePacket.deserialize(bytes(data))


def test_packet_invalid_magic():
    data = b"\x00\x00\x01\x01\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00"
    with pytest.raises(ValueError, match="Invalid magic"):
        BridgePacket.deserialize(data)


def test_parse_csi_payload_2x2():
    n_sub = 64
    rng = np.random.default_rng(42)

    timestamp = struct.pack("<Q", 5000000)
    rssi = struct.pack("<b", -45)
    n_sub_b = bytes([n_sub])
    sample_rate = bytes([100])
    antenna_config = bytes([0x22])  # 2x2 MIMO

    # 2 antennas × n_sub × 2 (imag, real) int8
    csi_data = rng.integers(-128, 127, size=n_sub * 2 * 2, dtype=np.int8)

    payload = timestamp + rssi + n_sub_b + sample_rate + antenna_config + csi_data.tobytes()
    result = parse_csi_payload(payload)

    assert result["timestamp_us"] == 5000000
    assert result["rssi"] == -45
    assert result["n_subcarriers"] == 64
    assert result["sample_rate_hz"] == 100
    assert "ant0" in result["antennas"]
    assert "ant1" in result["antennas"]
    assert result["antennas"]["ant0"]["amplitude"].shape == (64,)

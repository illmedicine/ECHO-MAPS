"""Tests for CSI signal filters."""

import numpy as np

from echo_maps.csi.filters import (
    butterworth_bandpass,
    classify_motion_energy,
    extract_breathing_band,
    hampel_filter,
    phase_sanitization,
)


def test_bandpass_shape_preserved():
    data = np.random.randn(64, 500).astype(np.float32)
    filtered = butterworth_bandpass(data, 0.1, 0.5, sample_rate=100.0)
    assert filtered.shape == data.shape


def test_breathing_band_extraction():
    data = np.random.randn(64, 1000).astype(np.float32)
    breathing = extract_breathing_band(data, sample_rate=100.0)
    assert breathing.shape == data.shape


def test_hampel_filter_removes_outliers():
    data = np.ones((1, 100), dtype=np.float32)
    data[0, 50] = 100.0  # Spike
    filtered = hampel_filter(data, window_size=5, n_sigma=3.0)
    assert abs(filtered[0, 50] - 100.0) > 0  # spike should be dampened


def test_phase_sanitization_shape():
    phase = np.random.randn(64, 100).astype(np.float32)
    sanitized = phase_sanitization(phase)
    assert sanitized.shape == phase.shape


def test_classify_motion_energy():
    # High variance = human
    human_data = np.random.randn(64, 100).astype(np.float32) * 2.0
    assert classify_motion_energy(human_data) == "human"

    # Near-zero = empty
    empty_data = np.ones((64, 100), dtype=np.float32) * 0.001
    assert classify_motion_energy(empty_data) == "empty"

"""CSI signal filtering and noise reduction.

Handles pet-vs-human discrimination, multipath interference cleaning,
and bandpass filtering for vital sign extraction.
"""

from __future__ import annotations

import numpy as np
from scipy import signal as sp_signal


def butterworth_bandpass(
    data: np.ndarray,
    low_hz: float,
    high_hz: float,
    sample_rate: float = 100.0,
    order: int = 4,
) -> np.ndarray:
    """Apply a Butterworth bandpass filter to CSI amplitude time-series.

    Args:
        data: (n_subcarriers, n_timesteps) amplitude matrix
        low_hz: lower cutoff frequency
        high_hz: upper cutoff frequency
        sample_rate: CSI sampling rate in Hz
        order: filter order
    """
    nyquist = sample_rate / 2.0
    low = low_hz / nyquist
    high = high_hz / nyquist
    b, a = sp_signal.butter(order, [low, high], btype="band")
    return sp_signal.filtfilt(b, a, data, axis=-1).astype(np.float32)


def extract_breathing_band(
    amplitude_matrix: np.ndarray,
    sample_rate: float = 100.0,
) -> np.ndarray:
    """Extract breathing-frequency components (0.1–0.5 Hz = 6–30 BPM)."""
    return butterworth_bandpass(amplitude_matrix, 0.1, 0.5, sample_rate)


def extract_heartrate_band(
    amplitude_matrix: np.ndarray,
    sample_rate: float = 100.0,
) -> np.ndarray:
    """Extract heart-rate-frequency components (0.8–2.0 Hz = 48–120 BPM)."""
    return butterworth_bandpass(amplitude_matrix, 0.8, 2.0, sample_rate)


def hampel_filter(
    data: np.ndarray,
    window_size: int = 5,
    n_sigma: float = 3.0,
) -> np.ndarray:
    """Hampel filter for outlier removal on per-subcarrier CSI time-series.

    Replaces outliers (> n_sigma MADs from rolling median) with the median.
    """
    filtered = data.copy()
    half_w = window_size // 2

    for i in range(half_w, data.shape[-1] - half_w):
        window = data[..., i - half_w : i + half_w + 1]
        median = np.median(window, axis=-1, keepdims=True)
        mad = np.median(np.abs(window - median), axis=-1, keepdims=True)
        mad = np.maximum(mad, 1e-6)  # avoid division by zero
        threshold = n_sigma * 1.4826 * mad
        outlier_mask = np.abs(data[..., i : i + 1] - median) > threshold
        filtered[..., i : i + 1] = np.where(outlier_mask, median, filtered[..., i : i + 1])

    return filtered


def phase_sanitization(phase: np.ndarray) -> np.ndarray:
    """Remove linear phase offset and random phase noise from CSI phase data.

    Applies linear regression across subcarriers to subtract the
    carrier-frequency-offset-induced slope.
    """
    n_sub = phase.shape[0]
    subcarrier_idx = np.arange(n_sub, dtype=np.float32)

    sanitized = np.empty_like(phase)
    for t in range(phase.shape[1]):
        col = phase[:, t]
        # Linear fit: phase = a * subcarrier_idx + b
        coeffs = np.polyfit(subcarrier_idx, col, 1)
        linear_component = np.polyval(coeffs, subcarrier_idx)
        sanitized[:, t] = col - linear_component

    return sanitized


def classify_motion_energy(
    amplitude_matrix: np.ndarray,
    human_threshold: float = 0.15,
    pet_max_energy: float = 0.08,
) -> str:
    """Basic heuristic classifier for motion type based on CSI variance.

    Returns: "human", "pet", or "empty"
    """
    variance = np.var(amplitude_matrix, axis=-1).mean()
    if variance > human_threshold:
        return "human"
    elif variance > pet_max_energy:
        return "pet"
    return "empty"

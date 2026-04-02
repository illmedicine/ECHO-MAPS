"""RF Signature extraction — gait periodicity, breathing baseline, vector embedding.

Phase 2: Anchor Extraction.  Before the camera turns off, the system extracts
unique trackable "anchors" from the RF data and compresses them into a secure
mathematical vector (the user's RF Signature).
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field
from scipy import signal as sp_signal


@dataclass(frozen=True, slots=True)
class RFSignature:
    """Compact RF identity vector for a tracked person."""

    user_tag: str
    gait_embedding: np.ndarray       # (64,) gait periodicity features
    breathing_embedding: np.ndarray   # (32,) static micro-vibration features
    mass_reflection: np.ndarray       # (16,) body-mass RF reflection profile
    combined_vector: np.ndarray       # (512,) full RF signature vector

    def cosine_similarity(self, other: RFSignature) -> float:
        a = self.combined_vector / (np.linalg.norm(self.combined_vector) + 1e-8)
        b = other.combined_vector / (np.linalg.norm(other.combined_vector) + 1e-8)
        return float(np.dot(a, b))


class GaitExtractor:
    """Extract gait periodicity features from micro-Doppler shifts in CSI.

    As a person walks, periodic limb movements create micro-Doppler shifts
    in the CSI subcarriers.  This module extracts the stride rhythm, speed,
    and spectral profile and encodes them into a 64-dim embedding.
    """

    def __init__(self, sample_rate_hz: float = 100.0, window_sec: float = 5.0) -> None:
        self.sample_rate = sample_rate_hz
        self.window_samples = int(sample_rate_hz * window_sec)

    def extract(self, csi_amplitude_seq: np.ndarray) -> np.ndarray:
        """Extract gait features from a CSI amplitude time-series.

        Args:
            csi_amplitude_seq: (n_subcarriers, n_timesteps) amplitude matrix

        Returns:
            (64,) gait embedding vector
        """
        n_sub, n_t = csi_amplitude_seq.shape

        # Compute variance across subcarriers to find motion-sensitive ones
        variance = np.var(csi_amplitude_seq, axis=1)
        top_k = min(20, n_sub)
        active_subs = np.argsort(variance)[-top_k:]

        # Average the most motion-sensitive subcarriers
        motion_signal = csi_amplitude_seq[active_subs].mean(axis=0)

        # Apply bandpass filter for walking frequencies (0.5–3 Hz = typical gait)
        nyquist = self.sample_rate / 2.0
        low = 0.5 / nyquist
        high = min(3.0 / nyquist, 0.99)
        b, a = sp_signal.butter(4, [low, high], btype="band")
        gait_signal = sp_signal.filtfilt(b, a, motion_signal)

        # Extract spectral features via FFT
        fft_vals = np.abs(np.fft.rfft(gait_signal))
        fft_freqs = np.fft.rfftfreq(len(gait_signal), 1.0 / self.sample_rate)

        # Stride frequency (dominant frequency in 0.5–3 Hz band)
        gait_mask = (fft_freqs >= 0.5) & (fft_freqs <= 3.0)
        gait_spectrum = fft_vals.copy()
        gait_spectrum[~gait_mask] = 0

        # Autocorrelation to find stride period
        autocorr = np.correlate(gait_signal, gait_signal, mode="full")
        autocorr = autocorr[len(autocorr) // 2 :]
        autocorr = autocorr / (autocorr[0] + 1e-8)

        # Build embedding: spectral bins + autocorrelation peaks + stats
        n_spectral = 32
        spectral_bins = np.zeros(n_spectral, dtype=np.float32)
        bin_edges = np.linspace(0.5, 3.0, n_spectral + 1)
        for i in range(n_spectral):
            mask = (fft_freqs >= bin_edges[i]) & (fft_freqs < bin_edges[i + 1])
            spectral_bins[i] = fft_vals[mask].sum() if mask.any() else 0.0

        # Autocorrelation features (first 24 lags, downsampled)
        lag_indices = np.linspace(10, min(len(autocorr) - 1, 300), 24).astype(int)
        autocorr_features = autocorr[lag_indices].astype(np.float32)

        # Statistical features
        stats = np.array([
            np.std(gait_signal),
            float(fft_freqs[gait_mask][np.argmax(gait_spectrum[gait_mask])] if gait_mask.any() else 0),
            np.max(gait_spectrum[gait_mask]) if gait_mask.any() else 0,
            np.mean(np.abs(gait_signal)),
            np.max(np.abs(gait_signal)),
            float(np.argmax(autocorr[10:]) + 10) / self.sample_rate,
            np.var(gait_signal),
            np.median(np.abs(gait_signal)),
        ], dtype=np.float32)

        embedding = np.concatenate([spectral_bins, autocorr_features, stats])
        assert embedding.shape == (64,), f"Expected 64-dim, got {embedding.shape}"
        return embedding


class BreathingExtractor:
    """Extract baseline breathing micro-vibration features from CSI.

    When a person is stationary, chest-wall micro-movements modulate
    the CSI subcarriers at breathing frequency (0.1–0.5 Hz).
    """

    def __init__(self, sample_rate_hz: float = 100.0) -> None:
        self.sample_rate = sample_rate_hz

    def extract(self, csi_amplitude_seq: np.ndarray) -> np.ndarray:
        """Extract breathing profile from stationary CSI data.

        Args:
            csi_amplitude_seq: (n_subcarriers, n_timesteps) amplitude matrix

        Returns:
            (32,) breathing embedding vector
        """
        n_sub, n_t = csi_amplitude_seq.shape

        # Bandpass for breathing (0.1–0.5 Hz = 6–30 BPM)
        nyquist = self.sample_rate / 2.0
        low = 0.1 / nyquist
        high = min(0.5 / nyquist, 0.99)
        b, a = sp_signal.butter(4, [low, high], btype="band")

        # Find subcarriers most sensitive to breathing
        breathing_energy = np.zeros(n_sub)
        for i in range(n_sub):
            filtered = sp_signal.filtfilt(b, a, csi_amplitude_seq[i])
            breathing_energy[i] = np.var(filtered)

        top_k = min(10, n_sub)
        sensitive_subs = np.argsort(breathing_energy)[-top_k:]
        breathing_signal = csi_amplitude_seq[sensitive_subs].mean(axis=0)
        breathing_signal = sp_signal.filtfilt(b, a, breathing_signal)

        # Spectral features
        fft_vals = np.abs(np.fft.rfft(breathing_signal))
        fft_freqs = np.fft.rfftfreq(len(breathing_signal), 1.0 / self.sample_rate)

        breath_mask = (fft_freqs >= 0.1) & (fft_freqs <= 0.5)

        # 16 spectral bins across breathing band
        n_bins = 16
        spectral_bins = np.zeros(n_bins, dtype=np.float32)
        bin_edges = np.linspace(0.1, 0.5, n_bins + 1)
        for i in range(n_bins):
            mask = (fft_freqs >= bin_edges[i]) & (fft_freqs < bin_edges[i + 1])
            spectral_bins[i] = fft_vals[mask].sum() if mask.any() else 0.0

        # Waveform shape features
        # Peak-to-peak interval consistency
        peaks, _ = sp_signal.find_peaks(breathing_signal, distance=int(self.sample_rate * 1.5))
        if len(peaks) >= 2:
            intervals = np.diff(peaks) / self.sample_rate
            interval_stats = np.array([
                np.mean(intervals),
                np.std(intervals),
                np.median(intervals),
                np.min(intervals),
            ], dtype=np.float32)
        else:
            interval_stats = np.zeros(4, dtype=np.float32)

        # Amplitude statistics
        amp_stats = np.array([
            np.std(breathing_signal),
            np.max(breathing_signal) - np.min(breathing_signal),
            np.mean(np.abs(breathing_signal)),
            float(fft_freqs[breath_mask][np.argmax(fft_vals[breath_mask])] if breath_mask.any() else 0),
        ], dtype=np.float32)

        # Subcarrier sensitivity profile
        sensitivity = breathing_energy[sensitive_subs].astype(np.float32)
        sensitivity = sensitivity / (sensitivity.max() + 1e-8)
        if len(sensitivity) < 8:
            sensitivity = np.pad(sensitivity, (0, 8 - len(sensitivity)))
        else:
            sensitivity = sensitivity[:8]

        embedding = np.concatenate([spectral_bins, interval_stats, amp_stats, sensitivity])
        assert embedding.shape == (32,), f"Expected 32-dim, got {embedding.shape}"
        return embedding


class MassReflectionExtractor:
    """Extract body-mass RF reflection profile from CSI amplitudes.

    Different body sizes create distinct amplitude attenuation patterns
    across the subcarrier spectrum.
    """

    def __init__(self, n_subcarriers: int = 242) -> None:
        self.n_subcarriers = n_subcarriers

    def extract(self, csi_amplitude_seq: np.ndarray) -> np.ndarray:
        """Extract mass-reflection features.

        Args:
            csi_amplitude_seq: (n_subcarriers, n_timesteps) amplitude matrix

        Returns:
            (16,) mass-reflection embedding
        """
        # Average amplitude profile across time
        mean_amp = csi_amplitude_seq.mean(axis=1)
        std_amp = csi_amplitude_seq.std(axis=1)

        # Bin the subcarrier spectrum into 8 bands
        n_bins = 8
        amp_bins = np.zeros(n_bins, dtype=np.float32)
        std_bins = np.zeros(n_bins, dtype=np.float32)
        bin_size = len(mean_amp) // n_bins
        for i in range(n_bins):
            start = i * bin_size
            end = start + bin_size if i < n_bins - 1 else len(mean_amp)
            amp_bins[i] = mean_amp[start:end].mean()
            std_bins[i] = std_amp[start:end].mean()

        embedding = np.concatenate([amp_bins, std_bins])
        assert embedding.shape == (16,), f"Expected 16-dim, got {embedding.shape}"
        return embedding


class RFSignatureBuilder:
    """Combines gait, breathing, and mass-reflection features into a full RF Signature.

    The combined 512-dim vector is built by:
      1. Extracting 64-dim gait periodicity embedding
      2. Extracting 32-dim breathing micro-vibration embedding
      3. Extracting 16-dim mass-reflection profile
      4. Projecting the concatenated 112-dim raw features through a
         learned projection to 512-dim using a simple linear transform
    """

    def __init__(self, sample_rate_hz: float = 100.0, n_subcarriers: int = 242) -> None:
        self.gait_extractor = GaitExtractor(sample_rate_hz)
        self.breathing_extractor = BreathingExtractor(sample_rate_hz)
        self.mass_extractor = MassReflectionExtractor(n_subcarriers)

        # Random orthogonal projection matrix (frozen after init)
        rng = np.random.default_rng(42)
        raw = rng.standard_normal((112, 512)).astype(np.float32)
        q, _ = np.linalg.qr(raw.T)
        self._projection = q.T  # (512, 112) → project 112→512

    def build(
        self,
        user_tag: str,
        walking_csi: np.ndarray,
        stationary_csi: np.ndarray,
    ) -> RFSignature:
        """Build a complete RF Signature for a tracked person.

        Args:
            user_tag: temporary tracking ID (e.g. "User_A")
            walking_csi: (n_subcarriers, n_timesteps) CSI from walking segment
            stationary_csi: (n_subcarriers, n_timesteps) CSI from stationary segment

        Returns:
            RFSignature with all anchors embedded
        """
        gait = self.gait_extractor.extract(walking_csi)
        breathing = self.breathing_extractor.extract(stationary_csi)
        mass = self.mass_extractor.extract(
            np.concatenate([walking_csi, stationary_csi], axis=1)
        )

        # Concatenate raw features
        raw_features = np.concatenate([gait, breathing, mass])  # (112,)

        # Project to 512-dim
        combined = self._projection @ raw_features  # (512,)
        # L2 normalize
        combined = combined / (np.linalg.norm(combined) + 1e-8)

        return RFSignature(
            user_tag=user_tag,
            gait_embedding=gait,
            breathing_embedding=breathing,
            mass_reflection=mass,
            combined_vector=combined.astype(np.float32),
        )

"""CSI-to-Pointcloud converter.

Transforms temporal CSI amplitude/phase data into 3D point clouds,
using the Angle-of-Arrival (AoA) from the 2x2 MIMO antenna array
and signal propagation models.
"""

from __future__ import annotations

import numpy as np


class CSI2PointCloud:
    """Convert CSI frames into a 3D point cloud representation.

    Uses the phase difference between MIMO antenna pairs to compute
    Angle of Arrival (AoA), combined with time-of-flight estimates
    from subcarrier phase slopes, to triangulate scatterer positions.

    When a router_position is provided, all point coordinates are
    relative to the router's known location and orientation, enabling
    accurate absolute positioning on the floor plan.
    """

    # Speed of light in m/s
    C = 3e8
    # WiFi 6 subcarrier spacing in Hz
    SUBCARRIER_SPACING_HZ = 78125.0
    # Antenna spacing in meters (for ESP32-S3 2x2 MIMO)
    ANTENNA_SPACING_M = 0.025

    def __init__(
        self,
        carrier_freq_hz: float = 5.8e9,
        n_subcarriers: int = 242,
        room_bounds: tuple[float, float, float] = (10.0, 10.0, 3.5),
        router_position: tuple[float, float, float] | None = None,
        router_orientation_deg: float = 0.0,
    ) -> None:
        self.carrier_freq_hz = carrier_freq_hz
        self.wavelength = self.C / carrier_freq_hz
        self.n_subcarriers = n_subcarriers
        self.room_bounds = room_bounds
        # Router anchor: (x, y, z) absolute position in metres
        self.router_position = router_position or (0.0, 0.0, 0.0)
        # Compass bearing the router faces (0=North, 90=East)
        self.router_orientation_rad = np.radians(router_orientation_deg)

    def estimate_aoa(
        self,
        phase_ant0: np.ndarray,
        phase_ant1: np.ndarray,
    ) -> np.ndarray:
        """Estimate Angle of Arrival from phase difference between 2 antennas.

        Args:
            phase_ant0: (n_subcarriers,) phase from antenna 0
            phase_ant1: (n_subcarriers,) phase from antenna 1

        Returns:
            (n_subcarriers,) estimated angles in radians
        """
        phase_diff = phase_ant1 - phase_ant0
        # Unwrap phase difference
        phase_diff = np.arctan2(np.sin(phase_diff), np.cos(phase_diff))
        # AoA = arcsin(phase_diff * wavelength / (2 * pi * d))
        arg = phase_diff * self.wavelength / (2.0 * np.pi * self.ANTENNA_SPACING_M)
        arg = np.clip(arg, -1.0, 1.0)
        return np.arcsin(arg)

    def estimate_tof(self, phase: np.ndarray) -> np.ndarray:
        """Estimate Time-of-Flight from subcarrier phase slope.

        Uses the gradient of phase across subcarriers to estimate
        propagation delay → distance.

        Args:
            phase: (n_subcarriers,) sanitized phase data

        Returns:
            (1,) estimated distance in meters
        """
        unwrapped = np.unwrap(phase)
        # Phase slope = d(phase)/d(subcarrier) → τ = slope / (2π × Δf)
        slope = np.polyfit(np.arange(len(unwrapped)), unwrapped, 1)[0]
        tau = slope / (2.0 * np.pi * self.SUBCARRIER_SPACING_HZ)
        distance = np.abs(tau) * self.C
        return np.array([distance], dtype=np.float32)

    def frames_to_pointcloud(
        self,
        amplitude_seq: np.ndarray,
        phase_ant0_seq: np.ndarray,
        phase_ant1_seq: np.ndarray,
        n_peaks: int = 32,
    ) -> np.ndarray:
        """Convert a sequence of CSI frames into a 3D point cloud.

        Args:
            amplitude_seq:  (n_frames, n_subcarriers) amplitude
            phase_ant0_seq: (n_frames, n_subcarriers) phase antenna 0
            phase_ant1_seq: (n_frames, n_subcarriers) phase antenna 1
            n_peaks: number of strongest subcarriers to use per frame

        Returns:
            (n_points, 3) point cloud — x, y, z in meters
        """
        points = []
        for t in range(amplitude_seq.shape[0]):
            amp = amplitude_seq[t]
            # Pick top-N strongest subcarriers (likely human reflections)
            peak_indices = np.argsort(amp)[-n_peaks:]

            for idx in peak_indices:
                aoa = self.estimate_aoa(
                    phase_ant0_seq[t, idx : idx + 1],
                    phase_ant1_seq[t, idx : idx + 1],
                )[0]
                dist = self.estimate_tof(phase_ant0_seq[t])[0]

                # Convert polar (distance, angle) to Cartesian
                # Apply router orientation: rotate AoA by the router's facing direction
                absolute_angle = aoa + self.router_orientation_rad
                x = self.router_position[0] + dist * np.sin(absolute_angle)
                y = self.router_position[1] - dist * np.cos(absolute_angle)
                # Z estimated from subcarrier index (elevation proxy)
                z = self.router_position[2] + (idx / self.n_subcarriers) * self.room_bounds[2]

                # Clip to room bounds
                x = np.clip(x, 0, self.room_bounds[0])
                y = np.clip(y, 0, self.room_bounds[1])
                z = np.clip(z, 0, self.room_bounds[2])

                points.append([x, y, z])

        if not points:
            return np.zeros((0, 3), dtype=np.float32)

        return np.array(points, dtype=np.float32)

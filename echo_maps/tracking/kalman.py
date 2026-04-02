"""Kalman filter for RF blob momentum tracking.

Phase 4: Continuous Trajectory Tracking.  Rather than re-identifying a person
every frame, the tracker predicts their next position from momentum, then
corrects with the observed RF blob centroid.
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TrackState:
    """State of a single tracked RF blob."""

    track_id: str
    user_tag: str                         # "User_A", "Guest_B", etc.
    position: np.ndarray                  # (3,) — x, y, z in meters
    velocity: np.ndarray                  # (3,) — vx, vy, vz in m/s
    confidence: float = 1.0               # tracking confidence [0, 1]
    is_registered: bool = False           # has an RF Signature
    is_ghosted: bool = False              # uncertainty ghost state
    frames_since_update: int = 0
    merged: bool = False                  # in collision/merge state

    @property
    def speed(self) -> float:
        return float(np.linalg.norm(self.velocity[:2]))


class KalmanTracker:
    """6-state Kalman filter for 3D position + velocity tracking of RF blobs.

    State vector: [x, y, z, vx, vy, vz]
    Measurement:  [x, y, z] (from CSI blob centroid)
    """

    def __init__(
        self,
        process_noise: float = 0.05,
        measurement_noise: float = 0.3,
        dt: float = 0.01,  # 100 Hz CSI sample rate
    ) -> None:
        self.dt = dt

        # State transition matrix (constant velocity model)
        self.F = np.eye(6, dtype=np.float32)
        self.F[0, 3] = dt
        self.F[1, 4] = dt
        self.F[2, 5] = dt

        # Measurement matrix (observe position only)
        self.H = np.zeros((3, 6), dtype=np.float32)
        self.H[0, 0] = 1.0
        self.H[1, 1] = 1.0
        self.H[2, 2] = 1.0

        # Process noise
        q = process_noise
        self.Q = np.diag([q, q, q, q * 2, q * 2, q * 2]).astype(np.float32)

        # Measurement noise
        r = measurement_noise
        self.R = np.diag([r, r, r]).astype(np.float32)

        # Per-track state
        self._states: dict[str, np.ndarray] = {}      # track_id → [x,y,z,vx,vy,vz]
        self._covariances: dict[str, np.ndarray] = {}  # track_id → P (6×6)

    def init_track(self, track_id: str, position: np.ndarray) -> None:
        """Initialize a new track with observed position and zero velocity."""
        self._states[track_id] = np.array(
            [position[0], position[1], position[2], 0.0, 0.0, 0.0],
            dtype=np.float32,
        )
        self._covariances[track_id] = np.eye(6, dtype=np.float32) * 1.0

    def predict(self, track_id: str) -> np.ndarray:
        """Predict next state (position + velocity) for a track.

        Returns predicted position (3,).
        """
        if track_id not in self._states:
            raise KeyError(f"Track {track_id} not initialized")

        x = self._states[track_id]
        P = self._covariances[track_id]

        # Predict
        x_pred = self.F @ x
        P_pred = self.F @ P @ self.F.T + self.Q

        self._states[track_id] = x_pred
        self._covariances[track_id] = P_pred

        return x_pred[:3].copy()

    def update(self, track_id: str, measurement: np.ndarray) -> np.ndarray:
        """Update track state with an observed RF blob centroid.

        Args:
            measurement: (3,) observed position

        Returns:
            Corrected position (3,).
        """
        if track_id not in self._states:
            raise KeyError(f"Track {track_id} not initialized")

        x = self._states[track_id]
        P = self._covariances[track_id]

        # Innovation
        y = measurement - self.H @ x
        S = self.H @ P @ self.H.T + self.R

        # Kalman gain
        K = P @ self.H.T @ np.linalg.inv(S)

        # Update
        x_new = x + K @ y
        P_new = (np.eye(6) - K @ self.H) @ P

        self._states[track_id] = x_new.astype(np.float32)
        self._covariances[track_id] = P_new.astype(np.float32)

        return x_new[:3].copy()

    def get_state(self, track_id: str) -> Optional[tuple[np.ndarray, np.ndarray]]:
        """Get current (position, velocity) for a track."""
        if track_id not in self._states:
            return None
        x = self._states[track_id]
        return x[:3].copy(), x[3:].copy()

    def get_innovation_distance(self, track_id: str, measurement: np.ndarray) -> float:
        """Mahalanobis distance between prediction and measurement.

        Used to decide whether an observed blob belongs to this track.
        """
        if track_id not in self._states:
            return float("inf")

        x = self._states[track_id]
        P = self._covariances[track_id]

        y = measurement - self.H @ x
        S = self.H @ P @ self.H.T + self.R
        d = float(y @ np.linalg.inv(S) @ y)
        return d

    def remove_track(self, track_id: str) -> None:
        self._states.pop(track_id, None)
        self._covariances.pop(track_id, None)

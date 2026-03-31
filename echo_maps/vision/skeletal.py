"""Skeletal keypoint extraction using MediaPipe Pose.

During the calibration "2D3D Map Trace" phase (webcam ON), this module
extracts 33 3D skeletal keypoints from each video frame, which become
the ground-truth labels for CroSSL and GAN training.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import mediapipe as mp
import numpy as np


@dataclass(frozen=True, slots=True)
class PoseResult:
    """Result of a single-frame pose extraction."""

    timestamp_ms: int
    keypoints_3d: np.ndarray   # (33, 3) — x, y, z in normalized coords
    keypoints_2d: np.ndarray   # (33, 2) — pixel coords for visualization
    visibility: np.ndarray     # (33,) — per-joint confidence [0, 1]
    detected: bool


class SkeletalExtractor:
    """MediaPipe-based 3D pose estimator for calibration video frames.

    Wraps MediaPipe Pose to provide a clean API for extracting
    33-point 3D skeletal coordinates from webcam or IP camera frames.
    """

    N_KEYPOINTS = 33

    def __init__(
        self,
        model_complexity: int = 2,
        min_detection_confidence: float = 0.7,
        min_tracking_confidence: float = 0.5,
        static_image_mode: bool = False,
    ) -> None:
        self._mp_pose = mp.solutions.pose
        self._pose = self._mp_pose.Pose(
            model_complexity=model_complexity,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
            static_image_mode=static_image_mode,
        )

    def extract(self, frame: np.ndarray, timestamp_ms: int = 0) -> PoseResult:
        """Extract 3D pose from a BGR video frame.

        Args:
            frame: (H, W, 3) BGR uint8 image
            timestamp_ms: frame timestamp in milliseconds

        Returns:
            PoseResult with 33 keypoints or empty result if no person detected
        """
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self._pose.process(rgb)

        if results.pose_world_landmarks is None:
            return PoseResult(
                timestamp_ms=timestamp_ms,
                keypoints_3d=np.zeros((self.N_KEYPOINTS, 3), dtype=np.float32),
                keypoints_2d=np.zeros((self.N_KEYPOINTS, 2), dtype=np.float32),
                visibility=np.zeros(self.N_KEYPOINTS, dtype=np.float32),
                detected=False,
            )

        h, w = frame.shape[:2]

        kp3d = np.array(
            [[lm.x, lm.y, lm.z] for lm in results.pose_world_landmarks.landmark],
            dtype=np.float32,
        )
        kp2d = np.array(
            [[lm.x * w, lm.y * h] for lm in results.pose_landmarks.landmark],
            dtype=np.float32,
        )
        vis = np.array(
            [lm.visibility for lm in results.pose_landmarks.landmark],
            dtype=np.float32,
        )

        return PoseResult(
            timestamp_ms=timestamp_ms,
            keypoints_3d=kp3d,
            keypoints_2d=kp2d,
            visibility=vis,
            detected=True,
        )

    def close(self) -> None:
        self._pose.close()

    def __enter__(self) -> SkeletalExtractor:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

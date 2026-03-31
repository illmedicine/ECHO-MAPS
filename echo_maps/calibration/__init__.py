"""Calibration workflow engine.

Orchestrates the 5-step calibration process:
  1. Setup     — provision environment
  2. Trace     — paired vision+CSI capture
  3. Training  — GAN adversarial training
  4. Confidence — monitor pose-match accuracy
  5. Live Mode — CSI-only inference
"""

from __future__ import annotations

import asyncio
import time
from typing import AsyncIterator

import numpy as np
import structlog

# Re-export lightweight types (no torch dependency)
from echo_maps.calibration.types import CalibrationStage, CalibrationState  # noqa: F401

logger = structlog.get_logger()


class CalibrationEngine:
    """Orchestrates the full calibration pipeline for an environment.

    Manages the lifecycle from initial setup through GAN training
    to confidence threshold attainment and transition to live mode.
    """

    def __init__(
        self,
        latent_dim: int = 512,
        n_subcarriers: int = 242,
        confidence_threshold: float = 0.95,
        device: str = "cpu",
    ) -> None:
        import torch

        from echo_maps.ai.calibration_gan import CalibrationGAN
        from echo_maps.ai.cross_modal import CroSSLFramework, PoseRegressor
        from echo_maps.ai.latent_csi import LatentCSI

        self.device = device
        self.confidence_threshold = confidence_threshold

        # AI models
        self.latent_csi = LatentCSI(
            n_subcarriers=n_subcarriers,
            latent_dim=latent_dim,
        ).to(device)

        self.crossl = CroSSLFramework(
            csi_dim=latent_dim,
            latent_dim=latent_dim,
        ).to(device)

        self.gan = CalibrationGAN(
            latent_dim=latent_dim,
            device=device,
        )

        self.pose_regressor = PoseRegressor(csi_dim=latent_dim).to(device)

        # Optimizers
        self.opt_csi = torch.optim.AdamW(self.latent_csi.parameters(), lr=1e-4)
        self.opt_crossl = torch.optim.AdamW(self.crossl.parameters(), lr=3e-4)
        self.opt_pose = torch.optim.AdamW(self.pose_regressor.parameters(), lr=1e-4)

        # Session tracking
        self._sessions: dict[str, CalibrationState] = {}

    def create_session(self, environment_id: str, user_id: str) -> CalibrationState:
        """Step 1: Setup — create a new calibration session."""
        state = CalibrationState(
            environment_id=environment_id,
            user_id=user_id,
            confidence_threshold=self.confidence_threshold,
        )
        self._sessions[environment_id] = state
        logger.info(
            "calibration_session_created",
            environment_id=environment_id,
            user_id=user_id,
        )
        return state

    def get_session(self, environment_id: str) -> CalibrationState | None:
        return self._sessions.get(environment_id)

    async def process_paired_frame(
        self,
        environment_id: str,
        csi_amplitude: np.ndarray,
        csi_phase: np.ndarray,
        skeletal_keypoints: np.ndarray,
    ) -> CalibrationState:
        """Step 2: Trace — process a paired vision+CSI frame.

        Args:
            csi_amplitude: (n_subcarriers,) amplitude vector
            csi_phase: (n_subcarriers,) phase vector
            skeletal_keypoints: (33, 3) 3D keypoints from MediaPipe
        """
        state = self._sessions.get(environment_id)
        if state is None:
            raise ValueError(f"No session for environment {environment_id}")

        state.stage = CalibrationStage.TRACE
        state.csi_frames_collected += 1
        state.vision_frames_collected += 1

        import torch

        # Stack amplitude + phase into 2-channel input
        csi_input = np.stack([csi_amplitude, csi_phase], axis=0)  # (2, n_sub)
        # Add batch and time dims: (1, 2, n_sub, 1)
        csi_tensor = torch.tensor(csi_input, dtype=torch.float32).unsqueeze(0).unsqueeze(-1)
        csi_tensor = csi_tensor.to(self.device)

        skel_tensor = torch.tensor(skeletal_keypoints, dtype=torch.float32).unsqueeze(0)
        skel_tensor = skel_tensor.to(self.device)

        # Encode CSI
        csi_latent = self.latent_csi.encode(csi_tensor)

        # CroSSL alignment step
        crossl_out = self.crossl(csi_latent, skel_tensor)

        # Backprop CroSSL loss
        self.opt_crossl.zero_grad()
        crossl_out["loss"].backward()
        self.opt_crossl.step()

        return state

    async def run_training(
        self,
        environment_id: str,
        csi_batch: torch.Tensor,
        pose_batch: torch.Tensor,
    ) -> AsyncIterator[CalibrationState]:
        """Step 3+4: Training + Confidence — run GAN training loop.

        Yields state updates as training progresses. Automatically
        transitions to LIVE stage when confidence threshold is met.

        Args:
            csi_batch: (N, 2, n_sub, T) batch of CSI spectrograms
            pose_batch: (N, 33, 3) batch of ground-truth poses
        """
        state = self._sessions.get(environment_id)
        if state is None:
            raise ValueError(f"No session for environment {environment_id}")

        import torch

        state.stage = CalibrationStage.TRAINING

        for epoch in range(state.max_epochs):
            state.training_epoch = epoch + 1

            # Encode CSI to latent
            with torch.no_grad():
                csi_latent = self.latent_csi.encode(csi_batch.to(self.device))

            # GAN training step
            metrics = self.gan.train_step(csi_latent, pose_batch.to(self.device))
            state.pose_match_accuracy = metrics["pose_match_accuracy"]

            logger.info(
                "calibration_training_step",
                environment_id=environment_id,
                epoch=epoch + 1,
                accuracy=state.pose_match_accuracy,
                d_loss=metrics["d_loss"],
                g_loss=metrics["g_loss"],
            )

            # Check confidence threshold
            if state.pose_match_accuracy >= self.confidence_threshold:
                state.stage = CalibrationStage.CONFIDENCE
                state.completed_at = time.time()
                logger.info(
                    "calibration_confidence_reached",
                    environment_id=environment_id,
                    accuracy=state.pose_match_accuracy,
                    epochs=epoch + 1,
                )
                yield state
                # Transition to live mode
                state.stage = CalibrationStage.LIVE
                yield state
                return

            yield state
            await asyncio.sleep(0)  # yield control

        # Max epochs reached without confidence
        state.stage = CalibrationStage.FAILED
        state.error = f"Max epochs ({state.max_epochs}) reached. Accuracy: {state.pose_match_accuracy:.2%}"
        yield state

    def infer_pose(self, csi_amplitude: np.ndarray, csi_phase: np.ndarray) -> np.ndarray:
        """Step 5: Live Mode — infer 3D pose from CSI alone (no camera).

        Args:
            csi_amplitude: (n_subcarriers,) amplitude
            csi_phase: (n_subcarriers,) phase

        Returns:
            (33, 3) predicted 3D skeletal keypoints
        """
        import torch

        csi_input = np.stack([csi_amplitude, csi_phase], axis=0)
        csi_tensor = torch.tensor(csi_input, dtype=torch.float32).unsqueeze(0).unsqueeze(-1)
        csi_tensor = csi_tensor.to(self.device)

        with torch.no_grad():
            latent = self.latent_csi.encode(csi_tensor)
            pose = self.pose_regressor(latent)

        return pose.squeeze(0).cpu().numpy()

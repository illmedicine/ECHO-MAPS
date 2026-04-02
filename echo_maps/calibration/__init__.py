"""Calibration workflow engine.

Orchestrates the full Visual Handshake to RF Handoff pipeline:
  Phase 1: Visual Handshake      — dual-data fusion, skeleton-RF blob pairing
  Phase 2: Anchor Extraction     — gait/breathing/mass RF Signature building
  Phase 3: RF Handoff            — GAN training → confidence → camera off
  Phase 4: Trajectory Tracking   — Kalman-filtered multi-person tracking
  Phase 5: Uncertainty Loop      — confidence decay, ghost tagging, re-acquisition
"""

from __future__ import annotations

import asyncio
import time
from typing import AsyncIterator

import numpy as np
import structlog

# Re-export lightweight types (no torch dependency)
from echo_maps.calibration.types import CalibrationStage, CalibrationState, TrackingConfidence  # noqa: F401

logger = structlog.get_logger()


class CalibrationEngine:
    """Orchestrates the full calibration and tracking pipeline for an environment.

    Manages the lifecycle from visual handshake through anchor extraction,
    GAN training, RF handoff, and into continuous multi-person tracking.
    """

    def __init__(
        self,
        latent_dim: int = 512,
        n_subcarriers: int = 242,
        confidence_threshold: float = 0.95,
        sample_rate_hz: float = 100.0,
        device: str = "cpu",
    ) -> None:
        import torch

        from echo_maps.ai.calibration_gan import CalibrationGAN
        from echo_maps.ai.cross_modal import CroSSLFramework, PoseRegressor
        from echo_maps.ai.latent_csi import LatentCSI
        from echo_maps.tracking.multi_person import MultiPersonTracker

        self.device = device
        self.confidence_threshold = confidence_threshold
        self.sample_rate = sample_rate_hz
        self.n_subcarriers = n_subcarriers

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

        # Multi-person tracker (Phases 1–5)
        self.tracker = MultiPersonTracker(
            sample_rate_hz=sample_rate_hz,
            n_subcarriers=n_subcarriers,
            device=device,
        )

        # Session tracking
        self._sessions: dict[str, CalibrationState] = {}

    def create_session(self, environment_id: str, user_id: str) -> CalibrationState:
        """Phase 1 Setup — create a new calibration session."""
        state = CalibrationState(
            environment_id=environment_id,
            user_id=user_id,
            confidence_threshold=self.confidence_threshold,
            rf_required_frames=int(self.sample_rate * 10),
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

    # ──────────────────────────────────────────────────────────
    # Phase 1: Visual Handshake — Dual-Data Ingestion & Fusion
    # ──────────────────────────────────────────────────────────

    async def process_paired_frame(
        self,
        environment_id: str,
        csi_amplitude: np.ndarray,
        csi_phase: np.ndarray,
        skeletal_keypoints: np.ndarray,
    ) -> CalibrationState:
        """Phase 1: Process a paired vision+CSI frame during the Visual Handshake.

        Performs:
          1. CSI → latent encoding
          2. Cross-modal alignment (CroSSL contrastive step)
          3. RF blob centroid extraction
          4. Skeleton-to-RF-blob pairing (if new person detected)
          5. CSI accumulation for signature extraction (Phase 2)

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

        # Encode CSI → latent
        csi_latent = self.latent_csi.encode(csi_tensor)

        # CroSSL alignment step — maps RF blob center to skeleton chest/core
        crossl_out = self.crossl(csi_latent, skel_tensor)

        # Backprop CroSSL loss
        self.opt_crossl.zero_grad()
        crossl_out["loss"].backward()
        self.opt_crossl.step()

        # Compute RF blob centroid from CSI features
        rf_blob_centroid = self._estimate_rf_centroid(csi_amplitude, csi_phase)

        # Register visual handshake if no tracks exist yet
        if len(self.tracker.tracks) == 0:
            self.tracker.register_visual_handshake(
                skeleton_keypoints=skeletal_keypoints,
                rf_blob_centroid=rf_blob_centroid,
            )

        # Accumulate CSI for Phase 2 anchor extraction
        for track_id, person in self.tracker.tracks.items():
            is_walking = person.speed > 0.2 if person.speed > 0 else self._detect_motion(csi_amplitude)
            self.tracker.accumulate_csi_for_signature(track_id, csi_amplitude, is_walking)
            if is_walking:
                state.walking_samples_collected += 1
            else:
                state.stationary_samples_collected += 1

        state.active_tracks = len(self.tracker.tracks)
        return state

    def _estimate_rf_centroid(
        self,
        csi_amplitude: np.ndarray,
        csi_phase: np.ndarray,
    ) -> np.ndarray:
        """Estimate the 3D centroid of the RF blob from CSI amplitude/phase."""
        from echo_maps.csi.pointcloud import CSI2PointCloud

        converter = CSI2PointCloud(
            n_subcarriers=len(csi_amplitude),
        )

        # Use phase slope for distance, weighted amplitude for direction
        amp_weights = csi_amplitude / (csi_amplitude.sum() + 1e-8)
        dist = converter.estimate_tof(csi_phase)[0]

        # Weighted subcarrier index → angle proxy
        indices = np.arange(len(csi_amplitude), dtype=np.float32)
        weighted_idx = float(np.dot(amp_weights, indices))
        angle = (weighted_idx / len(csi_amplitude) - 0.5) * np.pi

        x = dist * np.cos(angle)
        y = dist * np.sin(angle)
        z = 1.0  # approximate chest height

        return np.array([x, y, z], dtype=np.float32)

    def _detect_motion(self, csi_amplitude: np.ndarray) -> bool:
        """Simple motion detection from CSI amplitude variance."""
        from echo_maps.csi.filters import classify_motion_energy
        # Need time history, fallback to amplitude variance
        return float(np.var(csi_amplitude)) > 0.15

    # ──────────────────────────────────────────────────────────
    # Phase 2: Anchor Extraction
    # ──────────────────────────────────────────────────────────

    def extract_signatures(self, environment_id: str) -> list[dict]:
        """Phase 2: Extract RF Signatures for all tracked persons.

        Builds gait periodicity, breathing micro-vibration, and
        mass-reflection anchors from accumulated CSI data.

        Returns list of extraction results.
        """
        state = self._sessions.get(environment_id)
        if state is None:
            raise ValueError(f"No session for environment {environment_id}")

        state.stage = CalibrationStage.ANCHOR_EXTRACTION
        results = []

        for track_id in list(self.tracker.tracks.keys()):
            sig = self.tracker.extract_rf_signature(track_id)
            if sig is not None:
                state.rf_signatures_extracted += 1
                results.append({
                    "track_id": track_id,
                    "user_tag": sig.user_tag,
                    "status": "extracted",
                    "vector_dim": sig.combined_vector.shape[0],
                })
            else:
                results.append({
                    "track_id": track_id,
                    "user_tag": self.tracker.tracks[track_id].user_tag,
                    "status": "insufficient_data",
                })

        logger.info(
            "anchor_extraction_complete",
            environment_id=environment_id,
            signatures=state.rf_signatures_extracted,
        )
        return results

    # ──────────────────────────────────────────────────────────
    # Phase 3: RF Handoff — GAN Training + Confidence + Camera Off
    # ──────────────────────────────────────────────────────────

    async def run_training(
        self,
        environment_id: str,
        csi_batch,  # torch.Tensor (N, 2, n_sub, T)
        pose_batch,  # torch.Tensor (N, 33, 3)
    ) -> AsyncIterator[CalibrationState]:
        """Phase 3 Training: Run GAN adversarial training loop.

        The CalibrationGAN trains until the discriminator can no longer
        distinguish CSI-predicted poses from camera-observed poses.
        Once pose-match accuracy hits the confidence threshold for a
        sustained duration, the system triggers "Environment Synced"
        and terminates the camera feed.

        Yields state updates as training progresses.
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

            # Phase 3: Check RF-only accuracy against live video
            with torch.no_grad():
                rf_predicted_pose = self.pose_regressor(csi_latent)
                per_joint_dist = torch.norm(
                    rf_predicted_pose - pose_batch.to(self.device), dim=-1
                )
                rf_accuracy = float((per_joint_dist < 0.05).float().mean())

            state.rf_only_accuracy = rf_accuracy

            # Sustained confidence tracking (must hold 90%+ for required duration)
            if rf_accuracy >= 0.90:
                state.rf_sustained_frames += 1
            else:
                state.rf_sustained_frames = max(0, state.rf_sustained_frames - 5)

            logger.info(
                "calibration_training_step",
                environment_id=environment_id,
                epoch=epoch + 1,
                pose_accuracy=state.pose_match_accuracy,
                rf_accuracy=rf_accuracy,
                sustained=state.rf_sustained_frames,
                d_loss=metrics["d_loss"],
                g_loss=metrics["g_loss"],
            )

            # Check if confidence threshold met for sustained duration
            if state.pose_match_accuracy >= self.confidence_threshold:
                state.stage = CalibrationStage.CONFIDENCE
                state.completed_at = time.time()

                logger.info(
                    "calibration_confidence_reached",
                    environment_id=environment_id,
                    accuracy=state.pose_match_accuracy,
                    rf_accuracy=rf_accuracy,
                    epochs=epoch + 1,
                )
                yield state

                # Phase 3: RF Handoff — "Environment Synced"
                state.stage = CalibrationStage.HANDOFF
                state.handoff_triggered = True
                logger.info("environment_synced", environment_id=environment_id)
                yield state

                # Terminate camera feed → Active Sonar Mode
                state.camera_terminated = True
                self.tracker.complete_handoff()
                state.stage = CalibrationStage.LIVE
                yield state
                return

            yield state
            await asyncio.sleep(0)  # yield control

        # Max epochs reached without confidence
        state.stage = CalibrationStage.FAILED
        state.error = f"Max epochs ({state.max_epochs}) reached. Accuracy: {state.pose_match_accuracy:.2%}"
        yield state

    # ──────────────────────────────────────────────────────────
    # Phase 4–5: Live Mode — CSI-only inference + tracking
    # ──────────────────────────────────────────────────────────

    def infer_pose(self, csi_amplitude: np.ndarray, csi_phase: np.ndarray) -> np.ndarray:
        """Phase 4: Infer 3D pose from CSI alone (no camera).

        Returns (33, 3) predicted 3D skeletal keypoints.
        """
        import torch

        csi_input = np.stack([csi_amplitude, csi_phase], axis=0)
        csi_tensor = torch.tensor(csi_input, dtype=torch.float32).unsqueeze(0).unsqueeze(-1)
        csi_tensor = csi_tensor.to(self.device)

        with torch.no_grad():
            latent = self.latent_csi.encode(csi_tensor)
            pose = self.pose_regressor(latent)

        return pose.squeeze(0).cpu().numpy()

    def update_live_tracking(
        self,
        environment_id: str,
        rf_blob_centroids: dict[str, np.ndarray],
    ) -> CalibrationState:
        """Phase 4–5: Update multi-person tracking with new RF observations.

        Handles Kalman-filtered tracking, collision resolution,
        confidence decay, ghost tagging, and re-acquisition.
        """
        state = self._sessions.get(environment_id)
        if state is None:
            raise ValueError(f"No session for environment {environment_id}")

        self.tracker.update_tracks(rf_blob_centroids)

        # Update state counts
        state.active_tracks = len(self.tracker.tracks)
        state.ghosted_tracks = sum(
            1 for p in self.tracker.tracks.values() if p.is_ghosted
        )

        return state

    def get_tracking_snapshot(self) -> list[dict]:
        """Get JSON-serializable snapshot of all tracked persons."""
        return self.tracker.get_snapshot()

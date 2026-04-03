"""Multi-person RF tracker — the full handshake-to-handoff pipeline.

Orchestrates all 5 phases of the Visual Handshake to RF Handoff:
  Phase 1: Visual Handshake        — dual-data fusion & skeleton-RF blob pairing
  Phase 2: Anchor Extraction       — gait/breathing/mass RF Signature building
  Phase 3: RF Handoff              — confidence threshold & camera termination
  Phase 4: Trajectory Tracking     — Kalman-filtered momentum tracking + collision
  Phase 5: Uncertainty Loop        — confidence decay, ghost tagging, re-acquisition
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import numpy as np
import structlog

from echo_maps.tracking.kalman import KalmanTracker, TrackState
from echo_maps.tracking.rf_signature import RFSignature, RFSignatureBuilder
from echo_maps.tracking.ble_tether import (
    BLETetherEngine,
    BLEScan,
    TetherStatus,
)

logger = structlog.get_logger()


# ── Constants ──

CONFIDENCE_LIVE_THRESHOLD = 0.90     # Phase 3: RF-only must hit 90%+ accuracy
CONFIDENCE_GHOST_THRESHOLD = 0.70    # Phase 5: below this → ghost tag
CONFIDENCE_DECAY_RATE = 0.002        # per-frame decay when stationary behind obstacle
CONFIDENCE_RECOVERY_BOOST = 0.15     # bump on gross-motor re-acquisition
MERGE_DISTANCE_M = 1.0              # blobs closer than this are "merged"
SEPARATION_DISTANCE_M = 1.5         # blobs must be this far apart to "separate"
MAX_FRAMES_NO_UPDATE = 300           # 3 seconds at 100 Hz → drop track


class TrackingPhase(str, Enum):
    """Current phase of the handshake-to-handoff pipeline."""
    VISUAL_HANDSHAKE = "visual_handshake"
    ANCHOR_EXTRACTION = "anchor_extraction"
    RF_HANDOFF = "rf_handoff"
    ACTIVE_SONAR = "active_sonar"


@dataclass
class TrackedPerson:
    """Full state for a tracked individual."""

    track_id: str
    user_tag: str                          # "User_A", "Guest_B", etc.
    position: np.ndarray                   # (3,) meters
    velocity: np.ndarray                   # (3,) m/s
    confidence: float = 1.0
    is_registered: bool = False            # has RF Signature
    is_ghosted: bool = False               # Phase 5 ghost state
    rf_signature: Optional[RFSignature] = None
    last_activity: str = "idle"
    device_mac_suffix: Optional[str] = None       # last 8 chars of tethered BLE MAC
    device_tether_status: str = "none"             # tethered / awaiting_new_mac / none
    device_rssi: Optional[float] = None            # current RSSI of tethered device
    device_distance_m: Optional[float] = None      # estimated device distance
    breathing_rate: Optional[float] = None
    heart_rate: Optional[float] = None
    skeleton_keypoints: Optional[np.ndarray] = None  # (33, 3) during visual phase
    frames_since_update: int = 0
    _csi_history_walking: list = field(default_factory=list)
    _csi_history_stationary: list = field(default_factory=list)

    @property
    def speed(self) -> float:
        return float(np.linalg.norm(self.velocity[:2]))


@dataclass
class MergeEvent:
    """Tracks an active RF blob collision."""
    merge_key: str
    track_ids: list[str]
    pre_merge_positions: dict[str, np.ndarray]
    pre_merge_velocities: dict[str, np.ndarray]
    pre_merge_signatures: dict[str, Optional[RFSignature]]
    started_at: float = field(default_factory=time.time)


class MultiPersonTracker:
    """Full multi-person RF tracking engine.

    Manages the lifecycle from visual handshake through RF-only
    tracking, handling collisions, ghost states, and re-acquisition.
    """

    def __init__(
        self,
        sample_rate_hz: float = 100.0,
        n_subcarriers: int = 242,
        device: str = "cpu",
    ) -> None:
        self.sample_rate = sample_rate_hz
        self.n_subcarriers = n_subcarriers

        self.kalman = KalmanTracker(dt=1.0 / sample_rate_hz)
        self.signature_builder = RFSignatureBuilder(sample_rate_hz, n_subcarriers)

        self._tracks: dict[str, TrackedPerson] = {}
        self._next_tag_index: int = 0
        self._active_merges: dict[str, MergeEvent] = {}
        self._phase: TrackingPhase = TrackingPhase.VISUAL_HANDSHAKE

        # RF-only confidence tracking (Phase 3)
        self._rf_only_correct_frames: int = 0
        self._rf_only_required_frames: int = int(sample_rate_hz * 10)  # 10s sustained

        # CSI Anchor Protocol — BLE MAC tethering
        self.ble_tether = BLETetherEngine()

    @property
    def phase(self) -> TrackingPhase:
        return self._phase

    @property
    def tracks(self) -> dict[str, TrackedPerson]:
        return self._tracks

    # ──────────────────────────────────────────────────────────
    # Phase 1: Visual Handshake
    # ──────────────────────────────────────────────────────────

    def _assign_tag(self) -> str:
        """Generate a sequential user tag (User_A, User_B, ...)."""
        tag = f"User_{chr(65 + self._next_tag_index)}"
        self._next_tag_index += 1
        return tag

    def register_visual_handshake(
        self,
        skeleton_keypoints: np.ndarray,
        rf_blob_centroid: np.ndarray,
    ) -> TrackedPerson:
        """Phase 1: Cross-Modal Fusion — pair a visual skeleton with an RF blob.

        Maps the RF blob centroid to the chest/core of the skeleton
        and creates a new tracked person.

        Args:
            skeleton_keypoints: (33, 3) 3D skeleton from MediaPipe
            rf_blob_centroid: (3,) centroid of the RF blob from CSI

        Returns:
            Newly registered TrackedPerson
        """
        tag = self._assign_tag()
        track_id = f"track_{tag}_{int(time.time() * 1000)}"

        # The chest/core is the midpoint of shoulders (joints 11, 12)
        left_shoulder = skeleton_keypoints[11]
        right_shoulder = skeleton_keypoints[12]
        chest_center = (left_shoulder + right_shoulder) / 2.0

        # Verify spatial alignment — RF blob should be near chest center
        alignment_dist = float(np.linalg.norm(rf_blob_centroid - chest_center))

        person = TrackedPerson(
            track_id=track_id,
            user_tag=tag,
            position=rf_blob_centroid.copy(),
            velocity=np.zeros(3, dtype=np.float32),
            confidence=1.0,
            skeleton_keypoints=skeleton_keypoints.copy(),
        )

        self._tracks[track_id] = person
        self.kalman.init_track(track_id, rf_blob_centroid)

        logger.info(
            "visual_handshake_registered",
            track_id=track_id,
            user_tag=tag,
            alignment_dist=round(alignment_dist, 3),
            chest_center=chest_center.tolist(),
            rf_centroid=rf_blob_centroid.tolist(),
        )

        return person

    # ──────────────────────────────────────────────────────────
    # Phase 2: Anchor Extraction
    # ──────────────────────────────────────────────────────────

    def accumulate_csi_for_signature(
        self,
        track_id: str,
        csi_amplitude: np.ndarray,
        is_walking: bool,
    ) -> None:
        """Accumulate CSI frames for RF Signature extraction.

        Called during the visual handshake phase to collect enough
        walking and stationary samples for anchor extraction.
        """
        person = self._tracks.get(track_id)
        if person is None:
            return

        if is_walking:
            person._csi_history_walking.append(csi_amplitude.copy())
        else:
            person._csi_history_stationary.append(csi_amplitude.copy())

    def extract_rf_signature(self, track_id: str) -> Optional[RFSignature]:
        """Phase 2: Build the RF Signature from accumulated CSI data.

        Extracts gait periodicity, breathing micro-vibrations, and
        mass-reflection profile, then compresses to 512-dim vector.

        Returns None if insufficient data collected.
        """
        person = self._tracks.get(track_id)
        if person is None:
            return None

        min_walking = int(self.sample_rate * 5)   # 5 seconds of walking
        min_stationary = int(self.sample_rate * 3)  # 3 seconds stationary

        if len(person._csi_history_walking) < min_walking:
            logger.warning("insufficient_walking_data", track_id=track_id,
                           have=len(person._csi_history_walking), need=min_walking)
            return None
        if len(person._csi_history_stationary) < min_stationary:
            logger.warning("insufficient_stationary_data", track_id=track_id,
                           have=len(person._csi_history_stationary), need=min_stationary)
            return None

        # Stack into matrices: (n_subcarriers, n_timesteps)
        walking_csi = np.stack(person._csi_history_walking, axis=1)
        stationary_csi = np.stack(person._csi_history_stationary, axis=1)

        signature = self.signature_builder.build(
            user_tag=person.user_tag,
            walking_csi=walking_csi,
            stationary_csi=stationary_csi,
        )

        person.rf_signature = signature
        person.is_registered = True

        logger.info(
            "rf_signature_extracted",
            track_id=track_id,
            user_tag=person.user_tag,
            gait_dim=signature.gait_embedding.shape[0],
            breathing_dim=signature.breathing_embedding.shape[0],
        )

        return signature

    # ──────────────────────────────────────────────────────────
    # Phase 3: RF Handoff
    # ──────────────────────────────────────────────────────────

    def evaluate_rf_handoff(
        self,
        track_id: str,
        rf_predicted_position: np.ndarray,
        rf_predicted_pose: np.ndarray,
        vision_position: np.ndarray,
        vision_pose: np.ndarray,
    ) -> dict:
        """Phase 3: Compare RF-only predictions against live video ground truth.

        Checks whether CSI-only tracking has reached 90%+ accuracy
        for a sustained duration, triggering "Environment Synced."

        Returns dict with 'position_error', 'pose_accuracy', 'rf_ready', 'handoff_complete'.
        """
        position_error = float(np.linalg.norm(rf_predicted_position - vision_position))

        # Per-joint accuracy (within 5cm threshold)
        per_joint_dist = np.linalg.norm(rf_predicted_pose - vision_pose, axis=-1)
        pose_accuracy = float((per_joint_dist < 0.05).mean())

        rf_ready = pose_accuracy >= CONFIDENCE_LIVE_THRESHOLD

        if rf_ready:
            self._rf_only_correct_frames += 1
        else:
            self._rf_only_correct_frames = max(0, self._rf_only_correct_frames - 5)

        handoff_complete = self._rf_only_correct_frames >= self._rf_only_required_frames

        if handoff_complete and self._phase == TrackingPhase.VISUAL_HANDSHAKE:
            self._phase = TrackingPhase.RF_HANDOFF
            logger.info(
                "rf_handoff_triggered",
                track_id=track_id,
                pose_accuracy=pose_accuracy,
                sustained_frames=self._rf_only_correct_frames,
            )

        return {
            "position_error": position_error,
            "pose_accuracy": pose_accuracy,
            "rf_ready": rf_ready,
            "handoff_complete": handoff_complete,
            "sustained_frames": self._rf_only_correct_frames,
            "required_frames": self._rf_only_required_frames,
        }

    def complete_handoff(self) -> None:
        """Transition to Active Sonar Mode — camera is terminated."""
        self._phase = TrackingPhase.ACTIVE_SONAR
        for person in self._tracks.values():
            person.skeleton_keypoints = None  # no more visual data
        logger.info("active_sonar_mode_engaged", n_tracks=len(self._tracks))

    # ──────────────────────────────────────────────────────────
    # Phase 4: Continuous Trajectory Tracking
    # ──────────────────────────────────────────────────────────

    def update_tracks(
        self,
        rf_blob_centroids: dict[str, np.ndarray],
        rf_features: Optional[dict[str, np.ndarray]] = None,
    ) -> dict[str, TrackedPerson]:
        """Phase 4: Update all tracks with new RF blob observations.

        Uses Kalman prediction + measurement update for smooth tracking.
        Handles blob assignment via minimum-distance matching.

        Args:
            rf_blob_centroids: {blob_id: (3,) position} observed blobs
            rf_features: optional {blob_id: (D,) feature vector} for signature matching

        Returns:
            Updated tracks dict
        """
        # Step 1: Predict all tracks forward
        predictions = {}
        for track_id in list(self._tracks.keys()):
            predictions[track_id] = self.kalman.predict(track_id)

        # Step 2: Greedy assignment of blobs to tracks (nearest predicted position)
        unassigned_blobs = set(rf_blob_centroids.keys())
        assigned_tracks = set()

        assignments: list[tuple[str, str]] = []  # (track_id, blob_id)

        for track_id, predicted_pos in predictions.items():
            best_blob = None
            best_dist = float("inf")
            for blob_id in unassigned_blobs:
                dist = self.kalman.get_innovation_distance(
                    track_id, rf_blob_centroids[blob_id]
                )
                if dist < best_dist:
                    best_dist = dist
                    best_blob = blob_id

            if best_blob is not None and best_dist < 50.0:  # chi-squared threshold
                assignments.append((track_id, best_blob))
                unassigned_blobs.discard(best_blob)
                assigned_tracks.add(track_id)

        # Step 3: Apply Kalman updates for assigned tracks
        for track_id, blob_id in assignments:
            corrected_pos = self.kalman.update(track_id, rf_blob_centroids[blob_id])
            state = self.kalman.get_state(track_id)
            person = self._tracks[track_id]
            person.position = corrected_pos
            person.velocity = state[1] if state else np.zeros(3)
            person.frames_since_update = 0

            # Confidence boost
            if person.is_ghosted and person.speed > 0.3:
                person.confidence = min(1.0, person.confidence + CONFIDENCE_RECOVERY_BOOST)
                if person.confidence >= CONFIDENCE_GHOST_THRESHOLD:
                    person.is_ghosted = False
                    logger.info("ghost_re_acquired", track_id=track_id,
                                confidence=person.confidence)

        # Step 4: Handle unassigned tracks (no matching blob)
        for track_id in set(self._tracks.keys()) - assigned_tracks:
            person = self._tracks[track_id]
            person.frames_since_update += 1
            state = self.kalman.get_state(track_id)
            if state:
                person.position = state[0]
                person.velocity = state[1]

        # Step 5: Detect merges
        self._check_merges()

        # Step 6: Apply uncertainty decay (Phase 5)
        self._apply_uncertainty_decay()

        # Step 7: Prune dead tracks
        self._prune_dead_tracks()

        return self._tracks

    def _check_merges(self) -> None:
        """Detect and handle RF blob merges (path crossings)."""
        track_ids = list(self._tracks.keys())
        for i in range(len(track_ids)):
            for j in range(i + 1, len(track_ids)):
                tid_a = track_ids[i]
                tid_b = track_ids[j]
                pa = self._tracks[tid_a].position
                pb = self._tracks[tid_b].position
                dist = float(np.linalg.norm(pa - pb))

                merge_key = f"{tid_a}|{tid_b}"
                reverse_key = f"{tid_b}|{tid_a}"

                if dist < MERGE_DISTANCE_M:
                    if merge_key not in self._active_merges and reverse_key not in self._active_merges:
                        # New merge event — cache pre-merge state
                        self._active_merges[merge_key] = MergeEvent(
                            merge_key=merge_key,
                            track_ids=[tid_a, tid_b],
                            pre_merge_positions={
                                tid_a: self._tracks[tid_a].position.copy(),
                                tid_b: self._tracks[tid_b].position.copy(),
                            },
                            pre_merge_velocities={
                                tid_a: self._tracks[tid_a].velocity.copy(),
                                tid_b: self._tracks[tid_b].velocity.copy(),
                            },
                            pre_merge_signatures={
                                tid_a: self._tracks[tid_a].rf_signature,
                                tid_b: self._tracks[tid_b].rf_signature,
                            },
                        )
                        logger.info("rf_blob_merge_detected", tracks=[tid_a, tid_b])

                elif dist > SEPARATION_DISTANCE_M:
                    # Check if this was a merge that has now separated
                    for key in [merge_key, reverse_key]:
                        if key in self._active_merges:
                            self._resolve_separation(key, tid_a, tid_b)
                            break

    def _resolve_separation(self, merge_key: str, tid_a: str, tid_b: str) -> None:
        """Phase 4 Separation Logic: Re-assign identities after blob separation.

        Uses RF Signature matching and momentum continuity to determine
        which post-separation blob corresponds to which pre-merge identity.
        """
        merge_event = self._active_merges.pop(merge_key)
        person_a = self._tracks.get(tid_a)
        person_b = self._tracks.get(tid_b)
        if person_a is None or person_b is None:
            return

        # Strategy: Check each blob against stored RF signatures + expected momentum
        needs_swap = False

        # 1. Compare using RF Signatures if both are registered
        sig_a = merge_event.pre_merge_signatures.get(tid_a)
        sig_b = merge_event.pre_merge_signatures.get(tid_b)

        if sig_a is not None and sig_b is not None and person_a.rf_signature and person_b.rf_signature:
            # Compare current RF features against pre-merge signatures
            sim_a_to_a = sig_a.cosine_similarity(person_a.rf_signature) if person_a.rf_signature else 0
            sim_a_to_b = sig_a.cosine_similarity(person_b.rf_signature) if person_b.rf_signature else 0

            if sim_a_to_b > sim_a_to_a + 0.1:
                needs_swap = True

        # 2. Momentum continuity check
        pre_vel_a = merge_event.pre_merge_velocities[tid_a]
        pre_vel_b = merge_event.pre_merge_velocities[tid_b]

        if not needs_swap and np.linalg.norm(pre_vel_a) > 0.2 and np.linalg.norm(pre_vel_b) > 0.2:
            # Check which current velocity is more aligned with pre-merge velocity
            cur_vel_a = person_a.velocity
            cur_vel_b = person_b.velocity

            dot_aa = float(np.dot(pre_vel_a, cur_vel_a))
            dot_ab = float(np.dot(pre_vel_a, cur_vel_b))

            if dot_ab > dot_aa + 0.1:
                needs_swap = True

        if needs_swap:
            # Swap user tags, signatures, and registered status
            person_a.user_tag, person_b.user_tag = person_b.user_tag, person_a.user_tag
            person_a.rf_signature, person_b.rf_signature = person_b.rf_signature, person_a.rf_signature
            person_a.is_registered, person_b.is_registered = person_b.is_registered, person_a.is_registered
            logger.info("rf_blob_identity_swapped",
                        merge_key=merge_key,
                        new_a=person_a.user_tag,
                        new_b=person_b.user_tag)
        else:
            logger.info("rf_blob_identity_maintained", merge_key=merge_key)

    # ──────────────────────────────────────────────────────────
    # Phase 5: Uncertainty Loop
    # ──────────────────────────────────────────────────────────

    def _apply_uncertainty_decay(self) -> None:
        """Phase 5: Confidence Decay — degrade confidence for stationary/occluded tracks."""
        for person in self._tracks.values():
            if person.frames_since_update > 0:
                # No matching blob found — decay faster
                person.confidence = max(0.0, person.confidence - CONFIDENCE_DECAY_RATE * 3)
            elif person.speed < 0.05:
                # Sitting still — slow decay (signal may degrade behind furniture)
                person.confidence = max(0.0, person.confidence - CONFIDENCE_DECAY_RATE)

            # Ghost tagging threshold
            if person.confidence < CONFIDENCE_GHOST_THRESHOLD and not person.is_ghosted:
                person.is_ghosted = True
                logger.info("ghost_tagged", track_id=person.track_id,
                            user_tag=person.user_tag,
                            confidence=round(person.confidence, 3))

    def re_acquire(self, track_id: str, verified_signature: RFSignature) -> bool:
        """Phase 5: Re-acquisition — verify identity after gross motor movement.

        When a ghosted user stands up or makes a distinct movement,
        the system catches the RF reflection, verifies the gait anchor,
        and snaps tracking back to full confidence.

        Returns True if re-acquisition successful.
        """
        person = self._tracks.get(track_id)
        if person is None:
            return False

        if person.rf_signature is None:
            return False

        similarity = person.rf_signature.cosine_similarity(verified_signature)

        if similarity > 0.75:
            person.confidence = 1.0
            person.is_ghosted = False
            person.frames_since_update = 0
            logger.info("re_acquired", track_id=track_id,
                        user_tag=person.user_tag,
                        similarity=round(similarity, 3))
            return True

        return False

    def _prune_dead_tracks(self) -> None:
        """Remove tracks that have been unmatched for too long."""
        dead = [
            tid for tid, p in self._tracks.items()
            if p.frames_since_update > MAX_FRAMES_NO_UPDATE
        ]
        for tid in dead:
            logger.info("track_pruned", track_id=tid,
                        user_tag=self._tracks[tid].user_tag)
            self.kalman.remove_track(tid)
            self.ble_tether.remove_track(tid)
            del self._tracks[tid]

    # ──────────────────────────────────────────────────────────
    # BLE Tethering (CSI Anchor Protocol)
    # ──────────────────────────────────────────────────────────

    def ingest_ble_scans(self, scans: list[BLEScan]) -> list[dict]:
        """Process BLE advertisement scans and update device tethers.

        The CSI RF Signature remains the identity anchor — BLE MACs
        are volatile accessories that get re-tethered after rotation.

        Args:
            scans: BLE advertisements from the bridge

        Returns:
            List of tether events (mac_dropped, mac_retethered, etc.)
        """
        # Build current position map
        tracked_positions = {
            tid: p.position for tid, p in self._tracks.items()
        }

        events = self.ble_tether.ingest_ble_scan(scans, tracked_positions)

        # Sync tether state back to TrackedPerson objects
        for person in self._tracks.values():
            tether = self.ble_tether.tethers.get(person.track_id)
            if tether:
                person.device_mac_suffix = tether.mac[-8:]
                person.device_tether_status = TetherStatus.TETHERED.value
                person.device_rssi = tether.avg_rssi
                person.device_distance_m = tether.estimated_distance_m
            elif person.track_id in self.ble_tether.awaiting_tracks:
                person.device_mac_suffix = None
                person.device_tether_status = TetherStatus.AWAITING_NEW_MAC.value
                person.device_rssi = None
                person.device_distance_m = None
            else:
                person.device_mac_suffix = None
                person.device_tether_status = "none"
                person.device_rssi = None
                person.device_distance_m = None

        return events

    # ──────────────────────────────────────────────────────────
    # Query interface
    # ──────────────────────────────────────────────────────────

    def get_snapshot(self) -> list[dict]:
        """Get a JSON-serializable snapshot of all tracked persons."""
        snapshot = []
        for person in self._tracks.values():
            tether_info = self.ble_tether.tethers.get(person.track_id)
            snapshot.append({
                "track_id": person.track_id,
                "user_tag": person.user_tag,
                "position": person.position.tolist(),
                "velocity": person.velocity.tolist(),
                "speed": person.speed,
                "confidence": round(person.confidence, 3),
                "is_registered": person.is_registered,
                "is_ghosted": person.is_ghosted,
                "last_activity": person.last_activity,
                "breathing_rate": person.breathing_rate,
                "heart_rate": person.heart_rate,
                "device_mac_suffix": person.device_mac_suffix,
                "device_tether_status": person.device_tether_status,
                "device_rssi": round(tether_info.avg_rssi, 1) if tether_info else None,
                "device_distance_m": round(tether_info.estimated_distance_m, 2) if tether_info else None,
            })
        return snapshot

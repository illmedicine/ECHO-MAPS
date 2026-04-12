"""Room Scanner — visual room mapping from mobile phone camera.

Processes a stream of video frames captured from a phone's back-facing camera
while the user stands in the centre of the room and pans 360°.  Extracts:
  • Room dimensions (width, length, height) via depth estimation
  • Detected objects / furniture with bounding boxes and classifications
  • Wall / corner / opening locations for floor-plan reconstruction

The scan data is cross-referenced with CSI signatures so the AI engine can
associate RF reflections with physical objects (couch, bed, desk, etc.).
"""

from __future__ import annotations

import math
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Sequence

import cv2
import numpy as np
import structlog

logger = structlog.get_logger()


# ── Object categories recognisable by the scanner ──────────────────────────

class ObjectCategory(str, Enum):
    COUCH = "couch"
    SOFA = "sofa"
    BED = "bed"
    TV = "tv"
    TABLE = "table"
    DESK = "desk"
    CHAIR = "chair"
    TOILET = "toilet"
    BATHTUB = "bathtub"
    SINK = "sink"
    REFRIGERATOR = "refrigerator"
    OVEN = "oven"
    MICROWAVE = "microwave"
    BOOKSHELF = "bookshelf"
    WARDROBE = "wardrobe"
    NIGHTSTAND = "nightstand"
    DINING_TABLE = "dining_table"
    CABINET = "cabinet"
    DOOR = "door"
    WINDOW = "window"
    LAMP = "lamp"
    PLANT = "plant"
    WASHER = "washer"
    DRYER = "dryer"
    UNKNOWN = "unknown"


# COCO class-ids that map to our furniture categories
_COCO_TO_CATEGORY: dict[int, ObjectCategory] = {
    57: ObjectCategory.COUCH,      # couch
    59: ObjectCategory.BED,        # bed
    62: ObjectCategory.TV,         # tv
    60: ObjectCategory.DINING_TABLE,
    56: ObjectCategory.CHAIR,
    61: ObjectCategory.TOILET,
    68: ObjectCategory.MICROWAVE,
    69: ObjectCategory.OVEN,
    72: ObjectCategory.REFRIGERATOR,
    63: ObjectCategory.LAMP,       # laptop → remap if needed
    58: ObjectCategory.PLANT,      # potted plant
    70: ObjectCategory.SINK,
}


# ── Data classes ────────────────────────────────────────────────────────────

@dataclass
class DetectedObject:
    """A single object detected in the room scan."""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    category: ObjectCategory = ObjectCategory.UNKNOWN
    label: str = ""
    confidence: float = 0.0
    # Bounding box in normalised image coords [0..1]
    bbox: tuple[float, float, float, float] = (0, 0, 0, 0)  # x1, y1, x2, y2
    # Estimated real-world position relative to scanner (metres)
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)  # x, y, z
    # Estimated real-world dimensions (metres)
    dimensions: tuple[float, float, float] = (0.0, 0.0, 0.0)  # w, h, d
    # Bearing from scanner centre (radians, 0 = forward)
    bearing: float = 0.0
    # Estimated distance from scanner (metres)
    distance: float = 0.0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "category": self.category.value,
            "label": self.label or self.category.value.replace("_", " ").title(),
            "confidence": round(self.confidence, 3),
            "bbox": list(self.bbox),
            "position": [round(v, 3) for v in self.position],
            "dimensions": [round(v, 3) for v in self.dimensions],
            "bearing": round(self.bearing, 4),
            "distance": round(self.distance, 3),
        }


@dataclass
class RoomDimensions:
    """Estimated room dimensions from the visual scan."""
    width: float = 0.0    # metres (x-axis)
    length: float = 0.0   # metres (z-axis)
    height: float = 2.7   # metres (y-axis, default ceiling)
    confidence: float = 0.0

    def to_dict(self) -> dict:
        return {
            "width": round(self.width, 2),
            "length": round(self.length, 2),
            "height": round(self.height, 2),
            "confidence": round(self.confidence, 3),
        }


class ScanPhase(str, Enum):
    IDLE = "idle"
    CAPTURING = "capturing"
    PROCESSING = "processing"
    MAPPING = "mapping"
    COMPLETE = "complete"
    FAILED = "failed"


@dataclass
class ScanSession:
    """State container for a room scan session."""
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    environment_id: str = ""
    user_id: str = ""
    phase: ScanPhase = ScanPhase.IDLE
    # Captured frame metadata
    frames_captured: int = 0
    coverage_degrees: float = 0.0       # how much of 360° has been scanned
    target_coverage: float = 340.0      # need ~340° for full room
    # Detection results
    objects: list[DetectedObject] = field(default_factory=list)
    room_dimensions: RoomDimensions = field(default_factory=RoomDimensions)
    # Calibration boost
    scan_confidence: float = 0.0         # 0..1 — how complete is the scan
    calibration_boost: float = 0.0       # how much this scan raises calibration %
    # Timing
    started_at: float = field(default_factory=time.time)
    completed_at: float | None = None
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "environment_id": self.environment_id,
            "phase": self.phase.value,
            "frames_captured": self.frames_captured,
            "coverage_degrees": round(self.coverage_degrees, 1),
            "target_coverage": self.target_coverage,
            "objects": [o.to_dict() for o in self.objects],
            "room_dimensions": self.room_dimensions.to_dict(),
            "scan_confidence": round(self.scan_confidence, 3),
            "calibration_boost": round(self.calibration_boost, 3),
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "error": self.error,
        }


# ── Typical furniture dimensions (metres) for size estimation ──────────────

_TYPICAL_DIMS: dict[ObjectCategory, tuple[float, float, float]] = {
    ObjectCategory.COUCH:         (2.0, 0.85, 0.9),
    ObjectCategory.SOFA:          (2.0, 0.85, 0.9),
    ObjectCategory.BED:           (2.0, 0.6,  1.5),
    ObjectCategory.TV:            (1.2, 0.7,  0.1),
    ObjectCategory.TABLE:         (1.2, 0.75, 0.8),
    ObjectCategory.DESK:          (1.4, 0.75, 0.7),
    ObjectCategory.CHAIR:         (0.5, 0.9,  0.5),
    ObjectCategory.TOILET:        (0.4, 0.75, 0.65),
    ObjectCategory.BATHTUB:       (1.5, 0.5,  0.7),
    ObjectCategory.SINK:          (0.6, 0.85, 0.5),
    ObjectCategory.REFRIGERATOR:  (0.7, 1.7,  0.7),
    ObjectCategory.OVEN:          (0.6, 0.9,  0.6),
    ObjectCategory.MICROWAVE:     (0.5, 0.3,  0.4),
    ObjectCategory.BOOKSHELF:     (0.8, 1.8,  0.3),
    ObjectCategory.WARDROBE:      (1.2, 2.0,  0.6),
    ObjectCategory.NIGHTSTAND:    (0.5, 0.55, 0.4),
    ObjectCategory.DINING_TABLE:  (1.5, 0.75, 0.9),
    ObjectCategory.CABINET:       (0.8, 0.9,  0.4),
    ObjectCategory.DOOR:          (0.9, 2.1,  0.05),
    ObjectCategory.WINDOW:        (1.2, 1.2,  0.05),
    ObjectCategory.LAMP:          (0.3, 1.5,  0.3),
    ObjectCategory.PLANT:         (0.4, 0.8,  0.4),
    ObjectCategory.WASHER:        (0.6, 0.85, 0.6),
    ObjectCategory.DRYER:         (0.6, 0.85, 0.6),
}


# ── Room Scanner Engine ────────────────────────────────────────────────────

class RoomScanner:
    """Processes mobile camera frames to build a spatial map of the room.

    Designed for the flow:
      1. User opens Echo Vue on phone, navigates to Room Scan
      2. Phone back camera activates, user slowly pans 360°
      3. Each frame is sent to the backend (or processed locally)
      4. Object detection identifies furniture / fixtures
      5. Depth cues estimate positions and room dimensions
      6. Results are cross-analysed with CSI data for calibration boost
    """

    # Minimum confidence to keep a detected object
    MIN_DETECTION_CONFIDENCE = 0.45

    # Camera horizontal FOV approximation (radians) — typical phone
    CAMERA_HFOV = math.radians(70)

    def __init__(self) -> None:
        self._sessions: dict[str, ScanSession] = {}
        self._net: cv2.dnn.Net | None = None  # lazy-loaded
        self._class_names: list[str] = []

    # ── Session management ──

    def create_session(
        self,
        environment_id: str,
        user_id: str,
    ) -> ScanSession:
        session = ScanSession(
            environment_id=environment_id,
            user_id=user_id,
            phase=ScanPhase.CAPTURING,
        )
        self._sessions[environment_id] = session
        logger.info(
            "room_scan_session_created",
            environment_id=environment_id,
            session_id=session.id,
        )
        return session

    def get_session(self, environment_id: str) -> ScanSession | None:
        return self._sessions.get(environment_id)

    # ── Frame processing ──

    def process_frame(
        self,
        environment_id: str,
        frame: np.ndarray,
        device_orientation: dict | None = None,
    ) -> ScanSession:
        """Process a single camera frame during a room scan.

        Args:
            environment_id: Room being scanned.
            frame: BGR uint8 image from the phone camera.
            device_orientation: Optional IMU data
                {alpha, beta, gamma} in degrees for bearing tracking.

        Returns:
            Updated ScanSession.
        """
        session = self._sessions.get(environment_id)
        if session is None:
            raise ValueError(f"No scan session for {environment_id}")

        if session.phase not in (ScanPhase.CAPTURING, ScanPhase.PROCESSING):
            return session

        session.phase = ScanPhase.PROCESSING
        session.frames_captured += 1

        # --- Detect objects in this frame ---
        detections = self._detect_objects(frame)

        # --- Estimate bearing from device orientation ---
        bearing = 0.0
        if device_orientation:
            bearing = math.radians(device_orientation.get("alpha", 0.0))

        # --- Merge detections into session (deduplicate by position) ---
        for det in detections:
            det.bearing = bearing
            det.distance = self._estimate_distance(det, frame.shape)
            det.position = self._polar_to_cartesian(det.bearing, det.distance)
            det.dimensions = _TYPICAL_DIMS.get(det.category, (0.5, 0.5, 0.5))
            self._merge_detection(session, det)

        # --- Update coverage ---
        if device_orientation:
            alpha = device_orientation.get("alpha", 0.0)
            session.coverage_degrees = max(
                session.coverage_degrees,
                self._compute_coverage(session),
            )

        # --- Estimate room dimensions from object layout ---
        session.room_dimensions = self._estimate_room_dimensions(session)

        # --- Compute scan confidence ---
        session.scan_confidence = self._compute_scan_confidence(session)

        # --- Check if scan is complete ---
        if session.scan_confidence >= 0.95 and session.coverage_degrees >= session.target_coverage:
            session.phase = ScanPhase.COMPLETE
            session.completed_at = time.time()
            session.calibration_boost = self._compute_calibration_boost(session)
            logger.info(
                "room_scan_complete",
                environment_id=environment_id,
                objects=len(session.objects),
                dimensions=session.room_dimensions.to_dict(),
                calibration_boost=session.calibration_boost,
            )
        else:
            session.phase = ScanPhase.CAPTURING  # ready for next frame

        return session

    def finalise_scan(self, environment_id: str) -> ScanSession:
        """Manually finalise a scan even if coverage is incomplete.

        Computes final calibration boost based on what was captured.
        """
        session = self._sessions.get(environment_id)
        if session is None:
            raise ValueError(f"No scan session for {environment_id}")

        session.phase = ScanPhase.COMPLETE
        session.completed_at = time.time()
        session.calibration_boost = self._compute_calibration_boost(session)

        logger.info(
            "room_scan_finalised",
            environment_id=environment_id,
            objects=len(session.objects),
            scan_confidence=session.scan_confidence,
            calibration_boost=session.calibration_boost,
        )
        return session

    # ── Object detection ──

    def _load_detector(self) -> None:
        """Lazy-load a MobileNet-SSD or YOLO-based detector via OpenCV DNN."""
        if self._net is not None:
            return

        # Use OpenCV's built-in DNN with a MobileNet-SSD model (COCO classes).
        # In production this would load a fine-tuned model for indoor furniture.
        try:
            self._net = cv2.dnn.readNetFromTensorflow(
                "models/ssd_mobilenet_v2_coco.pb",
                "models/ssd_mobilenet_v2_coco.pbtxt",
            )
            logger.info("room_scanner_model_loaded", model="ssd_mobilenet_v2_coco")
        except Exception:
            # Fallback: signal that we'll use client-side detection only
            self._net = None
            logger.warning("room_scanner_model_unavailable", msg="Using client-side detection")

    def _detect_objects(self, frame: np.ndarray) -> list[DetectedObject]:
        """Run object detection on a single frame.

        Returns list of DetectedObject with bbox and confidence filled in.
        Falls back to empty list if model unavailable (client handles detection).
        """
        self._load_detector()

        if self._net is None:
            return []  # client-side detection mode

        h, w = frame.shape[:2]
        blob = cv2.dnn.blobFromImage(
            frame, size=(300, 300), swapRB=True, crop=False,
        )
        self._net.setInput(blob)
        detections_raw = self._net.forward()

        results: list[DetectedObject] = []
        for i in range(detections_raw.shape[2]):
            confidence = float(detections_raw[0, 0, i, 2])
            if confidence < self.MIN_DETECTION_CONFIDENCE:
                continue

            class_id = int(detections_raw[0, 0, i, 1])
            category = _COCO_TO_CATEGORY.get(class_id, None)
            if category is None:
                continue  # not a furniture / fixture class

            x1 = max(0.0, float(detections_raw[0, 0, i, 3]))
            y1 = max(0.0, float(detections_raw[0, 0, i, 4]))
            x2 = min(1.0, float(detections_raw[0, 0, i, 5]))
            y2 = min(1.0, float(detections_raw[0, 0, i, 6]))

            results.append(DetectedObject(
                category=category,
                confidence=confidence,
                bbox=(x1, y1, x2, y2),
            ))

        return results

    def process_client_detections(
        self,
        environment_id: str,
        detections: list[dict],
        device_orientation: dict | None = None,
    ) -> ScanSession:
        """Process detections already computed client-side (e.g. TF.js COCO-SSD).

        This is the primary path for mobile — the phone runs TensorFlow.js
        object detection locally and sends results to the backend.

        Args:
            environment_id: Room being scanned.
            detections: List of dicts with keys:
                category (str), confidence (float), bbox [x1,y1,x2,y2],
                optional: distance (float), bearing (float)
            device_orientation: {alpha, beta, gamma} in degrees.
        """
        session = self._sessions.get(environment_id)
        if session is None:
            raise ValueError(f"No scan session for {environment_id}")

        session.frames_captured += 1
        bearing = math.radians(device_orientation.get("alpha", 0.0)) if device_orientation else 0.0

        for det_dict in detections:
            cat_str = det_dict.get("category", "unknown")
            try:
                category = ObjectCategory(cat_str.lower().replace(" ", "_"))
            except ValueError:
                category = ObjectCategory.UNKNOWN

            if det_dict.get("confidence", 0) < self.MIN_DETECTION_CONFIDENCE:
                continue

            bbox = tuple(det_dict.get("bbox", [0, 0, 1, 1]))
            det = DetectedObject(
                category=category,
                confidence=det_dict.get("confidence", 0.5),
                bbox=bbox,
                bearing=det_dict.get("bearing", bearing),
                distance=det_dict.get("distance", self._estimate_distance_from_bbox(bbox)),
            )
            det.position = self._polar_to_cartesian(det.bearing, det.distance)
            det.dimensions = _TYPICAL_DIMS.get(det.category, (0.5, 0.5, 0.5))
            self._merge_detection(session, det)

        # Update coverage
        if device_orientation:
            session.coverage_degrees = max(
                session.coverage_degrees,
                self._compute_coverage(session),
            )

        session.room_dimensions = self._estimate_room_dimensions(session)
        session.scan_confidence = self._compute_scan_confidence(session)

        # Auto-complete check
        if session.scan_confidence >= 0.95 and session.coverage_degrees >= session.target_coverage:
            session.phase = ScanPhase.COMPLETE
            session.completed_at = time.time()
            session.calibration_boost = self._compute_calibration_boost(session)
        else:
            session.phase = ScanPhase.CAPTURING

        return session

    # ── Spatial estimation helpers ──

    @staticmethod
    def _estimate_distance(det: DetectedObject, frame_shape: tuple) -> float:
        """Estimate distance from camera using apparent size heuristics."""
        _, _, x2, y2 = det.bbox
        x1, y1 = det.bbox[0], det.bbox[1]
        bbox_height = (y2 - y1)
        if bbox_height < 0.01:
            return 5.0  # far away

        typical = _TYPICAL_DIMS.get(det.category, (0.5, 0.5, 0.5))
        # Rough pinhole model: distance ≈ (real_height × focal_length) / pixel_height
        # With normalised coords the focal_length ratio cancels to ~1.2
        estimated = typical[1] * 1.2 / bbox_height
        return max(0.3, min(estimated, 10.0))

    @staticmethod
    def _estimate_distance_from_bbox(bbox: tuple) -> float:
        """Estimate distance from normalised bounding box height."""
        if len(bbox) < 4:
            return 3.0
        height = bbox[3] - bbox[1]
        if height < 0.01:
            return 5.0
        return max(0.3, min(1.5 / height, 10.0))

    @staticmethod
    def _polar_to_cartesian(bearing: float, distance: float) -> tuple[float, float, float]:
        """Convert bearing + distance to (x, y=0, z) room coordinates.

        Origin is the scanner position (centre of room).
        """
        x = distance * math.sin(bearing)
        z = distance * math.cos(bearing)
        return (round(x, 3), 0.0, round(z, 3))

    def _merge_detection(self, session: ScanSession, new_det: DetectedObject) -> None:
        """Merge a new detection with existing ones, deduplicating by proximity."""
        MERGE_DISTANCE = 0.8  # metres — within this distance = same object

        for existing in session.objects:
            if existing.category != new_det.category:
                continue
            dx = existing.position[0] - new_det.position[0]
            dz = existing.position[2] - new_det.position[2]
            dist = math.sqrt(dx * dx + dz * dz)
            if dist < MERGE_DISTANCE:
                # Update confidence (keep the higher one)
                if new_det.confidence > existing.confidence:
                    existing.confidence = new_det.confidence
                    existing.bbox = new_det.bbox
                    existing.bearing = new_det.bearing
                    existing.distance = new_det.distance
                    # Average position for stability
                    existing.position = (
                        (existing.position[0] + new_det.position[0]) / 2,
                        0.0,
                        (existing.position[2] + new_det.position[2]) / 2,
                    )
                return

        # No match — new object
        session.objects.append(new_det)

    def _compute_coverage(self, session: ScanSession) -> float:
        """Compute angular coverage from detected object bearings."""
        if not session.objects:
            return min(session.frames_captured * 5.0, 360.0)  # rough estimate

        bearings = sorted(math.degrees(o.bearing) % 360 for o in session.objects)
        if len(bearings) < 2:
            return min(session.frames_captured * 5.0, 360.0)

        # Compute the span of bearings covered
        max_gap = 0.0
        for i in range(len(bearings)):
            gap = (bearings[(i + 1) % len(bearings)] - bearings[i]) % 360
            max_gap = max(max_gap, gap)

        return 360.0 - max_gap

    def _estimate_room_dimensions(self, session: ScanSession) -> RoomDimensions:
        """Estimate room size from detected object positions."""
        if not session.objects:
            return RoomDimensions()

        xs = [o.position[0] for o in session.objects]
        zs = [o.position[2] for o in session.objects]

        # Room extent is object spread + buffer for walls
        x_spread = max(xs) - min(xs) if xs else 0
        z_spread = max(zs) - min(zs) if zs else 0

        # Add ~1m buffer on each side for space between objects and walls
        width = max(2.0, x_spread + 2.0)
        length = max(2.0, z_spread + 2.0)

        # Height from known tall objects, else default
        height = 2.7
        for obj in session.objects:
            if obj.category in (ObjectCategory.DOOR, ObjectCategory.WARDROBE, ObjectCategory.BOOKSHELF):
                height = max(height, obj.dimensions[1] + 0.3)

        confidence = min(1.0, len(session.objects) / 5.0) * min(1.0, session.coverage_degrees / 270.0)

        return RoomDimensions(
            width=round(width, 2),
            length=round(length, 2),
            height=round(height, 2),
            confidence=round(confidence, 3),
        )

    def _compute_scan_confidence(self, session: ScanSession) -> float:
        """Compute overall scan confidence from coverage and detections."""
        coverage_pct = min(1.0, session.coverage_degrees / session.target_coverage)
        objects_pct = min(1.0, len(session.objects) / 3.0)  # at least 3 objects for a good scan
        dimension_conf = session.room_dimensions.confidence
        frames_pct = min(1.0, session.frames_captured / 20.0)  # at least 20 frames

        # Weighted combination
        confidence = (
            coverage_pct * 0.35 +
            objects_pct * 0.30 +
            dimension_conf * 0.20 +
            frames_pct * 0.15
        )
        return round(min(1.0, confidence), 3)

    def _compute_calibration_boost(self, session: ScanSession) -> float:
        """Compute how much this scan should boost calibration confidence.

        A perfect scan (100% coverage, all objects mapped, accurate dimensions)
        can boost calibration to 100% when combined with CSI cross-analysis.
        """
        base_boost = session.scan_confidence

        # Bonus for having many diverse objects (better CSI mapping)
        categories = {o.category for o in session.objects}
        diversity_bonus = min(0.1, len(categories) * 0.015)

        # Bonus for accurate room dimensions
        dim_bonus = session.room_dimensions.confidence * 0.1

        total = min(1.0, base_boost + diversity_bonus + dim_bonus)
        return round(total, 3)

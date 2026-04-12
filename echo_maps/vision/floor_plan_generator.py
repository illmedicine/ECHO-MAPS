"""Floor Plan Generator — auto-creates floor plans from room scan data.

Takes the detected objects and room dimensions from a RoomScanner session
and generates a FloorPlan with positioned furniture/fixtures suitable for
the LiveFloorPlanMap and FloorPlanEditor components.

The generated layout cross-references CSI reflection data so the AI engine
can map RF signatures to specific physical objects in the room.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from typing import Sequence

import structlog

from echo_maps.vision.room_scanner import (
    DetectedObject,
    ObjectCategory,
    RoomDimensions,
    ScanSession,
)

logger = structlog.get_logger()


@dataclass
class FloorPlanObject:
    """A furniture/fixture item positioned on the floor plan."""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    category: str = "unknown"
    label: str = ""
    # Position on the floor plan (metres from top-left origin)
    x: float = 0.0
    y: float = 0.0
    # Footprint dimensions (metres)
    width: float = 0.5
    height: float = 0.5  # depth on the 2D plan
    # Rotation in degrees (0 = default orientation)
    rotation: float = 0.0
    confidence: float = 0.0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "category": self.category,
            "label": self.label,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "width": round(self.width, 2),
            "height": round(self.height, 2),
            "rotation": round(self.rotation, 1),
            "confidence": round(self.confidence, 3),
        }


@dataclass
class GeneratedFloorPlan:
    """Complete auto-generated floor plan from room scan."""
    environment_id: str = ""
    room_width: float = 5.0
    room_length: float = 4.0
    room_height: float = 2.7
    objects: list[FloorPlanObject] = field(default_factory=list)
    walls: list[dict] = field(default_factory=list)
    doors: list[dict] = field(default_factory=list)
    windows: list[dict] = field(default_factory=list)
    scan_confidence: float = 0.0
    dimensions_confidence: float = 0.0

    @property
    def is_fully_mapped(self) -> bool:
        """True when scan+dimensions are confident enough for 100% calibration."""
        return (
            self.scan_confidence >= 0.90
            and self.dimensions_confidence >= 0.80
            and len(self.objects) >= 2
        )

    def to_dict(self) -> dict:
        return {
            "environment_id": self.environment_id,
            "room_width": round(self.room_width, 2),
            "room_length": round(self.room_length, 2),
            "room_height": round(self.room_height, 2),
            "objects": [o.to_dict() for o in self.objects],
            "walls": self.walls,
            "doors": self.doors,
            "windows": self.windows,
            "is_fully_mapped": self.is_fully_mapped,
            "scan_confidence": round(self.scan_confidence, 3),
            "dimensions_confidence": round(self.dimensions_confidence, 3),
        }


# ── Icons / emoji for floor plan rendering ─────────────────────────────────

OBJECT_ICONS: dict[str, str] = {
    "couch": "🛋️",
    "sofa": "🛋️",
    "bed": "🛏️",
    "tv": "📺",
    "table": "🪑",
    "desk": "💻",
    "chair": "🪑",
    "toilet": "🚽",
    "bathtub": "🛁",
    "sink": "🚰",
    "refrigerator": "🧊",
    "oven": "🍳",
    "microwave": "📦",
    "bookshelf": "📚",
    "wardrobe": "🚪",
    "nightstand": "🛏️",
    "dining_table": "🍽️",
    "cabinet": "🗄️",
    "door": "🚪",
    "window": "🪟",
    "lamp": "💡",
    "plant": "🌿",
    "washer": "🫧",
    "dryer": "🌀",
}


class FloorPlanGenerator:
    """Generates floor plans from completed room scans.

    Transforms scanner-centric polar coordinates into a top-down 2D layout
    with furniture footprints suitable for rendering in the floor plan editor.
    """

    def generate(self, session: ScanSession) -> GeneratedFloorPlan:
        """Generate a floor plan from a completed scan session.

        Coordinate transform: Scanner is at room centre. Detected objects
        have positions relative to scanner. We shift to top-left origin
        for the floor plan coordinate system.
        """
        dims = session.room_dimensions
        plan = GeneratedFloorPlan(
            environment_id=session.environment_id,
            room_width=dims.width,
            room_length=dims.length,
            room_height=dims.height,
            scan_confidence=session.scan_confidence,
            dimensions_confidence=dims.confidence,
        )

        # Scanner is at centre of room
        cx = dims.width / 2
        cz = dims.length / 2

        for det_obj in session.objects:
            fp_obj = self._object_to_floor_plan(det_obj, cx, cz, dims)
            if fp_obj is not None:
                plan.objects.append(fp_obj)

        # Extract doors and windows as special items
        plan.doors = [
            o.to_dict() for o in plan.objects
            if o.category == ObjectCategory.DOOR.value
        ]
        plan.windows = [
            o.to_dict() for o in plan.objects
            if o.category == ObjectCategory.WINDOW.value
        ]

        # Generate wall segments
        plan.walls = self._generate_walls(dims)

        logger.info(
            "floor_plan_generated",
            environment_id=session.environment_id,
            objects=len(plan.objects),
            fully_mapped=plan.is_fully_mapped,
        )

        return plan

    def _object_to_floor_plan(
        self,
        det: DetectedObject,
        center_x: float,
        center_z: float,
        dims: RoomDimensions,
    ) -> FloorPlanObject | None:
        """Transform a detected object to floor plan coordinates."""
        # Convert from scanner-relative to floor plan (top-left origin)
        x = center_x + det.position[0]
        y = center_z + det.position[2]

        # Clamp to room bounds with small margin
        margin = 0.1
        x = max(margin, min(x, dims.width - margin))
        y = max(margin, min(y, dims.length - margin))

        # Object footprint (width, depth on 2D plan)
        obj_width = det.dimensions[0]
        obj_depth = det.dimensions[2]

        # Determine rotation: objects against walls face inward
        rotation = self._snap_to_wall_rotation(x, y, dims)

        label = det.label or det.category.value.replace("_", " ").title()
        icon = OBJECT_ICONS.get(det.category.value, "📦")

        return FloorPlanObject(
            id=det.id,
            category=det.category.value,
            label=f"{icon} {label}",
            x=round(x - obj_width / 2, 2),  # position is top-left of object
            y=round(y - obj_depth / 2, 2),
            width=round(obj_width, 2),
            height=round(obj_depth, 2),
            rotation=rotation,
            confidence=det.confidence,
        )

    @staticmethod
    def _snap_to_wall_rotation(x: float, y: float, dims: RoomDimensions) -> float:
        """Determine object rotation based on proximity to walls.

        Objects near walls are typically oriented facing the room centre.
        """
        wall_threshold = 0.5  # metres from wall
        if y < wall_threshold:
            return 180.0   # near top wall → face down
        if y > dims.length - wall_threshold:
            return 0.0     # near bottom wall → face up
        if x < wall_threshold:
            return 90.0    # near left wall → face right
        if x > dims.width - wall_threshold:
            return 270.0   # near right wall → face left
        return 0.0

    @staticmethod
    def _generate_walls(dims: RoomDimensions) -> list[dict]:
        """Generate wall line segments for the floor plan."""
        return [
            {"from": [0, 0], "to": [dims.width, 0], "label": "North"},
            {"from": [dims.width, 0], "to": [dims.width, dims.length], "label": "East"},
            {"from": [dims.width, dims.length], "to": [0, dims.length], "label": "South"},
            {"from": [0, dims.length], "to": [0, 0], "label": "West"},
        ]

    def to_environment_floor_plan(
        self,
        plan: GeneratedFloorPlan,
        environment_id: str,
    ) -> dict:
        """Convert to the format expected by the FloorPlan DB model and frontend.

        Returns a dict matching FloorPlan.rooms_json structure with objects
        embedded as a new `objects` array alongside room definitions.
        """
        return {
            "environment_id": environment_id,
            "width": plan.room_width,
            "height": plan.room_length,  # floor plan "height" = room length (top-down)
            "rooms_json": {
                "objects": [o.to_dict() for o in plan.objects],
                "walls": plan.walls,
                "doors": plan.doors,
                "windows": plan.windows,
                "dimensions": {
                    "width": plan.room_width,
                    "length": plan.room_length,
                    "height": plan.room_height,
                },
                "scan_confidence": plan.scan_confidence,
                "is_fully_mapped": plan.is_fully_mapped,
            },
        }

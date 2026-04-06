"""CSI Anchor Protocol — BLE MAC tethering via RF Signature anchors.

The CSI RF Signature is the immutable identity anchor.  BLE MAC addresses
are ephemeral accessories that get tethered/untethered as devices rotate
their private addresses.

Protocol overview:
  1. Tethered Mode  — each TrackedPerson has a BLE MAC linked via RSSI overlap
  2. Drop Event     — MAC disappears; person persists as [Awaiting_New_MAC]
  3. Spawn & Bound  — new MAC appears; RSSI bounding box drawn around signal
  4. Reassignment   — RSSI footprint overlaps a person's RF position → re-tether
  5. Static Device  — if RSSI can't distinguish, wait for movement to disambiguate
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import numpy as np
import structlog

logger = structlog.get_logger()

# ── Constants ──

RSSI_BOUNDING_RADIUS_M = 1.5      # max distance (meters) for RSSI→position match
TETHER_LOCK_THRESHOLD = 0.85       # RSSI confidence required to lock tether
STALE_MAC_TIMEOUT_S = 2.0          # seconds before a missing MAC triggers drop
SPAWN_WINDOW_S = 5.0               # window after drop to look for replacement MACs
TRAJECTORY_LOCK_MIN_DISTANCE_M = 0.5  # movement needed to resolve static ambiguity
TRAJECTORY_LOCK_MIN_SAMPLES = 5    # consecutive co-moving samples to confirm tether
RSSI_PATH_LOSS_EXPONENT = 2.5      # indoor BLE path-loss exponent (typical)
RSSI_REF_DISTANCE_M = 1.0          # reference distance for RSSI → distance model
RSSI_REF_DBM = -59                 # typical RSSI at 1m for BLE


class TetherStatus(str, Enum):
    """Current state of a person↔device tether."""
    TETHERED = "tethered"                # MAC locked to person
    AWAITING_NEW_MAC = "awaiting_new_mac"  # MAC rotated; person persists
    UNASSIGNED = "unassigned"            # MAC exists but not linked to anyone
    TRAJECTORY_LOCK = "trajectory_lock"  # co-movement confirmation in progress


class BLEDeviceCategory(str, Enum):
    """Classification of BLE device type for tether eligibility."""
    PHONE = "phone"
    TABLET = "tablet"
    LAPTOP = "laptop"
    ACCESSORY = "accessory"
    BEACON = "beacon"
    HUB = "hub"
    UNKNOWN = "unknown"


# Device-name patterns for classification heuristics
_PHONE_PATTERNS = frozenset({
    "iphone", "pixel", "galaxy s", "oneplus", "samsung sm-",
    "huawei", "xiaomi", "oppo", "vivo", "moto g", "moto e",
    "nothing phone", "asus zenfone",
})
_LAPTOP_PATTERNS = frozenset({
    "surface", "macbook", "thinkpad", "laptop", "dell xps",
    "chromebook", "lenovo", "hp envy", "spectre", "zenbook",
})
_ACCESSORY_PATTERNS = frozenset({
    "airpods", "buds", "earbuds", "watch", "band", "fitbit",
    "jabra", "bose", "sony wf-", "sony wh-", "beats",
})
_HUB_PATTERNS = frozenset({
    "nest hub", "echo show", "echo dot", "homepod", "portal",
    "smart display", "nest mini", "google home",
})
_TABLET_PATTERNS = frozenset({
    "ipad", "galaxy tab", "fire hd", "surface go", "tab s",
})


def classify_ble_device(
    device_name: str = "",
    device_os: str = "",
    address_type: str = "random",
    company_id: str = "",
) -> BLEDeviceCategory:
    """Classify a BLE device into a category based on its advertisement data.

    Priority: exact match on name patterns > OS heuristics > address type.
    Used to determine whether a device is eligible for person tethering
    (only phones qualify).
    """
    name_lower = device_name.lower() if device_name else ""

    for pattern in _HUB_PATTERNS:
        if pattern in name_lower:
            return BLEDeviceCategory.HUB

    for pattern in _ACCESSORY_PATTERNS:
        if pattern in name_lower:
            return BLEDeviceCategory.ACCESSORY

    for pattern in _LAPTOP_PATTERNS:
        if pattern in name_lower:
            return BLEDeviceCategory.LAPTOP

    for pattern in _TABLET_PATTERNS:
        if pattern in name_lower:
            return BLEDeviceCategory.TABLET

    for pattern in _PHONE_PATTERNS:
        if pattern in name_lower:
            return BLEDeviceCategory.PHONE

    # OS heuristics
    os_lower = device_os.lower() if device_os else ""
    if os_lower == "windows":
        return BLEDeviceCategory.LAPTOP

    # Random-address iOS/Android without specific name → likely phone
    if address_type == "random" and os_lower in ("ios", "android"):
        return BLEDeviceCategory.PHONE

    # Public-address Android → likely hub/smart device
    if address_type == "public" and os_lower == "android":
        return BLEDeviceCategory.HUB

    return BLEDeviceCategory.UNKNOWN


@dataclass
class BLEScan:
    """A single BLE advertisement seen by the bridge."""
    mac: str
    rssi: int             # dBm
    timestamp: float      # time.time()
    device_name: str = ""
    is_random: bool = True  # randomized MAC (most iOS/Android devices)


@dataclass
class DeviceTether:
    """Links a BLE MAC address to a tracked person's RF anchor."""
    mac: str
    track_id: str
    status: TetherStatus
    rssi_history: list[int] = field(default_factory=list)
    estimated_distance_m: float = 0.0
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    co_movement_score: float = 0.0    # trajectory correlation [0, 1]
    position_history: list[np.ndarray] = field(default_factory=list)

    @property
    def avg_rssi(self) -> float:
        if not self.rssi_history:
            return -100.0
        # Exponential moving average over recent readings
        recent = self.rssi_history[-10:]
        weights = np.exp(np.linspace(-1, 0, len(recent)))
        return float(np.average(recent, weights=weights))


@dataclass
class UnassignedMAC:
    """A newly spawned MAC that hasn't been linked to any person yet."""
    mac: str
    rssi_history: list[int] = field(default_factory=list)
    estimated_position: Optional[np.ndarray] = None
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    position_history: list[np.ndarray] = field(default_factory=list)
    device_name: str = ""
    is_random: bool = True
    device_category: Optional[str] = None  # cached BLEDeviceCategory value


@dataclass
class BLEBeacon:
    """A BLE device configured as a stationary location beacon.

    Beacons are accessories (e.g. AirPods plugged in under a counter) that
    are intentionally left in a fixed position to anchor room detection.
    The engine uses their consistent RSSI to confirm room boundaries.
    """
    mac: str
    device_name: str
    manufacturer: str
    location_name: str            # e.g. "Kitchen"
    room_id: str                  # linked room id
    rssi_baseline: float          # expected RSSI when stationary
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    rssi_history: list[int] = field(default_factory=list)

    @property
    def is_present(self) -> bool:
        """Check if beacon was seen recently (within 30s)."""
        return time.time() - self.last_seen < 30.0


def rssi_to_distance(rssi_dbm: int) -> float:
    """Estimate distance from RSSI using log-distance path-loss model.

    d = d0 * 10^((RSSI_ref - RSSI) / (10 * n))
    """
    if rssi_dbm >= RSSI_REF_DBM:
        return 0.1  # very close
    exponent = (RSSI_REF_DBM - rssi_dbm) / (10.0 * RSSI_PATH_LOSS_EXPONENT)
    return RSSI_REF_DISTANCE_M * (10.0 ** exponent)


class BLETetherEngine:
    """Manages the spatiotemporal re-acquisition loop for BLE MAC ↔ RF Signature.

    The CSI RF blob is the "anchor" — the BLE MAC is a volatile accessory.
    When MACs rotate, the engine uses RSSI bounding + trajectory correlation
    to seamlessly re-tether the new MAC to the correct person.
    """

    def __init__(self, bridge_position: np.ndarray | None = None) -> None:
        # Active tethers: track_id → DeviceTether
        self._tethers: dict[str, DeviceTether] = {}
        # MAC → track_id reverse lookup
        self._mac_to_track: dict[str, str] = {}
        # Unassigned MACs waiting for tether
        self._unassigned: dict[str, UnassignedMAC] = {}
        # Tracks in "awaiting new MAC" state: track_id → drop_timestamp
        self._awaiting: dict[str, float] = {}
        # Bridge device position (for RSSI→position triangulation)
        self._bridge_pos = bridge_position if bridge_position is not None else np.zeros(3)
        # History of all BLE scans for trajectory analysis
        self._scan_history: list[BLEScan] = []
        # Beacons: mac → BLEBeacon (stationary location anchors)
        self._beacons: dict[str, BLEBeacon] = {}
        # Device category cache: mac → BLEDeviceCategory
        self._device_categories: dict[str, BLEDeviceCategory] = {}

    @property
    def tethers(self) -> dict[str, DeviceTether]:
        return self._tethers

    @property
    def awaiting_tracks(self) -> set[str]:
        return set(self._awaiting.keys())

    @property
    def beacons(self) -> dict[str, BLEBeacon]:
        """All registered location beacons."""
        return self._beacons

    # ──────────────────────────────────────────────────────────
    # Beacon Management
    # ──────────────────────────────────────────────────────────

    def register_beacon(
        self,
        mac: str,
        device_name: str,
        manufacturer: str,
        location_name: str,
        room_id: str,
        rssi_baseline: float = -50.0,
    ) -> BLEBeacon:
        """Register a BLE accessory as a stationary location beacon.

        Once registered, this MAC is excluded from person tethering and
        instead used to confirm room boundaries and physical locations.
        """
        beacon = BLEBeacon(
            mac=mac,
            device_name=device_name,
            manufacturer=manufacturer,
            location_name=location_name,
            room_id=room_id,
            rssi_baseline=rssi_baseline,
        )
        self._beacons[mac] = beacon
        # Remove from unassigned/tether pools if present
        self._unassigned.pop(mac, None)
        if mac in self._mac_to_track:
            track_id = self._mac_to_track.pop(mac)
            self._tethers.pop(track_id, None)
        self._device_categories[mac] = BLEDeviceCategory.BEACON
        logger.info(
            "beacon_registered",
            mac=mac[-8:],
            location=location_name,
            device=device_name,
        )
        return beacon

    def unregister_beacon(self, mac: str) -> bool:
        """Remove a beacon registration."""
        if mac in self._beacons:
            del self._beacons[mac]
            self._device_categories.pop(mac, None)
            return True
        return False

    def _classify_device(self, scan: BLEScan) -> BLEDeviceCategory:
        """Classify a BLE scan's device and cache the result."""
        if scan.mac in self._device_categories:
            return self._device_categories[scan.mac]
        category = classify_ble_device(
            device_name=scan.device_name,
            address_type="random" if scan.is_random else "public",
        )
        self._device_categories[scan.mac] = category
        return category

    def is_phone_device(self, scan: BLEScan) -> bool:
        """Check if a BLE scan is from a phone (eligible for tethering)."""
        return self._classify_device(scan) == BLEDeviceCategory.PHONE

    # ──────────────────────────────────────────────────────────
    # Step 1: Ingest BLE scan data from bridge
    # ──────────────────────────────────────────────────────────

    def ingest_ble_scan(
        self,
        scans: list[BLEScan],
        tracked_positions: dict[str, np.ndarray],
    ) -> list[dict]:
        """Process a batch of BLE advertisement scans from the bridge.

        Args:
            scans: BLE advertisements received in this cycle
            tracked_positions: {track_id: (3,) position} of all currently
                              tracked persons from the CSI engine

        Returns:
            List of tether events (for logging / API)
        """
        now = time.time()
        events: list[dict] = []

        seen_macs = set()
        for scan in scans:
            seen_macs.add(scan.mac)
            self._scan_history.append(scan)

            # Skip beacons — stationary location markers, not person devices
            if scan.mac in self._beacons:
                beacon = self._beacons[scan.mac]
                beacon.last_seen = now
                beacon.rssi_history.append(scan.rssi)
                if len(beacon.rssi_history) > 50:
                    beacon.rssi_history = beacon.rssi_history[-25:]
                continue

            # Classify the device
            category = self._classify_device(scan)

            # Only phone devices are eligible for person tethering.
            # Laptops, hubs, accessories, tablets are inventoried but not tethered.
            if category not in (BLEDeviceCategory.PHONE, BLEDeviceCategory.UNKNOWN):
                logger.debug(
                    "ble_non_phone_skipped",
                    mac=scan.mac[-8:],
                    category=category.value,
                    device_name=scan.device_name,
                )
                continue

            # Is this MAC already tethered?
            if scan.mac in self._mac_to_track:
                track_id = self._mac_to_track[scan.mac]
                tether = self._tethers.get(track_id)
                if tether:
                    tether.rssi_history.append(scan.rssi)
                    tether.last_seen = now
                    tether.estimated_distance_m = rssi_to_distance(scan.rssi)
                    # Track RSSI-estimated position for trajectory analysis
                    if track_id in tracked_positions:
                        tether.position_history.append(
                            tracked_positions[track_id].copy()
                        )
                        # Keep bounded history
                        if len(tether.position_history) > 100:
                            tether.position_history = tether.position_history[-50:]
                        if len(tether.rssi_history) > 100:
                            tether.rssi_history = tether.rssi_history[-50:]
                continue

            # New MAC — add to unassigned pool
            if scan.mac not in self._unassigned:
                self._unassigned[scan.mac] = UnassignedMAC(
                    mac=scan.mac,
                    first_seen=now,
                    device_name=scan.device_name,
                    is_random=scan.is_random,
                    device_category=category.value,
                )
                events.append({
                    "event": "mac_spawned",
                    "mac": scan.mac,
                    "rssi": scan.rssi,
                    "timestamp": now,
                })

            entry = self._unassigned[scan.mac]
            entry.rssi_history.append(scan.rssi)
            entry.last_seen = now
            if len(entry.rssi_history) > 50:
                entry.rssi_history = entry.rssi_history[-25:]

        # ── Step 2: Detect drop events ──
        drop_events = self._detect_drops(seen_macs, now)
        events.extend(drop_events)

        # ── Step 3: Attempt re-tethering for awaiting tracks ──
        retether_events = self._attempt_retether(tracked_positions, now)
        events.extend(retether_events)

        # ── Step 4: Attempt initial tethering for new tracks ──
        initial_events = self._attempt_initial_tether(tracked_positions, now)
        events.extend(initial_events)

        # ── Step 5: Prune stale unassigned MACs ──
        self._prune_stale(now)

        # Keep scan history bounded
        if len(self._scan_history) > 500:
            self._scan_history = self._scan_history[-250:]

        return events

    # ──────────────────────────────────────────────────────────
    # Step 2: Drop detection
    # ──────────────────────────────────────────────────────────

    def _detect_drops(self, seen_macs: set[str], now: float) -> list[dict]:
        """Detect when tethered MACs disappear (MAC rotation)."""
        events = []
        for track_id, tether in list(self._tethers.items()):
            if tether.mac not in seen_macs:
                time_since = now - tether.last_seen
                if time_since > STALE_MAC_TIMEOUT_S:
                    # MAC has rotated — enter awaiting state
                    old_mac = tether.mac
                    self._mac_to_track.pop(old_mac, None)
                    del self._tethers[track_id]
                    self._awaiting[track_id] = now

                    events.append({
                        "event": "mac_dropped",
                        "track_id": track_id,
                        "old_mac": old_mac,
                        "status": TetherStatus.AWAITING_NEW_MAC.value,
                        "timestamp": now,
                    })
                    logger.info(
                        "ble_mac_dropped",
                        track_id=track_id,
                        old_mac=old_mac[-8:],  # log only suffix for privacy
                        time_since=round(time_since, 2),
                    )
        return events

    # ──────────────────────────────────────────────────────────
    # Step 3: Spatiotemporal re-acquisition (the core protocol)
    # ──────────────────────────────────────────────────────────

    def _attempt_retether(
        self,
        tracked_positions: dict[str, np.ndarray],
        now: float,
    ) -> list[dict]:
        """Attempt to re-tether new MACs to tracks awaiting a replacement.

        Uses RSSI bounding: estimate the new MAC's position via RSSI,
        then check which awaiting track's RF position falls inside the
        bounding radius.
        """
        events = []
        if not self._awaiting or not self._unassigned:
            return events

        # Build candidate list: unassigned MACs with enough RSSI readings
        candidates: list[tuple[str, float, float]] = []  # (mac, avg_rssi, est_dist)
        for mac, entry in self._unassigned.items():
            if len(entry.rssi_history) < 2:
                continue
            recent = entry.rssi_history[-10:]
            avg_rssi = float(np.mean(recent))
            est_dist = rssi_to_distance(int(avg_rssi))
            candidates.append((mac, avg_rssi, est_dist))

        if not candidates:
            return events

        # For each awaiting track, find the best MAC candidate
        resolved = []
        for track_id, drop_time in list(self._awaiting.items()):
            if now - drop_time > SPAWN_WINDOW_S * 3:
                # Too long — give up waiting, the device may have left
                del self._awaiting[track_id]
                events.append({
                    "event": "mac_wait_expired",
                    "track_id": track_id,
                    "timestamp": now,
                })
                continue

            person_pos = tracked_positions.get(track_id)
            if person_pos is None:
                continue

            best_mac = None
            best_score = -1.0

            for mac, avg_rssi, est_dist in candidates:
                if mac in self._mac_to_track:
                    continue  # already claimed

                # RSSI bounding: is the estimated distance consistent with
                # the person being near the bridge?
                person_dist_to_bridge = float(np.linalg.norm(person_pos - self._bridge_pos))

                # The MAC's RSSI-estimated distance should be close to the
                # person's actual distance to the bridge
                distance_error = abs(est_dist - person_dist_to_bridge)

                if distance_error < RSSI_BOUNDING_RADIUS_M:
                    # Score: lower distance error = better match
                    # Also factor in timing (prefer MACs that spawned right after drop)
                    spawn_entry = self._unassigned[mac]
                    timing_score = max(0, 1.0 - (spawn_entry.first_seen - drop_time) / SPAWN_WINDOW_S)
                    distance_score = max(0, 1.0 - distance_error / RSSI_BOUNDING_RADIUS_M)
                    score = 0.6 * distance_score + 0.4 * timing_score

                    if score > best_score and score > 0.3:
                        best_score = score
                        best_mac = mac

            if best_mac is not None:
                # Check if there's ambiguity (another awaiting track also matches)
                other_matches = 0
                for other_tid in self._awaiting:
                    if other_tid == track_id:
                        continue
                    other_pos = tracked_positions.get(other_tid)
                    if other_pos is None:
                        continue
                    other_dist = float(np.linalg.norm(other_pos - self._bridge_pos))
                    mac_entry = self._unassigned[best_mac]
                    mac_dist = rssi_to_distance(int(np.mean(mac_entry.rssi_history[-10:])))
                    if abs(mac_dist - other_dist) < RSSI_BOUNDING_RADIUS_M:
                        other_matches += 1

                if other_matches > 0:
                    # Ambiguous — enter trajectory lock mode (wait for movement)
                    events.append({
                        "event": "mac_ambiguous",
                        "track_id": track_id,
                        "mac": best_mac,
                        "other_candidates": other_matches,
                        "status": TetherStatus.TRAJECTORY_LOCK.value,
                        "timestamp": now,
                    })
                    # Don't assign yet — let trajectory resolution handle it
                    continue

                # Unambiguous — lock the tether
                resolved.append((track_id, best_mac, best_score))

        # Apply resolved tethers
        for track_id, mac, score in resolved:
            self._lock_tether(track_id, mac, now)
            del self._awaiting[track_id]
            self._unassigned.pop(mac, None)
            events.append({
                "event": "mac_retethered",
                "track_id": track_id,
                "new_mac": mac,
                "score": round(score, 3),
                "status": TetherStatus.TETHERED.value,
                "timestamp": now,
            })
            logger.info(
                "ble_mac_retethered",
                track_id=track_id,
                new_mac=mac[-8:],
                score=round(score, 3),
            )

        return events

    # ──────────────────────────────────────────────────────────
    # Step 4: Initial tethering (first-time device discovery)
    # ──────────────────────────────────────────────────────────

    def _attempt_initial_tether(
        self,
        tracked_positions: dict[str, np.ndarray],
        now: float,
    ) -> list[dict]:
        """Try to tether unassigned MACs to tracks that have no device."""
        events = []

        # Find tracks without any tether
        untethered_tracks = set(tracked_positions.keys()) - set(self._tethers.keys()) - self._awaiting.keys()

        for track_id in untethered_tracks:
            person_pos = tracked_positions[track_id]
            person_dist = float(np.linalg.norm(person_pos - self._bridge_pos))

            best_mac = None
            best_error = float("inf")

            for mac, entry in self._unassigned.items():
                if mac in self._mac_to_track:
                    continue
                # Only phone devices are eligible for person tethering
                if entry.device_category and entry.device_category != BLEDeviceCategory.PHONE.value:
                    continue
                if len(entry.rssi_history) < 3:
                    continue

                avg_rssi = float(np.mean(entry.rssi_history[-10:]))
                est_dist = rssi_to_distance(int(avg_rssi))
                error = abs(est_dist - person_dist)

                if error < RSSI_BOUNDING_RADIUS_M and error < best_error:
                    best_error = error
                    best_mac = mac

            if best_mac is not None:
                self._lock_tether(track_id, best_mac, now)
                self._unassigned.pop(best_mac, None)
                events.append({
                    "event": "mac_initial_tether",
                    "track_id": track_id,
                    "mac": best_mac,
                    "distance_error": round(best_error, 3),
                    "status": TetherStatus.TETHERED.value,
                    "timestamp": now,
                })
                logger.info(
                    "ble_initial_tether",
                    track_id=track_id,
                    mac=best_mac[-8:],
                    distance_error=round(best_error, 3),
                )

        return events

    # ──────────────────────────────────────────────────────────
    # Step 5: Trajectory-based disambiguation (coffee table scenario)
    # ──────────────────────────────────────────────────────────

    def resolve_by_trajectory(
        self,
        mac: str,
        tracked_positions: dict[str, np.ndarray],
        candidate_track_ids: list[str],
    ) -> Optional[str]:
        """Resolve ambiguous MAC→person assignment using co-movement.

        When two people are near each other (e.g., phones on a table)
        and MACs rotate, RSSI alone can't distinguish ownership.
        Wait until one person moves with the device, then assign
        based on trajectory correlation.

        Returns the track_id of the matched person, or None if still ambiguous.
        """
        entry = self._unassigned.get(mac)
        if entry is None or len(entry.position_history) < TRAJECTORY_LOCK_MIN_SAMPLES:
            return None

        # Estimate MAC position trajectory from RSSI changes
        mac_distances = [rssi_to_distance(r) for r in entry.rssi_history[-TRAJECTORY_LOCK_MIN_SAMPLES:]]
        mac_moving = max(mac_distances) - min(mac_distances) > TRAJECTORY_LOCK_MIN_DISTANCE_M

        if not mac_moving:
            return None  # device is stationary; can't disambiguate yet

        # Check which person's trajectory correlates with the MAC's RSSI changes
        best_track = None
        best_correlation = -1.0

        for track_id in candidate_track_ids:
            positions = tracked_positions.get(track_id)
            if positions is None:
                continue

            # Get person's distance-to-bridge trajectory
            tether = self._tethers.get(track_id)
            if tether and len(tether.position_history) >= TRAJECTORY_LOCK_MIN_SAMPLES:
                person_distances = [
                    float(np.linalg.norm(p - self._bridge_pos))
                    for p in tether.position_history[-TRAJECTORY_LOCK_MIN_SAMPLES:]
                ]
            else:
                continue

            # Correlate distance changes
            if len(person_distances) >= TRAJECTORY_LOCK_MIN_SAMPLES and len(mac_distances) >= TRAJECTORY_LOCK_MIN_SAMPLES:
                # Normalize both series
                pd = np.array(person_distances[-TRAJECTORY_LOCK_MIN_SAMPLES:])
                md = np.array(mac_distances[-TRAJECTORY_LOCK_MIN_SAMPLES:])
                pd = (pd - pd.mean()) / (pd.std() + 1e-8)
                md = (md - md.mean()) / (md.std() + 1e-8)
                correlation = float(np.dot(pd, md) / len(pd))

                if correlation > best_correlation:
                    best_correlation = correlation
                    best_track = track_id

        if best_track is not None and best_correlation > 0.6:
            logger.info(
                "ble_trajectory_resolved",
                mac=mac[-8:],
                track_id=best_track,
                correlation=round(best_correlation, 3),
            )
            return best_track

        return None

    # ──────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────

    def _lock_tether(self, track_id: str, mac: str, now: float) -> None:
        """Create a hard tether between a MAC and a tracked person."""
        tether = DeviceTether(
            mac=mac,
            track_id=track_id,
            status=TetherStatus.TETHERED,
            first_seen=now,
            last_seen=now,
        )
        self._tethers[track_id] = tether
        self._mac_to_track[mac] = track_id

    def _prune_stale(self, now: float) -> None:
        """Remove unassigned MACs that haven't been seen recently."""
        stale = [
            mac for mac, entry in self._unassigned.items()
            if now - entry.last_seen > STALE_MAC_TIMEOUT_S * 5
        ]
        for mac in stale:
            del self._unassigned[mac]

    def remove_track(self, track_id: str) -> None:
        """Clean up tether state when a track is pruned."""
        tether = self._tethers.pop(track_id, None)
        if tether:
            self._mac_to_track.pop(tether.mac, None)
        self._awaiting.pop(track_id, None)

    def get_tether_snapshot(self) -> list[dict]:
        """Get current tether state for all tracked persons."""
        snapshot = []
        for track_id, tether in self._tethers.items():
            snapshot.append({
                "track_id": track_id,
                "mac_suffix": tether.mac[-8:],  # privacy: only last 8 chars
                "status": tether.status.value,
                "estimated_distance_m": round(tether.estimated_distance_m, 2),
                "avg_rssi": round(tether.avg_rssi, 1),
                "co_movement_score": round(tether.co_movement_score, 3),
            })

        # Add awaiting tracks
        for track_id in self._awaiting:
            snapshot.append({
                "track_id": track_id,
                "mac_suffix": None,
                "status": TetherStatus.AWAITING_NEW_MAC.value,
                "estimated_distance_m": None,
                "avg_rssi": None,
                "co_movement_score": None,
            })

        return snapshot

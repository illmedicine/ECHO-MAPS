"use client";

import { scopedKey, scheduleSyncPush, type NetworkFingerprint } from "./cloudSync";

// Track which keys have already been through recovery so we don't scan repeatedly
const _recoveredKeys = new Set<string>();

// Scoped localStorage wrappers — keys auto-scope to current user, writes trigger cloud sync
function _get(key: string): string | null {
  const raw = localStorage.getItem(scopedKey(key));
  if (raw) return raw;

  // Scoped key is empty — try recovery (once per key per session)
  if (_recoveredKeys.has(key)) return null;
  _recoveredKeys.add(key);

  const currentKey = scopedKey(key);
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    // Match both unscoped (exact) and any user-scoped variant
    if (k !== key && !k.startsWith(`${key}::`)) continue;
    if (k === currentKey) continue; // already tried
    const value = localStorage.getItem(k);
    if (!value) continue;
    try {
      const parsed = JSON.parse(value);
      const hasData = Array.isArray(parsed) ? parsed.length > 0 : (typeof parsed === "object" && parsed !== null && Object.keys(parsed).length > 0);
      if (hasData) {
        // Adopt data into the current user's scope
        localStorage.setItem(currentKey, value);
        return value;
      }
    } catch { /* skip corrupt */ }
  }
  return null;
}
function _set(key: string, value: string): void { localStorage.setItem(scopedKey(key), value); scheduleSyncPush(); }
function _remove(key: string): void { localStorage.removeItem(scopedKey(key)); scheduleSyncPush(); }

/**
 * Environment & Room CRUD backed by localStorage.
 *
 * Hierarchy:
 *   EchoEnvironment (Home, Work, School, Friend's House)
 *     └── Environment (Room: Kitchen, Bedroom, Office — each calibrated separately)
 *
 * All storage keys are scoped to the logged-in user's Google ID.
 * When a backend is configured, changes are auto-synced to the cloud.
 */

/* ── Top-level environment (container) ── */

export type EnvCategory = "home" | "work" | "school" | "friend" | "business" | "other";

export interface EchoEnvironment {
  id: string;
  name: string;
  category: EnvCategory;
  emoji?: string;
  address?: string;
  networkFingerprint?: NetworkFingerprint;
  createdAt: string;
}

export type { NetworkFingerprint };

const ENV_STORAGE_KEY = "echo_vue_environments";

export function getEchoEnvironments(): EchoEnvironment[] {
  if (typeof window === "undefined") return [];
  const raw = _get(ENV_STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function getEchoEnvironment(id: string): EchoEnvironment | null {
  return getEchoEnvironments().find((e) => e.id === id) ?? null;
}

export function updateEchoEnvironment(id: string, updates: Partial<Omit<EchoEnvironment, "id" | "createdAt">>): EchoEnvironment | null {
  const envs = getEchoEnvironments();
  const idx = envs.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  envs[idx] = { ...envs[idx], ...updates };
  _set(ENV_STORAGE_KEY, JSON.stringify(envs));
  return envs[idx];
}

export function createEchoEnvironment(data: Pick<EchoEnvironment, "name" | "category" | "address" | "emoji">): EchoEnvironment {
  const envs = getEchoEnvironments();
  const env: EchoEnvironment = {
    id: crypto.randomUUID(),
    name: data.name,
    category: data.category,
    emoji: data.emoji,
    address: data.address,
    createdAt: new Date().toISOString(),
  };
  envs.push(env);
  _set(ENV_STORAGE_KEY, JSON.stringify(envs));
  return env;
}

export function deleteEchoEnvironment(id: string): boolean {
  const envs = getEchoEnvironments();
  const filtered = envs.filter((e) => e.id !== id);
  if (filtered.length === envs.length) return false;
  _set(ENV_STORAGE_KEY, JSON.stringify(filtered));
  // Also delete all rooms in this environment
  const rooms = getEnvironments().filter((r) => r.environmentId === id);
  rooms.forEach((r) => deleteEnvironment(r.id));
  return true;
}

/* ── Room (per-room, calibrated individually) ── */

export interface Environment {
  id: string;
  environmentId?: string;  // parent EchoEnvironment id
  name: string;
  type: "home" | "office" | "clinic" | "kitchen" | "bedroom" | "living_room" | "bathroom" | "patio" | "garage" | "factory" | "other";
  dimensions: { width: number; length: number; height: number };
  emoji?: string;
  isCalibrated: boolean;
  calibrationConfidence: number;
  createdAt: string;
  updatedAt: string;
  bridgeId: string | null;
}

export interface ActivityLogEntry {
  timestamp: number;
  activity: string;
  breathingRate: number | null;
  heartRate: number | null;
  position: [number, number, number];
}

const STORAGE_KEY = "echo_maps_environments";
const ACTIVITY_KEY_PREFIX = "echo_maps_activity_";

const DEFAULT_DIMS = { width: 5, length: 4, height: 2.7 };

// ── CRUD ──

export function getEnvironments(): Environment[] {
  if (typeof window === "undefined") return [];
  const raw = _get(STORAGE_KEY);
  const envs: Environment[] = raw ? JSON.parse(raw) : [];
  return envs.map((e) => ({ ...e, dimensions: e.dimensions ?? DEFAULT_DIMS }));
}

export function getEnvironment(id: string): Environment | null {
  const env = getEnvironments().find((e) => e.id === id) ?? null;
  if (env && !env.dimensions) env.dimensions = DEFAULT_DIMS;
  return env;
}

export function createEnvironment(
  data: Pick<Environment, "name" | "type" | "dimensions"> & { environmentId?: string; emoji?: string }
): Environment {
  const envs = getEnvironments();
  const now = new Date().toISOString();
  const env: Environment = {
    id: crypto.randomUUID(),
    environmentId: data.environmentId,
    name: data.name,
    type: data.type,
    dimensions: data.dimensions,
    emoji: data.emoji,
    isCalibrated: false,
    calibrationConfidence: 0,
    createdAt: now,
    updatedAt: now,
    bridgeId: null,
  };
  envs.push(env);
  _set(STORAGE_KEY, JSON.stringify(envs));
  return env;
}

export function updateEnvironment(
  id: string,
  updates: Partial<Omit<Environment, "id" | "createdAt">>
): Environment | null {
  const envs = getEnvironments();
  const idx = envs.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  envs[idx] = { ...envs[idx], ...updates, updatedAt: new Date().toISOString() };
  _set(STORAGE_KEY, JSON.stringify(envs));
  return envs[idx];
}

export function deleteEnvironment(id: string): boolean {
  const envs = getEnvironments();
  const filtered = envs.filter((e) => e.id !== id);
  if (filtered.length === envs.length) return false;
  _set(STORAGE_KEY, JSON.stringify(filtered));
  _remove(ACTIVITY_KEY_PREFIX + id);
  return true;
}

export function getRoomsForEnvironment(envId: string): Environment[] {
  return getEnvironments().filter((e) => e.environmentId === envId);
}

// ── Activity Log ──

export function getActivityLog(envId: string): ActivityLogEntry[] {
  if (typeof window === "undefined") return [];
  const raw = _get(ACTIVITY_KEY_PREFIX + envId);
  return raw ? JSON.parse(raw) : [];
}

export function appendActivityLog(envId: string, entry: ActivityLogEntry): void {
  const log = getActivityLog(envId);
  log.push(entry);
  // Keep last 500 entries
  const trimmed = log.slice(-500);
  _set(ACTIVITY_KEY_PREFIX + envId, JSON.stringify(trimmed));
}

// ── Simulated Data Generation ──

export function generateSimulatedVitals(): {
  breathingRate: number;
  heartRate: number;
  activity: string;
} {
  const activities = ["standing", "walking", "sitting", "resting"];
  return {
    breathingRate: 14 + Math.random() * 6,       // 14-20 BPM
    heartRate: 62 + Math.random() * 20,           // 62-82 BPM
    activity: activities[Math.floor(Math.random() * activities.length)],
  };
}

export function generateHeatmapData(
  dims: Environment["dimensions"],
  hours: number = 24
): { x: number; z: number; intensity: number }[] {
  const data: { x: number; z: number; intensity: number }[] = [];
  const gridX = Math.ceil(dims.width);
  const gridZ = Math.ceil(dims.length);

  for (let x = 0; x < gridX; x++) {
    for (let z = 0; z < gridZ; z++) {
      // Higher intensity near center and doorways
      const cx = dims.width / 2;
      const cz = dims.length / 2;
      const distFromCenter = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
      const baseIntensity = Math.max(0, 1 - distFromCenter / Math.max(dims.width, dims.length));
      const noise = Math.random() * 0.3;

      data.push({
        x: x + 0.5,
        z: z + 0.5,
        intensity: Math.min(1, baseIntensity + noise),
      });
    }
  }
  return data;
}

// ── Environment Type Icons ──
export const ENV_TYPE_ICONS: Record<Environment["type"], string> = {
  home: "🏠",
  office: "🏢",
  clinic: "🏥",
  kitchen: "🍳",
  bedroom: "🛏️",
  living_room: "🛋️",
  bathroom: "🚿",
  patio: "☀️",
  garage: "🚗",
  factory: "🏭",
  other: "📍",
};

/* ══════════════════════════════════════════════
   Device Corrections & MAC Prefix Database
   ══════════════════════════════════════════════ */

/**
 * User-corrected device identities.
 * Keyed by BLE fingerprint (companyId|addrType or bleDeviceName|bleManufacturer).
 * When a correction exists, the presence engine applies it instead of the
 * auto-detected identity on every scan.
 */
export interface DeviceCorrection {
  /** Original auto-detected name */
  originalName: string;
  /** User-corrected display name */
  correctedName: string;
  /** User-corrected manufacturer */
  correctedManufacturer: string;
  /** User-corrected category */
  correctedCategory: "phone" | "tablet" | "laptop" | "accessory" | "hub" | "router" | "unknown";
  /** User-corrected OS */
  correctedOS: "iOS" | "Android" | "Windows" | "Other" | null;
  /** User-assigned room ID (null = auto-detect) */
  correctedRoomId: string | null;
  /** User-assigned room name */
  correctedRoomName: string | null;
  /** Emoji override */
  correctedEmoji: string;
  /** BLE company ID for fingerprinting */
  companyId: string | null;
  /** Timestamp of correction */
  createdAt: string;
}

const DEVICE_CORRECTIONS_KEY = "echo_vue_device_corrections";

export function getDeviceCorrections(): Record<string, DeviceCorrection> {
  if (typeof window === "undefined") return {};
  const raw = _get(DEVICE_CORRECTIONS_KEY);
  return raw ? JSON.parse(raw) : {};
}

export function setDeviceCorrection(fingerprint: string, correction: DeviceCorrection): void {
  const corrections = getDeviceCorrections();
  corrections[fingerprint] = correction;
  _set(DEVICE_CORRECTIONS_KEY, JSON.stringify(corrections));
}

export function removeDeviceCorrection(fingerprint: string): void {
  const corrections = getDeviceCorrections();
  delete corrections[fingerprint];
  _set(DEVICE_CORRECTIONS_KEY, JSON.stringify(corrections));
}

/** Build a fingerprint key from a beacon entity's BLE fields */
export function getDeviceFingerprint(entity: TrackedEntity): string {
  // Primary: bleDeviceName + bleManufacturer (most specific)
  if (entity.bleDeviceName && entity.bleManufacturer) {
    return `${entity.bleDeviceName}|${entity.bleManufacturer}`;
  }
  // Fallback: companyId + addressType
  if (entity.bleCompanyId) {
    return `${entity.bleCompanyId}|${entity.bleAddressType || "unknown"}`;
  }
  return entity.id;
}

/**
 * MAC prefix / BLE Company ID → Manufacturer mapping.
 * Used to improve auto-detection when a device's companyId is known
 * but the BLE advertisement name is ambiguous.
 */
export const MAC_PREFIX_DB: Record<string, { manufacturer: string; commonDevices: string[] }> = {
  "0x004C": { manufacturer: "Apple Inc.", commonDevices: ["iPhone", "iPad", "Apple Watch", "AirPods", "HomePod", "MacBook"] },
  "0x00E0": { manufacturer: "Google LLC", commonDevices: ["Pixel Phone", "Pixel Watch", "Nest Hub", "Chromecast"] },
  "0x0075": { manufacturer: "Samsung Electronics", commonDevices: ["Galaxy Phone", "Galaxy Watch", "Galaxy Buds", "SmartThings Hub"] },
  "0x0006": { manufacturer: "Microsoft Corp.", commonDevices: ["Surface Pro", "Xbox", "Surface Headphones"] },
  "0x0171": { manufacturer: "Amazon/Blink", commonDevices: ["Echo Dot", "Blink Camera", "Ring Doorbell", "Fire TV"] },
  "0x038F": { manufacturer: "OnePlus Technology", commonDevices: ["OnePlus Phone", "OnePlus Buds"] },
  "0x0059": { manufacturer: "Nordic Semiconductor", commonDevices: ["Fitness Tracker", "BLE Beacon", "Smart Lock"] },
  "0x000D": { manufacturer: "Texas Instruments", commonDevices: ["Sensor Tag", "BLE Module"] },
  "0x01DA": { manufacturer: "Garmin International", commonDevices: ["Garmin GPS", "Garmin Watch", "Garmin Hub Screen"] },
  "0x0087": { manufacturer: "Garmin International", commonDevices: ["Garmin Forerunner", "Garmin Edge", "Garmin inReach"] },
  "0x02E5": { manufacturer: "Meta Platforms", commonDevices: ["Meta Quest Pro", "Meta Quest 3", "Ray-Ban Meta"] },
  "0x030B": { manufacturer: "Google (Fitbit)", commonDevices: ["Pixel Watch", "Fitbit Sense", "Fitbit Charge"] },
};

/* ══════════════════════════════════════════════
   WiFi Router Anchor — known TX position & orientation
   for CSI-based distance / AoA triangulation
   ══════════════════════════════════════════════ */

/**
 * Physical position and orientation of the WiFi router within its room.
 * All coordinates are in metres relative to the room's top-left corner.
 * `orientation` is the compass bearing (degrees) the router faces (0 = North, 90 = East).
 */
export interface RouterAnchor {
  /** Which beacon entity this maps to */
  entityId: string;
  /** Room the router is in */
  roomId: string;
  /** Floor-plan room ID for coordinate mapping */
  floorPlanRoomId: string | null;
  /** X position within the room (metres from room left edge) */
  roomX: number;
  /** Y position within the room (metres from room top edge) */
  roomY: number;
  /** Absolute X on the floor plan (metres from origin) — computed */
  absoluteX: number;
  /** Absolute Y on the floor plan (metres from origin) — computed */
  absoluteY: number;
  /** Compass bearing the router faces in degrees (0=N, 90=E, 180=S, 270=W) */
  orientationDeg: number;
  /** Transmit power in dBm (typical home router: 20 dBm) */
  txPowerDbm: number;
  /** WiFi frequency band in GHz */
  frequencyGhz: number;
  /** Antenna count (for MIMO) */
  antennaCount: number;
  /** User label */
  label: string;
  createdAt: string;
  updatedAt: string;
}

const ROUTER_ANCHOR_KEY = "echo_vue_router_anchor";

export function getRouterAnchor(): RouterAnchor | null {
  if (typeof window === "undefined") return null;
  const raw = _get(ROUTER_ANCHOR_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setRouterAnchor(anchor: RouterAnchor): void {
  _set(ROUTER_ANCHOR_KEY, JSON.stringify(anchor));
}

export function removeRouterAnchor(): void {
  _remove(ROUTER_ANCHOR_KEY);
}

/**
 * Estimate distance from the router to a point using the log-distance path loss model.
 * RSSI (dBm) = TxPower - 10 * n * log10(d) where n ≈ 2.7–3.5 indoors.
 * Returns distance in metres.
 */
export function estimateDistanceFromRouter(rssiDbm: number, txPowerDbm: number = 20, pathLossExponent: number = 3.0): number {
  // d = 10 ^ ((TxPower - RSSI) / (10 * n))
  const distance = Math.pow(10, (txPowerDbm - rssiDbm) / (10 * pathLossExponent));
  return Math.round(distance * 100) / 100; // round to cm precision
}

/**
 * Given the router's known position/orientation and an estimated distance,
 * compute the set of possible (x, y) positions on the floor plan.
 * Returns an arc of candidate positions biased by the router's facing direction.
 */
export function computeSignalArc(
  router: RouterAnchor,
  distanceM: number,
  arcSpreadDeg: number = 120,
  steps: number = 12,
): Array<{ x: number; y: number; weight: number }> {
  const points: Array<{ x: number; y: number; weight: number }> = [];
  const centerRad = (router.orientationDeg * Math.PI) / 180;
  const spreadRad = (arcSpreadDeg * Math.PI) / 180;
  const halfSpread = spreadRad / 2;

  for (let i = 0; i < steps; i++) {
    const angle = centerRad - halfSpread + (spreadRad * i) / (steps - 1);
    // Floor plan Y increases downward, so sin is negated for "north = up"
    const x = router.absoluteX + distanceM * Math.sin(angle);
    const y = router.absoluteY - distanceM * Math.cos(angle);
    // Weight: strongest at center of arc (router's facing direction)
    const deviation = Math.abs(angle - centerRad);
    const weight = Math.cos(deviation) * 0.5 + 0.5; // 0.5 – 1.0 range
    points.push({ x, y, weight });
  }
  return points;
}

/* ══════════════════════════════════════════════
   Tracked Entity Persistence
   ══════════════════════════════════════════════ */

export interface TrackedEntity {
  id: string;
  name: string;
  type: "person" | "pet";
  emoji: string;
  rfSignature: string;
  roomId: string;
  location: string;
  status: "active" | "away";
  confidence: number;
  activity: string;
  breathingRate: number | null;
  heartRate: number | null;
  lastSeen: string;
  deviceMacSuffix: string | null;
  deviceTetherStatus: string;
  deviceRssi: number | null;
  deviceDistanceM: number | null;
  bleDeviceName: string | null;
  bleAddressType: "public" | "random" | null;
  bleManufacturer: string | null;
  bleDeviceOS: "iOS" | "Android" | "Windows" | "Other" | null;
  bleCompanyId: string | null;
  bleDeviceCategory: "phone" | "tablet" | "laptop" | "accessory" | "beacon" | "hub" | "router" | "unknown" | null;
  isBeacon: boolean;
  beaconLocationName: string | null;
  createdAt: string;
  updatedAt: string;
}

const ENTITY_STORAGE_KEY = "echo_vue_entities";

export function getEntities(): TrackedEntity[] {
  if (typeof window === "undefined") return [];
  const raw = _get(ENTITY_STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function getEntity(id: string): TrackedEntity | null {
  return getEntities().find((e) => e.id === id) ?? null;
}

export function createEntity(data: Pick<TrackedEntity, "name" | "type" | "emoji" | "roomId" | "location">): TrackedEntity {
  const entities = getEntities();
  const sigNum = (entities.length + 1).toString(16).toUpperCase().padStart(4, "0");
  const entity: TrackedEntity = {
    id: crypto.randomUUID(),
    name: data.name,
    type: data.type,
    emoji: data.emoji,
    rfSignature: `RF-${sigNum}`,
    roomId: data.roomId,
    location: data.location || "Unassigned",
    status: "away",
    confidence: 0,
    activity: "Unknown",
    breathingRate: null,
    heartRate: null,
    lastSeen: "Never",
    deviceMacSuffix: null,
    deviceTetherStatus: "none",
    deviceRssi: null,
    deviceDistanceM: null,
    bleDeviceName: null,
    bleAddressType: null,
    bleManufacturer: null,
    bleDeviceOS: null,
    bleCompanyId: null,
    bleDeviceCategory: null,
    isBeacon: false,
    beaconLocationName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  entities.push(entity);
  _set(ENTITY_STORAGE_KEY, JSON.stringify(entities));
  return entity;
}

export function updateEntity(id: string, updates: Partial<Omit<TrackedEntity, "id" | "createdAt">>): TrackedEntity | null {
  const entities = getEntities();
  const idx = entities.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  entities[idx] = { ...entities[idx], ...updates, updatedAt: new Date().toISOString() };
  _set(ENTITY_STORAGE_KEY, JSON.stringify(entities));
  return entities[idx];
}

export function deleteEntity(id: string): boolean {
  const entities = getEntities();
  const filtered = entities.filter((e) => e.id !== id);
  if (filtered.length === entities.length) return false;
  _set(ENTITY_STORAGE_KEY, JSON.stringify(filtered));
  return true;
}

/* ══════════════════════════════════════════════
   Household Profile & Visitor Tracking
   ══════════════════════════════════════════════ */

export interface HouseholdMember {
  entityId: string;
  role: "owner" | "household";
}

export interface VisitorRecord {
  id: string;
  name: string;
  emoji: string;
  /** BLE device fingerprint for recurring recognition */
  bleDeviceName: string | null;
  bleManufacturer: string | null;
  bleDeviceOS: "iOS" | "Android" | "Windows" | "Other" | null;
  bleCompanyId: string | null;
  firstSeen: string;
  lastSeen: string;
  visitCount: number;
  /** Associated entity id when actively present */
  entityId: string | null;
}

const HOUSEHOLD_KEY = "echo_vue_household";
const VISITOR_KEY = "echo_vue_visitors";

export function getHousehold(): HouseholdMember[] {
  if (typeof window === "undefined") return [];
  const raw = _get(HOUSEHOLD_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function setHousehold(members: HouseholdMember[]): void {
  _set(HOUSEHOLD_KEY, JSON.stringify(members));
}

export function addHouseholdMember(entityId: string, role: HouseholdMember["role"] = "household"): void {
  const members = getHousehold();
  if (members.find((m) => m.entityId === entityId)) return;
  members.push({ entityId, role });
  setHousehold(members);
}

export function removeHouseholdMember(entityId: string): void {
  setHousehold(getHousehold().filter((m) => m.entityId !== entityId));
}

export function isHouseholdMember(entityId: string): boolean {
  return getHousehold().some((m) => m.entityId === entityId);
}

export function getVisitors(): VisitorRecord[] {
  if (typeof window === "undefined") return [];
  const raw = _get(VISITOR_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function upsertVisitor(data: Omit<VisitorRecord, "id" | "firstSeen" | "visitCount"> & { id?: string }): VisitorRecord {
  const visitors = getVisitors();
  // Try to match by BLE fingerprint for recurring recognition
  const existing = data.bleDeviceName && data.bleManufacturer
    ? visitors.find((v) => v.bleDeviceName === data.bleDeviceName && v.bleManufacturer === data.bleManufacturer)
    : data.id ? visitors.find((v) => v.id === data.id) : null;
  if (existing) {
    existing.lastSeen = data.lastSeen;
    existing.visitCount++;
    existing.entityId = data.entityId;
    if (data.name && data.name !== existing.name) existing.name = data.name;
    _set(VISITOR_KEY, JSON.stringify(visitors));
    return existing;
  }
  const visitor: VisitorRecord = {
    id: crypto.randomUUID(),
    name: data.name,
    emoji: data.emoji,
    bleDeviceName: data.bleDeviceName,
    bleManufacturer: data.bleManufacturer,
    bleDeviceOS: data.bleDeviceOS,
    bleCompanyId: data.bleCompanyId,
    firstSeen: new Date().toISOString(),
    lastSeen: data.lastSeen,
    visitCount: 1,
    entityId: data.entityId,
  };
  visitors.push(visitor);
  _set(VISITOR_KEY, JSON.stringify(visitors));
  return visitor;
}

export function clearVisitorEntity(visitorId: string): void {
  const visitors = getVisitors();
  const v = visitors.find((vis) => vis.id === visitorId);
  if (v) { v.entityId = null; _set(VISITOR_KEY, JSON.stringify(visitors)); }
}

/* ── Calibration Activity Prompts ── */

export interface CalibrationActivity {
  id: string;
  label: string;
  instruction: string;
  durationSec: number;
  icon: string;
}

export const CALIBRATION_ACTIVITIES: CalibrationActivity[] = [
  { id: "walk_perimeter",  label: "Walk the perimeter",     instruction: "Walk slowly along every wall so Echo Vue can map the room boundaries.", durationSec: 30, icon: "🚶" },
  { id: "walk_center",     label: "Walk through center",    instruction: "Walk through the center of the room at a normal pace.",                 durationSec: 20, icon: "🚶‍♂️" },
  { id: "stand_still",     label: "Stand still",            instruction: "Stand in the center of the room and breathe normally.",                 durationSec: 15, icon: "🧍" },
  { id: "sit_down",        label: "Sit down",               instruction: "Sit in a chair or on the couch — let Echo Vue learn seated posture.",  durationSec: 15, icon: "🪑" },
  { id: "wave_arms",       label: "Wave your arms",         instruction: "Move your arms in different directions to help calibrate motion.",      durationSec: 10, icon: "🙋" },
  { id: "lie_down",        label: "Lie down / rest",        instruction: "Lie on a bed or couch — this teaches resting/sleeping patterns.",       durationSec: 15, icon: "🛏️" },
  { id: "use_device",      label: "Use phone / computer",   instruction: "Sit and interact with a device to capture subtle movement.",            durationSec: 15, icon: "💻" },
  { id: "pet_interact",    label: "Interact with a pet",    instruction: "If a pet is nearby, interact with it so Echo Vue can distinguish.",    durationSec: 10, icon: "🐕" },
];

/* ══════════════════════════════════════════════
   Floor Plan Management
   ══════════════════════════════════════════════ */

export interface FloorPlanRoom {
  id: string;
  label: string;
  type: Environment["type"];
  /** Rectangle: x, y are top-left in metres from origin; w, h are width/height in metres */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A detected object placed on the floor plan via room scanning. */
export interface FloorPlanObject {
  id: string;
  category: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  confidence: number;
}

export interface FloorPlan {
  id: string;
  environmentId: string;
  /** Overall footprint in metres */
  width: number;
  height: number;
  rooms: FloorPlanRoom[];
  /** Auto-detected objects from room scanner */
  objects?: FloorPlanObject[];
  /** Room scan metadata */
  scanConfidence?: number;
  isFullyMapped?: boolean;
  createdAt: string;
  updatedAt: string;
}

const FLOOR_PLAN_KEY = "echo_vue_floor_plans";

export function getFloorPlans(): FloorPlan[] {
  if (typeof window === "undefined") return [];
  const raw = _get(FLOOR_PLAN_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function getFloorPlan(environmentId: string): FloorPlan | null {
  return getFloorPlans().find((fp) => fp.environmentId === environmentId) ?? null;
}

export function saveFloorPlan(environmentId: string, width: number, height: number, rooms: FloorPlanRoom[]): FloorPlan {
  const plans = getFloorPlans();
  const now = new Date().toISOString();
  const idx = plans.findIndex((fp) => fp.environmentId === environmentId);

  const plan: FloorPlan = {
    id: idx >= 0 ? plans[idx].id : crypto.randomUUID(),
    environmentId,
    width,
    height,
    rooms,
    createdAt: idx >= 0 ? plans[idx].createdAt : now,
    updatedAt: now,
  };

  if (idx >= 0) {
    plans[idx] = plan;
  } else {
    plans.push(plan);
  }
  _set(FLOOR_PLAN_KEY, JSON.stringify(plans));

  // Override existing rooms: delete old rooms for this environment, create from floor plan
  const existingRooms = getEnvironments().filter((r) => r.environmentId === environmentId);
  existingRooms.forEach((r) => deleteEnvironment(r.id));

  for (const fpRoom of rooms) {
    createEnvironment({
      name: fpRoom.label,
      type: fpRoom.type,
      dimensions: { width: fpRoom.w, length: fpRoom.h, height: 2.7 },
      environmentId,
    });
  }

  return plan;
}

export function deleteFloorPlan(environmentId: string): boolean {
  const plans = getFloorPlans();
  const filtered = plans.filter((fp) => fp.environmentId !== environmentId);
  if (filtered.length === plans.length) return false;
  _set(FLOOR_PLAN_KEY, JSON.stringify(filtered));
  return true;
}

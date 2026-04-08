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

export function generateSimulatedPointCloud(
  dims: Environment["dimensions"],
  density: number = 200
): number[][] {
  const points: number[][] = [];
  for (let i = 0; i < density; i++) {
    points.push([
      Math.random() * dims.width,
      Math.random() * dims.height * 0.3, // mostly floor-level
      Math.random() * dims.length,
    ]);
  }
  // Add wall outlines
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    // Front wall
    points.push([t * dims.width, Math.random() * dims.height, 0]);
    // Back wall
    points.push([t * dims.width, Math.random() * dims.height, dims.length]);
    // Left wall
    points.push([0, Math.random() * dims.height, t * dims.length]);
    // Right wall
    points.push([dims.width, Math.random() * dims.height, t * dims.length]);
  }
  return points;
}

/**
 * Generate a point cloud from real skeleton keypoints — scatters points around
 * detected body positions to simulate the CSI signal reflection pattern that
 * a real WiFi CSI sensor array would produce for this body configuration.
 */
export function generatePointCloudFromSkeleton(
  skeleton: number[][],
  dims: Environment["dimensions"],
  density: number = 180
): number[][] {
  const points: number[][] = [];
  if (!skeleton || skeleton.length < 33) return generateSimulatedPointCloud(dims, density);

  // Wall structure points (always visible — these represent room boundaries)
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    points.push([t * dims.width, Math.random() * dims.height, 0]);
    points.push([t * dims.width, Math.random() * dims.height, dims.length]);
    points.push([0, Math.random() * dims.height, t * dims.length]);
    points.push([dims.width, Math.random() * dims.height, t * dims.length]);
  }

  // Body reflection points — scattered around each keypoint
  // Denser near torso (larger signal reflection), sparser at extremities
  const torsoIndices = [0, 11, 12, 23, 24]; // head, shoulders, hips
  const limbIndices = [13, 14, 15, 16, 25, 26, 27, 28]; // elbows, wrists, knees, ankles
  const extremityIndices = [7, 8, 17, 18, 19, 20, 21, 22, 29, 30, 31, 32]; // ears, fingers, toes

  const scatter = (kp: number[], radius: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const r = Math.random() * radius;
      points.push([
        kp[0] + r * Math.sin(phi) * Math.cos(theta),
        Math.max(0, kp[1] + r * Math.sin(phi) * Math.sin(theta)),
        kp[2] + r * Math.cos(phi),
      ]);
    }
  };

  // Dense scatter around torso (strong signal reflection)
  for (const idx of torsoIndices) {
    if (skeleton[idx]) scatter(skeleton[idx], 0.25, 8);
  }
  // Medium scatter around limbs
  for (const idx of limbIndices) {
    if (skeleton[idx]) scatter(skeleton[idx], 0.15, 4);
  }
  // Light scatter around extremities
  for (const idx of extremityIndices) {
    if (skeleton[idx]) scatter(skeleton[idx], 0.1, 2);
  }

  // Floor reflection points beneath the person (signal multipath)
  const hipCenter = [
    (skeleton[23][0] + skeleton[24][0]) / 2,
    0,
    (skeleton[23][2] + skeleton[24][2]) / 2,
  ];
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 0.8;
    points.push([
      hipCenter[0] + Math.cos(angle) * dist,
      Math.random() * 0.05,
      hipCenter[2] + Math.sin(angle) * dist,
    ]);
  }

  return points;
}

export function generateSimulatedSkeleton(
  dims: Environment["dimensions"],
  time: number = 0
): number[][] {
  // Simulate a person walking around the room with natural body mechanics
  const walkSpeed = 0.4;
  const pathRadius = Math.min(dims.width, dims.length) * 0.25;
  const cx = dims.width / 2 + Math.sin(time * walkSpeed) * pathRadius;
  const cz = dims.length / 2 + Math.cos(time * walkSpeed * 0.7) * pathRadius * 0.8;
  const baseY = 0;

  // Walking cycle — gait frequency
  const gaitFreq = 2.5; // steps per second
  const gaitPhase = time * gaitFreq;
  const walkCycle = Math.sin(gaitPhase * Math.PI);
  const walkCycleR = Math.sin(gaitPhase * Math.PI + Math.PI); // opposite phase

  // Subtle vertical bob from walking
  const bobY = Math.abs(Math.sin(gaitPhase * Math.PI)) * 0.02;

  // Torso sway — slight lateral shift per step
  const sway = Math.sin(gaitPhase * Math.PI) * 0.03;

  // Breathing — subtle chest expansion
  const breathCycle = Math.sin(time * 1.0) * 0.008; // ~15 bpm

  // 33 MediaPipe keypoints with natural walking motion
  const keypoints: number[][] = [];

  // Head (0-10) — slight head bob and turn
  const headTurn = Math.sin(time * 0.3) * 0.02;
  keypoints[0] = [cx + headTurn, baseY + 1.7 + bobY, cz];                    // nose
  keypoints[1] = [cx - 0.03 + headTurn, baseY + 1.75 + bobY, cz - 0.02];    // left eye inner
  keypoints[2] = [cx - 0.06 + headTurn, baseY + 1.75 + bobY, cz - 0.02];    // left eye
  keypoints[3] = [cx - 0.09 + headTurn, baseY + 1.75 + bobY, cz - 0.02];    // left eye outer
  keypoints[4] = [cx + 0.03 + headTurn, baseY + 1.75 + bobY, cz - 0.02];    // right eye inner
  keypoints[5] = [cx + 0.06 + headTurn, baseY + 1.75 + bobY, cz - 0.02];    // right eye
  keypoints[6] = [cx + 0.09 + headTurn, baseY + 1.75 + bobY, cz - 0.02];    // right eye outer
  keypoints[7] = [cx - 0.12 + headTurn, baseY + 1.72 + bobY, cz];            // left ear
  keypoints[8] = [cx + 0.12 + headTurn, baseY + 1.72 + bobY, cz];            // right ear
  keypoints[9] = [cx - 0.04 + headTurn, baseY + 1.65 + bobY, cz + 0.02];    // mouth left
  keypoints[10] = [cx + 0.04 + headTurn, baseY + 1.65 + bobY, cz + 0.02];   // mouth right

  // Shoulders (11-12) — sway with gait + breathing expansion
  keypoints[11] = [cx - 0.2 + sway - breathCycle, baseY + 1.45 + bobY, cz];  // left shoulder
  keypoints[12] = [cx + 0.2 + sway + breathCycle, baseY + 1.45 + bobY, cz];  // right shoulder

  // Arms (13-22) — natural arm swing opposite to legs
  const armSwingL = walkCycleR * 0.2;  // left arm swings with right leg
  const armSwingR = walkCycle * 0.2;    // right arm swings with left leg
  const armBendL = 0.15 + Math.abs(armSwingL) * 0.1; // elbow bend increases with swing
  const armBendR = 0.15 + Math.abs(armSwingR) * 0.1;

  keypoints[13] = [cx - 0.3 + sway, baseY + 1.2 + bobY, cz + armSwingL];           // left elbow
  keypoints[14] = [cx + 0.3 + sway, baseY + 1.2 + bobY, cz + armSwingR];           // right elbow
  keypoints[15] = [cx - 0.32 + sway, baseY + 1.0 + bobY - armBendL, cz + armSwingL * 1.3]; // left wrist
  keypoints[16] = [cx + 0.32 + sway, baseY + 1.0 + bobY - armBendR, cz + armSwingR * 1.3]; // right wrist
  keypoints[17] = [cx - 0.33 + sway, baseY + 0.95 + bobY - armBendL, cz + armSwingL * 1.35]; // left pinky
  keypoints[18] = [cx + 0.33 + sway, baseY + 0.95 + bobY - armBendR, cz + armSwingR * 1.35]; // right pinky
  keypoints[19] = [cx - 0.34 + sway, baseY + 0.96 + bobY - armBendL, cz + armSwingL * 1.32]; // left index
  keypoints[20] = [cx + 0.34 + sway, baseY + 0.96 + bobY - armBendR, cz + armSwingR * 1.32]; // right index
  keypoints[21] = [cx - 0.32 + sway, baseY + 0.97 + bobY - armBendL, cz + armSwingL * 1.28]; // left thumb
  keypoints[22] = [cx + 0.32 + sway, baseY + 0.97 + bobY - armBendR, cz + armSwingR * 1.28]; // right thumb

  // Hips (23-24) — sway with walking
  keypoints[23] = [cx - 0.12 + sway * 0.5, baseY + 0.9 + bobY * 0.5, cz];  // left hip
  keypoints[24] = [cx + 0.12 + sway * 0.5, baseY + 0.9 + bobY * 0.5, cz];  // right hip

  // Legs (25-32) — natural walking gait cycle
  const legStrideL = walkCycle * 0.25;   // left leg stride
  const legStrideR = walkCycleR * 0.25;  // right leg stride (opposite)
  const kneeBendL = Math.max(0, walkCycle) * 0.12;   // knee lifts on forward swing
  const kneeBendR = Math.max(0, walkCycleR) * 0.12;
  const footLiftL = Math.max(0, Math.sin(gaitPhase * Math.PI)) * 0.08;
  const footLiftR = Math.max(0, Math.sin(gaitPhase * Math.PI + Math.PI)) * 0.08;

  keypoints[25] = [cx - 0.12, baseY + 0.48 + kneeBendL, cz + legStrideL * 0.5];  // left knee
  keypoints[26] = [cx + 0.12, baseY + 0.48 + kneeBendR, cz + legStrideR * 0.5];  // right knee
  keypoints[27] = [cx - 0.12, baseY + 0.05 + footLiftL, cz + legStrideL];         // left ankle
  keypoints[28] = [cx + 0.12, baseY + 0.05 + footLiftR, cz + legStrideR];         // right ankle
  keypoints[29] = [cx - 0.12, baseY + 0.02 + footLiftL * 0.5, cz + legStrideL - 0.05]; // left heel
  keypoints[30] = [cx + 0.12, baseY + 0.02 + footLiftR * 0.5, cz + legStrideR - 0.05]; // right heel
  keypoints[31] = [cx - 0.12, baseY + 0.0 + footLiftL * 0.3, cz + legStrideL + 0.1];   // left foot index
  keypoints[32] = [cx + 0.12, baseY + 0.0 + footLiftR * 0.3, cz + legStrideR + 0.1];   // right foot index

  return keypoints;
}

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
   Camera Management
   ══════════════════════════════════════════════ */

export interface Camera {
  id: string;
  label: string;              // user-facing name, e.g. "OBS Virtual Camera"
  deviceId: string;           // MediaDevices deviceId
  roomId: string;             // linked Environment (room) id
  environmentId: string;      // parent EchoEnvironment id
  emoji?: string;             // custom emoji avatar
  active: boolean;            // currently streaming / tuning
  createdAt: string;
}

const CAMERA_STORAGE_KEY = "echo_vue_cameras";

export function getCameras(): Camera[] {
  if (typeof window === "undefined") return [];
  const raw = _get(CAMERA_STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function getCamerasForRoom(roomId: string): Camera[] {
  return getCameras().filter((c) => c.roomId === roomId);
}

export function getCamerasForEnvironment(envId: string): Camera[] {
  return getCameras().filter((c) => c.environmentId === envId);
}

export function addCamera(data: Omit<Camera, "id" | "createdAt">): Camera {
  const cams = getCameras();
  const cam: Camera = { ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  cams.push(cam);
  _set(CAMERA_STORAGE_KEY, JSON.stringify(cams));
  return cam;
}

export function updateCamera(id: string, updates: Partial<Omit<Camera, "id" | "createdAt">>): Camera | null {
  const cams = getCameras();
  const idx = cams.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  cams[idx] = { ...cams[idx], ...updates };
  _set(CAMERA_STORAGE_KEY, JSON.stringify(cams));
  return cams[idx];
}

export function removeCamera(id: string): boolean {
  const cams = getCameras();
  const filtered = cams.filter((c) => c.id !== id);
  if (filtered.length === cams.length) return false;
  _set(CAMERA_STORAGE_KEY, JSON.stringify(filtered));
  return true;
}

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

export interface FloorPlan {
  id: string;
  environmentId: string;
  /** Overall footprint in metres */
  width: number;
  height: number;
  rooms: FloorPlanRoom[];
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

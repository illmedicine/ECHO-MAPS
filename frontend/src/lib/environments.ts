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
  bleDeviceCategory: "phone" | "tablet" | "laptop" | "accessory" | "beacon" | "hub" | "unknown" | null;
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

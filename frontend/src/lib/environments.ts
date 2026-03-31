"use client";

/**
 * Environment CRUD backed by localStorage.
 * When the backend is deployed, swap these functions to hit the API.
 */

export interface Environment {
  id: string;
  name: string;
  type: "home" | "office" | "clinic" | "other";
  dimensions: { width: number; length: number; height: number };
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

// ── CRUD ──

export function getEnvironments(): Environment[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function getEnvironment(id: string): Environment | null {
  return getEnvironments().find((e) => e.id === id) ?? null;
}

export function createEnvironment(
  data: Pick<Environment, "name" | "type" | "dimensions">
): Environment {
  const envs = getEnvironments();
  const now = new Date().toISOString();
  const env: Environment = {
    id: crypto.randomUUID(),
    name: data.name,
    type: data.type,
    dimensions: data.dimensions,
    isCalibrated: false,
    calibrationConfidence: 0,
    createdAt: now,
    updatedAt: now,
    bridgeId: null,
  };
  envs.push(env);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envs));
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envs));
  return envs[idx];
}

export function deleteEnvironment(id: string): boolean {
  const envs = getEnvironments();
  const filtered = envs.filter((e) => e.id !== id);
  if (filtered.length === envs.length) return false;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  localStorage.removeItem(ACTIVITY_KEY_PREFIX + id);
  return true;
}

// ── Activity Log ──

export function getActivityLog(envId: string): ActivityLogEntry[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(ACTIVITY_KEY_PREFIX + envId);
  return raw ? JSON.parse(raw) : [];
}

export function appendActivityLog(envId: string, entry: ActivityLogEntry): void {
  const log = getActivityLog(envId);
  log.push(entry);
  // Keep last 500 entries
  const trimmed = log.slice(-500);
  localStorage.setItem(ACTIVITY_KEY_PREFIX + envId, JSON.stringify(trimmed));
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
  // Simulate a person standing/walking in the room
  const cx = dims.width / 2 + Math.sin(time * 0.5) * 1.5;
  const cz = dims.length / 2 + Math.cos(time * 0.3) * 1.0;
  const baseY = 0;

  // 33 MediaPipe keypoints (simplified — key ones positioned, rest interpolated)
  const keypoints: number[][] = [];

  // Head (0-10)
  keypoints[0] = [cx, baseY + 1.7, cz];                    // nose
  keypoints[1] = [cx - 0.03, baseY + 1.75, cz - 0.02];    // left eye inner
  keypoints[2] = [cx - 0.06, baseY + 1.75, cz - 0.02];    // left eye
  keypoints[3] = [cx - 0.09, baseY + 1.75, cz - 0.02];    // left eye outer
  keypoints[4] = [cx + 0.03, baseY + 1.75, cz - 0.02];    // right eye inner
  keypoints[5] = [cx + 0.06, baseY + 1.75, cz - 0.02];    // right eye
  keypoints[6] = [cx + 0.09, baseY + 1.75, cz - 0.02];    // right eye outer
  keypoints[7] = [cx - 0.12, baseY + 1.72, cz];            // left ear
  keypoints[8] = [cx + 0.12, baseY + 1.72, cz];            // right ear
  keypoints[9] = [cx - 0.04, baseY + 1.65, cz + 0.02];    // mouth left
  keypoints[10] = [cx + 0.04, baseY + 1.65, cz + 0.02];   // mouth right

  // Shoulders (11-12)
  keypoints[11] = [cx - 0.2, baseY + 1.45, cz];            // left shoulder
  keypoints[12] = [cx + 0.2, baseY + 1.45, cz];            // right shoulder

  // Arms (13-22)
  const armSwing = Math.sin(time * 2) * 0.15;
  keypoints[13] = [cx - 0.35, baseY + 1.15 + armSwing, cz];      // left elbow
  keypoints[14] = [cx + 0.35, baseY + 1.15 - armSwing, cz];      // right elbow
  keypoints[15] = [cx - 0.4, baseY + 0.9 + armSwing, cz + 0.05]; // left wrist
  keypoints[16] = [cx + 0.4, baseY + 0.9 - armSwing, cz + 0.05]; // right wrist
  keypoints[17] = [cx - 0.42, baseY + 0.85 + armSwing, cz + 0.06]; // left pinky
  keypoints[18] = [cx + 0.42, baseY + 0.85 - armSwing, cz + 0.06]; // right pinky
  keypoints[19] = [cx - 0.43, baseY + 0.86 + armSwing, cz + 0.04]; // left index
  keypoints[20] = [cx + 0.43, baseY + 0.86 - armSwing, cz + 0.04]; // right index
  keypoints[21] = [cx - 0.41, baseY + 0.87 + armSwing, cz + 0.05]; // left thumb
  keypoints[22] = [cx + 0.41, baseY + 0.87 - armSwing, cz + 0.05]; // right thumb

  // Hips (23-24)
  keypoints[23] = [cx - 0.15, baseY + 0.9, cz];            // left hip
  keypoints[24] = [cx + 0.15, baseY + 0.9, cz];            // right hip

  // Legs (25-32)
  const legSwing = Math.sin(time * 2) * 0.1;
  keypoints[25] = [cx - 0.15, baseY + 0.5 + legSwing, cz + 0.05];  // left knee
  keypoints[26] = [cx + 0.15, baseY + 0.5 - legSwing, cz + 0.05];  // right knee
  keypoints[27] = [cx - 0.15, baseY + 0.05, cz + legSwing * 0.5];  // left ankle
  keypoints[28] = [cx + 0.15, baseY + 0.05, cz - legSwing * 0.5];  // right ankle
  keypoints[29] = [cx - 0.15, baseY + 0.02, cz + 0.1 + legSwing * 0.5]; // left heel
  keypoints[30] = [cx + 0.15, baseY + 0.02, cz + 0.1 - legSwing * 0.5]; // right heel
  keypoints[31] = [cx - 0.15, baseY + 0.0, cz + 0.15 + legSwing * 0.5]; // left foot
  keypoints[32] = [cx + 0.15, baseY + 0.0, cz + 0.15 - legSwing * 0.5]; // right foot

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
  other: "📍",
};

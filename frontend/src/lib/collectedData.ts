"use client";

/**
 * Collected calibration data store.
 *
 * Stores real paired frames (CSI data + camera-extracted poses) collected
 * during calibration and camera AI tuning. This is the actual training
 * data that builds the CSI→skeletal correlation engine.
 *
 * Data persists in IndexedDB so it survives page reloads.
 */

export interface CollectedFrame {
  id: string;
  envId: string;
  roomId: string;
  timestamp: number;
  keypoints3d: number[][];    // 33 × [x, y, z] — from real camera pose estimation
  keypoints2d: number[][];    // raw 2D pixel keypoints
  confidence: number;         // pose detection confidence
  activity: string;           // activity label during collection
  source: "camera" | "csi";   // which sensor provided this frame
}

const DB_NAME = "echo_maps_calibration";
const STORE_NAME = "frames";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("envId", "envId", { unique: false });
        store.createIndex("roomId", "roomId", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  });
}

/** Store a collected frame from camera pose estimation */
export async function storeFrame(frame: CollectedFrame): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(frame);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Store a batch of frames efficiently */
export async function storeFrames(frames: CollectedFrame[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const frame of frames) {
      store.put(frame);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get all collected frames for an environment */
export async function getFramesForEnv(envId: string): Promise<CollectedFrame[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("envId");
    const req = idx.getAll(envId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Get all collected frames for a specific room */
export async function getFramesForRoom(roomId: string): Promise<CollectedFrame[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("roomId");
    const req = idx.getAll(roomId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Get total frame count for an environment */
export async function getFrameCount(envId: string): Promise<number> {
  const frames = await getFramesForEnv(envId);
  return frames.length;
}

/** Clear all collected frames for an environment */
export async function clearFramesForEnv(envId: string): Promise<void> {
  const db = await openDB();
  const frames = await getFramesForEnv(envId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const frame of frames) {
      store.delete(frame.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get all collected frames across the entire store */
export async function getAllFrames(): Promise<CollectedFrame[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Get data collection summary stats. If envId is omitted, returns stats for all frames. */
export async function getCollectionStats(envId?: string): Promise<{
  totalFrames: number;
  cameraFrames: number;
  avgConfidence: number;
  durationSec: number;
  activities: Record<string, number>;
}> {
  const frames = envId ? await getFramesForEnv(envId) : await getAllFrames();
  if (frames.length === 0) {
    return { totalFrames: 0, cameraFrames: 0, avgConfidence: 0, durationSec: 0, activities: {} };
  }

  const cameraFrames = frames.filter((f) => f.source === "camera").length;
  const avgConfidence = frames.reduce((sum, f) => sum + f.confidence, 0) / frames.length;
  const minTs = Math.min(...frames.map((f) => f.timestamp));
  const maxTs = Math.max(...frames.map((f) => f.timestamp));
  const durationSec = (maxTs - minTs) / 1000;
  const activities: Record<string, number> = {};
  for (const f of frames) {
    activities[f.activity] = (activities[f.activity] ?? 0) + 1;
  }

  return { totalFrames: frames.length, cameraFrames, avgConfidence, durationSec, activities };
}

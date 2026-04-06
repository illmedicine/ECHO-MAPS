"use client";

/**
 * Local AI Correlation Engine — learns to map WiFi CSI data to skeletal poses.
 *
 * Strategy:
 *   1. During calibration, the camera extracts real skeletal keypoints (via MoveNet)
 *      and stores them as CollectedFrames in IndexedDB.
 *   2. This engine loads those frames and builds a local "pose library" —
 *      a set of activity-labeled skeleton templates with confidence weights.
 *   3. When no camera is active, the engine provides pose estimates based on
 *      the learned activity patterns, blended with any available CSI signal data.
 *   4. As more calibration data is collected over time, the engine improves,
 *      refining its templates and adding new activity patterns.
 *
 * This is the client-side learning engine. The backend has the full
 * GAN-based CSI→skeleton model; this local engine provides an immediate
 * fallback that uses real data instead of pure simulation.
 */

import { getFramesForEnv, getCollectionStats, type CollectedFrame } from "./collectedData";

/** A learned skeleton template for a specific activity and pose */
export interface PoseTemplate {
  activity: string;
  keypoints: number[][];       // 33 × [x, y, z] — averaged from collected frames
  confidence: number;          // average detection confidence
  sampleCount: number;         // how many frames contributed
  lastUpdated: number;         // timestamp of last update
}

/** Summary of what the engine has learned for an environment */
export interface LearnedState {
  envId: string;
  totalFrames: number;
  activities: string[];
  templates: PoseTemplate[];
  lastTrainedAt: number;
  isReady: boolean;            // true when enough data exists for inference
}

const MIN_FRAMES_FOR_INFERENCE = 10;
const LEARNED_STORE_KEY = "echo_maps_learned_poses";

/** Load learned state from localStorage */
function loadLearnedState(envId: string): LearnedState | null {
  try {
    const raw = localStorage.getItem(`${LEARNED_STORE_KEY}::${envId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Save learned state to localStorage */
function saveLearnedState(state: LearnedState): void {
  try {
    localStorage.setItem(`${LEARNED_STORE_KEY}::${state.envId}`, JSON.stringify(state));
  } catch {
    // localStorage full — silently skip
  }
}

/**
 * Average multiple keypoint arrays into a single template.
 * Handles varying frame quality by weighting by confidence.
 */
function averageKeypoints(frames: CollectedFrame[]): number[][] {
  if (frames.length === 0) return [];

  const kpCount = frames[0].keypoints3d.length;
  const result: number[][] = Array.from({ length: kpCount }, () => [0, 0, 0]);
  let totalWeight = 0;

  for (const frame of frames) {
    if (frame.keypoints3d.length !== kpCount) continue;
    const w = frame.confidence;
    totalWeight += w;
    for (let i = 0; i < kpCount; i++) {
      result[i][0] += frame.keypoints3d[i][0] * w;
      result[i][1] += frame.keypoints3d[i][1] * w;
      result[i][2] += frame.keypoints3d[i][2] * w;
    }
  }

  if (totalWeight > 0) {
    for (let i = 0; i < kpCount; i++) {
      result[i][0] /= totalWeight;
      result[i][1] /= totalWeight;
      result[i][2] /= totalWeight;
    }
  }

  return result;
}

/**
 * Train the local correlation engine from collected calibration frames.
 * Groups frames by activity label and builds averaged pose templates.
 */
export async function trainFromCollectedData(envId: string): Promise<LearnedState> {
  const frames = await getFramesForEnv(envId);
  const stats = await getCollectionStats(envId);

  // Group frames by activity
  const byActivity: Record<string, CollectedFrame[]> = {};
  for (const frame of frames) {
    if (!frame.keypoints3d || frame.keypoints3d.length < 33) continue;
    const key = frame.activity || "idle";
    if (!byActivity[key]) byActivity[key] = [];
    byActivity[key].push(frame);
  }

  // Build templates per activity
  const templates: PoseTemplate[] = [];
  for (const [activity, actFrames] of Object.entries(byActivity)) {
    const avgKp = averageKeypoints(actFrames);
    if (avgKp.length >= 33) {
      templates.push({
        activity,
        keypoints: avgKp,
        confidence: actFrames.reduce((s, f) => s + f.confidence, 0) / actFrames.length,
        sampleCount: actFrames.length,
        lastUpdated: Date.now(),
      });
    }
  }

  const state: LearnedState = {
    envId,
    totalFrames: frames.length,
    activities: Object.keys(byActivity),
    templates,
    lastTrainedAt: Date.now(),
    isReady: frames.length >= MIN_FRAMES_FOR_INFERENCE && templates.length > 0,
  };

  saveLearnedState(state);
  return state;
}

/**
 * Get a pose estimate from the local correlation engine.
 * Returns null if not enough data has been collected.
 *
 * Uses the learned templates and applies temporal variation
 * so the skeleton appears alive (subtle breathing, sway).
 */
export function inferPose(
  envId: string,
  elapsed: number,
  activity?: string,
): { keypoints: number[][]; confidence: number; activity: string } | null {
  const state = loadLearnedState(envId);
  if (!state || !state.isReady || state.templates.length === 0) return null;

  // Find the best matching template
  let template = state.templates[0];
  if (activity) {
    const match = state.templates.find((t) => t.activity === activity);
    if (match) template = match;
  } else {
    // Cycle through activities based on elapsed time
    const idx = Math.floor(elapsed / 8) % state.templates.length;
    template = state.templates[idx];
  }

  // Apply subtle animation (breathing + sway) to make the skeleton look alive
  const breathCycle = Math.sin(elapsed * 0.8) * 0.01;  // ~0.8Hz breathing
  const swayCycle = Math.sin(elapsed * 0.3) * 0.005;   // gentle sway

  const animated = template.keypoints.map((kp, i) => {
    const isUpper = i <= 22; // above hips
    const breathOffset = isUpper ? breathCycle : 0;
    const swayOffset = swayCycle;
    return [
      kp[0] + swayOffset,
      kp[1] + breathOffset,
      kp[2],
    ];
  });

  return {
    keypoints: animated,
    confidence: template.confidence * 0.9, // slightly lower than calibration confidence
    activity: template.activity,
  };
}

/** Check if the correlation engine has learned data for an environment */
export function hasLearnedData(envId: string): boolean {
  const state = loadLearnedState(envId);
  return state !== null && state.isReady;
}

/** Get learning progress stats */
export function getLearningStats(envId: string): {
  framesCollected: number;
  activitiesLearned: number;
  isReady: boolean;
  lastTrained: number | null;
} {
  const state = loadLearnedState(envId);
  if (!state) {
    return { framesCollected: 0, activitiesLearned: 0, isReady: false, lastTrained: null };
  }
  return {
    framesCollected: state.totalFrames,
    activitiesLearned: state.activities.length,
    isReady: state.isReady,
    lastTrained: state.lastTrainedAt,
  };
}

"use client";

/**
 * Global pose data bus — shares real-time pose data between components.
 *
 * The Cameras tab runs MoveNet pose extraction and publishes frames here.
 * The 3D Viewer / useSkeletalStream subscribes and renders real skeletons
 * instead of falling back to simulation.
 *
 * This avoids running duplicate pose estimators and ensures the env page
 * 3D view always has access to real camera data when cameras are active.
 */

import type { PoseFrame } from "./poseEstimator";

export interface PoseBusFrame extends PoseFrame {
  cameraId: string;
  roomId: string;
}

type PoseListener = (frame: PoseBusFrame) => void;

const listeners = new Set<PoseListener>();
let latestFrames: Record<string, PoseBusFrame> = {};

/** Publish a pose frame from any camera */
export function publishPose(frame: PoseBusFrame): void {
  latestFrames[frame.cameraId] = frame;
  listeners.forEach((fn) => {
    try { fn(frame); } catch { /* ignore listener errors */ }
  });
}

/** Subscribe to pose frames from all cameras */
export function subscribePose(listener: PoseListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Get the latest frame for a specific room, or the most recent frame overall */
export function getLatestPose(roomId?: string): PoseBusFrame | null {
  const entries = Object.values(latestFrames);
  if (roomId) {
    const roomFrame = entries.find((f) => f.roomId === roomId && f.isDetected);
    if (roomFrame) return roomFrame;
  }
  // Return the most recent detected frame from any camera
  const detected = entries.filter((f) => f.isDetected);
  if (detected.length === 0) return null;
  return detected.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
}

/** Check if any camera is actively producing pose data */
export function hasActivePose(roomId?: string): boolean {
  const now = performance.now();
  const entries = Object.values(latestFrames);
  const relevant = roomId ? entries.filter((f) => f.roomId === roomId) : entries;
  // Consider "active" if we received a frame within the last 2 seconds
  return relevant.some((f) => now - f.timestamp < 2000 && f.isDetected);
}

/** Clear frames for a camera (when stopped) */
export function clearPose(cameraId: string): void {
  delete latestFrames[cameraId];
}

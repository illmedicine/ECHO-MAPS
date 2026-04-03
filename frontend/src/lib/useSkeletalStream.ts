"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { isBackendConfigured } from "./api";
import { generateSimulatedSkeleton, generateSimulatedVitals, getCamerasForRoom, type Environment } from "./environments";
import { estimatePose, preloadModel } from "./poseEstimator";
import { storeFrame, type CollectedFrame } from "./collectedData";
import { subscribePose, getLatestPose, hasActivePose, type PoseBusFrame } from "./poseBus";

export type StreamSource = "csi" | "camera" | "simulated" | "disconnected";

export interface SkeletalFrame {
  keypoints: number[][];       // 33 × [x, y, z]
  activity: string;
  breathingRate: number | null;
  heartRate: number | null;
  confidence: number;
  source: StreamSource;
  timestamp: number;
  isDetected: boolean;         // true when a real person is detected
}

export interface TrackedPerson {
  track_id: string;
  user_tag: string;
  position: number[];
  velocity: number[];
  speed: number;
  confidence: number;
  is_registered: boolean;
  is_ghosted: boolean;
  last_activity: string;
  skeleton?: number[][];
}

interface UseSkeletalStreamOptions {
  envId: string | null;
  dims: Environment["dimensions"];
  live: boolean;
  isCalibrated: boolean;
  /** External video element (e.g. from calibration camera) */
  videoElement?: HTMLVideoElement | null;
  /** Current activity label during calibration */
  activityLabel?: string;
}

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

function lerpKeypoints(
  prev: number[][],
  next: number[][],
  t: number
): number[][] {
  if (prev.length !== next.length) return next;
  return next.map((kp, i) => [
    prev[i][0] + (kp[0] - prev[i][0]) * t,
    prev[i][1] + (kp[1] - prev[i][1]) * t,
    prev[i][2] + (kp[2] - prev[i][2]) * t,
  ]);
}

/**
 * Try to find an active camera stream for this room.
 * Checks if the Cameras tab has an active stream we can tap into.
 */
function findActiveCameraVideo(envId: string): HTMLVideoElement | null {
  // Look for any active camera video elements in the DOM
  // The CamerasView stores video refs directly on video elements
  const cameras = getCamerasForRoom(envId);
  const activeCam = cameras.find((c) => c.active);
  if (!activeCam) return null;

  // Find the video element by checking all video elements in the document
  const videos = document.querySelectorAll("video");
  for (const video of videos) {
    if (video.srcObject && video.readyState >= 2 && !video.paused) {
      return video;
    }
  }
  return null;
}

export function useSkeletalStream({
  envId,
  dims,
  live,
  isCalibrated,
  videoElement,
  activityLabel = "idle",
}: UseSkeletalStreamOptions) {
  const [frame, setFrame] = useState<SkeletalFrame | null>(null);
  const [tracks, setTracks] = useState<TrackedPerson[]>([]);
  const [source, setSource] = useState<StreamSource>("disconnected");

  const wsRef = useRef<WebSocket | null>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const prevKeypointsRef = useRef<number[][]>([]);
  const nextKeypointsRef = useRef<number[][]>([]);
  const lastServerFrameRef = useRef<number>(0);
  const lastPoseTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);

  // Start preloading the pose model early
  useEffect(() => {
    if (live || videoElement) {
      preloadModel().catch(() => {});
    }
  }, [live, videoElement]);

  // Track external video element
  useEffect(() => {
    cameraVideoRef.current = videoElement ?? null;
  }, [videoElement]);

  // Attempt WebSocket connection to live CSI stream
  const connectWs = useCallback(() => {
    if (!envId || !WS_BASE || !isCalibrated) return null;

    const protocol = WS_BASE.startsWith("https") ? "wss" : "ws";
    const base = WS_BASE.replace(/^https?/, protocol);
    const url = `${base}/api/live/stream/${envId}`;

    try {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        setSource("csi");
        const stored = localStorage.getItem("echo_maps_user");
        const token = stored ? JSON.parse(stored).apiToken : "";
        ws.send(JSON.stringify({ token }));
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          const now = performance.now();

          if (nextKeypointsRef.current.length > 0) {
            prevKeypointsRef.current = [...nextKeypointsRef.current];
          }
          nextKeypointsRef.current = data.keypoints ?? [];
          lastServerFrameRef.current = now;

          setFrame({
            keypoints: data.keypoints ?? [],
            activity: data.activity ?? "idle",
            breathingRate: data.breathing_rate ?? null,
            heartRate: data.heart_rate ?? null,
            confidence: data.tracks?.[0]?.confidence ?? 1.0,
            source: "csi",
            timestamp: now,
            isDetected: (data.keypoints ?? []).length >= 33,
          });

          if (data.tracks) {
            setTracks(data.tracks);
          }
        } catch { /* ignore malformed frames */ }
      };

      ws.onclose = () => {
        setSource((prev) => (prev === "csi" ? "disconnected" : prev));
        wsRef.current = null;
      };

      ws.onerror = () => { ws.close(); };

      return ws;
    } catch {
      return null;
    }
  }, [envId, isCalibrated]);

  // Main animation loop — prioritizes real data sources
  useEffect(() => {
    if (!live || !envId) {
      setSource("disconnected");
      return;
    }

    startTimeRef.current = performance.now();
    let wsAttempted = false;
    let disposed = false;

    // Subscribe to the global pose bus (data from Cameras tab)
    const unsubBus = subscribePose((busFrame: PoseBusFrame) => {
      if (disposed) return;
      // Accept pose data from any camera assigned to this room, or any camera if no room match
      if (busFrame.roomId === envId || !busFrame.roomId) {
        if (busFrame.isDetected && busFrame.keypoints3d.length >= 33) {
          setSource("camera");
          setFrame({
            keypoints: busFrame.keypoints3d,
            activity: activityLabel,
            breathingRate: null,
            heartRate: null,
            confidence: busFrame.confidence,
            source: "camera",
            timestamp: busFrame.timestamp,
            isDetected: true,
          });
        }
      }
    });

    // Use setTimeout-based loop instead of requestAnimationFrame to avoid
    // competing with the Three.js render loop for GPU time.
    // Skeletal data only needs ~10fps updates; Three.js needs 60fps for smooth 3D.
    let loopTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      if (!disposed) {
        // 100ms = 10fps for skeleton updates — plenty smooth
        loopTimer = setTimeout(animate, 100);
      }
    };

    const animate = async () => {
      if (disposed) return;

      const now = performance.now();
      const elapsed = (now - startTimeRef.current) / 1000;

      // Priority 1: Try WebSocket CSI stream
      if (!wsAttempted && isBackendConfigured() && isCalibrated) {
        wsAttempted = true;
        wsRef.current = connectWs();
      }

      // If CSI WebSocket is active, interpolate between server frames
      if (source === "csi" && prevKeypointsRef.current.length > 0) {
        const timeSinceFrame = now - lastServerFrameRef.current;
        const t = Math.min(timeSinceFrame / 100, 1);
        const interpolated = lerpKeypoints(
          prevKeypointsRef.current,
          nextKeypointsRef.current,
          t
        );
        setFrame((prev) =>
          prev ? { ...prev, keypoints: interpolated, timestamp: now } : prev
        );
      }
      // Priority 2: Check if pose bus has recent data from Cameras tab
      else if (hasActivePose(envId)) {
        // Data is being pushed via subscribePose callback above
        // Don't override with simulation
      }
      // Priority 3: Use live camera feed (only during calibration with local videoElement)
      else {
        const video = cameraVideoRef.current;

        if (video && video.readyState >= 2 && !video.paused) {
          const poseResult = await estimatePose(video, dims);

          if (poseResult.isDetected && poseResult.keypoints3d.length >= 33) {
            setSource("camera");
            setFrame({
              keypoints: poseResult.keypoints3d,
              activity: activityLabel,
              breathingRate: null,
              heartRate: null,
              confidence: poseResult.confidence,
              source: "camera",
              timestamp: now,
              isDetected: true,
            });

            // Store collected frame for the correlation engine
            frameCountRef.current++;
            if (frameCountRef.current % 5 === 0) {
              const collectedFrame: CollectedFrame = {
                id: `${envId}-${Date.now()}-${frameCountRef.current}`,
                envId: envId,
                roomId: envId,
                timestamp: Date.now(),
                keypoints3d: poseResult.keypoints3d,
                keypoints2d: poseResult.keypoints2d,
                confidence: poseResult.confidence,
                activity: activityLabel,
                source: "camera",
              };
              storeFrame(collectedFrame).catch(() => {});
            }
          } else if (source !== "camera") {
            setSource("camera");
            setFrame({
              keypoints: [],
              activity: "scanning",
              breathingRate: null,
              heartRate: null,
              confidence: 0,
              source: "camera",
              timestamp: now,
              isDetected: false,
            });
          }
        }
        // Priority 4: Simulation fallback only when no real data source exists
        else {
          setSource("simulated");
          const keypoints = generateSimulatedSkeleton(dims, elapsed);
          const vitals = generateSimulatedVitals();

          setFrame({
            keypoints,
            activity: vitals.activity,
            breathingRate: vitals.breathingRate,
            heartRate: vitals.heartRate,
            confidence: isCalibrated ? 0.95 : 0.5,
            source: "simulated",
            timestamp: now,
            isDetected: true,
          });
        }
      }

      scheduleNext();
    };

    scheduleNext();

    return () => {
      disposed = true;
      unsubBus();
      if (loopTimer) clearTimeout(loopTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [live, envId, dims, isCalibrated, connectWs, source, activityLabel]);

  return { frame, tracks, source };
}

"use client";

/**
 * Room Scan API client — communicates with the /api/room-scan backend
 * for mobile phone camera-based room mapping.
 *
 * Primary flow:
 *   1. startRoomScan()   → creates scan session
 *   2. submitDetections() → sends each frame's COCO-SSD results + orientation
 *   3. finaliseScan()     → completes scan, generates floor plan
 *   4. getFloorPlan()     → retrieves the auto-generated floor plan
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem("echo_maps_user");
  if (!stored) return null;
  const user = JSON.parse(stored);
  return user.apiToken ?? null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? res.statusText);
  }
  return res.json();
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface DetectionItem {
  category: string;
  confidence: number;
  bbox: number[];       // [x1, y1, x2, y2] normalised 0..1
  distance?: number;
  bearing?: number;
}

export interface DeviceOrientation {
  alpha: number;    // compass heading 0–360
  beta: number;     // front-back tilt
  gamma: number;    // left-right tilt
}

export interface ScanStatus {
  id: string;
  environment_id: string;
  phase: "idle" | "capturing" | "processing" | "mapping" | "complete" | "failed";
  frames_captured: number;
  coverage_degrees: number;
  target_coverage: number;
  objects_detected: number;
  room_dimensions: {
    width: number;
    length: number;
    height: number;
    confidence: number;
  };
  scan_confidence: number;
  calibration_boost: number;
  message: string;
}

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

export interface GeneratedFloorPlan {
  environment_id: string;
  room_width: number;
  room_length: number;
  room_height: number;
  objects: FloorPlanObject[];
  walls: { from: number[]; to: number[]; label: string }[];
  doors: FloorPlanObject[];
  windows: FloorPlanObject[];
  is_fully_mapped: boolean;
  scan_confidence: number;
  dimensions_confidence: number;
}

// ── API calls ──────────────────────────────────────────────────────────────

export async function startRoomScan(envId: string): Promise<ScanStatus> {
  return request<ScanStatus>(`/api/room-scan/start/${envId}`, { method: "POST" });
}

export async function getScanStatus(envId: string): Promise<ScanStatus> {
  return request<ScanStatus>(`/api/room-scan/status/${envId}`);
}

export async function submitDetections(
  envId: string,
  detections: DetectionItem[],
  orientation?: DeviceOrientation,
  frameIndex?: number,
): Promise<ScanStatus> {
  return request<ScanStatus>(`/api/room-scan/frame/${envId}`, {
    method: "POST",
    body: JSON.stringify({
      detections,
      orientation: orientation ?? null,
      frame_index: frameIndex ?? 0,
    }),
  });
}

export async function finaliseScan(envId: string): Promise<GeneratedFloorPlan> {
  return request<GeneratedFloorPlan>(`/api/room-scan/finalise/${envId}`, {
    method: "POST",
  });
}

export async function getGeneratedFloorPlan(envId: string): Promise<GeneratedFloorPlan> {
  return request<GeneratedFloorPlan>(`/api/room-scan/floor-plan/${envId}`);
}

// ── WebSocket streaming ────────────────────────────────────────────────────

export type ScanStreamMessage = {
  phase: string;
  frames_captured: number;
  coverage_degrees: number;
  objects: FloorPlanObject[];
  room_dimensions: { width: number; length: number; height: number; confidence: number };
  scan_confidence: number;
  calibration_boost: number;
  floor_plan: GeneratedFloorPlan | null;
};

export function createScanStream(
  envId: string,
  onMessage: (msg: ScanStreamMessage) => void,
  onError?: (err: Event) => void,
): {
  send: (detections: DetectionItem[], orientation?: DeviceOrientation) => void;
  close: () => void;
} {
  const wsBase = API_BASE.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/api/room-scan/stream/${envId}`);
  let authenticated = false;

  ws.onopen = () => {
    const token = getToken();
    ws.send(JSON.stringify({ token: token ?? "" }));
    authenticated = true;
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch { /* ignore parse errors */ }
  };

  ws.onerror = (event) => {
    onError?.(event);
  };

  return {
    send(detections: DetectionItem[], orientation?: DeviceOrientation) {
      if (ws.readyState === WebSocket.OPEN && authenticated) {
        ws.send(JSON.stringify({ detections, orientation }));
      }
    },
    close() {
      ws.close();
    },
  };
}

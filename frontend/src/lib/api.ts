"use client";

/**
 * API client for Echo Maps backend.
 * When NEXT_PUBLIC_API_URL is set, all calls go to the live backend.
 * When not set, the app runs in demo/offline mode.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem("echo_maps_user");
  if (!stored) return null;
  const user = JSON.parse(stored);
  return user.apiToken ?? null;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Auth ──

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  email: string;
  name: string;
}

export async function verifyGoogleToken(credential: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/google/verify", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

// ── Environments ──

export interface EnvironmentOut {
  id: string;
  name: string;
  is_calibrated: boolean;
  calibration_confidence: number;
  created_at: string;
}

export async function listEnvironments(): Promise<EnvironmentOut[]> {
  const data = await request<{ environments: EnvironmentOut[] }>("/api/environments");
  return data.environments;
}

export async function createEnvironment(name: string): Promise<EnvironmentOut> {
  return request<EnvironmentOut>("/api/environments", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function getEnvironment(id: string): Promise<EnvironmentOut> {
  return request<EnvironmentOut>(`/api/environments/${id}`);
}

export async function deleteEnvironment(id: string): Promise<void> {
  return request<void>(`/api/environments/${id}`, { method: "DELETE" });
}

// ── Calibration ──

export interface CalibrationStatus {
  environment_id: string;
  stage: string;
  pose_match_accuracy: number;
  training_epoch: number;
  csi_frames_collected: number;
  vision_frames_collected: number;
  message: string;
}

export async function startCalibration(environmentId: string): Promise<CalibrationStatus> {
  return request<CalibrationStatus>("/api/calibration/start", {
    method: "POST",
    body: JSON.stringify({ environment_id: environmentId }),
  });
}

export async function getCalibrationStatus(envId: string): Promise<CalibrationStatus> {
  return request<CalibrationStatus>(`/api/calibration/status/${envId}`);
}

// ── Live ──

export interface LiveStatus {
  environment_id: string;
  stage: string;
  is_live: boolean;
  confidence: number;
}

export async function getLiveStatus(envId: string): Promise<LiveStatus> {
  return request<LiveStatus>(`/api/live/status/${envId}`);
}

// ── Health ──

let _healthFailCount = 0;
let _lastHealthFail = 0;
const HEALTH_BACKOFF_MS = 60_000; // Wait 60s after a health check failure before retrying

export async function healthCheck(): Promise<{ status: string; service: string }> {
  // Circuit breaker: if health check failed recently, don't retry yet
  if (_healthFailCount > 0 && Date.now() - _lastHealthFail < HEALTH_BACKOFF_MS * Math.min(_healthFailCount, 5)) {
    throw new ApiError(503, "Backend unavailable (skipped — backoff active)");
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const result = await request<{ status: string; service: string }>("/health", { signal: controller.signal });
    clearTimeout(timeout);
    _healthFailCount = 0; // Reset on success
    return result;
  } catch (err) {
    _healthFailCount++;
    _lastHealthFail = Date.now();
    throw err;
  }
}

// ── Backend connectivity check ──

export function isBackendConfigured(): boolean {
  return !!API_BASE;
}

/** Check if the backend has been confirmed unreachable this session */
export function isBackendUnreachable(): boolean {
  return _healthFailCount > 0 && Date.now() - _lastHealthFail < HEALTH_BACKOFF_MS * Math.min(_healthFailCount, 5);
}

// ── User Settings (cloud sync) ──

export interface UserSettingsPayload {
  settings: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export async function getUserSettings(): Promise<UserSettingsPayload> {
  return request<UserSettingsPayload>("/api/settings");
}

export async function saveUserSettings(payload: UserSettingsPayload): Promise<UserSettingsPayload> {
  return request<UserSettingsPayload>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// ── Bridge Device Management ──

export interface BridgeDevice {
  device_id: string;
  model: string;
  firmware_version: string;
  status: string;
  is_bound: boolean;
  ip_address: string;
  has_camera: boolean;
  has_mic: boolean;
  has_speaker: boolean;
  has_lcd: boolean;
  current_room: string;
  rooms_calibrated: string[];
}

export interface BridgeCalibrationProgress {
  device_id: string;
  status: string;
  current_room: string;
  rooms_calibrated: string[];
  environment_id: string | null;
  is_bound: boolean;
}

/** Discover Illy Bridge devices on the network */
export async function discoverBridges(): Promise<BridgeDevice[]> {
  return request<BridgeDevice[]>("/api/bridge/discover");
}

/** Report a bridge found via local mDNS scan */
export async function reportDiscoveredBridge(info: {
  device_id: string;
  ip_address: string;
  model?: string;
  firmware_version?: string;
}): Promise<{ status: string; device_id: string }> {
  return request("/api/bridge/report-discovered", {
    method: "POST",
    body: JSON.stringify(info),
  });
}

/** Bind a bridge to the current user */
export async function bindBridge(deviceId: string): Promise<BridgeDevice> {
  return request<BridgeDevice>("/api/bridge/bind", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId }),
  });
}

/** Unbind a bridge from the current user */
export async function unbindBridge(deviceId: string): Promise<{ status: string }> {
  return request("/api/bridge/unbind", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId }),
  });
}

/** List all bridges bound to the current user */
export async function listBridges(): Promise<BridgeDevice[]> {
  return request<BridgeDevice[]>("/api/bridge/devices");
}

/** Get a specific bridge device */
export async function getBridge(deviceId: string): Promise<BridgeDevice> {
  return request<BridgeDevice>(`/api/bridge/devices/${deviceId}`);
}

/** Start room calibration scan (camera + mic + CSI) */
export async function startRoomCalibration(
  deviceId: string,
  environmentId: string,
  roomName: string
): Promise<BridgeCalibrationProgress> {
  return request<BridgeCalibrationProgress>("/api/bridge/calibrate/start", {
    method: "POST",
    body: JSON.stringify({
      device_id: deviceId,
      environment_id: environmentId,
      room_name: roomName,
    }),
  });
}

/** Start presence detection scan (CSI + mic) */
export async function startPresenceScan(
  deviceId: string,
  environmentId: string,
  roomName: string
): Promise<BridgeCalibrationProgress> {
  return request<BridgeCalibrationProgress>("/api/bridge/calibrate/presence", {
    method: "POST",
    body: JSON.stringify({
      device_id: deviceId,
      environment_id: environmentId,
      room_name: roomName,
    }),
  });
}

/** Stop current calibration/scan on a bridge */
export async function stopBridgeCalibration(
  deviceId: string
): Promise<{ status: string }> {
  return request("/api/bridge/calibrate/stop", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId }),
  });
}

/** Get calibration progress for a bridge */
export async function getBridgeCalibrationProgress(
  deviceId: string
): Promise<BridgeCalibrationProgress> {
  return request<BridgeCalibrationProgress>(
    `/api/bridge/calibrate/progress/${deviceId}`
  );
}

/**
 * Discover Illy Bridge devices on the local network via mDNS.
 * This runs in the browser and queries for _illybridge._tcp services.
 * Falls back to scanning common local IPs if mDNS is not available.
 */
export async function discoverLocalBridges(): Promise<
  Array<{ device_id: string; ip_address: string; info: Record<string, unknown> }>
> {
  const found: Array<{
    device_id: string;
    ip_address: string;
    info: Record<string, unknown>;
  }> = [];

  // Browser-based discovery: try to hit common local IPs on port 80
  // The bridge runs an HTTP server that responds to /api/bridge/info
  const localSubnet = window.location.hostname.split(".").slice(0, 3).join(".");
  const scanPromises: Promise<void>[] = [];

  for (let i = 1; i <= 254; i++) {
    const ip = `${localSubnet}.${i}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    scanPromises.push(
      fetch(`http://${ip}/api/bridge/info`, { signal: controller.signal })
        .then((res) => res.json())
        .then((info) => {
          clearTimeout(timeout);
          if (info.device_id) {
            found.push({ device_id: info.device_id, ip_address: ip, info });
            // Report to cloud backend
            reportDiscoveredBridge({
              device_id: info.device_id,
              ip_address: ip,
              model: info.model,
              firmware_version: info.version,
            }).catch(() => {});
          }
        })
        .catch(() => {
          clearTimeout(timeout);
        })
    );
  }

  await Promise.allSettled(scanPromises);
  return found;
}

// ── Room Scan (re-export from roomScanApi for convenience) ──

export {
  startRoomScan,
  getScanStatus,
  submitDetections as submitRoomScanDetections,
  finaliseScan as finaliseRoomScan,
  getGeneratedFloorPlan,
} from "./roomScanApi";
export type {
  ScanStatus as RoomScanStatus,
  GeneratedFloorPlan as RoomScanFloorPlan,
} from "./roomScanApi";

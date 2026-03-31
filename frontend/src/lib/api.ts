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

export async function healthCheck(): Promise<{ status: string; service: string }> {
  return request<{ status: string; service: string }>("/health");
}

// ── Backend connectivity check ──

export function isBackendConfigured(): boolean {
  return !!API_BASE;
}

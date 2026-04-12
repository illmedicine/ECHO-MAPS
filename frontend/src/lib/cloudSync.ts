"use client";

/**
 * Cloud Sync — persists user settings across devices.
 *
 * Strategy:
 *   1. User-scoped localStorage keys (prevents account mixing on same browser)
 *   2. Cloud sync via backend API (when NEXT_PUBLIC_API_URL is set)
 *   3. JSON export/import (for manual cross-device transfer)
 *
 * All localStorage keys are scoped to the authenticated user's Google ID.
 * On login: pull from cloud → merge with local.
 * On data change: debounced push to cloud.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

// All syncable localStorage base keys — every key here is pushed/pulled to cloud
const SYNCABLE_KEYS = [
  "echo_vue_environments",
  "echo_maps_environments",
  "echo_vue_cameras",
  "echo_vue_entities",
  "echo_vue_floor_plans",
  "echo_vue_household",
  "echo_vue_visitors",
  "echo_vue_router_anchor",
  "echo_vue_device_corrections",
] as const;

// Dynamic per-environment keys — handled separately during collect/restore
const ACTIVITY_KEY_PREFIX = "echo_maps_activity_";

/* ── User scoping helpers ── */

export function getCurrentUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("echo_maps_user");
    if (!raw) return null;
    return JSON.parse(raw).id ?? null;
  } catch {
    return null;
  }
}

/** Return the user-scoped localStorage key. Falls back to unscoped if no user. */
export function scopedKey(baseKey: string): string {
  const uid = getCurrentUserId();
  return uid ? `${baseKey}::${uid}` : baseKey;
}

/* ── Data migration ── */

/**
 * Migrate unscoped localStorage data to user-scoped keys.
 * Called once on login. Only migrates if scoped key is empty.
 */
export function migrateToUserScope(userId: string): void {
  if (typeof window === "undefined") return;

  for (const baseKey of SYNCABLE_KEYS) {
    const unscopedData = localStorage.getItem(baseKey);
    const scopedK = `${baseKey}::${userId}`;

    if (unscopedData && !localStorage.getItem(scopedK)) {
      localStorage.setItem(scopedK, unscopedData);
      localStorage.removeItem(baseKey);
    }
  }

  // Migrate dynamic per-environment keys (activity logs, etc.)
  const keysToMigrate: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(ACTIVITY_KEY_PREFIX) && !key.includes("::")) {
      keysToMigrate.push(key);
    }
  }
  for (const key of keysToMigrate) {
    const data = localStorage.getItem(key);
    const scopedK = `${key}::${userId}`;
    if (data && !localStorage.getItem(scopedK)) {
      localStorage.setItem(scopedK, data);
      localStorage.removeItem(key);
    }
  }
}

/* ── Cloud sync (backend API) ── */

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("echo_maps_user");
    if (!raw) return null;
    return JSON.parse(raw).apiToken ?? null;
  } catch {
    return null;
  }
}

function isCloudAvailable(): boolean {
  return !!API_BASE && !!getToken();
}

interface UserSettingsPayload {
  settings: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

/** Collect all user-scoped data into a single payload */
export function collectAllSettings(): Record<string, unknown> {
  const uid = getCurrentUserId();
  if (!uid) return {};

  const data: Record<string, unknown> = {};

  for (const baseKey of SYNCABLE_KEYS) {
    const raw = localStorage.getItem(`${baseKey}::${uid}`);
    if (raw) {
      try { data[baseKey] = JSON.parse(raw); } catch { /* skip corrupt */ }
    }
  }

  // Collect activity logs and other dynamic per-environment keys
  const dynamicData: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.includes(`::${uid}`)) continue;
    // Already covered by SYNCABLE_KEYS above
    const baseKey = key.replace(`::${uid}`, "");
    if ((SYNCABLE_KEYS as readonly string[]).includes(baseKey)) continue;
    // Capture activity logs and any other user-scoped dynamic keys
    if (key.startsWith(ACTIVITY_KEY_PREFIX) || key.startsWith("echo_vue_") || key.startsWith("echo_maps_")) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try { dynamicData[baseKey] = JSON.parse(raw); } catch { /* skip */ }
      }
    }
  }
  if (Object.keys(dynamicData).length > 0) {
    data["_dynamic_keys"] = dynamicData;
  }

  return data;
}

/** Push all settings to the cloud backend */
export async function syncPushToCloud(): Promise<boolean> {
  if (!isCloudAvailable()) return false;

  const settings = collectAllSettings();
  const payload: UserSettingsPayload = {
    settings,
    version: Date.now(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Pull settings from cloud and write to localStorage */
export async function syncPullFromCloud(): Promise<boolean> {
  if (!isCloudAvailable()) return false;

  const uid = getCurrentUserId();
  if (!uid) return false;

  try {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/settings`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) return false;

    const payload: UserSettingsPayload = await res.json();
    const settings = payload.settings;

    // Write each key to user-scoped localStorage
    // Safety: never overwrite non-empty local data with empty cloud data
    for (const baseKey of SYNCABLE_KEYS) {
      const cloudData = settings[baseKey];
      if (cloudData !== undefined) {
        const localRaw = localStorage.getItem(`${baseKey}::${uid}`);
        const localData = localRaw ? JSON.parse(localRaw) : null;
        const cloudIsEmpty = Array.isArray(cloudData) ? cloudData.length === 0 : !cloudData;
        const localHasData = Array.isArray(localData) ? localData.length > 0 : !!localData;
        // Don't overwrite local data with empty cloud data
        if (cloudIsEmpty && localHasData) continue;
        localStorage.setItem(`${baseKey}::${uid}`, JSON.stringify(cloudData));
      }
    }

    // Restore dynamic keys (activity logs, per-environment data, etc.)
    const dynamicKeys = settings["_dynamic_keys"] as Record<string, unknown> | undefined;
    if (dynamicKeys) {
      for (const [key, data] of Object.entries(dynamicKeys)) {
        if (data !== undefined) {
          localStorage.setItem(`${key}::${uid}`, JSON.stringify(data));
        }
      }
    }

    // Legacy: also check old "_activity_logs" key for backwards compat
    const activityLogs = settings["_activity_logs"] as Record<string, unknown> | undefined;
    if (activityLogs) {
      for (const [key, data] of Object.entries(activityLogs)) {
        if (data !== undefined) {
          localStorage.setItem(`${key}::${uid}`, JSON.stringify(data));
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

/* ── Debounced auto-sync with circuit breaker ── */

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncBackoff = 0; // ms to wait before retrying after failure
let lastSyncFail = 0;

/** Schedule a debounced push to cloud (5 second delay). Backs off on repeated failures. */
export function scheduleSyncPush(): void {
  if (!isCloudAvailable()) return;
  // Circuit breaker: if last sync failed recently, don't retry yet
  if (syncBackoff > 0 && Date.now() - lastSyncFail < syncBackoff) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncPushToCloud().then((ok) => {
      if (ok) {
        syncBackoff = 0; // reset on success
      } else {
        lastSyncFail = Date.now();
        syncBackoff = Math.min((syncBackoff || 30000) * 2, 600000); // 30s → 60s → … → 10min max
      }
    }).catch(() => {
      lastSyncFail = Date.now();
      syncBackoff = Math.min((syncBackoff || 30000) * 2, 600000);
    });
  }, 5000);
}

/* ── JSON Export / Import ── */

export function exportSettingsToJSON(): string {
  const data = collectAllSettings();
  const exportPayload = {
    _export: {
      app: "Echo Vue by Illy Robotics",
      version: "1.0",
      exportedAt: new Date().toISOString(),
      userId: getCurrentUserId(),
    },
    ...data,
  };
  return JSON.stringify(exportPayload, null, 2);
}

export function downloadSettingsAsFile(): void {
  const json = exportSettingsToJSON();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `echo-vue-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importSettingsFromJSON(jsonString: string): boolean {
  const uid = getCurrentUserId();
  if (!uid) return false;

  try {
    const data = JSON.parse(jsonString);

    for (const baseKey of SYNCABLE_KEYS) {
      if (data[baseKey] !== undefined) {
        localStorage.setItem(`${baseKey}::${uid}`, JSON.stringify(data[baseKey]));
      }
    }

    // Restore activity logs if present
    const activityLogs = data["_activity_logs"] as Record<string, unknown> | undefined;
    if (activityLogs) {
      for (const [key, logData] of Object.entries(activityLogs)) {
        if (logData !== undefined) {
          localStorage.setItem(`${key}::${uid}`, JSON.stringify(logData));
        }
      }
    }

    // Push imported data to cloud
    scheduleSyncPush();

    return true;
  } catch {
    return false;
  }
}

export async function importSettingsFromFile(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === "string") {
        resolve(importSettingsFromJSON(text));
      } else {
        resolve(false);
      }
    };
    reader.onerror = () => resolve(false);
    reader.readAsText(file);
  });
}

/* ── Network Fingerprint ── */

export interface NetworkFingerprint {
  isp: string;
  asn: string;
  city: string;
  region: string;
  country: string;
  ipHash: string;
  networkLabel: string;     // Human-readable: "Comcast · AS7922 · Philadelphia"
  detectedAt: string;
}

/** Simple SHA-256 hash of a string */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/**
 * Detect the current network's ISP/ASN/location using a public API.
 * Returns a NetworkFingerprint that uniquely labels this physical network.
 *
 * BLE Company ID identifies device manufacturers; network fingerprint
 * identifies the physical location/ISP of the environment itself.
 */
export async function detectNetworkFingerprint(): Promise<NetworkFingerprint | null> {
  try {
    // Use ipapi.co — free, no API key needed for < 1000 req/day
    const res = await fetch("https://ipapi.co/json/", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const info = await res.json();
    const ip = info.ip ?? "";
    const isp = info.org ?? info.asn ?? "Unknown ISP";
    const asn = info.asn ?? "";
    const city = info.city ?? "";
    const region = info.region ?? "";
    const country = info.country_name ?? info.country ?? "";

    // Hash the IP for privacy (don't store raw IP)
    const ipHash = await sha256(ip);

    // Build human-readable label
    const parts = [isp.replace(/^AS\d+\s+/, ""), asn, city].filter(Boolean);
    const networkLabel = parts.join(" · ") || "Unknown Network";

    return {
      isp,
      asn,
      city,
      region,
      country,
      ipHash,
      networkLabel,
      detectedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

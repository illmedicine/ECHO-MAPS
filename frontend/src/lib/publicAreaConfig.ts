/**
 * Per-area sensing preferences for public areas.
 *
 *   auto   - the dashboard follows the area's bridge continuously (live CSI)
 *   manual - the dashboard only reads the area when someone presses "Scan now"
 *
 * Stored per user under an `echo_vue_` key, so it syncs with the rest of the
 * user's settings.
 */

import { scopedKey, scheduleSyncPush } from "./cloudSync";

export type SensingMode = "auto" | "manual";

const KEY = "echo_vue_area_modes";

export function getAreaModes(): Record<string, SensingMode> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(scopedKey(KEY));
    return raw ? (JSON.parse(raw) as Record<string, SensingMode>) : {};
  } catch {
    return {};
  }
}

export function setAreaMode(areaName: string, mode: SensingMode): Record<string, SensingMode> {
  const modes = { ...getAreaModes(), [areaName]: mode };
  try {
    localStorage.setItem(scopedKey(KEY), JSON.stringify(modes));
    scheduleSyncPush();
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
  return modes;
}

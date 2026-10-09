/**
 * Turn live zone data into occupant estimates.
 *
 * One occupant per distinct, steady breathing signature reported by the backend. The
 * backend labels each "slower" (shown as a person) or "faster" (shown as a pet). Nothing
 * here is tied to a saved profile: occupants exist only while the sensor sees them.
 */

import type { LiveZone } from "./api";

export interface Occupant {
  /** Stable while the signature persists: area + kind + rank within the area. */
  key: string;
  zone: LiveZone;
  kind: "slower" | "faster";
  bpm: number;
  snr: number;
  readings: number;
  min: number;
  max: number;
  series: number[];
}

export const PETS_BPM_NOTE =
  "Slower rates are shown as people and faster ones (above about 20 breaths/min) as pets; pets generally breathe faster than adults at rest, but the ranges overlap, so a fast breather may be a child or someone who just exercised.";

export function occupantsOf(zones: LiveZone[]): { people: Occupant[]; pets: Occupant[]; unclassified: LiveZone[] } {
  const people: Occupant[] = [];
  const pets: Occupant[] = [];
  const unclassified: LiveZone[] = [];
  for (const z of zones) {
    if (z.state === "offline") continue;
    const sigs = z.breathing?.signatures ?? [];
    const rank = { slower: 0, faster: 0 };
    for (const s of sigs) {
      const o: Occupant = {
        key: `${z.device_id}|${z.zone}|${s.kind}|${rank[s.kind]++}`,
        zone: z, kind: s.kind, bpm: s.bpm, snr: s.snr, readings: s.readings, min: s.min, max: s.max, series: s.series,
      };
      (s.kind === "faster" ? pets : people).push(o);
    }
    if (z.present && sigs.length === 0) unclassified.push(z);
  }
  return { people, pets, unclassified };
}

/** How trustworthy a signature is, from its spectral peak strength and how long it has persisted. */
export function signalQuality(o: Pick<Occupant, "snr" | "readings">): "strong" | "moderate" | "weak" {
  if (o.snr >= 8 && o.readings >= 6) return "strong";
  if (o.snr >= 5 && o.readings >= 4) return "moderate";
  return "weak";
}

/** Steady if the rate barely moves between readings, otherwise variable. */
export function pattern(o: Pick<Occupant, "series">): "steady" | "variable" {
  const s = o.series;
  if (s.length < 2) return "steady";
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return sd <= 1.0 ? "steady" : "variable";
}

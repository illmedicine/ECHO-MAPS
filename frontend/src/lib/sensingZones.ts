/**
 * Sensing Zones
 *
 * Privacy scoping for CSI sensing: by default, occupancy/presence sensing runs
 * ONLY in common/public areas (lobby, front desk, pool, laundry, etc.) and is
 * disabled in private guest rooms. This enforces the consent-first policy in
 * product behavior, not just in the privacy page text.
 *
 * Classification is name/type based so it works on generated hotel rooms
 * ("Room 304" → private) and amenity spaces ("Outdoor Pool" → public).
 */

export type ZoneKind = "public" | "private";

/** Name fragments that mark a genuinely public / common area. */
const PUBLIC_PATTERNS = [
  /lobby/i,
  /front\s*desk/i,
  /reception/i,
  /pool/i,
  /terrace/i,
  /laundry/i,
  /deli|snack|vending|market|pantry/i,
  /elevator|lift/i,
  /stair/i,
  /lounge|lobby|atrium/i,
  /gym|fitness/i,
  /hall|corridor|walkway|breezeway/i,
  /business\s*center|conference|meeting/i,
  /breakfast|dining|cafe|bar/i,
  /game\s*room|rec\s*room|common/i,
  /entrance|entry|foyer|vestibule/i,
  /parking|garage|carport/i,
];

/** Name fragments that mark a private guest room. */
const PRIVATE_PATTERNS = [/^\s*room\s*\d+/i, /suite\s*\d+/i, /\bguest\s*room\b/i];

export interface ClassifiableRoom {
  id: string;
  name: string;
  type?: string;
}

/**
 * Decide whether a room is a public/common area or a private guest room.
 *
 * Guest-room classification always wins over any public-looking signal.
 */
export function classifyRoom(room: ClassifiableRoom): ZoneKind {
  if (PRIVATE_PATTERNS.some((re) => re.test(room.name))) return "private";
  if (room.type === "bedroom") return "private";
  if (PUBLIC_PATTERNS.some((re) => re.test(room.name))) return "public";
  // Fall back to type: patios/kitchens/offices/common areas public.
  if (room.type === "patio" || room.type === "kitchen" || room.type === "office") return "public";
  // Unknown "other"-type spaces default to public (they're amenity spaces here).
  if (room.type === "other") return "public";
  // Conservative default: treat anything unrecognised as private (no sensing).
  return "private";
}

export function isPublicArea(room: ClassifiableRoom): boolean {
  return classifyRoom(room) === "public";
}

/* ─── Public-area-only mode config (per browser/user) ─── */

const PUBLIC_ONLY_KEY = "echo_vue_sensing_public_only";

/**
 * Whether CSI sensing is restricted to public areas. Defaults to TRUE — the
 * privacy-first posture for the hospitality product.
 */
export function isPublicOnlySensing(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(PUBLIC_ONLY_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function setPublicOnlySensing(enabled: boolean): void {
  try {
    localStorage.setItem(PUBLIC_ONLY_KEY, String(enabled));
  } catch {
    /* ignore */
  }
}

/** Whether sensing is allowed for a given room under the current config. */
export function isSensingAllowed(room: ClassifiableRoom): boolean {
  if (!isPublicOnlySensing()) return true;
  return isPublicArea(room);
}

/** Names of the public areas in a room set, in natural order ("Floor 2" before "Floor 10"). */
export function publicAreaNames(rooms: ClassifiableRoom[]): string[] {
  return rooms
    .filter(isPublicArea)
    .map((r) => r.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Split rooms into the sensing-enabled (public) and excluded (private) sets. */
export function partitionBySensing<T extends ClassifiableRoom>(rooms: T[]): { sensed: T[]; excluded: T[] } {
  const sensed: T[] = [];
  const excluded: T[] = [];
  const publicOnly = isPublicOnlySensing();
  for (const r of rooms) {
    if (!publicOnly || isPublicArea(r)) sensed.push(r);
    else excluded.push(r);
  }
  return { sensed, excluded };
}

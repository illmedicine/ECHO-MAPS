/**
 * Hotel Auto-Setup
 *
 * Generates a full hotel/motel room set and a representative floor plan from a
 * compact config, so an operator never has to add 100+ rooms by hand. Rooms are
 * named by hotel convention (floor-prefixed), assigned realistic room classes,
 * and common amenities are added as their own mappable spaces.
 *
 * Tuned from the real Motel 6 Columbia, SC – Fort Jackson Area amenity set
 * (outdoor pool, self-serve laundry, terrace, snack deli, vending, elevator,
 * 24-hour front desk, accessible rooms), but works for any property.
 */

import type { Environment, FloorPlanRoom } from "./environments";

export interface HotelConfig {
  floors: number;
  roomsPerFloor: number;
  /** Accessible (ADA) guest rooms per floor */
  accessiblePerFloor: number;
  includeAmenities: boolean;
}

export interface GeneratedRoom {
  name: string;
  type: Environment["type"];
  dimensions: { width: number; length: number; height: number };
  emoji: string;
}

export interface GeneratedHotel {
  rooms: GeneratedRoom[];
  floorPlan: { width: number; height: number; rooms: FloorPlanRoom[] };
  summary: { guestRooms: number; amenities: number; floors: number };
}

// Defaults match Motel 6 Columbia, SC – Fort Jackson Area
// (7541 Nates Rd): 121 rooms across 3 floors.
export const DEFAULT_HOTEL: HotelConfig = {
  floors: 3,
  roomsPerFloor: 40,
  accessiblePerFloor: 2,
  includeAmenities: true,
};

/** Guest-room classes drawn from the real property's listed room types. */
const ROOM_CLASSES: Array<{ label: string; emoji: string }> = [
  { label: "Deluxe Queen", emoji: "🛏️" },
  { label: "Deluxe Double Queen", emoji: "🛏️" },
  { label: "Premium Quad", emoji: "🛏️" },
  { label: "Deluxe Queen · Non-Smoking", emoji: "🚭" },
];

/** Amenities / common areas, each mapped to a supported room type. */
const AMENITIES: Array<{ name: string; type: Environment["type"]; emoji: string }> = [
  { name: "Front Desk / Lobby", type: "other", emoji: "🛎️" },
  { name: "Outdoor Pool", type: "patio", emoji: "🏊" },
  { name: "Terrace", type: "patio", emoji: "☀️" },
  { name: "Guest Laundry", type: "other", emoji: "🧺" },
  { name: "Snack Deli", type: "kitchen", emoji: "🥪" },
  { name: "Vending Area", type: "other", emoji: "🥤" },
  { name: "Elevator", type: "other", emoji: "🛗" },
  { name: "Stairwell", type: "other", emoji: "🪜" },
];

const GUEST_DIMS = { width: 3.7, length: 6.1, height: 2.7 };

function classFor(num: number, floor: number, isAccessible: boolean): { label: string; emoji: string } {
  return isAccessible ? { label: "Accessible Queen", emoji: "♿" } : ROOM_CLASSES[(num + floor) % ROOM_CLASSES.length];
}

/**
 * Build the whole property as a single floor plan: every floor is a
 * double-loaded corridor (two rows of rooms facing a hallway), floors stacked
 * vertically, amenities in a row beneath. The floor plan is the single source
 * of truth — saveFloorPlan() creates one Environment room per plan room, so
 * guest rooms and amenities stay perfectly in sync.
 *
 * Room labels carry the class (e.g. "Room 214 · Deluxe Queen") so the room
 * cards read richly; the map truncates them to fit.
 */
export function generateHotel(cfg: HotelConfig): GeneratedHotel {
  const rw = GUEST_DIMS.width;
  const rh = GUEST_DIMS.length;
  const corridor = 2.2;
  const floorGap = 3;
  const floorHeight = rh * 2 + corridor;

  const perSide = Math.ceil(cfg.roomsPerFloor / 2);
  const fpRooms: FloorPlanRoom[] = [];
  let guestRooms = 0;

  for (let f = 1; f <= cfg.floors; f++) {
    const blockTop = (f - 1) * (floorHeight + floorGap);
    for (let n = 1; n <= cfg.roomsPerFloor; n++) {
      const num = f * 100 + n;
      const isAccessible = n > cfg.roomsPerFloor - cfg.accessiblePerFloor;
      const cls = classFor(num, f, isAccessible);
      const topRow = n <= perSide;
      const col = topRow ? n - 1 : n - perSide - 1;
      const x = col * rw;
      const y = topRow ? blockTop : blockTop + rh + corridor;
      fpRooms.push({ id: `fp-${num}`, label: `Room ${num} · ${cls.label}`, type: "bedroom", x, y, w: rw, h: rh });
      guestRooms++;
    }
  }

  const totalFloorsHeight = cfg.floors * floorHeight + (cfg.floors - 1) * floorGap;
  let amenities = 0;
  if (cfg.includeAmenities) {
    const amenY = totalFloorsHeight + floorGap;
    const aw = (perSide * rw) / AMENITIES.length - 0.4;
    AMENITIES.forEach((a, i) => {
      fpRooms.push({ id: `fp-amen-${i}`, label: a.name, type: a.type, x: i * (aw + 0.4), y: amenY, w: aw, h: 5 });
      amenities++;
    });
  }

  const width = Math.ceil(perSide * rw);
  const height = Math.ceil(totalFloorsHeight + (cfg.includeAmenities ? floorGap + 5 : 0));

  // `rooms` mirrors the plan (used for the modal's count/preview only).
  const rooms: GeneratedRoom[] = fpRooms.map((r) => ({
    name: r.label,
    type: r.type,
    dimensions: { width: r.w, length: r.h, height: 2.7 },
    emoji: r.type === "bedroom" ? "🛏️" : "📍",
  }));

  return {
    rooms,
    floorPlan: { width, height, rooms: fpRooms },
    summary: { guestRooms, amenities, floors: cfg.floors },
  };
}

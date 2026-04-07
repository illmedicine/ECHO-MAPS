/**
 * Smart Presence Engine
 *
 * Understands household composition and avoids creating duplicate entities.
 * - Household members (owner + pets) are never duplicated.
 * - New BLE devices paired with new vitals = new visitor.
 * - Returning BLE device fingerprint = recognised recurring visitor.
 * - Entities without new BLE evidence are not duplicated.
 */

import {
  getEntities,
  createEntity,
  updateEntity,
  getHousehold,
  isHouseholdMember,
  getVisitors,
  upsertVisitor,
  type TrackedEntity,
  type VisitorRecord,
  getRoomsForEnvironment,
} from "./environments";

/* ─── Types ─── */

export interface RFPresence {
  roomId: string;
  roomName: string;
  isHuman: boolean;
  confidence: number;
  breathingRate: number;
  heartRate: number;
}

export interface DiscoveredDevice {
  name: string | null;
  os: "iOS" | "Android" | "Windows" | "Other" | null;
  manufacturer: string | null;
  companyId: string | null;
  addrType: "random" | "public" | null;
  category: "phone" | "tablet" | "laptop" | "accessory" | "hub" | "unknown";
  roomId: string;
  roomName: string;
  rssi: number;
}

export interface ScanResult {
  newCount: number;
  mergedCount: number;
  visitorCount: number;
  log: string[];
}

/* ─── Device pool for simulated BLE scans ─── */

const DEVICE_POOL: Array<Omit<DiscoveredDevice, "roomId" | "roomName" | "rssi">> = [
  { name: "iPhone 15", os: "iOS", manufacturer: "Apple Inc.", companyId: "0x004C", addrType: "random", category: "phone" },
  { name: "iPad Pro", os: "iOS", manufacturer: "Apple Inc.", companyId: "0x004C", addrType: "random", category: "tablet" },
  { name: "Apple Watch", os: "iOS", manufacturer: "Apple Inc.", companyId: "0x004C", addrType: "random", category: "accessory" },
  { name: "AirPods Pro", os: "iOS", manufacturer: "Apple Inc.", companyId: "0x004C", addrType: "random", category: "accessory" },
  { name: "Google Pixel 9 Plus", os: "Android", manufacturer: "Google LLC", companyId: "0x00E0", addrType: "random", category: "phone" },
  { name: "Nest Hub", os: "Android", manufacturer: "Google LLC", companyId: "0x00E0", addrType: "public", category: "hub" },
  { name: "Galaxy S24", os: "Android", manufacturer: "Samsung Electronics", companyId: "0x0075", addrType: "random", category: "phone" },
  { name: "OnePlus 12", os: "Android", manufacturer: "OnePlus Technology", companyId: "0x038F", addrType: "random", category: "phone" },
  { name: "Surface Pro", os: "Windows", manufacturer: "Microsoft Corp.", companyId: "0x0006", addrType: "public", category: "laptop" },
  // User's spatial anchor devices
  { name: "Blink Cam Hub", os: "Other", manufacturer: "Amazon/Blink", companyId: "0x0171", addrType: "public", category: "hub" },
  { name: "iPod Case Beacon", os: "iOS", manufacturer: "Apple Inc.", companyId: "0x004C", addrType: "random", category: "accessory" },
];

/* ─── Simulated RF scan ─── */

/**
 * RF scan for known household members only.
 * Instead of generating N presences per room, we generate exactly ONE presence
 * per known household entity (matched to a random room from the list).
 * Extra RF ghost signals are only generated if there are more rooms than
 * household members, and are flagged as "unmatched".
 */
export function simulateRFPresences(roomIds: { id: string; name: string }[]): RFPresence[] {
  const presences: RFPresence[] = [];
  const household = getHousehold();
  const existing = getEntities();
  const householdEntities = existing.filter((e) => household.some((h) => h.entityId === e.id));
  const memberRooms = [...roomIds];

  // One RF presence per household entity, placed in a room
  for (const entity of householdEntities) {
    // Use the entity's current room if available and in the scan list, otherwise pick randomly
    const inList = memberRooms.find((r) => r.id === entity.roomId);
    const room = inList || memberRooms[Math.floor(Math.random() * memberRooms.length)];
    if (!room) continue;

    presences.push({
      roomId: room.id,
      roomName: room.name,
      isHuman: entity.type === "person",
      confidence: 0.80 + Math.random() * 0.18,
      breathingRate: entity.type === "pet"
        ? Math.round((18 + Math.random() * 15) * 10) / 10
        : Math.round((13 + Math.random() * 7) * 10) / 10,
      heartRate: entity.type === "pet"
        ? Math.round(90 + Math.random() * 60)
        : Math.round(62 + Math.random() * 25),
      // Carry entity linkage so resolvePresences can match
      _entityId: entity.id,
    } as RFPresence & { _entityId: string });
  }

  return presences;
}

/**
 * BLE scan — only surfaces devices that are actually tethered to household
 * members, plus any genuinely new devices from the device pool (rare).
 * The user's own phone is always returned when household has an owner.
 */
export function simulateBLEDevices(roomIds: { id: string; name: string }[]): DiscoveredDevice[] {
  const devices: DiscoveredDevice[] = [];
  const household = getHousehold();
  const existing = getEntities();

  // Return known tethered devices for household members
  for (const member of household) {
    const entity = existing.find((e) => e.id === member.entityId);
    if (!entity || !entity.bleDeviceName) continue;
    const room = roomIds.find((r) => r.id === entity.roomId) || roomIds[0];
    if (!room) continue;
    devices.push({
      name: entity.bleDeviceName,
      os: (entity.bleDeviceOS as DiscoveredDevice["os"]) || null,
      manufacturer: entity.bleManufacturer,
      companyId: entity.bleCompanyId,
      addrType: (entity.bleAddressType as DiscoveredDevice["addrType"]) || null,
      category: (entity.bleDeviceCategory as DiscoveredDevice["category"]) || "phone",
      roomId: room.id,
      roomName: room.name,
      rssi: -(35 + Math.floor(Math.random() * 20)),
    });
  }

  // Very rarely inject a genuinely new device (5% chance) to simulate a visitor
  if (Math.random() < 0.05 && roomIds.length > 0) {
    const room = roomIds[Math.floor(Math.random() * roomIds.length)];
    // Pick a device NOT already in the household tethered set
    const tetheredNames = new Set(devices.map((d) => d.name));
    const newDev = DEVICE_POOL.filter((d) => d.category === "phone" && !tetheredNames.has(d.name));
    if (newDev.length > 0) {
      const dev = newDev[Math.floor(Math.random() * newDev.length)];
      devices.push({ ...dev, roomId: room.id, roomName: room.name, rssi: -(50 + Math.floor(Math.random() * 30)) });
    }
  }

  // Always include existing registered beacons so they stay active
  const beacons = existing.filter((e) => e.isBeacon && e.bleDeviceName);
  for (const beacon of beacons) {
    const room = roomIds.find((r) => r.id === beacon.roomId) || roomIds[0];
    if (!room) continue;
    devices.push({
      name: beacon.bleDeviceName,
      os: (beacon.bleDeviceOS as DiscoveredDevice["os"]) || null,
      manufacturer: beacon.bleManufacturer,
      companyId: beacon.bleCompanyId,
      addrType: (beacon.bleAddressType as DiscoveredDevice["addrType"]) || null,
      category: (beacon.bleDeviceCategory as DiscoveredDevice["category"]) || "hub",
      roomId: room.id,
      roomName: room.name,
      rssi: -(30 + Math.floor(Math.random() * 15)),
    });
  }

  return devices;
}

/* ─── Core Smart Presence Resolution ─── */

export function resolvePresences(
  rfPresences: RFPresence[],
  bleDevices: DiscoveredDevice[],
): ScanResult {
  const log: string[] = [];
  const existing = getEntities();
  const household = getHousehold();
  const visitors = getVisitors();

  const householdEntityIds = new Set(household.map((m) => m.entityId));
  const householdEntities = existing.filter((e) => householdEntityIds.has(e.id));
  const householdPeople = householdEntities.filter((e) => e.type === "person");
  const householdPets = householdEntities.filter((e) => e.type === "pet");

  // Classify BLE devices
  const phoneDevices = bleDevices.filter((d) => d.category === "phone");
  const accessoryDevices = bleDevices.filter((d) => d.category === "accessory");
  const laptopDevices = bleDevices.filter((d) => d.category === "laptop");
  const hubDevices = bleDevices.filter((d) => d.category === "hub");

  log.push(`WiFi CSI detected ${rfPresences.filter((p) => p.isHuman).length} human and ${rfPresences.filter((p) => !p.isHuman).length} pet-like RF signatures.`);
  log.push(`BLE scan: ${bleDevices.length} device(s) — ${phoneDevices.length} phone(s), ${laptopDevices.length} laptop(s), ${hubDevices.length} hub(s), ${accessoryDevices.length} accessory(ies).`);

  if (laptopDevices.length > 0) log.push(`⊘ Filtered ${laptopDevices.length} laptop(s): ${laptopDevices.map((d) => d.name).join(", ")}`);
  if (hubDevices.length > 0) log.push(`⊘ Filtered ${hubDevices.length} hub(s): ${hubDevices.map((d) => d.name).join(", ")}`);

  // Build a map of phones already tethered to household members
  const tetheredPhoneFingerprints = new Set(
    householdPeople.filter((e) => e.bleDeviceName && e.bleManufacturer)
      .map((e) => `${e.bleDeviceName}|${e.bleManufacturer}`)
  );

  // Identify truly new phones (not already tethered to a household member)
  const newPhones = phoneDevices.filter((d) =>
    d.name && d.manufacturer && !tetheredPhoneFingerprints.has(`${d.name}|${d.manufacturer}`)
  );
  // Known phones are ones already tethered
  const knownPhones = phoneDevices.filter((d) =>
    d.name && d.manufacturer && tetheredPhoneFingerprints.has(`${d.name}|${d.manufacturer}`)
  );

  let newCount = 0;
  let mergedCount = 0;
  let visitorCount = 0;

  const humanRF = rfPresences.filter((p) => p.isHuman);
  const petRF = rfPresences.filter((p) => !p.isHuman);

  // ── Rule 1: Update household people (never create duplicates) ──
  // Match RF presences that carry _entityId back to their household entity
  const usedRFIndices = new Set<number>();
  for (const member of householdPeople) {
    // First try the linked RF presence
    const linkedIdx = humanRF.findIndex((rf, i) => !usedRFIndices.has(i) && (rf as RFPresence & { _entityId?: string })._entityId === member.id);
    const rfIdx = linkedIdx !== -1 ? linkedIdx : humanRF.findIndex((_rf, i) => !usedRFIndices.has(i));
    if (rfIdx !== -1) {
      usedRFIndices.add(rfIdx);
      const rf = humanRF[rfIdx];
      // Determine activity based on current state — keep consistent unless scan detects change
      const currentActivity = member.activity || "Unknown";
      const stableActivities = ["Resting", "Sitting", "Standing"];
      const activity = stableActivities.includes(currentActivity) && Math.random() < 0.7
        ? currentActivity  // Likely still doing the same thing
        : ["Resting", "Sitting", "Standing", "Walking", "Moving"][Math.floor(Math.random() * 5)];

      const knownPhone = knownPhones.find((p) =>
        p.name && p.manufacturer && member.bleDeviceName === p.name && member.bleManufacturer === p.manufacturer
      );
      const bleUpdate: Record<string, unknown> = {
        status: "active",
        confidence: Math.round(rf.confidence * 100) / 100,
        activity,
        breathingRate: rf.breathingRate,
        heartRate: rf.heartRate,
        lastSeen: "Just now",
        roomId: rf.roomId,
        location: rf.roomName,
        // rfSignature is NEVER changed — it persists from entity creation
      };
      if (knownPhone) {
        const distM = Math.round(Math.pow(10, (-59 - knownPhone.rssi) / (10 * 2.5)) * 100) / 100;
        Object.assign(bleUpdate, {
          deviceTetherStatus: "tethered",
          deviceRssi: knownPhone.rssi,
          deviceDistanceM: distM,
        });
      }
      updateEntity(member.id, bleUpdate);
      mergedCount++;
      log.push(`↻ Updated household member ${member.name} (${member.rfSignature}) → ${rf.roomName} [${activity}]`);
    }
  }

  // ── Rule 2: Update household pets (never create duplicates) ──
  for (const pet of householdPets) {
    // Try linked RF presence first
    const linkedIdx = petRF.findIndex((rf) => (rf as RFPresence & { _entityId?: string })._entityId === pet.id);
    const petRfIdx = linkedIdx !== -1 ? linkedIdx : petRF.findIndex(() => true);
    if (petRfIdx !== -1) {
      const rf = petRF[petRfIdx];
      petRF.splice(petRfIdx, 1);
      const currentActivity = pet.activity || "Unknown";
      const activity = currentActivity === "Resting" && Math.random() < 0.75
        ? "Resting"
        : ["Resting", "Moving", "Sitting"][Math.floor(Math.random() * 3)];
      updateEntity(pet.id, {
        status: "active",
        confidence: Math.round(rf.confidence * 100) / 100,
        activity,
        breathingRate: rf.breathingRate,
        heartRate: rf.heartRate,
        lastSeen: "Just now",
        roomId: rf.roomId,
        location: rf.roomName,
        // rfSignature is NEVER changed
      });
      mergedCount++;
      log.push(`↻ Updated household pet ${pet.name} (${pet.rfSignature}) → ${rf.roomName} [${activity}]`);
    }
  }

  // ── Rule 3: Remaining human RF + NEW phone = visitor/new presence ──
  // Only create new entities if there are genuinely new BLE phones
  const remainingHumanRF = humanRF.filter((_rf, i) => !usedRFIndices.has(i));

  for (const rf of remainingHumanRF) {
    if (newPhones.length === 0) {
      // No new BLE phones → this is likely a household member in another room. Skip.
      log.push(`⊘ RF presence in ${rf.roomName} with no new BLE device — skipping (likely household member)`);
      continue;
    }

    const phone = newPhones.shift()!;
    // Check if this phone matches a known visitor
    const knownVisitor = visitors.find((v) =>
      v.bleDeviceName === phone.name && v.bleManufacturer === phone.manufacturer
    );

    if (knownVisitor) {
      // Recurring visitor — re-create entity and update visitor record
      const entity = createEntity({
        name: knownVisitor.name,
        type: "person",
        emoji: knownVisitor.emoji,
        roomId: rf.roomId,
        location: rf.roomName,
      });
      const rssi = phone.rssi;
      const distM = Math.round(Math.pow(10, (-59 - rssi) / (10 * 2.5)) * 100) / 100;
      const macSuffix = `${Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, "0")}:${Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, "0")}`;
      updateEntity(entity.id, {
        status: "active",
        confidence: Math.round(rf.confidence * 100) / 100,
        activity: "Arrived",
        breathingRate: rf.breathingRate,
        heartRate: rf.heartRate,
        lastSeen: "Just now",
        deviceMacSuffix: macSuffix,
        deviceTetherStatus: "tethered",
        deviceRssi: rssi,
        deviceDistanceM: distM,
        bleDeviceName: phone.name,
        bleAddressType: phone.addrType,
        bleManufacturer: phone.manufacturer,
        bleDeviceOS: phone.os,
        bleCompanyId: phone.companyId,
        bleDeviceCategory: "phone",
      });
      upsertVisitor({
        ...knownVisitor,
        lastSeen: new Date().toISOString(),
        entityId: entity.id,
      });
      visitorCount++;
      log.push(`✓ Recurring visitor recognised: ${knownVisitor.name} (${phone.name}) → ${rf.roomName} — visit #${knownVisitor.visitCount + 1}`);
    } else {
      // Brand new visitor
      const entity = createEntity({
        name: `Visitor ${visitors.length + 1}`,
        type: "person",
        emoji: "🧑‍🦰",
        roomId: rf.roomId,
        location: rf.roomName,
      });
      const rssi = phone.rssi;
      const distM = Math.round(Math.pow(10, (-59 - rssi) / (10 * 2.5)) * 100) / 100;
      const macSuffix = `${Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, "0")}:${Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, "0")}`;
      updateEntity(entity.id, {
        status: "active",
        confidence: Math.round(rf.confidence * 100) / 100,
        activity: "Arrived",
        breathingRate: rf.breathingRate,
        heartRate: rf.heartRate,
        lastSeen: "Just now",
        deviceMacSuffix: macSuffix,
        deviceTetherStatus: "tethered",
        deviceRssi: rssi,
        deviceDistanceM: distM,
        bleDeviceName: phone.name,
        bleAddressType: phone.addrType,
        bleManufacturer: phone.manufacturer,
        bleDeviceOS: phone.os,
        bleCompanyId: phone.companyId,
        bleDeviceCategory: "phone",
      });
      upsertVisitor({
        name: entity.name,
        emoji: "🧑‍🦰",
        bleDeviceName: phone.name,
        bleManufacturer: phone.manufacturer,
        bleDeviceOS: phone.os,
        bleCompanyId: phone.companyId,
        lastSeen: new Date().toISOString(),
        entityId: entity.id,
      });
      newCount++;
      visitorCount++;
      log.push(`✓ New visitor detected in ${rf.roomName} — ${phone.name} [${phone.os}]`);
    }
  }

  // ── Rule 4: Remaining pet RF without household pets → new pet ──
  // Only if no household pets exist at all
  if (householdPets.length === 0 && petRF.length > 0) {
    const rf = petRF[0];
    const entity = createEntity({
      name: "Pet 1",
      type: "pet",
      emoji: "🐾",
      roomId: rf.roomId,
      location: rf.roomName,
    });
    updateEntity(entity.id, {
      status: "active",
      confidence: Math.round(rf.confidence * 100) / 100,
      activity: ["Resting", "Moving", "Sitting"][Math.floor(Math.random() * 3)],
      breathingRate: rf.breathingRate,
      heartRate: rf.heartRate,
      lastSeen: "Just now",
    });
    newCount++;
    log.push(`✓ Detected pet in ${rf.roomName} (${entity.rfSignature}) via RF micro-motion`);
  } else if (petRF.length > 0 && householdPets.length > 0) {
    // Already handled above
  } else if (petRF.length > 0) {
    log.push(`⊘ Pet-like RF in area but household pet already tracked — skipping duplicate`);
  }

  // ── Beacon registration — use hubs and accessories as spatial anchors ──
  const beaconDevices = [...hubDevices, ...accessoryDevices];
  for (const dev of beaconDevices) {
    // Check if a beacon entity already exists for this device
    const existingBeacon = existing.find(
      (e) => e.isBeacon && e.bleDeviceName === dev.name && e.bleManufacturer === dev.manufacturer
    );
    if (existingBeacon) {
      // Update RSSI / room
      updateEntity(existingBeacon.id, {
        status: "active",
        deviceRssi: dev.rssi,
        roomId: dev.roomId,
        location: dev.roomName,
        lastSeen: "Just now",
      });
      log.push(`📍 Beacon updated: ${dev.name} in ${dev.roomName} — RSSI ${dev.rssi} dBm`);
    } else {
      // Register new beacon
      const entity = createEntity({
        name: dev.name || "Unknown Beacon",
        type: "person", // Beacons reuse entity storage
        emoji: dev.category === "hub" ? "📡" : "📍",
        roomId: dev.roomId,
        location: dev.roomName,
      });
      updateEntity(entity.id, {
        status: "active",
        isBeacon: true,
        beaconLocationName: dev.roomName,
        bleDeviceName: dev.name,
        bleManufacturer: dev.manufacturer,
        bleDeviceOS: dev.os,
        bleCompanyId: dev.companyId,
        bleDeviceCategory: dev.category,
        deviceRssi: dev.rssi,
        lastSeen: "Just now",
        confidence: 1.0,
        activity: "Anchor",
      });
      log.push(`📍 New beacon registered: ${dev.name} (${dev.manufacturer}) in ${dev.roomName} — spatial anchor for CSI triangulation`);
    }
  }

  const summary = [];
  if (newCount > 0) summary.push(`${newCount} new`);
  if (mergedCount > 0) summary.push(`${mergedCount} updated`);
  if (visitorCount > 0) summary.push(`${visitorCount} visitor(s)`);
  log.push(`Scan complete. ${summary.join(", ") || "No changes"}.`);

  return { newCount, mergedCount, visitorCount, log };
}

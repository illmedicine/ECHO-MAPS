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
];

/* ─── Simulated RF scan ─── */

export function simulateRFPresences(roomIds: { id: string; name: string }[]): RFPresence[] {
  const presences: RFPresence[] = [];
  for (const room of roomIds) {
    // 1 human per room (conservative — the smart engine deduplicates)
    presences.push({
      roomId: room.id,
      roomName: room.name,
      isHuman: true,
      confidence: 0.75 + Math.random() * 0.23,
      breathingRate: Math.round((13 + Math.random() * 10) * 10) / 10,
      heartRate: Math.round(60 + Math.random() * 30),
    });
    // Sometimes detect pet-like signature
    if (Math.random() < 0.45) {
      presences.push({
        roomId: room.id,
        roomName: room.name,
        isHuman: false,
        confidence: 0.5 + Math.random() * 0.3,
        breathingRate: Math.round((15 + Math.random() * 20) * 10) / 10,
        heartRate: Math.round(80 + Math.random() * 80),
      });
    }
  }
  return presences;
}

export function simulateBLEDevices(roomIds: { id: string; name: string }[]): DiscoveredDevice[] {
  const devices: DiscoveredDevice[] = [];
  for (const room of roomIds) {
    const count = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < count; i++) {
      const dev = DEVICE_POOL[Math.floor(Math.random() * DEVICE_POOL.length)];
      devices.push({ ...dev, roomId: room.id, roomName: room.name, rssi: -(35 + Math.floor(Math.random() * 50)) });
    }
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
  // Pick a unique room for each household person from the RF presences
  const usedRFIndices = new Set<number>();
  for (const member of householdPeople) {
    // Find an RF presence in any room to update this member
    const rfIdx = humanRF.findIndex((rf, i) => !usedRFIndices.has(i));
    if (rfIdx !== -1) {
      usedRFIndices.add(rfIdx);
      const rf = humanRF[rfIdx];
      const activities = ["Walking", "Sitting", "Standing", "Resting", "Moving"];
      const knownPhone = knownPhones.find((p) =>
        p.name && p.manufacturer && member.bleDeviceName === p.name && member.bleManufacturer === p.manufacturer
      );
      const bleUpdate: Record<string, unknown> = {
        status: "active",
        confidence: Math.round(rf.confidence * 100) / 100,
        activity: activities[Math.floor(Math.random() * activities.length)],
        breathingRate: rf.breathingRate,
        heartRate: rf.heartRate,
        lastSeen: "Just now",
        roomId: rf.roomId,
        location: rf.roomName,
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
      log.push(`↻ Updated household member ${member.name} (${member.rfSignature}) → ${rf.roomName}`);
    }
  }

  // ── Rule 2: Update household pets (never create duplicates) ──
  for (const pet of householdPets) {
    const petRfIdx = petRF.findIndex(() => true);
    if (petRfIdx !== -1) {
      const rf = petRF[petRfIdx];
      petRF.splice(petRfIdx, 1);
      updateEntity(pet.id, {
        status: "active",
        confidence: Math.round(rf.confidence * 100) / 100,
        activity: ["Resting", "Moving", "Sitting"][Math.floor(Math.random() * 3)],
        breathingRate: rf.breathingRate,
        heartRate: rf.heartRate,
        lastSeen: "Just now",
        roomId: rf.roomId,
        location: rf.roomName,
      });
      mergedCount++;
      log.push(`↻ Updated household pet ${pet.name} (${pet.rfSignature}) → ${rf.roomName}`);
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

  // ── Beacon registration ──
  for (const acc of accessoryDevices) {
    if (acc.rssi > -60) {
      log.push(`📍 Beacon candidate: ${acc.name} (${acc.manufacturer}) in ${acc.roomName} — RSSI ${acc.rssi} dBm`);
    }
  }

  const summary = [];
  if (newCount > 0) summary.push(`${newCount} new`);
  if (mergedCount > 0) summary.push(`${mergedCount} updated`);
  if (visitorCount > 0) summary.push(`${visitorCount} visitor(s)`);
  log.push(`Scan complete. ${summary.join(", ") || "No changes"}.`);

  return { newCount, mergedCount, visitorCount, log };
}

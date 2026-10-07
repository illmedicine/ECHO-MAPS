/**
 * WiFi Site Survey
 *
 * Infrastructure-focused RF survey: discover access points and repeaters/mesh
 * nodes in range, score coverage, flag channel congestion and dead zones, and
 * lay out a signal-footprint topology of the building.
 *
 * This is the property-facing half of Echo Vue — it maps the *WiFi network*
 * (how many APs/repeaters, where coverage is strong or weak, which channels
 * are congested), NOT the people inside. It is the same CSI-capable radio
 * environment used for the demo, read purely as infrastructure.
 *
 * Like the rest of the dashboard, the scan is simulated client-side so the
 * feature is demoable without live capture hardware.
 */

export type Band = "2.4" | "5" | "6";

export interface AccessPoint {
  /** Stable id for React keys / selection */
  id: string;
  /** Broadcast network name */
  ssid: string;
  /** MAC-style BSSID (vendor-prefixed) */
  bssid: string;
  /** Equipment vendor inferred from the BSSID OUI */
  vendor: string;
  band: Band;
  /** WiFi channel number */
  channel: number;
  /** Channel width in MHz */
  widthMhz: number;
  /** Received signal strength in dBm (−30 strong … −90 weak) */
  rssi: number;
  /** Role in the network topology */
  role: "gateway" | "repeater" | "mesh" | "neighbor";
  /** Normalised position on the coverage grid (0..1) */
  x: number;
  y: number;
  /** Security mode */
  security: "WPA3" | "WPA2" | "WPA2/WPA3" | "Open";
}

export interface ChannelLoad {
  band: Band;
  channel: number;
  apCount: number;
  /** true when this 2.4 GHz channel overlaps a non-1/6/11 allocation */
  congested: boolean;
}

export interface SurveyResult {
  scannedAt: string;
  aps: AccessPoint[];
  /** APs that belong to the property's own ESSID (gateway + repeaters/mesh) */
  ownNetworkCount: number;
  repeaterCount: number;
  neighborCount: number;
  bands: Band[];
  channelLoads: ChannelLoad[];
  /** 0..100 overall coverage score across the sampled grid */
  coverageScore: number;
  /** Fraction (0..1) of the grid below the usable threshold */
  deadZoneFraction: number;
  /** True when built from a single-point live capture (coverage is "reach", not a surveyed metric) */
  singlePoint: boolean;
  /** Total own-network radios observed (live capture only) */
  ownRadioCount: number;
  log: string[];
}

/* ─── Vendor / OUI pool (BSSID prefixes are illustrative) ─── */

const VENDOR_POOL: Array<{ vendor: string; oui: string }> = [
  { vendor: "Ubiquiti", oui: "F4:92:BF" },
  { vendor: "Cisco Meraki", oui: "00:18:0A" },
  { vendor: "Aruba (HPE)", oui: "20:4C:03" },
  { vendor: "TP-Link", oui: "50:C7:BF" },
  { vendor: "Netgear", oui: "A0:40:A0" },
  { vendor: "Ruckus", oui: "C0:C5:20" },
  { vendor: "ARRIS", oui: "3C:36:E4" },
];

const CHANNELS_24 = [1, 6, 11];
const CHANNELS_5 = [36, 40, 44, 48, 149, 153, 157, 161];
const CHANNELS_6 = [37, 53, 69, 85];

function randHex(n: number): string {
  return Array.from({ length: n }, () =>
    Math.floor(Math.random() * 16)
      .toString(16)
      .toUpperCase(),
  ).join("");
}

function makeBssid(oui: string): string {
  return `${oui}:${randHex(2)}:${randHex(2)}:${randHex(2)}`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Run a simulated site survey.
 *
 * @param essid     The property's own network name (e.g. the motel WiFi SSID).
 * @param apCount   How many APs/repeaters belong to the property network.
 * @param neighbors How many unrelated nearby networks to surface as context.
 */
export function runSiteSurvey(
  essid = "GuestWiFi",
  apCount = 6,
  neighbors = 4,
): SurveyResult {
  const log: string[] = [];
  const aps: AccessPoint[] = [];

  const infraVendor = pick(VENDOR_POOL);
  log.push(`Beginning passive 802.11 survey for ESSID "${essid}"…`);

  // Gateway + repeaters/mesh nodes for the property network.
  for (let i = 0; i < apCount; i++) {
    const isGateway = i === 0;
    const band: Band = i % 3 === 2 ? "6" : i % 2 === 0 ? "5" : "2.4";
    const channel =
      band === "2.4"
        ? CHANNELS_24[i % CHANNELS_24.length]
        : band === "5"
          ? CHANNELS_5[i % CHANNELS_5.length]
          : CHANNELS_6[i % CHANNELS_6.length];
    // Spread nodes across the grid; gateway sits central.
    const x = isGateway ? 0.5 : 0.12 + Math.random() * 0.76;
    const y = isGateway ? 0.5 : 0.12 + Math.random() * 0.76;
    const rssi = isGateway ? -38 - Math.floor(Math.random() * 6) : -46 - Math.floor(Math.random() * 28);

    aps.push({
      id: `ap-${i}`,
      ssid: essid,
      bssid: makeBssid(infraVendor.oui),
      vendor: infraVendor.vendor,
      band,
      channel,
      widthMhz: band === "2.4" ? 20 : band === "6" ? 160 : 80,
      rssi,
      role: isGateway ? "gateway" : i % 2 === 0 ? "mesh" : "repeater",
      x,
      y,
      security: "WPA2/WPA3",
    });
  }

  // Neighboring networks (context — not part of the property estate).
  for (let i = 0; i < neighbors; i++) {
    const v = pick(VENDOR_POOL);
    const band: Band = Math.random() < 0.5 ? "2.4" : "5";
    const channel = band === "2.4" ? pick([1, 2, 6, 9, 11]) : pick(CHANNELS_5);
    aps.push({
      id: `nb-${i}`,
      ssid: pick(["Setup-5G", "ATT-Guest", "xfinitywifi", "HP-Print", "NETGEAR-2G", "Lobby-POS"]),
      bssid: makeBssid(v.oui),
      vendor: v.vendor,
      band,
      channel,
      widthMhz: band === "2.4" ? 20 : 40,
      rssi: -68 - Math.floor(Math.random() * 22),
      role: "neighbor",
      x: Math.random(),
      y: Math.random(),
      security: pick(["WPA2", "WPA3", "Open"] as const),
    });
  }

  const own = aps.filter((a) => a.role !== "neighbor");
  const repeaterCount = own.filter((a) => a.role === "repeater" || a.role === "mesh").length;
  const neighborCount = aps.length - own.length;
  const bands = Array.from(new Set(own.map((a) => a.band))) as Band[];

  log.push(`Discovered ${own.length} AP(s) on "${essid}": 1 gateway + ${repeaterCount} repeater/mesh node(s).`);
  log.push(`Observed ${neighborCount} neighboring network(s) sharing the airspace.`);

  // Channel congestion: group every observed AP by band+channel.
  const loadMap = new Map<string, ChannelLoad>();
  for (const a of aps) {
    const key = `${a.band}-${a.channel}`;
    const existing = loadMap.get(key);
    if (existing) existing.apCount++;
    else
      loadMap.set(key, {
        band: a.band,
        channel: a.channel,
        apCount: 1,
        // On 2.4 GHz, anything outside the non-overlapping 1/6/11 set congests.
        congested: a.band === "2.4" && !CHANNELS_24.includes(a.channel),
      });
  }
  const channelLoads = Array.from(loadMap.values()).sort(
    (x, y) => x.band.localeCompare(y.band) || x.channel - y.channel,
  );
  const congested = channelLoads.filter((c) => c.congested || c.apCount >= 3);
  if (congested.length)
    log.push(
      `⚠ Channel congestion on ${congested.map((c) => `${c.band}GHz ch${c.channel} (${c.apCount} APs)`).join(", ")}.`,
    );
  else log.push("Channel plan looks clean — no major 2.4 GHz overlap.");

  // Coverage grid: sample a 24×16 grid, take the best own-AP signal at each cell.
  const { coverageScore, deadZoneFraction } = scoreCoverage(own);
  log.push(
    `Coverage score ${coverageScore}/100 · ${(deadZoneFraction * 100).toFixed(0)}% of sampled area below usable signal.`,
  );
  log.push("Survey complete.");

  return {
    scannedAt: new Date().toISOString(),
    aps,
    ownNetworkCount: own.length,
    repeaterCount,
    neighborCount,
    bands,
    channelLoads,
    coverageScore,
    deadZoneFraction,
    singlePoint: false,
    ownRadioCount: own.length,
    log,
  };
}

/** Log-distance path-loss estimate of RSSI at (gx,gy) from an AP. */
export function estimatedRssiAt(ap: AccessPoint, gx: number, gy: number): number {
  const d = Math.hypot(gx - ap.x, gy - ap.y); // 0..~1.4 in grid units
  const metres = Math.max(0.1, d * 20); // treat the grid as ~20 m across
  const pathLoss = 10 * 2.8 * Math.log10(metres);
  // Anchor to the AP's own measured strength at ~1 m.
  return Math.round(ap.rssi - pathLoss + 10 * 2.8 * Math.log10(1));
}

const USABLE_DBM = -72;

export function scoreCoverage(
  own: AccessPoint[],
  cols = 24,
  rows = 16,
): { coverageScore: number; deadZoneFraction: number } {
  if (own.length === 0) return { coverageScore: 0, deadZoneFraction: 1 };
  let usable = 0;
  let total = 0;
  let strengthSum = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gx = (c + 0.5) / cols;
      const gy = (r + 0.5) / rows;
      let best = -120;
      for (const ap of own) best = Math.max(best, estimatedRssiAt(ap, gx, gy));
      total++;
      if (best >= USABLE_DBM) usable++;
      // Map −90..−40 dBm onto 0..1 for an average-quality contribution.
      strengthSum += Math.min(1, Math.max(0, (best + 90) / 50));
    }
  }
  const coverageScore = Math.round((strengthSum / total) * 100);
  const deadZoneFraction = 1 - usable / total;
  return { coverageScore, deadZoneFraction };
}

/* ══════════════════════════════════════════════
   Live capture — build a survey from a real netsh scan
   (frontend/public/live-survey.json, produced by
   scripts/capture-wifi.ps1)
   ══════════════════════════════════════════════ */

export interface LiveRadio {
  ssid: string;
  bssid: string;
  signal: number; // 0..100 %
  band: string; // "2.4 GHz" | "5 GHz" | "6 GHz"
  channel: number;
  radio: string; // e.g. "802.11ax"
}

export interface LiveSnapshot {
  capturedAt: string;
  essid: string;
  adapter: string;
  connectedBssid: string;
  ownOui: string;
  radioCount: number;
  radios: LiveRadio[];
}

/** Known OUI → vendor. Kept small and only where we're confident. */
const OUI_VENDORS: Record<string, string> = {
  "0c:8d:db": "Cisco Meraki",
  "32:8d:db": "Cisco Meraki",
  "88:dc:96": "EnGenius",
  "34:49:5b": "Charter/Spectrum",
};

function vendorForBssid(bssid: string): string {
  const oui = bssid.toLowerCase().split(":").slice(0, 3).join(":");
  return OUI_VENDORS[oui] ?? `OUI ${oui}`;
}

function normalizeBand(band: string): Band {
  if (band.startsWith("6")) return "6";
  if (band.startsWith("5")) return "5";
  return "2.4";
}

/** Windows reports signal quality %; approximate RSSI in dBm. */
export function pctToRssi(pct: number): number {
  return Math.round(pct / 2 - 100);
}

/**
 * Build a SurveyResult from a real single-point capture.
 *
 * Radios are grouped into physical access points by their hardware address
 * (OUI + the 5th octet, which identifies the radio group on multi-band APs),
 * so "15 radios" collapses to the true "N physical APs/repeaters" count.
 *
 * Positions are radial from the capture point — stronger signal = closer —
 * so the coverage map honestly reads as "reach from where you're standing",
 * not a surveyed floor plan. Walk the property and re-capture to fill it in.
 */
export function surveyFromLiveSnapshot(snap: LiveSnapshot): SurveyResult {
  const log: string[] = [];
  log.push(`Loaded live capture · ${new Date(snap.capturedAt).toLocaleString()} · ${snap.adapter}.`);

  const ownRadios = snap.radios.filter((r) => r.ssid === snap.essid && snap.essid !== "");
  const neighborRadios = snap.radios.filter((r) => r.ssid !== snap.essid || snap.essid === "");

  // Group own radios into physical APs by OUI + 5th octet.
  const groups = new Map<string, LiveRadio[]>();
  for (const r of ownRadios) {
    const parts = r.bssid.split(":");
    const key = parts.slice(0, 5).join(":"); // first 5 octets = one physical AP
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const connectedKey = snap.connectedBssid.split(":").slice(0, 5).join(":");
  const aps: AccessPoint[] = [];
  const physAps = Array.from(groups.entries());

  physAps.forEach(([key, radios], idx) => {
    // Representative radio = strongest in the group.
    const strongest = [...radios].sort((a, b) => b.signal - a.signal)[0];
    const isGateway = key === connectedKey;
    const rssi = pctToRssi(strongest.signal);

    // Radial placement: gateway centered, others pushed out as signal drops.
    let x = 0.5;
    let y = 0.5;
    if (!isGateway) {
      const angle = (idx / Math.max(1, physAps.length - 1)) * Math.PI * 2;
      const radius = 0.12 + (1 - strongest.signal / 100) * 0.4;
      x = Math.min(0.94, Math.max(0.06, 0.5 + radius * Math.cos(angle)));
      y = Math.min(0.94, Math.max(0.06, 0.5 + radius * Math.sin(angle)));
    }

    aps.push({
      id: key,
      ssid: snap.essid,
      bssid: strongest.bssid,
      vendor: vendorForBssid(strongest.bssid),
      band: normalizeBand(strongest.band),
      channel: strongest.channel,
      widthMhz: normalizeBand(strongest.band) === "2.4" ? 20 : 80,
      rssi,
      role: isGateway ? "gateway" : strongest.signal >= 60 ? "mesh" : "repeater",
      x,
      y,
      security: "Open",
    });
  });

  // Neighbors — one node per BSSID, positioned at the edge by signal.
  neighborRadios.forEach((r, i) => {
    const angle = (i / Math.max(1, neighborRadios.length)) * Math.PI * 2;
    aps.push({
      id: `nb-${r.bssid}`,
      ssid: r.ssid || "(hidden)",
      bssid: r.bssid,
      vendor: vendorForBssid(r.bssid),
      band: normalizeBand(r.band),
      channel: r.channel,
      widthMhz: 20,
      rssi: pctToRssi(r.signal),
      role: "neighbor",
      x: 0.5 + 0.46 * Math.cos(angle),
      y: 0.5 + 0.46 * Math.sin(angle),
      security: "WPA2",
    });
  });

  const own = aps.filter((a) => a.role !== "neighbor");
  const repeaterCount = own.filter((a) => a.role !== "gateway").length;
  const bands = Array.from(new Set(own.map((a) => a.band))) as Band[];

  log.push(`"${snap.essid}": ${snap.radioCount} radios visible → ${own.length} physical AP(s) (1 gateway + ${repeaterCount} repeater/mesh).`);
  log.push(`${neighborRadios.length} neighboring radio(s) sharing the airspace.`);

  // Channel loads across every observed radio.
  const loadMap = new Map<string, ChannelLoad>();
  for (const r of snap.radios) {
    const band = normalizeBand(r.band);
    const key = `${band}-${r.channel}`;
    const existing = loadMap.get(key);
    if (existing) existing.apCount++;
    else loadMap.set(key, { band, channel: r.channel, apCount: 1, congested: band === "2.4" && !CHANNELS_24.includes(r.channel) });
  }
  const channelLoads = Array.from(loadMap.values()).sort((a, b) => a.band.localeCompare(b.band) || a.channel - b.channel);

  const { coverageScore, deadZoneFraction } = scoreCoverage(own);
  log.push(`Captured from a single vantage point — coverage map shows signal reach from here, not a property-wide survey.`);

  return {
    scannedAt: snap.capturedAt,
    aps,
    ownNetworkCount: own.length,
    repeaterCount,
    neighborCount: neighborRadios.length,
    bands,
    channelLoads,
    coverageScore,
    deadZoneFraction,
    singlePoint: true,
    ownRadioCount: ownRadios.length,
    log,
  };
}

/** Fetch the live capture JSON, if present. Returns null when unavailable. */
export async function loadLiveSnapshot(basePath = ""): Promise<LiveSnapshot | null> {
  try {
    const res = await fetch(`${basePath}/live-survey.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as LiveSnapshot;
    if (!data || !Array.isArray(data.radios)) return null;
    return data;
  } catch {
    return null;
  }
}

/** dBm → a 0..4 bar level for compact signal meters. */
export function signalBars(rssi: number): number {
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -70) return 2;
  if (rssi >= -80) return 1;
  return 0;
}

/** dBm → a coverage color token for heatmaps. */
export function signalColor(rssi: number): string {
  if (rssi >= -55) return "#34A853"; // strong — green
  if (rssi >= -67) return "#9CCC65"; // good
  if (rssi >= USABLE_DBM) return "#FBBC05"; // usable — amber
  if (rssi >= -82) return "#EF8E3B"; // weak
  return "#EA4335"; // dead zone — red
}

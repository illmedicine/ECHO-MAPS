"use client";

/**
 * ZoneInsights — what a bridge can say about a zone beyond present / clear:
 *   · activity level (how much movement),
 *   · breathing rate, when one person is staying fairly still near the link,
 *   · nearby Bluetooth devices, anonymised on the bridge.
 *
 * Nothing here is estimated by the browser: each value is reported by the bridge and
 * checked by the backend. When there is no usable signal it says so instead of guessing.
 */

import type { LiveZone } from "@/lib/api";

const ACTIVITY_STEPS = ["none", "low", "moderate", "high"] as const;
const ACTIVITY_LABEL: Record<(typeof ACTIVITY_STEPS)[number], string> = {
  none: "No movement",
  low: "Light movement",
  moderate: "Moderate movement",
  high: "Heavy movement",
};
const ACTIVITY_COLOR = ["var(--gh-text-muted)", "#B8860B", "#E37400", "#B3261E"];

export function ActivityMeter({ zone }: { zone: LiveZone }) {
  const level = zone.present ? zone.activity : "none";
  const idx = ACTIVITY_STEPS.indexOf(level);
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium">Activity</span>
        <span style={{ color: ACTIVITY_COLOR[idx] }}>{ACTIVITY_LABEL[level]}</span>
      </div>
      <div className="flex gap-1" role="img" aria-label={`Activity level: ${ACTIVITY_LABEL[level]}`}>
        {[1, 2, 3].map((step) => (
          <span key={step} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: idx >= step ? ACTIVITY_COLOR[idx] : "var(--gh-border)" }} />
        ))}
      </div>
    </div>
  );
}

export function BreathingRow({ zone }: { zone: LiveZone }) {
  const b = zone.breathing;
  if (!b || b.state === "none" || b.bpm === null) {
    return (
      <div className="text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium">🫁 Breathing</span>
          <span style={{ color: "var(--gh-text-muted)" }}>No breathing signal</span>
        </div>
        <p className="text-[10px] mt-0.5" style={{ color: "var(--gh-text-muted)" }}>
          Needs one person staying fairly still near the sensor for about 30 seconds.
        </p>
      </div>
    );
  }
  const good = b.state === "good";
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">🫁 Breathing</span>
        <span className="font-semibold" style={{ color: good ? "var(--gh-green)" : "#B8860B" }}>
          {good ? "" : "≈ "}{Math.round(b.bpm)} breaths/min
        </span>
      </div>
      <p className="text-[10px] mt-0.5" style={{ color: "var(--gh-text-muted)" }}>
        {good
          ? `${b.pattern === "steady" ? "Steady" : "Variable"} pattern · ${b.readings} agreeing readings`
          : "Weak signal: readings don't agree yet, so treat this as a rough estimate."}
      </p>
    </div>
  );
}

export function NearbyBle({ zone, showDevices = true }: { zone: LiveZone; showDevices?: boolean }) {
  const ble = zone.ble;
  if (!ble) {
    return (
      <div className="text-xs flex items-center justify-between">
        <span className="font-medium">📶 Nearby devices</span>
        <span style={{ color: "var(--gh-text-muted)" }}>Not reported</span>
      </div>
    );
  }
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">📶 Nearby devices</span>
        <span className="font-semibold">
          {ble.count} <span className="font-normal" style={{ color: "var(--gh-text-muted)" }}>· {ble.near} close · {ble.persistent} persistent</span>
        </span>
      </div>
      {showDevices && ble.devices.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Strongest signals</summary>
          <ul className="mt-1 space-y-0.5">
            {ble.devices.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-[10px]" style={{ color: "var(--gh-text-muted)" }}>
                <code>#{d.id}</code>
                <span>{d.rssi} dBm</span>
                <span>{d.t === 0 ? "fixed address" : "rotating address"}</span>
                {d.p === 1 && <span className="px-1.5 rounded-full" style={{ backgroundColor: "rgba(66,133,244,0.12)", color: "var(--gh-blue)" }}>persistent</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-[10px] mt-1" style={{ color: "var(--gh-text-muted)" }}>
        Anonymised on the bridge: ids are salted hashes that change daily, never real addresses. A persistent device may belong to someone who has been in this area a while, but this is a hint, not an identification.
      </p>
    </div>
  );
}

/** All three, stacked. */
export default function ZoneInsights({ zone }: { zone: LiveZone }) {
  return (
    <div className="space-y-3 mt-3 pt-3" style={{ borderTop: "1px solid var(--gh-border)" }}>
      <ActivityMeter zone={zone} />
      <BreathingRow zone={zone} />
      <NearbyBle zone={zone} />
    </div>
  );
}

/** Compact chips for list cards. Renders nothing when there is nothing to say. */
export function InsightChips({ zone }: { zone: LiveZone }) {
  const chips: string[] = [];
  if (zone.breathing && zone.breathing.state !== "none" && zone.breathing.bpm !== null) {
    chips.push(`🫁 ${zone.breathing.state === "good" ? "" : "≈"}${Math.round(zone.breathing.bpm)}/min`);
  }
  const sigs = zone.breathing?.signatures ?? [];
  const nPets = sigs.filter((s) => s.kind === "faster").length;
  if (sigs.length > 0) chips.push(`👤 ${sigs.length - nPets}${nPets > 0 ? ` · 🐾 ${nPets}` : ""}`);
  if (zone.ble) chips.push(`📶 ${zone.ble.count}`);
  if (zone.present && zone.activity !== "none") chips.push(`↯ ${zone.activity}`);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {chips.map((c) => (
        <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text-muted)" }}>
          {c}
        </span>
      ))}
    </div>
  );
}

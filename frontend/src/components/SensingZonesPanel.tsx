"use client";

/**
 * SensingZonesPanel — shows where CSI sensing is permitted.
 *
 * Public/common areas (lobby, front desk, pool, hallways, …) are sensing-
 * enabled; private guest rooms are excluded. This mirrors the privacy-first
 * policy: no sensing in private rooms. Live presence comes from LivePresencePanel.
 */

import { useEffect, useMemo, useState } from "react";
import { getEnvironments, type Environment } from "@/lib/environments";
import { useLivePresence } from "@/lib/useLivePresence";
import { classifyRoom, isPublicOnlySensing, setPublicOnlySensing } from "@/lib/sensingZones";

export default function SensingZonesPanel() {
  const [rooms, setRooms] = useState<Environment[]>([]);
  const [publicOnly, setPublicOnly] = useState(true);
  const live = useLivePresence(3000);

  useEffect(() => {
    setRooms(getEnvironments());
    setPublicOnly(isPublicOnlySensing());
  }, []);

  const classified = useMemo(() => {
    const pub: Environment[] = [];
    const priv: Environment[] = [];
    for (const r of rooms) {
      const kind = classifyRoom({ id: r.id, name: r.name, type: r.type });
      (kind === "public" ? pub : priv).push(r);
    }
    pub.sort((a, b) => a.name.localeCompare(b.name));
    return { pub, priv };
  }, [rooms]);

  // Occupancy comes from live CSI only. A sensor zone maps to a room by name.
  const liveFor = (roomName: string) =>
    live.zones.find((z) => z.zone.trim().toLowerCase() === roomName.trim().toLowerCase());
  const totalOccupied = classified.pub.filter((r) => liveFor(r.name)?.present).length;
  const reporting = classified.pub.filter((r) => {
    const z = liveFor(r.name);
    return z && z.state !== "offline";
  }).length;

  const toggle = () => {
    const next = !publicOnly;
    setPublicOnly(next);
    setPublicOnlySensing(next);
  };

  if (rooms.length === 0) {
    return (
      <div className="p-5 rounded-2xl text-sm" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)", color: "var(--gh-text-muted)" }}>
        <h3 className="font-semibold mb-1" style={{ color: "var(--gh-text)" }}>🛡️ CSI Sensing Zones</h3>
        No rooms defined yet. Use <strong>Auto-Setup Hotel</strong> on the dashboard to generate the property, then sensing zones appear here.
      </div>
    );
  }

  return (
    <div className="p-5 rounded-2xl" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">🛡️ CSI Sensing Zones</h3>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--gh-text-muted)" }}>
            Occupancy sensing runs only in public / common areas. Private guest rooms are never sensed.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs flex-shrink-0 cursor-pointer" style={{ color: "var(--gh-text-muted)" }}>
          <input type="checkbox" checked={publicOnly} onChange={toggle} />
          Public areas only
        </label>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        <div className="p-3 rounded-xl text-center" style={{ backgroundColor: "rgba(52,168,83,0.1)" }}>
          <p className="text-xl font-bold" style={{ color: "var(--gh-green)" }}>{classified.pub.length}</p>
          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Public areas sensed</p>
        </div>
        <div className="p-3 rounded-xl text-center" style={{ backgroundColor: "var(--gh-card)" }}>
          <p className="text-xl font-bold" style={{ color: "var(--gh-text-muted)" }}>{classified.priv.length}</p>
          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Private rooms excluded</p>
        </div>
        <div className="p-3 rounded-xl text-center" style={{ backgroundColor: "rgba(66,133,244,0.1)" }}>
          <p className="text-xl font-bold" style={{ color: "var(--gh-blue)" }}>{totalOccupied}</p>
          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Areas with presence (live CSI)</p>
        </div>
        <div className="p-3 rounded-xl text-center" style={{ backgroundColor: "rgba(251,188,5,0.12)" }}>
          <p className="text-xl font-bold" style={{ color: "#B8860B" }}>{reporting}</p>
          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Areas with a live sensor</p>
        </div>
      </div>

      {/* Public areas list */}
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Public areas</p>
      <div className="space-y-1.5 mb-4">
        {classified.pub.map((r) => {
          const z = liveFor(r.name);
          const status = !z || z.state === "offline" ? "No live sensor" : z.state === "learning" ? "Calibrating" : z.present ? "Presence detected" : "Clear";
          const color = !z || z.state === "offline" ? "var(--gh-text-muted)" : z.present ? "#B3261E" : "var(--gh-green)";
          return (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ backgroundColor: "var(--gh-card)", border: "1px solid rgba(52,168,83,0.25)" }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-sm flex-1 min-w-0 truncate">{r.emoji ?? "📍"} {r.name}</span>
              <span className="text-[10px] flex-shrink-0" style={{ color }}>{status}</span>
            </div>
          );
        })}
        {classified.pub.length === 0 && (
          <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>No public areas detected in the current room set.</p>
        )}
      </div>

      {/* Private rooms (excluded) */}
      <div className="px-3 py-2.5 rounded-xl flex items-center gap-2" style={{ backgroundColor: "var(--gh-card)", border: "1px dashed var(--gh-border)" }}>
        <span className="text-sm">🔒</span>
        <span className="text-xs flex-1" style={{ color: "var(--gh-text-muted)" }}>
          <strong>{classified.priv.length}</strong> private guest room{classified.priv.length !== 1 ? "s" : ""} — sensing disabled. No CSI data is collected in guest rooms{publicOnly ? "" : " (public-only mode is OFF — enable it to enforce this)"}.
        </span>
      </div>
    </div>
  );
}

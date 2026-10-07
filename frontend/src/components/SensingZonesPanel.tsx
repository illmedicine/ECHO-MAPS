"use client";

/**
 * SensingZonesPanel — shows where CSI sensing is permitted.
 *
 * Public/common areas (lobby, front desk, pool, hallways, …) are sensing-
 * enabled; private guest rooms are excluded. A networked camera marks a space
 * as public. This mirrors the privacy-first policy: no sensing in private rooms.
 */

import { useEffect, useMemo, useState } from "react";
import { getEnvironments, getCameras, getEntities, type Environment } from "@/lib/environments";
import { classifyRoom, isPublicOnlySensing, setPublicOnlySensing } from "@/lib/sensingZones";

export default function SensingZonesPanel() {
  const [rooms, setRooms] = useState<Environment[]>([]);
  const [cameraRoomIds, setCameraRoomIds] = useState<Set<string>>(new Set());
  const [publicOnly, setPublicOnly] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRooms(getEnvironments());
    setCameraRoomIds(new Set(getCameras().map((c) => c.roomId)));
    setPublicOnly(isPublicOnlySensing());
    const iv = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(iv);
  }, []);

  const entities = useMemo(() => getEntities(), [tick]);

  const classified = useMemo(() => {
    const pub: Environment[] = [];
    const priv: Environment[] = [];
    for (const r of rooms) {
      const kind = classifyRoom({ id: r.id, name: r.name, type: r.type, hasNetworkedCamera: cameraRoomIds.has(r.id) });
      (kind === "public" ? pub : priv).push(r);
    }
    pub.sort((a, b) => a.name.localeCompare(b.name));
    return { pub, priv };
  }, [rooms, cameraRoomIds]);

  const occupancyFor = (roomId: string) =>
    entities.filter((e) => e.roomId === roomId && e.status === "active" && !e.isBeacon).length;

  const totalPublicOccupancy = classified.pub.reduce((sum, r) => sum + occupancyFor(r.id), 0);

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
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="p-3 rounded-xl text-center" style={{ backgroundColor: "rgba(52,168,83,0.1)" }}>
          <p className="text-xl font-bold" style={{ color: "var(--gh-green)" }}>{classified.pub.length}</p>
          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Public areas sensed</p>
        </div>
        <div className="p-3 rounded-xl text-center" style={{ backgroundColor: "var(--gh-card)" }}>
          <p className="text-xl font-bold" style={{ color: "var(--gh-text-muted)" }}>{classified.priv.length}</p>
          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Private rooms excluded</p>
        </div>
        <div className="p-3 rounded-xl text-center" style={{ backgroundColor: "rgba(66,133,244,0.1)" }}>
          <p className="text-xl font-bold" style={{ color: "var(--gh-blue)" }}>{totalPublicOccupancy}</p>
          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>People in public areas</p>
        </div>
      </div>

      {/* Public areas list */}
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Sensing Active</p>
      <div className="space-y-1.5 mb-4">
        {classified.pub.map((r) => {
          const occ = occupancyFor(r.id);
          const hasCam = cameraRoomIds.has(r.id);
          return (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ backgroundColor: "var(--gh-card)", border: "1px solid rgba(52,168,83,0.25)" }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: "var(--gh-green)" }} />
              <span className="text-sm flex-1 min-w-0 truncate">{r.emoji ?? "📍"} {r.name}</span>
              {hasCam && <span className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: "rgba(66,133,244,0.12)", color: "var(--gh-blue)" }}>📷 camera</span>}
              <span className="text-[10px] flex-shrink-0" style={{ color: "var(--gh-green)" }}>CSI Active</span>
              {occ > 0 && <span className="text-[10px] flex-shrink-0" style={{ color: "var(--gh-blue)" }}>· {occ} 👤</span>}
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

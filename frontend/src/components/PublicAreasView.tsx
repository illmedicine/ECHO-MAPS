"use client";

/**
 * PublicAreasView — the facility's public areas, each with its live CSI state,
 * the bridge assigned to it, and how it is sensed (automatic or on demand).
 *
 * Guest rooms are never listed or sensed; they only appear as a count.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLivePresence } from "@/lib/useLivePresence";
import { getLivePresence, isBackendConfigured, publishPublicAreas, type LiveZone } from "@/lib/api";
import { classifyRoom, publicAreaNames } from "@/lib/sensingZones";
import { getAreaModes, setAreaMode, type SensingMode } from "@/lib/publicAreaConfig";
import type { Environment } from "@/lib/environments";
import PresenceSpark from "./PresenceSpark";
import ZoneInsights, { InsightChips } from "./ZoneInsights";

type Status = "present" | "clear" | "learning" | "nosensor" | "unscanned" | "failed";
type Filter = "all" | "present" | "clear" | "nosensor";

interface Area {
  room: Environment;
  floor: number | null;
}

interface Resolved {
  status: Status;
  zone: LiveZone | null;   // the reading being shown (live, or the last manual scan)
  bridge: LiveZone | null; // the bridge currently reporting for this area, if any
  scannedAt?: number;
}

interface ManualReading {
  at: number;
  zone: LiveZone | null;
  failed?: boolean;
}

const STATUS_STYLE: Record<Status, { label: string; color: string; bg: string }> = {
  present: { label: "Presence detected", color: "#B3261E", bg: "rgba(234,67,53,0.10)" },
  clear: { label: "Clear", color: "var(--gh-green)", bg: "rgba(52,168,83,0.10)" },
  learning: { label: "Learning baseline", color: "#B8860B", bg: "rgba(251,188,5,0.12)" },
  nosensor: { label: "No live sensor", color: "var(--gh-text-muted)", bg: "var(--gh-card)" },
  unscanned: { label: "Not scanned yet", color: "var(--gh-text-muted)", bg: "var(--gh-card)" },
  failed: { label: "Scan failed", color: "#B3261E", bg: "var(--gh-card)" },
};

function statusOf(z: LiveZone | null): Status {
  if (!z || z.state === "offline") return "nosensor";
  if (z.state === "learning") return "learning";
  return z.present ? "present" : "clear";
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

interface Props {
  rooms: Environment[];
  environmentName: string;
  onAddArea: () => void;
  onAutoSetup: () => void;
  onDeleteRoom: (id: string) => void;
}

export default function PublicAreasView({ rooms, environmentName, onAddArea, onAutoSetup, onDeleteRoom }: Props) {
  const live = useLivePresence(2000);
  const [modes, setModes] = useState<Record<string, SensingMode>>({});
  const [manual, setManual] = useState<Record<string, ManualReading>>({});
  const [scanning, setScanning] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => setModes(getAreaModes()), []);

  // Below the xl breakpoint the detail panel stacks under the list; bring it into view.
  useEffect(() => {
    if (!selectedId || typeof window === "undefined" || window.matchMedia("(min-width: 1280px)").matches) return;
    document.getElementById("area-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  const { areas, privateCount } = useMemo(() => {
    const pub: Area[] = [];
    let priv = 0;
    for (const r of rooms) {
      if (classifyRoom({ id: r.id, name: r.name, type: r.type }) === "public") {
        const m = /floor\s*(\d+)/i.exec(r.name);
        pub.push({ room: r, floor: m ? Number(m[1]) : null });
      } else priv++;
    }
    pub.sort((a, b) => {
      if (a.floor !== null && b.floor !== null) return a.floor - b.floor;
      if (a.floor !== null) return -1;
      if (b.floor !== null) return 1;
      return a.room.name.localeCompare(b.room.name);
    });
    return { areas: pub, privateCount: priv };
  }, [rooms]);

  // Tell the backend which areas this facility has, so each bridge's Area dropdown matches.
  const areaKey = useMemo(() => publicAreaNames(rooms.map((r) => ({ id: r.id, name: r.name, type: r.type }))).join("\n"), [rooms]);
  useEffect(() => {
    if (!isBackendConfigured() || !areaKey) return;
    publishPublicAreas(areaKey.split("\n")).catch(() => {});
  }, [areaKey]);

  const liveFor = (name: string): LiveZone | null => live.zones.find((z) => sameName(z.zone, name)) ?? null;
  const modeOf = (name: string): SensingMode => modes[name] ?? "auto";

  /** What the card should show: live data in automatic mode, the last scan in manual mode. */
  const resolve = (name: string): Resolved => {
    const bridge = liveFor(name); // which bridge covers the area doesn't depend on the sensing mode
    if (modeOf(name) === "auto") return { status: statusOf(bridge), zone: bridge, bridge };
    const r = manual[name];
    if (!r) return { status: "unscanned", zone: null, bridge };
    if (r.failed) return { status: "failed", zone: null, bridge, scannedAt: r.at };
    return { status: statusOf(r.zone), zone: r.zone, bridge, scannedAt: r.at };
  };

  const scan = async (name: string) => {
    setScanning((s) => ({ ...s, [name]: true }));
    try {
      const res = await getLivePresence();
      const z = res.zones.find((x) => sameName(x.zone, name)) ?? null;
      setManual((m) => ({ ...m, [name]: { at: Date.now(), zone: z && z.state !== "offline" ? z : null } }));
    } catch {
      setManual((m) => ({ ...m, [name]: { at: Date.now(), zone: null, failed: true } }));
    } finally {
      setScanning((s) => ({ ...s, [name]: false }));
    }
  };

  const changeMode = (name: string, mode: SensingMode) => setModes(setAreaMode(name, mode));

  const resolved = areas.map((a) => ({ area: a, ...resolve(a.room.name) }));
  const presentNow = resolved.filter((r) => r.status === "present").length;
  const withSensor = resolved.filter((r) => liveFor(r.area.room.name) && liveFor(r.area.room.name)!.state !== "offline").length;

  const matches = (s: Status) =>
    filter === "all" || (filter === "present" && s === "present") || (filter === "clear" && s === "clear") ||
    (filter === "nosensor" && (s === "nosensor" || s === "unscanned"));
  const visible = resolved.filter((r) => matches(r.status));
  const floors = visible.filter((r) => r.area.floor !== null);
  const amenities = visible.filter((r) => r.area.floor === null);
  const selected = resolved.find((r) => r.area.room.id === selectedId) ?? null;

  if (areas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center" style={{ color: "var(--gh-text-muted)" }}>
        <div className="text-6xl mb-4 opacity-30">📍</div>
        <p className="text-lg mb-2">No public areas in {environmentName}</p>
        <p className="text-sm mb-6 max-w-md">
          Public areas (hallways, lobby, pool, laundry…) are what the Illy Bridge sensors monitor. Generate them for a hotel, or add one by hand.
          {privateCount > 0 && ` ${privateCount} private room${privateCount === 1 ? " is" : "s are"} excluded from sensing.`}
        </p>
        <div className="flex gap-3 flex-wrap justify-center">
          <button onClick={onAutoSetup} className="px-5 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "rgba(66,133,244,0.1)", border: "1px solid var(--gh-border)", color: "var(--gh-blue)" }}>
            🏨 Auto-Setup Hotel
          </button>
          <button onClick={onAddArea} className="btn-primary">Add Area</button>
        </div>
      </div>
    );
  }

  const card = (r: (typeof resolved)[number]) => {
    const room = r.area.room;
    const st = STATUS_STYLE[r.status];
    const mode = modeOf(room.name);
    const isSel = room.id === selectedId;
    return (
      <div
        key={room.id}
        role="button"
        tabIndex={0}
        onClick={() => setSelectedId(isSel ? null : room.id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(isSel ? null : room.id); } }}
        className="rounded-xl p-3 cursor-pointer transition"
        style={{ backgroundColor: st.bg, border: `1px solid ${isSel ? "var(--gh-blue)" : "var(--gh-border)"}`, boxShadow: isSel ? "0 0 0 1px var(--gh-blue)" : undefined }}
      >
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none mt-0.5">{room.emoji ?? "📍"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{room.name}</p>
            <p className="text-[11px] truncate" style={{ color: "var(--gh-text-muted)" }}>
              {r.bridge ? `📡 ${r.bridge.bridge_name || "Unnamed bridge"}${r.bridge.state === "offline" ? " (offline)" : ""}` : "No bridge assigned"}
            </p>
          </div>
          <span className="text-[11px] font-semibold flex-shrink-0 text-right" style={{ color: st.color }}>
            {r.status === "present" ? `👤 ${st.label}` : st.label}
          </span>
        </div>

        {r.zone && r.status !== "nosensor" && r.status !== "learning" && (
          <p className="text-[10px] mt-1.5" style={{ color: "var(--gh-text-muted)" }}>
            Confidence {Math.round(r.zone.confidence * 100)}%
            {mode === "auto" && r.zone.age_s !== null ? ` · updated ${Math.round(r.zone.age_s)}s ago` : ""}
          </p>
        )}
        {r.status === "learning" && r.zone && (
          <p className="text-[10px] mt-1.5" style={{ color: "var(--gh-text-muted)" }}>Calibrating baseline… {Math.round(r.zone.learning_progress * 100)}%</p>
        )}

        {r.zone && r.status !== "nosensor" && r.status !== "learning" && <InsightChips zone={r.zone} />}

        <div className="mt-2.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="inline-flex rounded-lg overflow-hidden text-[11px]" style={{ border: "1px solid var(--gh-border)" }} role="group" aria-label={`Sensing mode for ${room.name}`}>
            {(["auto", "manual"] as const).map((m) => (
              <button
                key={m}
                onClick={() => changeMode(room.name, m)}
                aria-pressed={mode === m}
                className="px-2.5 py-1 transition"
                style={{ backgroundColor: mode === m ? "var(--gh-blue)" : "transparent", color: mode === m ? "#fff" : "var(--gh-text-muted)" }}
              >
                {m === "auto" ? "Automatic" : "Manual"}
              </button>
            ))}
          </div>
          {mode === "manual" && (
            <button
              onClick={() => scan(room.name)}
              disabled={!!scanning[room.name]}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium disabled:opacity-60"
              style={{ backgroundColor: "rgba(66,133,244,0.12)", color: "var(--gh-blue)" }}
            >
              {scanning[room.name] ? "Scanning…" : "Scan now"}
            </button>
          )}
          {mode === "manual" && r.scannedAt && (
            <span className="text-[10px] ml-auto" style={{ color: "var(--gh-text-muted)" }}>Last scan {clock(r.scannedAt)}</span>
          )}
        </div>
      </div>
    );
  };

  const grid = (items: typeof resolved) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((r) => card(r))}
    </div>
  );

  const FILTERS: { id: Filter; label: string; n: number }[] = [
    { id: "all", label: "All", n: resolved.length },
    { id: "present", label: "Presence", n: presentNow },
    { id: "clear", label: "Clear", n: resolved.filter((r) => r.status === "clear").length },
    { id: "nosensor", label: "No reading", n: resolved.filter((r) => r.status === "nosensor" || r.status === "unscanned").length },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 min-w-0">
        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
          {[
            { v: areas.length, l: "Public areas", c: "var(--gh-blue)", bg: "rgba(66,133,244,0.1)" },
            { v: withSensor, l: "With a live sensor", c: "var(--gh-green)", bg: "rgba(52,168,83,0.1)" },
            { v: presentNow, l: "Presence now", c: presentNow ? "#B3261E" : "var(--gh-text-muted)", bg: presentNow ? "rgba(234,67,53,0.1)" : "var(--gh-card)" },
            { v: privateCount, l: "Private rooms excluded", c: "var(--gh-text-muted)", bg: "var(--gh-card)" },
          ].map((s) => (
            <div key={s.l} className="p-3 rounded-xl text-center" style={{ backgroundColor: s.bg }}>
              <p className="text-xl font-bold" style={{ color: s.c }}>{s.v}</p>
              <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{s.l}</p>
            </div>
          ))}
        </div>

        {/* Filters + link state */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex gap-1.5 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className="px-3 py-1 rounded-full text-xs font-medium transition"
                style={{ backgroundColor: filter === f.id ? "var(--gh-blue)" : "var(--gh-card)", color: filter === f.id ? "#fff" : "var(--gh-text-muted)", border: "1px solid var(--gh-border)" }}
              >
                {f.label} <span className="opacity-70">{f.n}</span>
              </button>
            ))}
          </div>
          <span className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--gh-text-muted)" }}>
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: live.link === "ok" ? "var(--gh-green)" : live.link === "error" ? "#B3261E" : "var(--gh-text-muted)" }} />
            {live.link === "ok" ? "Live" : live.link === "error" ? "Can't reach the API" : live.link === "no-backend" ? "No backend configured" : "Connecting…"}
          </span>
        </div>

        {live.link === "error" && (
          <p className="text-xs mb-3" style={{ color: "#B3261E" }}>
            Can&apos;t read live presence: {live.error}. The API may be waking up (free tier can take ~30 s), or you may need to sign in with Google.
          </p>
        )}

        {visible.length === 0 && (
          <p className="text-sm py-8 text-center" style={{ color: "var(--gh-text-muted)" }}>No areas match this filter.</p>
        )}

        {floors.length > 0 && (
          <section className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--gh-text-muted)" }}>Floors</h2>
            {grid(floors)}
          </section>
        )}
        {amenities.length > 0 && (
          <section className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--gh-text-muted)" }}>Amenities &amp; common areas</h2>
            {grid(amenities)}
          </section>
        )}

        <div className="px-3 py-2.5 rounded-xl flex items-center gap-2" style={{ backgroundColor: "var(--gh-card)", border: "1px dashed var(--gh-border)" }}>
          <span className="text-sm">🔒</span>
          <span className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
            <strong>{privateCount}</strong> private guest room{privateCount === 1 ? "" : "s"} — never sensed, so they aren&apos;t listed here.
          </span>
        </div>
      </div>

      {/* Detail panel */}
      <aside id="area-detail" className="xl:sticky xl:top-24 self-start">
        <div className="rounded-2xl p-4" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
          {!selected ? (
            <div className="text-center py-10" style={{ color: "var(--gh-text-muted)" }}>
              <div className="text-4xl mb-3 opacity-40">👆</div>
              <p className="text-sm">Select an area to see its live signal, its bridge, and how it is sensed.</p>
            </div>
          ) : (
            <Detail
              r={selected}
              mode={modeOf(selected.area.room.name)}
              scanning={!!scanning[selected.area.room.name]}
              onScan={() => scan(selected.area.room.name)}
              onMode={(m) => changeMode(selected.area.room.name, m)}
              onRemove={() => { onDeleteRoom(selected.area.room.id); setSelectedId(null); }}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function Detail({ r, mode, scanning, onScan, onMode, onRemove }: {
  r: Resolved & { area: Area };
  mode: SensingMode;
  scanning: boolean;
  onScan: () => void;
  onMode: (m: SensingMode) => void;
  onRemove: () => void;
}) {
  const room = r.area.room;
  const st = STATUS_STYLE[r.status];
  const z = r.zone;
  return (
    <div>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl">{room.emoji ?? "📍"}</span>
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{room.name}</h3>
          <p className="text-sm font-medium" style={{ color: st.color }}>{r.status === "present" ? `👤 ${st.label}` : st.label}</p>
        </div>
      </div>

      {z && z.state !== "offline" ? (
        <>
          <div className="rounded-xl p-2 mb-3" style={{ backgroundColor: st.bg }}>
            <PresenceSpark zone={z} height={64} />
            <p className="text-[10px] mt-1" style={{ color: "var(--gh-text-muted)" }}>Motion score, last minute. Dashed line = detection threshold.</p>
          </div>
          <div className="mb-3 -mt-3"><ZoneInsights zone={z} /></div>
          <dl className="grid grid-cols-2 gap-2 text-xs mb-3">
            {[
              ["Confidence", z.state === "learning" ? "—" : `${Math.round(z.confidence * 100)}%`],
              ["Activity", z.present ? z.activity : "none"],
              ["Signal (RSSI)", `${z.rssi} dBm`],
              ["CSI frames", z.frames.toLocaleString()],
              ["Score / threshold", `${z.score.toFixed(3)} / ${z.threshold.toFixed(3)}`],
              ["Baseline", z.baseline.toFixed(3)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg px-2.5 py-1.5" style={{ backgroundColor: "var(--gh-card)" }}>
                <dt style={{ color: "var(--gh-text-muted)" }}>{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        !r.bridge && (
          <div className="rounded-xl p-3 mb-3 text-xs space-y-1.5" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>
            <p className="font-medium" style={{ color: "var(--gh-text)" }}>No bridge is reporting for this area</p>
            <p>1. Put an Illy Bridge in this area and power it on the facility WiFi.</p>
            <p>2. Open its setup page (<code>http://&lt;bridge-ip&gt;/zone</code>).</p>
            <p>3. Name the bridge, and pick <strong>{room.name}</strong> in the Area dropdown.</p>
          </div>
        )
      )}

      <div className="rounded-xl p-3 mb-3 text-xs" style={{ backgroundColor: "var(--gh-card)" }}>
        <p className="font-medium mb-1">Bridge</p>
        {r.bridge ? (
          <>
            <p>📡 {r.bridge.bridge_name || "Unnamed bridge"}</p>
            <p style={{ color: "var(--gh-text-muted)" }}>
              {r.bridge.device_id}
              {r.bridge.age_s !== null ? ` · ${r.bridge.state === "offline" ? "offline, last data" : "last data"} ${Math.round(r.bridge.age_s)}s ago` : ""}
            </p>
          </>
        ) : (
          <p style={{ color: "var(--gh-text-muted)" }}>None assigned</p>
        )}
      </div>

      <div className="mb-3">
        <p className="text-xs font-medium mb-1.5">Sensing</p>
        <div className="inline-flex rounded-lg overflow-hidden text-xs" style={{ border: "1px solid var(--gh-border)" }}>
          {(["auto", "manual"] as const).map((m) => (
            <button key={m} onClick={() => onMode(m)} aria-pressed={mode === m} className="px-3 py-1.5"
              style={{ backgroundColor: mode === m ? "var(--gh-blue)" : "transparent", color: mode === m ? "#fff" : "var(--gh-text-muted)" }}>
              {m === "auto" ? "Automatic" : "Manual"}
            </button>
          ))}
        </div>
        <p className="text-[11px] mt-1.5" style={{ color: "var(--gh-text-muted)" }}>
          {mode === "auto"
            ? "Follows the bridge continuously and updates every couple of seconds."
            : "Only reads this area when you press Scan now."}
        </p>
        {mode === "manual" && (
          <button onClick={onScan} disabled={scanning} className="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60" style={{ backgroundColor: "rgba(66,133,244,0.12)", color: "var(--gh-blue)" }}>
            {scanning ? "Scanning…" : "Scan now"}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between pt-3" style={{ borderTop: "1px solid var(--gh-border)" }}>
        <Link href={`/dashboard/env?id=${room.id}`} className="text-xs hover:underline" style={{ color: "var(--gh-blue)" }}>Open full view →</Link>
        <button onClick={onRemove} className="text-xs hover:underline" style={{ color: "var(--gh-text-muted)" }}>Remove area</button>
      </div>
    </div>
  );
}

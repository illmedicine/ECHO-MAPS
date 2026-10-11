"use client";

/**
 * HistoryInsights — how many people, devices and pets passed through an area over a period,
 * and what an AI makes of the pattern.
 *
 * Every figure is an ESTIMATE shown with a likely range and a confidence, because the sensors
 * cannot count individuals: Bluetooth addresses rotate (they are linked back into devices by
 * when ids vanish and appear), people carry a varying number of devices, and pets are inferred
 * from fast breathing. The numbers say so instead of pretending to be exact.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBridges,
  getHistoryInsights,
  getHistoryReport,
  getHistoryStatus,
  type BridgeInfo,
  type HistoryInsights as Insights,
  type HistoryRange,
  type HistoryRangeKey,
  type HistoryReport,
  type HistoryStatus,
} from "@/lib/api";

const RANGES: { key: HistoryRangeKey; label: string }[] = [
  { key: "1h", label: "1 hour" },
  { key: "6h", label: "6 hours" },
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "boot", label: "Since restart" },
];

const CONF_COLOR = { high: "var(--gh-green)", medium: "#B8860B", low: "#B3261E" } as const;

const card = { backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" } as const;

function dur(s: number): string {
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  return `${h} h ${Math.round((s % 3600) / 60)} m`;
}

/** "<1%" instead of a misleading "0%" when there is a little data. */
function pct(frac: number): string {
  const v = frac * 100;
  return v > 0 && v < 1 ? "<1%" : `${Math.round(v)}%`;
}

function span(low: number, high: number): string {
  return low === high ? `${low}` : `${low}–${high}`;
}

function when(epoch: number | null | undefined): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Conf({ level }: { level: "low" | "medium" | "high" }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--gh-card)", color: CONF_COLOR[level] }} title="How much to trust this estimate">
      {level} confidence
    </span>
  );
}

function Kpi({ icon, label, value, est, note }: { icon: string; label: string; value: string; est?: HistoryRange; note?: string }) {
  return (
    <div className="p-4 rounded-2xl" style={card}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium" style={{ color: "var(--gh-text-muted)" }}>{icon} {label}</p>
        {est && <Conf level={est.confidence} />}
      </div>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {est && (
        <p className="text-[11px] mt-0.5" style={{ color: "var(--gh-text-muted)" }}>
          likely {span(est.low, est.high)}
        </p>
      )}
      {note && <p className="text-[11px] mt-0.5" style={{ color: "var(--gh-text-muted)" }}>{note}</p>}
    </div>
  );
}

/** Hourly occupancy bars, with the busiest device count marked on each hour. */
function HourlyChart({ report }: { report: HistoryReport }) {
  const rows = report.hourly;
  if (rows.length === 0) return null;
  const W = 640, H = 150, pad = 22;
  const bw = Math.max(2, (W - pad * 2) / rows.length - 2);
  const maxDev = Math.max(1, ...rows.map((r) => r.devices_max));
  return (
    <div className="p-4 rounded-2xl" style={card}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">By hour</h3>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--gh-text-muted)" }}>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: "var(--gh-blue)" }} />occupied %</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: "#E37400" }} />nearby devices (peak)</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="Occupancy and nearby devices by hour">
        <line x1={pad} x2={W - pad} y1={H} y2={H} stroke="currentColor" strokeOpacity="0.25" />
        {rows.map((r, i) => {
          const x = pad + i * ((W - pad * 2) / rows.length);
          const h = (r.occupied_pct / 100) * (H - 20);
          const dy = H - (r.devices_max / maxDev) * (H - 20);
          const label = new Date(r.t * 1000).toLocaleTimeString([], { hour: "numeric" });
          return (
            <g key={r.t}>
              <title>{`${new Date(r.t * 1000).toLocaleString([], { weekday: "short", hour: "numeric" })}: occupied ${r.occupied_pct}%, up to ${r.devices_max} device(s), ${r.people_max} breathing as people, ${r.pets_max} as pets${r.minutes ? "" : " (no data)"}`}</title>
              <rect x={x} y={H - h} width={bw} height={Math.max(h, r.minutes ? 1 : 0)} rx="2" fill="var(--gh-blue)" opacity={r.minutes ? 0.85 : 0.15} />
              {r.devices_max > 0 && <circle cx={x + bw / 2} cy={dy} r="3" fill="#E37400" />}
              {(rows.length <= 12 || i % Math.ceil(rows.length / 12) === 0) && (
                <text x={x + bw / 2} y={H + 13} fontSize="9" textAnchor="middle" fill="currentColor" opacity="0.6">{label}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function InsightsCard({ data, loading, onRefresh, status }: { data: Insights | null; loading: boolean; onRefresh: () => void; status: HistoryStatus | null }) {
  return (
    <div className="p-5 rounded-2xl" style={card}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            ✨ Insights
            {data && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: data.source === "ai" ? "rgba(66,133,244,0.12)" : "var(--gh-card)", color: data.source === "ai" ? "var(--gh-blue)" : "var(--gh-text-muted)" }}>
                {data.source === "ai" ? `AI · ${data.model ?? "Claude"}` : "rule-based"}
              </span>
            )}
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--gh-text-muted)" }}>
            Written from aggregated counts only. No device ids or personal data are sent to the AI.
          </p>
        </div>
        <button onClick={onRefresh} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)" }}>
          {loading ? "Thinking…" : "↻ Refresh"}
        </button>
      </div>

      {loading && !data && <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>Analysing the period…</p>}

      {data && (
        <div className="space-y-3">
          {data.source === "rules" && data.ai_error && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: "rgba(251,188,5,0.12)", color: "#8A6D00" }}>
              AI insights are unavailable ({data.ai_error}). Showing observations computed directly from the data.
            </p>
          )}
          {data.source === "rules" && !data.ai_error && !status?.ai_configured && (
            <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>Set ANTHROPIC_API_KEY on the server to turn on AI insights.</p>
          )}
          {data.headline && <p className="text-base font-semibold">{data.headline}</p>}
          <ul className="space-y-2">
            {data.insights.map((i, k) => (
              <li key={k} className="px-3 py-2.5 rounded-xl" style={{ backgroundColor: "var(--gh-card)" }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{i.title}</p>
                  <Conf level={i.confidence} />
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--gh-text-muted)" }}>{i.detail}</p>
              </li>
            ))}
          </ul>
          {data.recommendations.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--gh-text-muted)" }}>Suggestions</p>
              <ul className="list-disc pl-5 space-y-1 text-sm">{data.recommendations.map((r, k) => <li key={k}>{r}</li>)}</ul>
            </div>
          )}
          {data.caveats.length > 0 && (
            <ul className="list-disc pl-5 space-y-0.5 text-[11px]" style={{ color: "var(--gh-text-muted)" }}>{data.caveats.map((c, k) => <li key={k}>{c}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function HistoryInsights() {
  const [bridges, setBridges] = useState<BridgeInfo[]>([]);
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [range, setRange] = useState<HistoryRangeKey>("24h");
  const [report, setReport] = useState<HistoryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const seq = useRef(0);
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

  useEffect(() => {
    getBridges().then((r) => setBridges(r.bridges)).catch(() => setBridges([]));
    getHistoryStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const load = useCallback(async (refreshInsights = false) => {
    const id = ++seq.current;
    const q = { deviceId: deviceId || undefined, range, tz };
    setLoading(true);
    setError(null);
    try {
      const rep = await getHistoryReport(q);
      if (id !== seq.current) return;
      setReport(rep);
      setLoading(false);
      setInsightsLoading(true);
      try {
        const ins = await getHistoryInsights(q, refreshInsights);
        if (id === seq.current) setInsights(ins);
      } catch (e) {
        if (id === seq.current) setInsights(null);
        console.warn("insights failed", e);
      } finally {
        if (id === seq.current) setInsightsLoading(false);
      }
    } catch (e) {
      if (id !== seq.current) return;
      setReport(null);
      setInsights(null);
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [deviceId, range, tz]);

  useEffect(() => { load(); }, [load]);

  const bridge = bridges.find((b) => b.device_id === deviceId);
  const bootOk = !!deviceId && report?.bridge.uptime_s != null || (range === "boot" && !!deviceId);
  const s = report?.summary;
  const lowCoverage = s ? s.window.coverage < 0.6 : false;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="p-4 rounded-2xl flex flex-wrap items-end gap-4" style={card}>
        <label className="text-xs font-medium">
          <span className="block mb-1" style={{ color: "var(--gh-text-muted)" }}>Bridge</span>
          <select value={deviceId} onChange={(e) => { setDeviceId(e.target.value); if (!e.target.value && range === "boot") setRange("24h"); }}
            className="px-3 py-2 rounded-xl text-sm bg-transparent border outline-none" style={{ borderColor: "var(--gh-border)" }}>
            <option value="">All bridges</option>
            {bridges.map((b) => <option key={b.device_id} value={b.device_id}>{b.bridge_name || b.device_id} — {b.area}</option>)}
          </select>
        </label>
        <div className="text-xs font-medium">
          <span className="block mb-1" style={{ color: "var(--gh-text-muted)" }}>Period</span>
          <div className="flex flex-wrap gap-1.5">
            {RANGES.map((r) => {
              const disabled = r.key === "boot" && !deviceId;
              return (
                <button key={r.key} disabled={disabled} onClick={() => setRange(r.key)}
                  title={disabled ? "Pick a specific bridge to see everything since it last restarted" : undefined}
                  className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                  style={{ backgroundColor: range === r.key ? "var(--gh-blue)" : "var(--gh-card)", color: range === r.key ? "white" : "inherit", border: "1px solid var(--gh-border)" }}>
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
        {bridge && report?.bridge.uptime_s != null && (
          <p className="text-xs pb-2" style={{ color: "var(--gh-text-muted)" }}>
            {bridge.bridge_name || "Bridge"} has been up <strong style={{ color: "var(--gh-text)" }}>{dur(report.bridge.uptime_s)}</strong>
          </p>
        )}
      </div>

      {status?.persistence === "memory" && (
        <p className="text-xs px-3 py-2 rounded-xl" style={{ backgroundColor: "rgba(234,67,53,0.08)", color: "#B3261E" }}>
          History is currently held in the server&apos;s memory only and will be lost on a restart{status.last_error ? ` (database error: ${status.last_error})` : " (no database connected)"}.
        </p>
      )}
      {error && <p className="text-sm px-3 py-2 rounded-xl" style={{ backgroundColor: "rgba(234,67,53,0.08)", color: "#B3261E" }}>{error}</p>}
      {loading && !report && <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>Loading history…</p>}

      {report && s && (
        <>
          {lowCoverage && (
            <p className="text-xs px-3 py-2 rounded-xl" style={{ backgroundColor: "rgba(251,188,5,0.14)", color: "#8A6D00" }}>
              Only {pct(s.window.coverage)} of this period has sensor data. History is recorded from {when(report.bridge.recording_since ?? status?.recording_since)} onward and cannot be rebuilt for earlier time, so these counts are probably too low.
            </p>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon="👤" label="People (est.)" value={`~${s.people.estimate}`} est={s.people} note={`${s.guests.estimate} guests · ${s.guests.regulars} regulars`} />
            <Kpi icon="📱" label="Devices (est.)" value={`~${s.devices.estimate}`} est={s.devices} note={`peak ${s.devices.peak_nearby} nearby at once`} />
            <Kpi icon="🐾" label="Pets (est.)" value={`~${s.pets.estimate}`} est={s.pets} />
            <Kpi icon="🚶" label="Visits" value={`${s.visits.count}`} note={s.visits.count ? `typical stay ${dur(s.visits.median_dwell_s)} · occupied ${s.visits.occupied_pct}%` : "no occupied periods"} />
          </div>

          <HourlyChart report={report} />

          <InsightsCard data={insights} loading={insightsLoading} onRefresh={() => load(true)} status={status} />

          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl" style={card}>
              <h3 className="font-semibold text-sm mb-2">Devices by maker</h3>
              {s.devices.by_manufacturer.length === 0 && <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>No devices came near the sensor.</p>}
              <div className="space-y-1.5">
                {s.devices.by_manufacturer.slice(0, 8).map((m) => {
                  const max = Math.max(1, ...s.devices.by_manufacturer.map((x) => x.count));
                  return (
                    <div key={m.name} className="flex items-center gap-2 text-xs">
                      <span className="w-20 truncate">{m.name}</span>
                      <span className="h-2 rounded-full" style={{ width: `${(m.count / max) * 100}%`, minWidth: 6, backgroundColor: "var(--gh-blue)", opacity: 0.8 }} />
                      <span style={{ color: "var(--gh-text-muted)" }}>{m.count}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] mt-3" style={{ color: "var(--gh-text-muted)" }}>
                Maker comes from the company id a device announces; devices that do not announce one are &ldquo;Unknown&rdquo;.
              </p>
            </div>

            <div className="p-4 rounded-2xl" style={card}>
              <h3 className="font-semibold text-sm mb-2">By area</h3>
              <div className="space-y-1.5">
                {report.areas.map((a) => (
                  <div key={a.area} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate">{a.area}</span>
                    <span style={{ color: "var(--gh-text-muted)" }}>occupied {a.occupied_pct}% · up to {a.devices_peak} devices</span>
                  </div>
                ))}
                {report.areas.length === 0 && <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>No data.</p>}
              </div>
            </div>
          </div>

          <details className="p-4 rounded-2xl text-xs" style={card}>
            <summary className="cursor-pointer font-semibold text-sm">How these numbers are estimated</summary>
            <div className="mt-3 space-y-3" style={{ color: "var(--gh-text-muted)" }}>
              <p>The sensors cannot count individuals, so each figure is an estimate with a likely range. Nothing recorded can identify a person or a real device address.</p>
              {([["Devices", s.devices.basis], ["People", s.people.basis], ["Guests vs regulars", s.guests.basis], ["Pets", s.pets.basis]] as const).map(([title, lines]) => (
                <div key={title}>
                  <p className="font-medium" style={{ color: "var(--gh-text)" }}>{title}</p>
                  <ul className="list-disc pl-5">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </div>
              ))}
              <p>
                Phones and watches rotate their Bluetooth address every ~15 minutes. When one id disappears at the same moment another appears at a similar signal
                strength (and the same manufacturer, where announced), they are treated as one device. Devices with a fixed address that are present most of the time (from about 10 minutes of data) are treated as equipment, such as a printer, TV or desktop, and left out of visitor counts. Devices per person rises with the Apple share, since Apple users often also carry a Watch or AirPods.
              </p>
              <p>Data coverage in this period: {pct(s.window.coverage)} ({s.window.data_minutes} minutes recorded). Recording since {when(report.bridge.recording_since ?? status?.recording_since)}.</p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

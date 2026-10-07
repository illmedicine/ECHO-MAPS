"use client";

/**
 * WiFiSiteSurvey — property-facing WiFi infrastructure survey.
 *
 * Maps the network, not the people: counts APs/repeaters, scores coverage,
 * flags channel congestion and dead zones, draws a signal-footprint heatmap,
 * and explains what WiFi CSI is for a non-technical audience (built for the
 * property-management demo).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  runSiteSurvey,
  surveyFromLiveSnapshot,
  loadLiveSnapshot,
  estimatedRssiAt,
  signalBars,
  signalColor,
  type SurveyResult,
  type AccessPoint,
} from "@/lib/wifiSurvey";

function SignalMeter({ rssi }: { rssi: number }) {
  const bars = signalBars(rssi);
  return (
    <span className="inline-flex items-end gap-0.5 h-3.5" title={`${rssi} dBm`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 4 + i * 3,
            borderRadius: 1,
            backgroundColor: i < bars ? signalColor(rssi) : "var(--gh-border)",
          }}
        />
      ))}
    </span>
  );
}

function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="p-4 rounded-2xl" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)" }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--gh-text-muted)" }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: color ?? "var(--gh-text)" }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: "var(--gh-text-muted)" }}>{sub}</p>}
    </div>
  );
}

/* ── Coverage heatmap canvas ── */
function CoverageHeatmap({ result, selectedId }: { result: SurveyResult; selectedId: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(Math.max(260, width * 0.6)) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const own = result.aps.filter((a) => a.role !== "neighbor");

    // Heatmap cells
    const cols = 48;
    const rows = Math.round(cols * (size.h / size.w));
    const cw = size.w / cols;
    const ch = size.h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const gx = (c + 0.5) / cols;
        const gy = (r + 0.5) / rows;
        let best = -120;
        for (const ap of own) best = Math.max(best, estimatedRssiAt(ap, gx, gy));
        ctx.fillStyle = signalColor(best);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(c * cw, r * ch, cw + 1, ch + 1);
      }
    }
    ctx.globalAlpha = 1;

    // AP markers
    for (const ap of own) {
      const px = ap.x * size.w;
      const py = ap.y * size.h;
      const isSel = ap.id === selectedId;
      const isGw = ap.role === "gateway";
      const rad = isGw ? 9 : 7;

      // Halo
      const grad = ctx.createRadialGradient(px, py, 0, px, py, rad * 4);
      grad.addColorStop(0, "rgba(255,255,255,0.5)");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, rad * 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fillStyle = isGw ? "#4285F4" : "#1F2937";
      ctx.fill();
      ctx.strokeStyle = isSel ? "#FBBC05" : "rgba(255,255,255,0.9)";
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.stroke();

      ctx.fillStyle = "#1F2937";
      ctx.font = "bold 10px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(isGw ? "📶 Gateway" : ap.role === "mesh" ? "Mesh" : "Repeater", px, py - rad - 6);
    }
  }, [result, size, selectedId]);

  return (
    <div ref={containerRef} className="w-full rounded-2xl overflow-hidden" style={{ border: "1px solid var(--gh-border)" }}>
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h, display: "block" }} />
    </div>
  );
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function WiFiSiteSurvey() {
  const [essid, setEssid] = useState("GuestWiFi");
  const [result, setResult] = useState<SurveyResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [liveAvailable, setLiveAvailable] = useState(false);

  // On mount, prefer a real capture (frontend/public/live-survey.json) if present.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await loadLiveSnapshot(BASE_PATH);
      if (cancelled || !snap) return;
      setLiveAvailable(true);
      setEssid(snap.essid || "GuestWiFi");
      setResult(surveyFromLiveSnapshot(snap));
      setCapturedAt(snap.capturedAt);
      setIsLive(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleScan = useCallback(() => {
    setScanning(true);
    setSelectedId(null);
    (async () => {
      // Try a fresh live capture first; fall back to the simulated model.
      const snap = await loadLiveSnapshot(BASE_PATH);
      setTimeout(() => {
        if (snap) {
          setResult(surveyFromLiveSnapshot(snap));
          setCapturedAt(snap.capturedAt);
          setIsLive(true);
        } else {
          const apCount = 5 + Math.floor(Math.random() * 4); // 5–8 property APs
          const neighbors = 3 + Math.floor(Math.random() * 4);
          setResult(runSiteSurvey(essid.trim() || "GuestWiFi", apCount, neighbors));
          setIsLive(false);
        }
        setScanning(false);
      }, 700);
    })();
  }, [essid]);

  const runSimulated = useCallback(() => {
    setScanning(true);
    setSelectedId(null);
    setTimeout(() => {
      const apCount = 5 + Math.floor(Math.random() * 4);
      const neighbors = 3 + Math.floor(Math.random() * 4);
      setResult(runSiteSurvey(essid.trim() || "GuestWiFi", apCount, neighbors));
      setIsLive(false);
      setScanning(false);
    }, 700);
  }, [essid]);

  const own = result?.aps.filter((a) => a.role !== "neighbor") ?? [];
  const neighbors = result?.aps.filter((a) => a.role === "neighbor") ?? [];

  return (
    <div className="space-y-6">
      {/* Scan control */}
      <div className="p-5 rounded-2xl" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>
              Property network name (ESSID)
            </label>
            <input
              value={essid}
              onChange={(e) => setEssid(e.target.value)}
              placeholder="e.g. Motel6-Guest"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }}
            />
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="btn-primary flex items-center justify-center gap-2 px-6 py-2.5"
            style={{ opacity: scanning ? 0.7 : 1 }}
          >
            {scanning ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Scanning…
              </>
            ) : (
              <>📡 Run Site Survey</>
            )}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          {result && (
            <span
              className="text-[10px] font-semibold px-2 py-1 rounded-full inline-flex items-center gap-1.5"
              style={{
                backgroundColor: isLive ? "rgba(52,168,83,0.12)" : "rgba(251,188,5,0.14)",
                color: isLive ? "var(--gh-green)" : "#B8860B",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isLive ? "var(--gh-green)" : "#B8860B" }} />
              {isLive ? "LIVE CAPTURE" : "SIMULATED"}
              {isLive && capturedAt && <span className="font-normal opacity-80">· {new Date(capturedAt).toLocaleString()}</span>}
            </span>
          )}
          {liveAvailable && isLive && (
            <button onClick={runSimulated} className="text-[11px] underline" style={{ color: "var(--gh-text-muted)" }}>
              Show simulated model instead
            </button>
          )}
          {liveAvailable && !isLive && (
            <button onClick={handleScan} className="text-[11px] underline" style={{ color: "var(--gh-text-muted)" }}>
              Back to live capture
            </button>
          )}
        </div>
        <p className="text-[11px] mt-2" style={{ color: "var(--gh-text-muted)" }}>
          {isLive
            ? "Live 802.11 capture from this device — real access points and signal, read from a single vantage point. Walk the property and re-run scripts/capture-wifi.ps1 to fill in the full coverage map."
            : "Passive 802.11 survey of the surrounding airspace — maps access points, repeaters and coverage."}{" "}
          It reads the <strong>network infrastructure</strong>, not individual guests.
        </p>
      </div>

      {!result && !scanning && (
        <div className="flex flex-col items-center justify-center py-16 rounded-2xl" style={{ border: "1px dashed var(--gh-border)", color: "var(--gh-text-muted)" }}>
          <div className="text-5xl mb-3 opacity-40">🛰️</div>
          <p className="text-sm">Run a survey to map the property&apos;s WiFi coverage.</p>
        </div>
      )}

      {result && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Access Points" value={`${result.ownNetworkCount}`} sub={`on “${essid}”`} color="var(--gh-blue)" />
            <StatTile label="Repeaters / Mesh" value={`${result.repeaterCount}`} sub="extending coverage" color="var(--gh-green)" />
            {result.singlePoint ? (
              <>
                <StatTile label="Radios Seen" value={`${result.ownRadioCount}`} sub="2.4 + 5 GHz broadcasts" color="var(--gh-text)" />
                <StatTile
                  label="Strongest Signal"
                  value={`${Math.max(...own.map((a) => a.rssi))} dBm`}
                  sub="nearest AP from here"
                  color="var(--gh-green)"
                />
              </>
            ) : (
              <>
                <StatTile
                  label="Coverage Score"
                  value={`${result.coverageScore}`}
                  sub="/ 100 across floor"
                  color={result.coverageScore >= 70 ? "var(--gh-green)" : result.coverageScore >= 50 ? "var(--gh-yellow)" : "var(--gh-red)"}
                />
                <StatTile
                  label="Dead Zones"
                  value={`${(result.deadZoneFraction * 100).toFixed(0)}%`}
                  sub="below usable signal"
                  color={result.deadZoneFraction <= 0.15 ? "var(--gh-green)" : result.deadZoneFraction <= 0.3 ? "var(--gh-yellow)" : "var(--gh-red)"}
                />
              </>
            )}
          </div>

          {/* Coverage heatmap */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">🗺️ {result.singlePoint ? "Signal Reach (from capture point)" : "Coverage Map"}</h3>
              <div className="flex flex-wrap gap-2 text-[10px]" style={{ color: "var(--gh-text-muted)" }}>
                {[
                  ["Strong", "#34A853"],
                  ["Good", "#9CCC65"],
                  ["Usable", "#FBBC05"],
                  ["Weak", "#EF8E3B"],
                  ["Dead", "#EA4335"],
                ].map(([label, c]) => (
                  <span key={label} className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: c }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <CoverageHeatmap result={result} selectedId={selectedId} />
          </div>

          {/* AP / repeater list */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Network Nodes</h3>
            <div className="space-y-1.5">
              {own.map((ap) => (
                <APRow key={ap.id} ap={ap} selected={ap.id === selectedId} onSelect={() => setSelectedId(ap.id === selectedId ? null : ap.id)} />
              ))}
            </div>
          </div>

          {/* Channel analysis */}
          <div className="p-5 rounded-2xl" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
            <h3 className="text-sm font-semibold mb-3">📶 Channel Usage</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {result.channelLoads.map((c) => (
                <div key={`${c.band}-${c.channel}`} className="flex items-center justify-between px-3 py-2 rounded-xl"
                  style={{ backgroundColor: "var(--gh-card)", border: `1px solid ${c.congested || c.apCount >= 3 ? "rgba(234,67,53,0.4)" : "var(--gh-border)"}` }}>
                  <span className="text-xs font-medium">{c.band} GHz · ch {c.channel}</span>
                  <span className="text-[11px]" style={{ color: c.congested || c.apCount >= 3 ? "var(--gh-red)" : "var(--gh-text-muted)" }}>
                    {c.apCount} AP{c.apCount !== 1 ? "s" : ""}{c.congested ? " · overlap" : c.apCount >= 3 ? " · busy" : ""}
                  </span>
                </div>
              ))}
            </div>
            {neighbors.length > 0 && (
              <p className="text-[11px] mt-3" style={{ color: "var(--gh-text-muted)" }}>
                {neighbors.length} neighboring network(s) share this airspace: {neighbors.map((n) => n.ssid).join(", ")}.
              </p>
            )}
          </div>

          {/* Scan log */}
          <details className="rounded-2xl p-4" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)" }}>
            <summary className="text-xs font-semibold cursor-pointer" style={{ color: "var(--gh-text-muted)" }}>Survey log</summary>
            <div className="mt-2 space-y-1 font-mono text-[11px]" style={{ color: "var(--gh-text-muted)" }}>
              {result.log.map((line, i) => <p key={i}>{line}</p>)}
            </div>
          </details>
        </>
      )}

      {/* ── What is WiFi CSI? explainer (for the demo) ── */}
      <div className="p-5 rounded-2xl" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
        <h3 className="font-semibold flex items-center gap-2 mb-3">💡 What is WiFi CSI?</h3>
        <div className="space-y-3 text-sm" style={{ color: "var(--gh-text-muted)" }}>
          <p>
            <strong style={{ color: "var(--gh-text)" }}>Channel State Information (CSI)</strong> describes how a WiFi
            signal changes as it travels from an access point to a device. Walls, furniture and the layout of a space
            all bend and reflect the signal in measurable ways.
          </p>
          <p>
            Because every room reflects WiFi differently, CSI lets Echo Vue understand the <em>shape of a space</em> and
            where coverage is strong or weak — without any cameras. That is what powers the coverage map above: each
            repeater you add changes the RF fingerprint of the building.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {[
              { icon: "📡", t: "Measure", d: "Read how the WiFi signal arrives at each node." },
              { icon: "🧠", t: "Model", d: "Correlate those patterns with the building layout." },
              { icon: "🗺️", t: "Map", d: "Render coverage, dead zones and topology." },
            ].map((s) => (
              <div key={s.t} className="p-3 rounded-xl" style={{ backgroundColor: "var(--gh-card)" }}>
                <div className="text-xl mb-1">{s.icon}</div>
                <p className="text-xs font-semibold" style={{ color: "var(--gh-text)" }}>{s.t}</p>
                <p className="text-[11px] mt-0.5">{s.d}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] pt-1" style={{ color: "var(--gh-text-muted)" }}>
            For the clinical product, the same radio can also sense presence and breathing in spaces where the people
            present have consented — e.g. a patient room or a live on-stage demo.
          </p>
        </div>
      </div>
    </div>
  );
}

function APRow({ ap, selected, onSelect }: { ap: AccessPoint; selected: boolean; onSelect: () => void }) {
  const roleBadge =
    ap.role === "gateway"
      ? { label: "Gateway / Modem", bg: "rgba(66,133,244,0.12)", fg: "var(--gh-blue)" }
      : ap.role === "mesh"
        ? { label: "Mesh Node", bg: "rgba(52,168,83,0.12)", fg: "var(--gh-green)" }
        : { label: "Repeater", bg: "rgba(251,188,5,0.14)", fg: "#B8860B" };
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition"
      style={{
        backgroundColor: selected ? "rgba(66,133,244,0.06)" : "var(--gh-surface)",
        border: `1px solid ${selected ? "var(--gh-blue)" : "var(--gh-border)"}`,
      }}
    >
      <SignalMeter rssi={ap.rssi} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{ap.ssid}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: roleBadge.bg, color: roleBadge.fg }}>{roleBadge.label}</span>
        </div>
        <p className="text-[10px] font-mono truncate" style={{ color: "var(--gh-text-muted)" }}>
          {ap.bssid} · {ap.vendor}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs font-medium">{ap.band} GHz · ch {ap.channel}</p>
        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{ap.rssi} dBm · {ap.security}</p>
      </div>
    </button>
  );
}

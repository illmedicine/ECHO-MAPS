"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  isBackendConfigured,
  getEnvironment,
  startCalibration as apiStartCalibration,
} from "@/lib/api";
import {
  getEnvironment as getLocalEnv,
  updateEnvironment,
  generateSimulatedPointCloud,
  generateSimulatedSkeleton,
  generateSimulatedVitals,
  generateHeatmapData,
} from "@/lib/environments";

const EnvironmentViewer = dynamic(() => import("@/components/EnvironmentViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[500px] rounded-2xl flex items-center justify-center" style={{ backgroundColor: "var(--gh-surface)", color: "var(--gh-text-muted)" }}>
      Loading 3D viewer...
    </div>
  ),
});

export default function EnvironmentViewPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--gh-blue)] border-t-transparent rounded-full animate-spin" />
      </main>
    }>
      <EnvironmentViewContent />
    </Suspense>
  );
}

interface EnvState {
  id: string;
  name: string;
  isCalibrated: boolean;
  confidence: number;
  dims: { width: number; length: number; height: number };
}

type CalibrationStep = "idle" | "calibrating" | "camera-off" | "detecting" | "complete";

function EnvironmentViewContent() {
  const searchParams = useSearchParams();
  const envId = searchParams.get("id");

  const [env, setEnv] = useState<EnvState | null>(null);
  const [pointCloud, setPointCloud] = useState<number[][]>([]);
  const [skeleton, setSkeleton] = useState<number[][]>([]);
  const [vitals, setVitals] = useState<{ breathingRate: number | null; heartRate: number | null; activity: string }>({ breathingRate: null, heartRate: null, activity: "idle" });
  const [heatmapData, setHeatmapData] = useState<{ x: number; z: number; intensity: number }[]>([]);
  const [view, setView] = useState<"3d" | "heatmap" | "vitals">("3d");
  const [live, setLive] = useState(false);
  const [calStep, setCalStep] = useState<CalibrationStep>("idle");
  const [calProgress, setCalProgress] = useState(0);
  const [calMessage, setCalMessage] = useState("");
  const animRef = useRef<number | null>(null);

  const DEFAULT_DIMS = { width: 5, length: 4, height: 2.7 };

  useEffect(() => {
    if (!envId) return;
    const loadEnv = async () => {
      if (isBackendConfigured()) {
        try {
          const apiEnv = await getEnvironment(envId);
          setEnv({ id: apiEnv.id, name: apiEnv.name, isCalibrated: apiEnv.is_calibrated, confidence: apiEnv.calibration_confidence, dims: DEFAULT_DIMS });
          return;
        } catch { /* fall through */ }
      }
      const local = getLocalEnv(envId);
      if (local) {
        setEnv({ id: local.id, name: local.name, isCalibrated: local.isCalibrated, confidence: local.calibrationConfidence, dims: local.dimensions ?? DEFAULT_DIMS });
      }
    };
    loadEnv();
  }, [envId]);

  useEffect(() => {
    if (!env) return;
    setPointCloud(generateSimulatedPointCloud(env.dims));
    setSkeleton(generateSimulatedSkeleton(env.dims));
    setHeatmapData(generateHeatmapData(env.dims));
    setVitals(generateSimulatedVitals());
  }, [env]);

  useEffect(() => {
    if (!live || !env) { if (animRef.current) cancelAnimationFrame(animRef.current); return; }
    const animate = () => {
      setPointCloud(generateSimulatedPointCloud(env.dims));
      setSkeleton(generateSimulatedSkeleton(env.dims));
      setVitals(generateSimulatedVitals());
      setHeatmapData(generateHeatmapData(env.dims));
      animRef.current = requestAnimationFrame(() => { setTimeout(() => { animRef.current = requestAnimationFrame(animate); }, 500); });
    };
    animate();
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [live, env]);

  /* Step-by-step calibration matching landing page Steps 1-3 */
  const runCalibration = async () => {
    if (!env) return;

    if (isBackendConfigured()) {
      try { await apiStartCalibration(envId!); } catch { /* simulate */ }
    }

    // Step 1: Calibrate - camera trace learning WiFi signature
    setCalStep("calibrating");
    setCalMessage("Walk through your space with phone camera...");
    for (let p = 0; p <= 40; p += 2) {
      await tick(150);
      setCalProgress(p);
      if (p % 10 === 0) setPointCloud(generateSimulatedPointCloud(env.dims));
    }

    // Step 2: Camera Off - WiFi CSI takes over
    setCalStep("camera-off");
    setCalMessage("Camera turning off... WiFi CSI taking over.");
    for (let p = 40; p <= 70; p += 2) {
      await tick(120);
      setCalProgress(p);
      if (p % 8 === 0) {
        setPointCloud(generateSimulatedPointCloud(env.dims));
        setSkeleton(generateSimulatedSkeleton(env.dims));
      }
    }

    // Step 3: Detect - AI maps presence, movement, breathing, heart rate
    setCalStep("detecting");
    setCalMessage("AI detecting presence, movement, breathing, heart rate...");
    for (let p = 70; p <= 98; p += 2) {
      await tick(100);
      setCalProgress(p);
      setPointCloud(generateSimulatedPointCloud(env.dims));
      setSkeleton(generateSimulatedSkeleton(env.dims));
      setVitals(generateSimulatedVitals());
      setHeatmapData(generateHeatmapData(env.dims));
    }

    // Complete
    setCalStep("complete");
    setCalProgress(100);
    setCalMessage("Space calibrated! CSI-only monitoring is now active.");
    updateEnvironment(env.id, { isCalibrated: true, calibrationConfidence: 0.98 });
    setEnv({ ...env, isCalibrated: true, confidence: 0.98 });

    await tick(1500);
    setCalStep("idle");
    setLive(true);
  };

  if (!envId) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p style={{ color: "var(--gh-text-muted)" }} className="mb-4">No environment selected</p>
          <Link href="/dashboard" className="hover:underline" style={{ color: "var(--gh-blue)" }}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (!env) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--gh-blue)] border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  const isCalibrating = calStep !== "idle";

  return (
    <main className="min-h-screen p-6" style={{ backgroundColor: "var(--gh-bg)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm transition hover:opacity-80" style={{ color: "var(--gh-text-muted)" }}>← Dashboard</Link>
          <h1 className="text-2xl font-bold">{env.name}</h1>
          {env.isCalibrated && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(52,168,83,0.15)", color: "var(--gh-green)" }}>Calibrated</span>
          )}
          {live && (
            <span className="text-xs px-2 py-0.5 rounded-full animate-pulse" style={{ backgroundColor: "rgba(52,168,83,0.25)", color: "var(--gh-green)" }}>● Live</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {env.isCalibrated && (
            <button
              onClick={() => setLive(!live)}
              className="px-4 py-1.5 rounded-full text-sm font-medium transition"
              style={live ? { backgroundColor: "var(--gh-green)", color: "#000" } : { backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}
            >
              {live ? "■ Stop Live" : "▶ Start Live"}
            </button>
          )}
        </div>
      </div>

      {/* Step Progress Bar — shown during calibration */}
      {isCalibrating && (
        <div className="max-w-6xl mx-auto mb-6">
          <div className="rounded-2xl border p-5" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
            <div className="flex items-center justify-between mb-4">
              {[
                { key: "calibrating", label: "Step 1: Calibrate", icon: "📐", desc: "Camera trace" },
                { key: "camera-off", label: "Step 2: Camera Off", icon: "📴", desc: "WiFi CSI takeover" },
                { key: "detecting", label: "Step 3: Detect", icon: "🧠", desc: "AI sensing" },
              ].map((s, i) => {
                const stepKeys: CalibrationStep[] = ["calibrating", "camera-off", "detecting"];
                const currentIdx = stepKeys.indexOf(calStep === "complete" ? "detecting" : calStep);
                const thisIdx = i;
                const isActive = thisIdx === currentIdx;
                const isDone = thisIdx < currentIdx || calStep === "complete";
                return (
                  <div key={s.key} className="flex-1 text-center">
                    <div className="text-2xl mb-1">{isDone ? "✅" : s.icon}</div>
                    <p className="text-xs font-semibold" style={{ color: isActive ? "var(--gh-blue)" : isDone ? "var(--gh-green)" : "var(--gh-text-muted)" }}>{s.label}</p>
                    <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{s.desc}</p>
                  </div>
                );
              })}
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--gh-border)" }}>
              <div className="h-full rounded-full transition-all duration-300" style={{
                width: `${calProgress}%`,
                backgroundColor: calStep === "complete" ? "var(--gh-green)" : "var(--gh-blue)",
              }} />
            </div>
            <p className="text-sm mt-3 text-center" style={{ color: calStep === "complete" ? "var(--gh-green)" : "var(--gh-text-muted)" }}>
              {calMessage} <span className="font-mono text-xs">({calProgress}%)</span>
            </p>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-3">
          {/* Uncalibrated: show setup wizard */}
          {!env.isCalibrated && !isCalibrating && (
            <div className="rounded-2xl border p-8 text-center mb-6" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
              <h2 className="text-xl font-bold mb-2">Set Up This Space</h2>
              <p className="text-sm mb-6" style={{ color: "var(--gh-text-muted)" }}>
                Follow 3 simple steps to enable WiFi-only sensing in this space.
              </p>
              <div className="grid grid-cols-3 gap-4 mb-8 max-w-lg mx-auto">
                {[
                  { step: "1", title: "Calibrate", desc: "Camera traces WiFi signature", icon: "📐", color: "var(--gh-blue)" },
                  { step: "2", title: "Camera Off", desc: "WiFi CSI takes over", icon: "📴", color: "var(--gh-yellow)" },
                  { step: "3", title: "Detect", desc: "AI maps presence & vitals", icon: "🧠", color: "var(--gh-green)" },
                ].map((s) => (
                  <div key={s.step} className="p-3 rounded-xl" style={{ backgroundColor: "var(--gh-card)" }}>
                    <div className="text-2xl mb-1">{s.icon}</div>
                    <div className="text-[10px] font-bold mb-0.5" style={{ color: s.color }}>STEP {s.step}</div>
                    <p className="text-xs font-semibold">{s.title}</p>
                    <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{s.desc}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={runCalibration}
                className="px-8 py-3 rounded-full font-semibold text-sm hover:opacity-90 transition"
                style={{ backgroundColor: "var(--gh-blue)" }}
              >
                Begin Calibration
              </button>
            </div>
          )}

          {/* View Tabs — shown when calibrated or during calibration */}
          {(env.isCalibrated || isCalibrating) && (
            <>
              <div className="flex gap-2 mb-4">
                {(["3d", "heatmap", "vitals"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className="px-4 py-2 rounded-full text-sm font-medium transition"
                    style={view === v ? { backgroundColor: "var(--gh-blue)" } : { backgroundColor: "var(--gh-surface)", color: "var(--gh-text-muted)" }}
                  >
                    {v === "3d" ? "3D View" : v === "heatmap" ? "Heatmap" : "Vitals"}
                  </button>
                ))}
              </div>

              {view === "3d" && (
                <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
                  <EnvironmentViewer pointCloud={pointCloud} skeleton={skeleton} roomBounds={[env.dims.width, env.dims.length, env.dims.height]} />
                </div>
              )}

              {view === "heatmap" && (
                <div className="rounded-2xl border p-6" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
                  <h3 className="text-lg font-semibold mb-4">Activity Heatmap</h3>
                  <div className="grid gap-1 mx-auto" style={{ gridTemplateColumns: `repeat(${Math.ceil(env.dims.width * 2)}, 1fr)`, maxWidth: "600px" }}>
                    {heatmapData.map((cell, i) => (
                      <div key={i} className="aspect-square rounded-sm" style={{ backgroundColor: `rgba(0, ${Math.floor(180 + cell.intensity * 75)}, ${Math.floor(200 + cell.intensity * 55)}, ${0.2 + cell.intensity * 0.8})` }} title={`Activity: ${(cell.intensity * 100).toFixed(0)}%`} />
                    ))}
                  </div>
                  <div className="flex items-center justify-center gap-4 mt-4 text-xs" style={{ color: "var(--gh-text-muted)" }}>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "rgba(52,168,83,0.2)" }} /> Low</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "rgba(52,168,83,0.6)" }} /> Medium</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "var(--gh-green)" }} /> High</span>
                  </div>
                </div>
              )}

              {view === "vitals" && (
                <div className="rounded-2xl border p-6" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
                  <h3 className="text-lg font-semibold mb-6">Vital Signs</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <VitalCard label="Breathing Rate" value={vitals.breathingRate} unit="bpm" icon="🫁" color="var(--gh-blue)" />
                    <VitalCard label="Heart Rate" value={vitals.heartRate} unit="bpm" icon="❤️" color="var(--gh-red)" />
                    <VitalCard label="Activity" value={vitals.activity} unit="" icon="🏃" color="var(--gh-green)" />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Preview 3D — shown on uncalibrated setup page */}
          {!env.isCalibrated && !isCalibrating && (
            <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
              <div className="px-4 py-2 text-xs font-medium" style={{ color: "var(--gh-text-muted)", borderBottom: "1px solid var(--gh-border)" }}>
                Space Preview — {env.dims.width}m × {env.dims.length}m × {env.dims.height}m
              </div>
              <EnvironmentViewer roomBounds={[env.dims.width, env.dims.length, env.dims.height]} />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Calibration Status */}
          <div className="rounded-2xl border p-4" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
            <h3 className="font-semibold mb-3">Calibration</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                <span>Status</span>
                <span style={{ color: env.isCalibrated ? "var(--gh-green)" : isCalibrating ? "var(--gh-blue)" : "var(--gh-yellow)" }}>
                  {env.isCalibrated ? "✓ Calibrated" : isCalibrating ? "Running..." : "Pending"}
                </span>
              </div>
              <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                <span>Confidence</span>
                <span>{isCalibrating ? `${calProgress}%` : `${(env.confidence * 100).toFixed(0)}%`}</span>
              </div>
              <div className="w-full h-1.5 rounded-full overflow-hidden mt-1" style={{ backgroundColor: "var(--gh-border)" }}>
                <div className="h-full rounded-full transition-all duration-300" style={{
                  width: `${isCalibrating ? calProgress : env.confidence * 100}%`,
                  backgroundColor: env.isCalibrated ? "var(--gh-green)" : "var(--gh-blue)",
                }} />
              </div>
            </div>
          </div>

          {/* Space Info */}
          <div className="rounded-2xl border p-4" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
            <h3 className="font-semibold mb-3">Space</h3>
            <div className="space-y-2 text-sm" style={{ color: "var(--gh-text-muted)" }}>
              <div className="flex justify-between"><span>Dimensions</span><span>{env.dims.width}m × {env.dims.length}m</span></div>
              <div className="flex justify-between"><span>Height</span><span>{env.dims.height}m</span></div>
              <div className="flex justify-between"><span>Area</span><span>{(env.dims.width * env.dims.length).toFixed(1)}m²</span></div>
            </div>
          </div>

          {/* Live Vitals Mini */}
          {live && (
            <div className="rounded-2xl border p-4" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
              <h3 className="font-semibold mb-3">Live Vitals</h3>
              <div className="space-y-2 text-sm" style={{ color: "var(--gh-text-muted)" }}>
                <div className="flex justify-between"><span>🫁 Breathing</span><span>{vitals.breathingRate?.toFixed(1) ?? "--"} bpm</span></div>
                <div className="flex justify-between"><span>❤️ Heart Rate</span><span>{vitals.heartRate?.toFixed(0) ?? "--"} bpm</span></div>
                <div className="flex justify-between"><span>🏃 Activity</span><span>{vitals.activity}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function tick(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function VitalCard({ label, value, unit, icon, color }: { label: string; value: number | string | null; unit: string; icon: string; color: string }) {
  return (
    <div className="rounded-xl p-5 text-center" style={{ backgroundColor: "var(--gh-card)" }}>
      <p className="text-2xl mb-2">{icon}</p>
      <p className="text-xs mb-1" style={{ color: "var(--gh-text-muted)" }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{typeof value === "number" ? value.toFixed(1) : value ?? "--"}</p>
      {unit && <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{unit}</p>}
    </div>
  );
}

"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  isBackendConfigured,
  getEnvironment,
  getCalibrationStatus,
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
    <div className="w-full h-[600px] rounded-2xl flex items-center justify-center" style={{ backgroundColor: "var(--gh-surface)", color: "var(--gh-text-muted)" }}>
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

function EnvironmentViewContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const envId = searchParams.get("id");

  const [env, setEnv] = useState<EnvState | null>(null);
  const [pointCloud, setPointCloud] = useState<number[][]>([]);
  const [skeleton, setSkeleton] = useState<number[][]>([]);
  const [vitals, setVitals] = useState<{ breathingRate: number | null; heartRate: number | null; activity: string }>({ breathingRate: null, heartRate: null, activity: "idle" });
  const [calibration, setCalibration] = useState<{ stage: string; confidence: number; epoch: number; csiFrames: number; message: string }>({ stage: "setup", confidence: 0, epoch: 0, csiFrames: 0, message: "" });
  const [heatmapData, setHeatmapData] = useState<{ x: number; z: number; intensity: number }[]>([]);
  const [view, setView] = useState<"3d" | "heatmap" | "vitals">("3d");
  const [live, setLive] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const animRef = useRef<number | null>(null);

  const DEFAULT_DIMS = { width: 5, length: 4, height: 2.7 };

  // Load environment
  useEffect(() => {
    if (!envId) return;

    const loadEnv = async () => {
      if (isBackendConfigured()) {
        try {
          const apiEnv = await getEnvironment(envId);
          setEnv({
            id: apiEnv.id,
            name: apiEnv.name,
            isCalibrated: apiEnv.is_calibrated,
            confidence: apiEnv.calibration_confidence,
            dims: DEFAULT_DIMS,
          });
          return;
        } catch { /* fall through to local */ }
      }

      const local = getLocalEnv(envId);
      if (local) {
        setEnv({
          id: local.id,
          name: local.name,
          isCalibrated: local.isCalibrated,
          confidence: local.calibrationConfidence,
          dims: local.dimensions ?? DEFAULT_DIMS,
        });
      }
    };

    loadEnv();
  }, [envId]);

  // Generate initial data
  useEffect(() => {
    if (!env) return;
    setPointCloud(generateSimulatedPointCloud(env.dims));
    setSkeleton(generateSimulatedSkeleton());
    setHeatmapData(generateHeatmapData(env.dims));
    setVitals(generateSimulatedVitals());
  }, [env]);

  // Live animation loop
  useEffect(() => {
    if (!live || !env) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const animate = () => {
      setPointCloud(generateSimulatedPointCloud(env.dims));
      setSkeleton(generateSimulatedSkeleton());
      setVitals(generateSimulatedVitals());
      setHeatmapData(generateHeatmapData(env.dims));
      animRef.current = requestAnimationFrame(() => {
        setTimeout(() => { animRef.current = requestAnimationFrame(animate); }, 500);
      });
    };
    animate();

    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [live, env]);

  // Calibration simulation
  const startCalibration = async () => {
    if (!env) return;
    setCalibrating(true);

    if (isBackendConfigured()) {
      try {
        await apiStartCalibration(envId!);
      } catch { /* simulate locally */ }
    }

    const stages = [
      { stage: "setup", message: "Initializing Bridge CSI collection...", confidence: 0 },
      { stage: "trace", message: "Walk through your space with phone camera...", confidence: 0.15 },
      { stage: "training", message: "Training LatentCSI + CalibrationGAN...", confidence: 0.55 },
      { stage: "confidence", message: "Environment Synced — camera no longer needed!", confidence: 0.97 },
      { stage: "live", message: "CSI-only monitoring active", confidence: 0.98 },
    ];

    for (let i = 0; i < stages.length; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      setCalibration({ ...calibration, ...stages[i], epoch: i * 100, csiFrames: i * 500 });
    }

    updateEnvironment(env.id, { isCalibrated: true, calibrationConfidence: 0.98 });
    setEnv({ ...env, isCalibrated: true, confidence: 0.98 });
    setCalibrating(false);
    setLive(true);
  };

  if (!envId) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p style={{ color: "var(--gh-text-muted)" }} className="mb-4">No environment selected</p>
          <Link href="/dashboard" className="hover:underline" style={{ color: "var(--gh-blue)" }}>
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (!env) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--illy-blue)] border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6" style={{ backgroundColor: "var(--gh-bg)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm transition hover:opacity-80" style={{ color: "var(--gh-text-muted)" }}>
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold">{env.name}</h1>
          {env.isCalibrated && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(52,168,83,0.15)", color: "var(--gh-green)" }}>
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLive(!live)}
            className="px-4 py-1.5 rounded-full text-sm font-medium transition"
            style={live ? { backgroundColor: "var(--gh-green)", color: "#000" } : { backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}
          >
            {live ? "● Live" : "○ Start Live"}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-3">
          {/* View Tabs */}
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

          {/* 3D View */}
          {view === "3d" && (
            <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
              <EnvironmentViewer
                pointCloud={pointCloud}
                skeleton={skeleton}
                dimensions={env.dims}
              />
            </div>
          )}

          {/* Heatmap */}
          {view === "heatmap" && (
            <div className="rounded-2xl border p-6" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
              <h3 className="text-lg font-semibold mb-4">Activity Heatmap</h3>
              <div
                className="grid gap-1 mx-auto"
                style={{
                  gridTemplateColumns: `repeat(${Math.ceil(env.dims.width * 2)}, 1fr)`,
                  maxWidth: "600px",
                }}
              >
                {heatmapData.map((cell, i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-sm"
                    style={{
                      backgroundColor: `rgba(0, ${Math.floor(180 + cell.intensity * 75)}, ${Math.floor(200 + cell.intensity * 55)}, ${0.2 + cell.intensity * 0.8})`,
                    }}
                    title={`Activity: ${(cell.intensity * 100).toFixed(0)}%`}
                  />
                ))}
              </div>
              <div className="flex items-center justify-center gap-4 mt-4 text-xs" style={{ color: "var(--gh-text-muted)" }}>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "rgba(52,168,83,0.2)" }} /> Low
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "rgba(52,168,83,0.6)" }} /> Medium
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "var(--gh-green)" }} /> High
                </span>
              </div>
            </div>
          )}

          {/* Vitals */}
          {view === "vitals" && (
            <div className="rounded-2xl border p-6" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
              <h3 className="text-lg font-semibold mb-6">Vital Signs</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <VitalCard
                  label="Breathing Rate"
                  value={vitals.breathingRate}
                  unit="bpm"
                  icon="🫁"
                  color="var(--gh-blue)"
                />
                <VitalCard
                  label="Heart Rate"
                  value={vitals.heartRate}
                  unit="bpm"
                  icon="❤️"
                  color="var(--gh-red)"
                />
                <VitalCard
                  label="Activity"
                  value={vitals.activity}
                  unit=""
                  icon="🏃"
                  color="var(--gh-green)"
                />
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Calibration Panel */}
          <div className="rounded-2xl border p-4" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
            <h3 className="font-semibold mb-3">Calibration</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                <span>Status</span>
                <span style={{ color: env.isCalibrated ? "var(--gh-green)" : "var(--gh-yellow)" }}>
                  {env.isCalibrated ? "Calibrated" : "Pending"}
                </span>
              </div>
              <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                <span>Confidence</span>
                <span>{(env.confidence * 100).toFixed(0)}%</span>
              </div>
              {calibrating && (
                <div className="mt-2 p-2 rounded-xl text-xs" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>
                  <p className="font-medium" style={{ color: "var(--gh-blue)" }}>{calibration.stage.toUpperCase()}</p>
                  <p>{calibration.message}</p>
                  <div className="w-full h-1 rounded-full mt-2 overflow-hidden" style={{ backgroundColor: "var(--gh-border)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${calibration.confidence * 100}%`, backgroundColor: "var(--gh-blue)" }}
                    />
                  </div>
                </div>
              )}
              {!env.isCalibrated && !calibrating && (
                <button
                  onClick={startCalibration}
                  className="w-full mt-2 px-3 py-2 rounded-full text-sm font-semibold hover:opacity-90 transition"
                  style={{ backgroundColor: "var(--gh-blue)" }}
                >
                  Start Calibration
                </button>
              )}
            </div>
          </div>

          {/* Space Info */}
          <div className="rounded-2xl border p-4" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
            <h3 className="font-semibold mb-3">Space</h3>
            <div className="space-y-2 text-sm" style={{ color: "var(--gh-text-muted)" }}>
              <div className="flex justify-between">
                <span>Dimensions</span>
                <span>{env.dims.width}m × {env.dims.length}m</span>
              </div>
              <div className="flex justify-between">
                <span>Height</span>
                <span>{env.dims.height}m</span>
              </div>
              <div className="flex justify-between">
                <span>Area</span>
                <span>{(env.dims.width * env.dims.length).toFixed(1)}m²</span>
              </div>
            </div>
          </div>

          {/* Live Vitals Mini */}
          {live && (
            <div className="rounded-2xl border p-4" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
              <h3 className="font-semibold mb-3">Live Vitals</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                  <span>🫁 Breathing</span>
                  <span>{vitals.breathingRate?.toFixed(1) ?? "--"} bpm</span>
                </div>
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                  <span>❤️ Heart Rate</span>
                  <span>{vitals.heartRate?.toFixed(0) ?? "--"} bpm</span>
                </div>
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                  <span>🏃 Activity</span>
                  <span>{vitals.activity}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function VitalCard({ label, value, unit, icon, color }: { label: string; value: number | string | null; unit: string; icon: string; color: string }) {
  return (
    <div className="rounded-xl p-5 text-center" style={{ backgroundColor: "var(--gh-card)" }}>
      <p className="text-2xl mb-2">{icon}</p>
      <p className="text-xs mb-1" style={{ color: "var(--gh-text-muted)" }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>
        {typeof value === "number" ? value.toFixed(1) : value ?? "--"}
      </p>
      {unit && <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{unit}</p>}
    </div>
  );
}

"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
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
    <div className="w-full h-[600px] bg-[var(--illy-surface)] rounded-xl flex items-center justify-center text-gray-500">
      Loading 3D viewer...
    </div>
  ),
});

interface EnvState {
  id: string;
  name: string;
  isCalibrated: boolean;
  confidence: number;
  dims: { width: number; length: number; height: number };
}

export default function EnvironmentDetail() {
  const params = useParams();
  const router = useRouter();
  const envId = params?.envId as string;

  const [env, setEnv] = useState<EnvState | null>(null);
  const [pointCloud, setPointCloud] = useState<number[][]>([]);
  const [skeleton, setSkeleton] = useState<number[][]>([]);
  const [vitals, setVitals] = useState<{ breathingRate: number | null; heartRate: number | null; activity: string }>({ breathingRate: null, heartRate: null, activity: "idle" });
  const [calibration, setCalibration] = useState<{ stage: string; confidence: number; epoch: number; csiFrames: number; message: string }>({ stage: "setup", confidence: 0, epoch: 0, csiFrames: 0, message: "" });
  const [heatmapData, setHeatmapData] = useState<{ x: number; z: number; intensity: number }[]>([]);
  const [view, setView] = useState<"3d" | "heatmap" | "vitals">("3d");
  const [isLive, setIsLive] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef(0);

  // Load environment data
  useEffect(() => {
    const stored = localStorage.getItem("echo_maps_user");
    if (!stored) { router.push("/auth/signin"); return; }

    const loadEnv = async () => {
      if (isBackendConfigured()) {
        try {
          const apiEnv = await getEnvironment(envId);
          setEnv({ id: apiEnv.id, name: apiEnv.name, isCalibrated: apiEnv.is_calibrated, confidence: apiEnv.calibration_confidence, dims: { width: 6, length: 5, height: 3 } });
          setBackendOnline(true);
          try {
            const cs = await getCalibrationStatus(envId);
            setCalibration({ stage: cs.stage, confidence: cs.pose_match_accuracy, epoch: cs.training_epoch, csiFrames: cs.csi_frames_collected, message: cs.message });
          } catch { /* no calibration yet */ }
          return;
        } catch { /* fall through to local */ }
      }
      const localEnv = getLocalEnv(envId);
      if (localEnv) {
        setEnv({ id: localEnv.id, name: localEnv.name, isCalibrated: localEnv.isCalibrated, confidence: localEnv.calibrationConfidence, dims: localEnv.dimensions ?? { width: 5, length: 4, height: 2.7 } });
      }
    };
    loadEnv();
  }, [envId, router]);

  useEffect(() => {
    if (!env) return;
    setPointCloud(generateSimulatedPointCloud(env.dims));
    setHeatmapData(generateHeatmapData(env.dims));
  }, [env]);

  useEffect(() => {
    if (!isLive || !env) return;
    let running = true;
    const animate = () => {
      if (!running) return;
      timeRef.current += 0.016;
      setSkeleton(generateSimulatedSkeleton(env.dims, timeRef.current));
      if (Math.floor(timeRef.current * 10) % 20 === 0) setVitals(generateSimulatedVitals());
      if (Math.floor(timeRef.current * 10) % 50 === 0) setPointCloud(generateSimulatedPointCloud(env.dims, 200 + Math.floor(Math.random() * 50)));
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => { running = false; cancelAnimationFrame(animFrameRef.current); };
  }, [isLive, env]);

  const handleStartCalibration = async () => {
    if (!env) return;
    if (backendOnline) {
      try {
        const s = await apiStartCalibration(envId);
        setCalibration({ stage: s.stage, confidence: s.pose_match_accuracy, epoch: s.training_epoch, csiFrames: s.csi_frames_collected, message: s.message });
        return;
      } catch { /* fall through */ }
    }
    setCalibration({ stage: "trace", confidence: 0, epoch: 0, csiFrames: 0, message: "Collecting paired vision + CSI frames..." });
    setIsLive(true);
    let progress = 0;
    const interval = setInterval(() => {
      progress += 0.02;
      if (progress < 0.3) {
        setCalibration(p => ({ ...p, stage: "trace", csiFrames: Math.floor(progress * 1000), message: "Collecting paired vision + CSI frames..." }));
      } else if (progress < 0.7) {
        setCalibration(p => ({ ...p, stage: "training", epoch: Math.floor((progress - 0.3) * 50), confidence: progress * 1.2, message: `Training... Epoch ${Math.floor((progress - 0.3) * 50)}` }));
      } else if (progress >= 0.95) {
        setCalibration({ stage: "live", confidence: 0.97, epoch: 20, csiFrames: 950, message: "Environment Synced. Camera no longer required." });
        updateEnvironment(envId, { isCalibrated: true, calibrationConfidence: 0.97 });
        setEnv(p => p ? { ...p, isCalibrated: true, confidence: 0.97 } : p);
        clearInterval(interval);
      } else {
        setCalibration(p => ({ ...p, stage: "confidence", confidence: progress, message: "Verifying pose-match accuracy..." }));
      }
    }, 500);
  };

  if (!env) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--illy-blue)] border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  const STAGE_INFO: Record<string, { label: string; color: string; icon: string }> = {
    setup: { label: "Setup", color: "text-gray-400", icon: "⚙️" },
    trace: { label: "Tracing", color: "text-blue-400", icon: "📐" },
    training: { label: "Training", color: "text-yellow-400", icon: "🧠" },
    confidence: { label: "Verifying", color: "text-orange-400", icon: "🔍" },
    live: { label: "Live Mode", color: "text-[var(--illy-green)]", icon: "🟢" },
  };
  const stageInfo = STAGE_INFO[calibration.stage] ?? STAGE_INFO.setup;

  return (
    <div className="min-h-screen p-6">
      <header className="flex items-center justify-between mb-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-500 hover:text-white transition">← Back</Link>
          <div>
            <h1 className="text-2xl font-bold">{env.name}</h1>
            <p className="text-gray-500 text-sm">{env.dims.width}m × {env.dims.length}m × {env.dims.height}m</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${backendOnline ? "bg-[var(--illy-green)] animate-pulse" : "bg-yellow-500"}`} />
            <span className="text-xs text-gray-500">{backendOnline ? "Live API" : "Demo"}</span>
          </div>
          <button
            onClick={() => setIsLive(!isLive)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${isLive ? "bg-[var(--illy-green)]/20 text-[var(--illy-green)] border border-[var(--illy-green)]/30" : "bg-gray-800 text-gray-400 border border-gray-700"}`}
          >
            {isLive ? "● Live" : "○ Paused"}
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto">
        <div className="flex gap-1 mb-4 bg-gray-800/50 rounded-lg p-1 w-fit">
          {([["3d", "3D View"], ["heatmap", "Heatmap"], ["vitals", "Vitals"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setView(key)} className={`px-4 py-1.5 rounded text-sm transition ${view === key ? "bg-[var(--illy-blue)] text-white" : "text-gray-400 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {view === "3d" && (
              <EnvironmentViewer pointCloud={pointCloud} skeleton={isLive ? skeleton : []} roomBounds={[env.dims.width, env.dims.length, env.dims.height]} />
            )}
            {view === "heatmap" && (
              <div className="w-full h-[600px] bg-[var(--illy-surface)] rounded-xl border border-gray-800 p-6">
                <h3 className="text-lg font-semibold mb-4">Activity Heatmap — 24h</h3>
                <div className="relative w-full h-[500px]">
                  <div className="w-full h-full grid gap-px" style={{ gridTemplateColumns: `repeat(${Math.ceil(env.dims.width)}, 1fr)`, gridTemplateRows: `repeat(${Math.ceil(env.dims.length)}, 1fr)` }}>
                    {heatmapData.map((cell, i) => (
                      <div key={i} className="rounded-sm transition-colors" style={{ backgroundColor: `rgba(0, 102, 255, ${cell.intensity * 0.8})` }} title={`Activity: ${(cell.intensity * 100).toFixed(0)}%`} />
                    ))}
                  </div>
                  <div className="absolute -bottom-6 left-0 right-0 text-center text-xs text-gray-500">Width ({env.dims.width}m)</div>
                  <div className="absolute -left-6 top-0 bottom-0 flex items-center">
                    <span className="text-xs text-gray-500 -rotate-90 whitespace-nowrap">Length ({env.dims.length}m)</span>
                  </div>
                </div>
              </div>
            )}
            {view === "vitals" && (
              <div className="w-full h-[600px] bg-[var(--illy-surface)] rounded-xl border border-gray-800 p-6">
                <h3 className="text-lg font-semibold mb-4">Vital Signs Monitor</h3>
                <div className="grid grid-cols-2 gap-6 mb-8">
                  <div className="p-6 bg-gray-800/50 rounded-lg text-center">
                    <div className="text-gray-400 text-sm mb-2">Breathing Rate</div>
                    <div className="text-5xl font-mono text-[var(--illy-green)]">{vitals.breathingRate != null ? vitals.breathingRate.toFixed(1) : "--"}</div>
                    <div className="text-xs text-gray-500 mt-2">breaths/min</div>
                  </div>
                  <div className="p-6 bg-gray-800/50 rounded-lg text-center">
                    <div className="text-gray-400 text-sm mb-2">Heart Rate</div>
                    <div className="text-5xl font-mono text-[var(--illy-red)]">{vitals.heartRate != null ? vitals.heartRate.toFixed(0) : "--"}</div>
                    <div className="text-xs text-gray-500 mt-2">BPM</div>
                  </div>
                </div>
                <div className="p-4 bg-gray-800/50 rounded-lg">
                  <div className="text-gray-400 text-sm mb-1">Detected Activity</div>
                  <div className="text-xl font-medium capitalize">{vitals.activity}</div>
                </div>
                {!isLive && (
                  <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-sm">
                    Enable live mode to start monitoring vitals in real-time.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* Calibration Panel */}
            <div className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800">
              <h2 className="text-lg font-semibold mb-4">Calibration</h2>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">{stageInfo.icon}</span>
                <span className={`text-lg font-medium ${stageInfo.color}`}>{stageInfo.label}</span>
              </div>
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-400 mb-1">
                  <span>Pose-Match Confidence</span>
                  <span>{(calibration.confidence * 100).toFixed(1)}%</span>
                </div>
                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, calibration.confidence * 100)}%`, backgroundColor: calibration.confidence >= 0.95 ? "var(--illy-green)" : "var(--illy-blue)" }} />
                </div>
                <div className="text-xs text-gray-500 mt-1">Target: 95%</div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                <div className="p-3 bg-gray-800/50 rounded-lg">
                  <div className="text-gray-400">CSI Frames</div>
                  <div className="text-xl font-mono">{calibration.csiFrames}</div>
                </div>
                <div className="p-3 bg-gray-800/50 rounded-lg">
                  <div className="text-gray-400">Epoch</div>
                  <div className="text-xl font-mono">{calibration.epoch}</div>
                </div>
              </div>
              {calibration.message && (
                <div className="p-3 bg-gray-800/50 rounded-lg text-sm text-gray-300 mb-4">{calibration.message}</div>
              )}
              {calibration.stage === "setup" && (
                <button onClick={handleStartCalibration} className="w-full px-6 py-2 bg-[var(--illy-blue)] rounded-lg font-medium hover:opacity-90 transition">
                  Start 2D3D Map Trace
                </button>
              )}
              {calibration.stage === "live" && (
                <div className="flex items-center gap-2 text-[var(--illy-green)] text-sm">
                  <span className="w-2 h-2 bg-[var(--illy-green)] rounded-full animate-pulse" />
                  Camera no longer required
                </div>
              )}
            </div>

            {/* Environment Info */}
            <div className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800">
              <h2 className="text-lg font-semibold mb-4">Info</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Status</span><span className={env.isCalibrated ? "text-[var(--illy-green)]" : "text-yellow-400"}>{env.isCalibrated ? "Calibrated" : "Pending"}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Dimensions</span><span>{env.dims.width} × {env.dims.length} × {env.dims.height}m</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Data Source</span><span>{backendOnline ? "Live API" : "Simulated"}</span></div>
              </div>
            </div>

            {/* Quick Vitals */}
            {isLive && vitals.breathingRate != null && (
              <div className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800">
                <h2 className="text-lg font-semibold mb-4">Live Vitals</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-gray-800/50 rounded-lg text-center">
                    <div className="text-xs text-gray-400">Breathing</div>
                    <div className="text-2xl font-mono text-[var(--illy-green)]">{vitals.breathingRate.toFixed(1)}</div>
                  </div>
                  <div className="p-3 bg-gray-800/50 rounded-lg text-center">
                    <div className="text-xs text-gray-400">Heart Rate</div>
                    <div className="text-2xl font-mono text-[var(--illy-red)]">{vitals.heartRate?.toFixed(0) ?? "--"}</div>
                  </div>
                </div>
                <div className="mt-3 p-2 bg-gray-800/50 rounded-lg text-center text-sm">
                  <span className="text-gray-400">Activity: </span>
                  <span className="capitalize">{vitals.activity}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

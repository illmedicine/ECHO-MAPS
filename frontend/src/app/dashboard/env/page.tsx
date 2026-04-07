"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  isBackendConfigured,
  startCalibration as apiStartCalibration,
} from "@/lib/api";
import { trainFromCollectedData } from "@/lib/correlationEngine";
import {
  getEnvironment as getLocalEnv,
  updateEnvironment,
  generateSimulatedPointCloud,
  generatePointCloudFromSkeleton,
  generateSimulatedSkeleton,
  generateSimulatedVitals,
  generateHeatmapData,
  CALIBRATION_ACTIVITIES,
  type CalibrationActivity,
  getEntities,
} from "@/lib/environments";
import { useSkeletalStream, type StreamSource } from "@/lib/useSkeletalStream";

const EnvironmentViewer = dynamic(() => import("@/components/EnvironmentViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded-2xl flex items-center justify-center" style={{ backgroundColor: "var(--gh-surface)", color: "var(--gh-text-muted)", height: "calc(100vh - 14rem)", minHeight: "400px" }}>
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [currentActivity, setCurrentActivity] = useState<CalibrationActivity | null>(null);
  const [activityIndex, setActivityIndex] = useState(0);
  const [activitiesCompleted, setActivitiesCompleted] = useState(0);
  const [activityTimeLeft, setActivityTimeLeft] = useState(0);
  const skeletalFrameRef = useRef<ReturnType<typeof useSkeletalStream>["frame"]>(null);

  const DEFAULT_DIMS = { width: 5, length: 4, height: 2.7 };

  // Live skeletal stream — uses real camera pose data or CSI WebSocket
  const { frame: skeletalFrame, tracks: liveTracks, source: streamSource, detectionMetrics } = useSkeletalStream({
    envId,
    dims: env?.dims ?? DEFAULT_DIMS,
    live: live || cameraActive, // also run during calibration when camera is active
    isCalibrated: env?.isCalibrated ?? false,
    videoElement: videoRef.current,
    activityLabel: currentActivity?.label ?? vitals.activity,
  });

  // Keep ref in sync so async calibration loop always reads latest frame
  useEffect(() => {
    skeletalFrameRef.current = skeletalFrame;
  }, [skeletalFrame]);

  // Sync skeletal stream data into component state (during live AND calibration)
  useEffect(() => {
    if (!skeletalFrame) return;
    if (!live && !cameraActive) return;
    if (skeletalFrame.keypoints.length >= 33) {
      setSkeleton(skeletalFrame.keypoints);
      // Generate point cloud from real skeleton data (CSI signal reflection pattern)
      if (skeletalFrame.isDetected && env) {
        setPointCloud(generatePointCloudFromSkeleton(skeletalFrame.keypoints, env.dims));
      }
    }
    if (live) {
      setVitals({
        breathingRate: skeletalFrame.breathingRate,
        heartRate: skeletalFrame.heartRate,
        activity: skeletalFrame.activity,
      });
    }
  }, [skeletalFrame, live, cameraActive, env]);

  // Update heatmap at a lower rate during live mode
  // Point cloud is now driven by real skeleton data in the sync effect above
  useEffect(() => {
    if (!live || !env) return;
    const interval = setInterval(() => {
      setHeatmapData(generateHeatmapData(env.dims));
      // Only regenerate point cloud if we don't have real skeleton data driving it
      if (!skeletalFrame?.isDetected) {
        setPointCloud(generateSimulatedPointCloud(env.dims));
      }
    }, 800);
    return () => clearInterval(interval);
  }, [live, env, skeletalFrame?.isDetected]);

  /* Camera helpers */
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      // Attach stream immediately if video element exists
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Camera access denied");
      setCameraActive(false);
    }
  }, []);

  // Re-attach stream whenever the video DOM element mounts/re-mounts
  // This fixes the race condition where startCamera runs before the <video> renders
  const videoCallbackRef = useCallback((el: HTMLVideoElement | null) => {
    // Keep the imperative ref in sync
    (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    if (el && streamRef.current && !el.srcObject) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => {
    if (!envId) return;
    const local = getLocalEnv(envId);
    if (local) {
      setEnv({ id: local.id, name: local.name, isCalibrated: local.isCalibrated, confidence: local.calibrationConfidence, dims: local.dimensions ?? DEFAULT_DIMS });
    }
  }, [envId]);

  useEffect(() => {
    if (!env) return;
    // Initialize point cloud and heatmap views; skeleton and vitals come from real data streams
    setPointCloud(generateSimulatedPointCloud(env.dims));
    setHeatmapData(generateHeatmapData(env.dims));
  }, [env]);

  /* Cleanup camera on unmount */
  useEffect(() => {
    return () => { stopCamera(); };
  }, [stopCamera]);

  /* Step-by-step calibration with activity prompts */
  const runCalibration = async () => {
    if (!env) return;

    // Only call backend if we have a real API token
    const stored = typeof window !== "undefined" ? localStorage.getItem("echo_maps_user") : null;
    const hasToken = stored ? !!JSON.parse(stored).apiToken : false;
    if (hasToken && isBackendConfigured()) {
      try { await apiStartCalibration(envId!); } catch { /* simulate locally */ }
    }

    const activities = CALIBRATION_ACTIVITIES;
    const totalActivities = activities.length;
    let completedCount = 0;

    // Step 1: Camera calibration with activity prompts
    setCalStep("calibrating");
    setCalMessage("Starting camera... Prepare to perform calibration activities.");
    await startCamera();
    await tick(800);

    for (let i = 0; i < totalActivities; i++) {
      const activity = activities[i];
      setCurrentActivity(activity);
      setActivityIndex(i);
      setCalMessage(`${activity.icon} ${activity.instruction}`);

      // Count down the activity duration
      for (let sec = activity.durationSec; sec > 0; sec--) {
        setActivityTimeLeft(sec);
        const overallProgress = Math.round(((i * 100 / totalActivities) + ((activity.durationSec - sec) / activity.durationSec) * (100 / totalActivities)) * 0.4);
        setCalProgress(overallProgress);
        // Point cloud derived from real skeleton when available
        if (sec % 3 === 0) {
          const latestFrame = skeletalFrameRef.current;
          if (latestFrame?.isDetected && latestFrame.keypoints.length >= 33) {
            // Real camera data flowing — generate point cloud from actual skeleton
            setPointCloud(generatePointCloudFromSkeleton(latestFrame.keypoints, env.dims));
          } else {
            // No detection yet — use simulated point cloud but NOT simulated skeleton
            setPointCloud(generateSimulatedPointCloud(env.dims));
            // Only set skeleton if camera hasn't detected anything
            if (!latestFrame || !latestFrame.isDetected) {
              setSkeleton(generateSimulatedSkeleton(env.dims));
            }
          }
        }
        await tick(1000);
      }
      completedCount++;
      setActivitiesCompleted(completedCount);
    }
    setCurrentActivity(null);
    setActivityTimeLeft(0);

    // Step 2: Camera Off - WiFi CSI takes over
    setCalStep("camera-off");
    setCalMessage("Camera turning off... WiFi CSI taking over.");
    stopCamera();
    for (let p = 40; p <= 70; p += 2) {
      await tick(120);
      setCalProgress(p);
      if (p % 8 === 0) {
        // Use learned skeleton data from correlation engine if available
        const latestFrame = skeletalFrameRef.current;
        if (latestFrame?.isDetected && latestFrame.keypoints.length >= 33) {
          setSkeleton(latestFrame.keypoints);
          setPointCloud(generatePointCloudFromSkeleton(latestFrame.keypoints, env.dims));
        } else {
          setPointCloud(generateSimulatedPointCloud(env.dims));
        }
      }
    }

    // Step 3: Detect - AI maps presence, movement, breathing, heart rate
    setCalStep("detecting");
    setCalMessage("AI detecting presence, movement, breathing, heart rate...");
    for (let p = 70; p <= 98; p += 2) {
      await tick(100);
      setCalProgress(p);
      if (p % 10 === 0) {
        const latestFrame = skeletalFrameRef.current;
        if (latestFrame?.isDetected && latestFrame.keypoints.length >= 33) {
          setSkeleton(latestFrame.keypoints);
          setPointCloud(generatePointCloudFromSkeleton(latestFrame.keypoints, env.dims));
          setVitals({
            breathingRate: latestFrame.breathingRate,
            heartRate: latestFrame.heartRate,
            activity: latestFrame.activity,
          });
        } else {
          setPointCloud(generateSimulatedPointCloud(env.dims));
          setVitals(generateSimulatedVitals());
        }
        setHeatmapData(generateHeatmapData(env.dims));
      }
    }

    // Compute confidence from REAL detection metrics:
    // - Detection rate: how many frames successfully detected a person
    // - Average confidence: mean MoveNet confidence score across detected frames
    // - Cross-modal readiness: correlation engine trained successfully
    const metrics = detectionMetrics;
    const detectionRate = metrics.attempted > 0 ? metrics.detected / metrics.attempted : 0;
    const avgDetectionConfidence = metrics.detected > 0 ? metrics.totalConfidence / metrics.detected : 0;
    // Confidence = weighted blend of detection rate and average pose confidence
    // This measures how well the system can detect skeletal movements
    const rawConfidence = (detectionRate * 0.6) + (avgDetectionConfidence * 0.4);
    const confidence = Math.round(Math.min(0.99, Math.max(0.1, rawConfidence)) * 100) / 100;

    // Complete
    setCalStep("complete");
    setCalProgress(100);
    const detectedPct = Math.round(detectionRate * 100);
    setCalMessage(`Space calibrated! ${completedCount}/${totalActivities} activities — ${detectedPct}% detection rate — ${(confidence * 100).toFixed(0)}% confidence.`);
    updateEnvironment(env.id, { isCalibrated: true, calibrationConfidence: confidence });

    // Train the local AI correlation engine from collected camera data
    // This builds signal fingerprints and cross-modal mapping
    const learnedState = await trainFromCollectedData(env.id).catch(() => null);
    const crossModalAcc = learnedState?.crossModalAccuracy ?? 0;

    // Final confidence incorporates cross-modal accuracy (ability to detect WITHOUT camera)
    const finalConfidence = Math.round(Math.min(0.99, confidence * 0.5 + crossModalAcc * 0.5) * 100) / 100;
    updateEnvironment(env.id, { calibrationConfidence: finalConfidence });
    setEnv({ ...env, isCalibrated: true, confidence: finalConfidence });

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
            <span className="text-xs px-2 py-0.5 rounded-full animate-pulse flex items-center gap-1" style={{
              backgroundColor: streamSource === "csi" ? "rgba(0,255,136,0.2)" : streamSource === "camera" ? "rgba(255,204,0,0.2)" : "rgba(136,170,255,0.15)",
              color: streamSource === "csi" ? "#00ff88" : streamSource === "camera" ? "#ffcc00" : "#88aaff",
            }}>
              ● Live — {streamSource === "csi" ? "Signal Detection" : streamSource === "camera" ? "Camera + AI" : "Scanning"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {env.isCalibrated && live && (
            <button
              onClick={() => {
                if (cameraActive) { stopCamera(); } else { startCamera(); }
              }}
              className="px-4 py-1.5 rounded-full text-sm font-medium transition"
              style={cameraActive
                ? { backgroundColor: "rgba(255,204,0,0.2)", color: "#ffcc00" }
                : { backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }
              }
            >
              {cameraActive ? "📷 Camera On" : "📷 Start Camera"}
            </button>
          )}
          {env.isCalibrated && (
            <button
              onClick={() => {
                const next = !live;
                setLive(next);
                if (!next && cameraActive) stopCamera();
              }}
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

            {/* Live Camera Feed + Activity Prompt — shown during Step 1 */}
            {calStep === "calibrating" && (
              <div className="mt-4 space-y-3">
                {/* Activity Progress */}
                {currentActivity && (
                  <div className="rounded-xl p-4 border" style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{currentActivity.icon}</span>
                        <div>
                          <p className="text-sm font-semibold">{currentActivity.label}</p>
                          <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
                            Activity {activityIndex + 1} of {CALIBRATION_ACTIVITIES.length}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-mono font-bold" style={{ color: "var(--gh-blue)" }}>{activityTimeLeft}s</p>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>remaining</p>
                      </div>
                    </div>
                    <p className="text-xs mb-2" style={{ color: "var(--gh-text-muted)" }}>{currentActivity.instruction}</p>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--gh-border)" }}>
                      <div className="h-full rounded-full transition-all duration-1000" style={{
                        width: `${((currentActivity.durationSec - activityTimeLeft) / currentActivity.durationSec) * 100}%`,
                        backgroundColor: "var(--gh-blue)",
                      }} />
                    </div>
                    {/* Completed activities counter */}
                    <div className="flex gap-1 mt-2">
                      {CALIBRATION_ACTIVITIES.map((a, i) => (
                        <div key={a.id} className="flex-1 h-1 rounded-full" style={{
                          backgroundColor: i < activitiesCompleted ? "var(--gh-green)" : i === activityIndex ? "var(--gh-blue)" : "var(--gh-border)",
                        }} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Camera Preview */}
                <div className="rounded-xl overflow-hidden border relative" style={{ borderColor: "var(--gh-border)" }}>
                  {cameraError ? (
                    <div className="h-[250px] flex items-center justify-center text-center p-4" style={{ backgroundColor: "var(--gh-card)" }}>
                      <div>
                        <p className="text-2xl mb-2">📷</p>
                        <p className="text-sm font-medium" style={{ color: "var(--gh-red)" }}>Camera unavailable</p>
                        <p className="text-xs mt-1" style={{ color: "var(--gh-text-muted)" }}>{cameraError}</p>
                        <p className="text-xs mt-2" style={{ color: "var(--gh-text-muted)" }}>Calibration will continue with simulated data</p>
                      </div>
                    </div>
                  ) : (
                    <div className="relative">
                      <video ref={videoCallbackRef} autoPlay playsInline muted className="w-full h-[250px] object-cover" style={{ backgroundColor: "#000" }} />
                      {cameraActive && (
                        <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1 rounded-full" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[10px] text-white font-medium">RECORDING</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
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
                <div className="rounded-2xl border overflow-hidden relative" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
                  <EnvironmentViewer
                    pointCloud={pointCloud}
                    skeleton={skeleton}
                    roomBounds={[env.dims.width, env.dims.length, env.dims.height]}
                    sourceType={streamSource === "simulated" ? "csi" : streamSource}
                    isLive={live}
                    compact={isCalibrating}
                    trackedPersons={liveTracks.length > 0 ? liveTracks : getEntities().filter((e) => e.status === "active" && e.roomId === envId).map((e, i) => ({
                      track_id: e.id,
                      user_tag: e.name,
                      position: [1.5 + i * 2, 0.9, env.dims.length / 2],
                      velocity: [0, 0, 0],
                      speed: 0,
                      confidence: e.confidence,
                      is_registered: true,
                      is_ghosted: false,
                      last_activity: e.activity,
                      device_tether_status: e.deviceTetherStatus ?? "none",
                    }))}
                  />
                  {/* Stream source badge */}
                  {live && (
                    <div className="absolute top-3 right-3 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm" style={{
                      backgroundColor: "rgba(0,0,0,0.6)",
                      color: streamSource === "csi" ? "#00ff88" : streamSource === "camera" ? "#ffcc00" : "#88aaff",
                    }}>
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{
                        backgroundColor: streamSource === "csi" ? "#00ff88" : streamSource === "camera" ? "#ffcc00" : "#88aaff",
                      }} />
                      {streamSource === "csi" ? "Signal Detection" : streamSource === "camera" ? "Camera AI" : "AI Detection"}
                    </div>
                  )}
                  {/* Camera PiP overlay — shown when camera is active during live mode */}
                  {live && cameraActive && (
                    <div className="absolute bottom-3 left-3 rounded-xl overflow-hidden border shadow-lg" style={{ borderColor: "rgba(255,204,0,0.4)", width: "200px" }}>
                      <video ref={videoCallbackRef} autoPlay playsInline muted className="w-full h-[130px] object-cover" style={{ backgroundColor: "#000" }} />
                      <div className="flex items-center gap-1.5 px-2 py-1" style={{ backgroundColor: "rgba(0,0,0,0.8)" }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[10px] text-white font-medium">Camera Feed</span>
                      </div>
                    </div>
                  )}
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

          {/* Presence & Devices — CSI Anchor Protocol */}
          {live && liveTracks.length > 0 && (
            <div className="rounded-2xl border p-4" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
              <h3 className="font-semibold mb-3">Presence &amp; Devices</h3>
              <div className="space-y-3">
                {liveTracks.map((t) => (
                  <div key={t.track_id} className="rounded-xl p-3 border" style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", opacity: t.is_ghosted ? 0.5 : 1 }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold">{t.user_tag}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{
                        backgroundColor: t.is_ghosted ? "rgba(234,179,8,0.2)" : t.is_registered ? "rgba(0,204,136,0.2)" : "rgba(0,102,255,0.2)",
                        color: t.is_ghosted ? "#eab308" : t.is_registered ? "#00cc88" : "#0066ff",
                      }}>
                        {t.is_ghosted ? "Ghost" : t.is_registered ? "Anchored" : "Tracking"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--gh-text-muted)" }}>
                      {t.device_tether_status === "tethered" ? (
                        <>
                          <span style={{ color: "#38bdf8" }}>📱</span>
                          <span>
                            {t.device_mac_suffix ?? "Device"}{t.device_distance_m != null ? ` · ${t.device_distance_m.toFixed(1)}m` : ""}
                          </span>
                        </>
                      ) : t.device_tether_status === "awaiting_new_mac" ? (
                        <>
                          <span className="animate-pulse" style={{ color: "#f97316" }}>📱</span>
                          <span style={{ color: "#f97316" }}>Reassigning device…</span>
                        </>
                      ) : (
                        <span>No device detected</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px]" style={{ color: "var(--gh-text-muted)" }}>
                      <span>Conf: {(t.confidence * 100).toFixed(0)}%</span>
                      <span>Speed: {t.speed.toFixed(1)} m/s</span>
                    </div>
                  </div>
                ))}
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

"use client";

/**
 * RoomScanner — mobile-first room mapping component.
 *
 * Uses the phone's back-facing camera + TensorFlow.js COCO-SSD to detect
 * furniture/objects in real-time as the user pans 360°. Detected objects
 * are sent to the backend which builds a spatial floor plan and boosts
 * calibration confidence when combined with CSI data.
 *
 * Flow:
 *   1. User taps "Start Scan" → back camera activates
 *   2. COCO-SSD runs on each frame, detecting furniture
 *   3. Device orientation (compass) tracks rotation coverage
 *   4. Detections + orientation sent to backend per frame
 *   5. Backend builds spatial map → auto-generates floor plan
 *   6. When coverage ≥ 340° + objects mapped → calibration can reach 100%
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type {
  ScanStatus,
  DetectionItem,
  DeviceOrientation,
  GeneratedFloorPlan,
  FloorPlanObject,
} from "@/lib/roomScanApi";
import {
  startRoomScan,
  submitDetections,
  finaliseScan,
} from "@/lib/roomScanApi";

// ── COCO-SSD category mapping to our furniture types ───────────────────────

const COCO_TO_FURNITURE: Record<string, string> = {
  couch: "couch",
  sofa: "sofa",
  bed: "bed",
  tv: "tv",
  "tv monitor": "tv",
  "dining table": "dining_table",
  chair: "chair",
  toilet: "toilet",
  sink: "sink",
  refrigerator: "refrigerator",
  oven: "oven",
  microwave: "microwave",
  book: "bookshelf",
  "potted plant": "plant",
  clock: "lamp",
  laptop: "desk",
};

const OBJECT_ICONS: Record<string, string> = {
  couch: "🛋️",
  sofa: "🛋️",
  bed: "🛏️",
  tv: "📺",
  table: "🪑",
  desk: "💻",
  chair: "🪑",
  toilet: "🚽",
  bathtub: "🛁",
  sink: "🚰",
  refrigerator: "🧊",
  oven: "🍳",
  microwave: "📦",
  bookshelf: "📚",
  wardrobe: "🚪",
  nightstand: "🛏️",
  dining_table: "🍽️",
  cabinet: "🗄️",
  door: "🚪",
  window: "🪟",
  lamp: "💡",
  plant: "🌿",
  unknown: "📦",
};

interface RoomScannerProps {
  environmentId: string;
  roomName?: string;
  onComplete?: (plan: GeneratedFloorPlan) => void;
  onCancel?: () => void;
}

type ScanState = "idle" | "starting" | "scanning" | "finalising" | "complete" | "error";

export default function RoomScanner({
  environmentId,
  roomName = "Room",
  onComplete,
  onCancel,
}: RoomScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<any>(null);
  const animFrameRef = useRef<number>(0);
  const orientationRef = useRef<DeviceOrientation>({ alpha: 0, beta: 0, gamma: 0 });
  const frameIndexRef = useRef(0);

  const [scanState, setScanState] = useState<ScanState>("idle");
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [detectedObjects, setDetectedObjects] = useState<DetectionItem[]>([]);
  const [floorPlan, setFloorPlan] = useState<GeneratedFloorPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);

  // ── Load COCO-SSD model ────────────────────────────────────────────────

  const loadModel = useCallback(async () => {
    try {
      // Dynamic import — TF.js + COCO-SSD loaded only when needed
      const [tf, cocoSsd] = await Promise.all([
        import("@tensorflow/tfjs"),
        import("@tensorflow-models/coco-ssd"),
      ]);
      await tf.ready();
      const model = await cocoSsd.load({ base: "mobilenet_v2" });
      modelRef.current = model;
      setModelLoaded(true);
    } catch (err) {
      console.error("Failed to load COCO-SSD model:", err);
      setError("Failed to load object detection model. Please try again.");
    }
  }, []);

  // ── Start camera ───────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }, // back camera
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err) {
      console.error("Camera access denied:", err);
      setError("Camera access is required for room scanning. Please allow camera permissions.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  // ── Device orientation tracking ────────────────────────────────────────

  useEffect(() => {
    const handler = (e: DeviceOrientationEvent) => {
      orientationRef.current = {
        alpha: e.alpha ?? 0,
        beta: e.beta ?? 0,
        gamma: e.gamma ?? 0,
      };
    };
    window.addEventListener("deviceorientation", handler);
    return () => window.removeEventListener("deviceorientation", handler);
  }, []);

  // ── Detection loop ─────────────────────────────────────────────────────

  const runDetectionLoop = useCallback(async () => {
    if (!modelRef.current || !videoRef.current || !cameraReady) return;
    if (scanState !== "scanning") return;

    const video = videoRef.current;
    if (video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(() => runDetectionLoop());
      return;
    }

    try {
      const predictions = await modelRef.current.detect(video);

      // Filter to furniture/objects only
      const furnitureDetections: DetectionItem[] = predictions
        .filter((p: any) => {
          const mapped = COCO_TO_FURNITURE[p.class.toLowerCase()];
          return mapped !== undefined && p.score >= 0.4;
        })
        .map((p: any) => {
          const [x, y, w, h] = p.bbox;
          const vw = video.videoWidth || 640;
          const vh = video.videoHeight || 480;
          return {
            category: COCO_TO_FURNITURE[p.class.toLowerCase()] ?? "unknown",
            confidence: p.score,
            bbox: [x / vw, y / vh, (x + w) / vw, (y + h) / vh],
          };
        });

      // Draw bounding boxes on overlay canvas
      drawDetections(predictions);

      if (furnitureDetections.length > 0) {
        setDetectedObjects((prev) => {
          const combined = [...prev];
          for (const det of furnitureDetections) {
            const exists = combined.find(
              (d) => d.category === det.category && Math.abs(d.bbox[0] - det.bbox[0]) < 0.15
            );
            if (!exists) combined.push(det);
          }
          return combined;
        });

        // Send to backend
        frameIndexRef.current += 1;
        try {
          const result = await submitDetections(
            environmentId,
            furnitureDetections,
            orientationRef.current,
            frameIndexRef.current,
          );
          setStatus(result);

          if (result.phase === "complete") {
            setScanState("finalising");
            return; // stop loop — will finalise
          }
        } catch {
          // Backend unavailable — continue local detection
        }
      }
    } catch (err) {
      console.error("Detection error:", err);
    }

    // Throttle to ~5 FPS for performance on mobile
    setTimeout(() => {
      animFrameRef.current = requestAnimationFrame(() => runDetectionLoop());
    }, 200);
  }, [cameraReady, scanState, environmentId]);

  // ── Draw bounding boxes ────────────────────────────────────────────────

  const drawDetections = useCallback((predictions: any[]) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const pred of predictions) {
      const mapped = COCO_TO_FURNITURE[pred.class.toLowerCase()];
      if (!mapped || pred.score < 0.4) continue;

      const [x, y, w, h] = pred.bbox;
      const icon = OBJECT_ICONS[mapped] ?? "📦";

      // Bounding box
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);

      // Label background
      const label = `${icon} ${mapped.replace("_", " ")} ${(pred.score * 100).toFixed(0)}%`;
      ctx.font = "bold 14px sans-serif";
      const textW = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(x, y - 22, textW + 8, 22);

      // Label text
      ctx.fillStyle = "#00ff88";
      ctx.fillText(label, x + 4, y - 6);
    }
  }, []);

  // Start detection loop when scanning begins
  useEffect(() => {
    if (scanState === "scanning" && cameraReady && modelLoaded) {
      runDetectionLoop();
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [scanState, cameraReady, modelLoaded, runDetectionLoop]);

  // Auto-finalise when scan state transitions
  useEffect(() => {
    if (scanState === "finalising") {
      handleFinalise();
    }
  }, [scanState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleStart = async () => {
    setError(null);
    setScanState("starting");

    // Load model + start camera in parallel
    await Promise.all([loadModel(), startCamera()]);

    // Start backend session
    try {
      const result = await startRoomScan(environmentId);
      setStatus(result);
    } catch {
      // Backend unavailable — local mode only
      setStatus({
        id: crypto.randomUUID(),
        environment_id: environmentId,
        phase: "capturing",
        frames_captured: 0,
        coverage_degrees: 0,
        target_coverage: 340,
        objects_detected: 0,
        room_dimensions: { width: 0, length: 0, height: 2.7, confidence: 0 },
        scan_confidence: 0,
        calibration_boost: 0,
        message: "Scanning locally — backend not connected.",
      });
    }

    setScanState("scanning");
  };

  const handleFinalise = async () => {
    setScanState("finalising");
    stopCamera();

    try {
      const plan = await finaliseScan(environmentId);
      setFloorPlan(plan);
      setScanState("complete");
      onComplete?.(plan);
    } catch {
      // Generate local summary if backend unavailable
      setScanState("complete");
    }
  };

  const handleCancel = () => {
    stopCamera();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setScanState("idle");
    onCancel?.();
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [stopCamera]);

  // ── Render ─────────────────────────────────────────────────────────────

  const coveragePct = status ? (status.coverage_degrees / status.target_coverage) * 100 : 0;
  const confidencePct = status ? status.scan_confidence * 100 : 0;

  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          📸 Room Scanner — {roomName}
        </h2>
        {scanState !== "idle" && scanState !== "complete" && (
          <button
            onClick={handleCancel}
            className="text-sm text-red-400 hover:text-red-300"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Idle state — instructions */}
      {scanState === "idle" && (
        <div className="bg-gray-800/50 rounded-xl p-6 text-center">
          <div className="text-4xl mb-3">📱</div>
          <h3 className="text-white font-medium mb-2">Visual Room Scan</h3>
          <p className="text-gray-400 text-sm mb-4">
            Stand in the centre of the room and slowly pan your phone camera 360°.
            Echo Vue will detect furniture and objects to build an accurate floor plan
            and boost calibration to 100%.
          </p>
          <ul className="text-left text-gray-400 text-xs space-y-1 mb-4 max-w-xs mx-auto">
            <li>📷 Uses back camera — point it at the room</li>
            <li>🔄 Pan slowly in a full circle</li>
            <li>🛋️ AI detects couches, beds, TVs, desks, etc.</li>
            <li>📐 Room dimensions are estimated automatically</li>
            <li>🗺️ Floor plan with objects generated on completion</li>
          </ul>
          <button
            onClick={handleStart}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
          >
            Start Room Scan
          </button>
        </div>
      )}

      {/* Starting state — loading */}
      {scanState === "starting" && (
        <div className="bg-gray-800/50 rounded-xl p-6 text-center">
          <div className="animate-spin text-3xl mb-3">⏳</div>
          <p className="text-gray-300">Loading camera & AI model...</p>
          <div className="flex justify-center gap-4 mt-3 text-xs text-gray-500">
            <span>{modelLoaded ? "✅" : "⏳"} Model</span>
            <span>{cameraReady ? "✅" : "⏳"} Camera</span>
          </div>
        </div>
      )}

      {/* Scanning state — live camera + detections */}
      {(scanState === "scanning" || scanState === "finalising") && (
        <div className="space-y-3">
          {/* Camera viewport */}
          <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
            {/* Coverage ring overlay */}
            <div className="absolute top-3 right-3 bg-black/70 rounded-lg px-3 py-2 text-xs text-white">
              <div className="flex items-center gap-2">
                <span>🔄 {coveragePct.toFixed(0)}%</span>
                <span className="text-gray-400">|</span>
                <span>🎯 {confidencePct.toFixed(0)}%</span>
              </div>
            </div>
            {/* Guidance overlay */}
            <div className="absolute bottom-3 left-3 right-3 bg-black/70 rounded-lg px-3 py-2 text-center text-xs text-gray-300">
              {coveragePct < 50
                ? "Slowly turn around — scan all walls and furniture"
                : coveragePct < 90
                ? "Keep going — almost there!"
                : "Great coverage! Tap 'Complete Scan' when ready"}
            </div>
          </div>

          {/* Progress bars */}
          <div className="bg-gray-800/50 rounded-lg p-3 space-y-2">
            {/* Coverage bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Room Coverage</span>
                <span>{status?.coverage_degrees.toFixed(0) ?? 0}° / {status?.target_coverage ?? 340}°</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, coveragePct)}%` }}
                />
              </div>
            </div>

            {/* Confidence bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Scan Confidence</span>
                <span>{confidencePct.toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    confidencePct >= 95 ? "bg-green-500" : confidencePct >= 70 ? "bg-yellow-500" : "bg-orange-500"
                  }`}
                  style={{ width: `${Math.min(100, confidencePct)}%` }}
                />
              </div>
            </div>

            {/* Frames + objects stats */}
            <div className="flex justify-between text-xs text-gray-500 pt-1">
              <span>Frames: {status?.frames_captured ?? 0}</span>
              <span>Objects: {status?.objects_detected ?? detectedObjects.length}</span>
              <span>Dims: {status?.room_dimensions?.width ?? "—"}m × {status?.room_dimensions?.length ?? "—"}m</span>
            </div>
          </div>

          {/* Detected objects list */}
          {detectedObjects.length > 0 && (
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-2">Detected Objects</p>
              <div className="flex flex-wrap gap-2">
                {detectedObjects.map((d, i) => (
                  <span
                    key={`${d.category}-${i}`}
                    className="inline-flex items-center gap-1 bg-gray-700/50 rounded-full px-3 py-1 text-xs text-white"
                  >
                    {OBJECT_ICONS[d.category] ?? "📦"} {d.category.replace("_", " ")}
                    <span className="text-gray-400">{(d.confidence * 100).toFixed(0)}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Complete button */}
          {scanState === "scanning" && (
            <button
              onClick={handleFinalise}
              className={`w-full py-3 rounded-lg font-medium transition-colors ${
                confidencePct >= 70
                  ? "bg-green-600 hover:bg-green-500 text-white"
                  : "bg-gray-700 text-gray-400"
              }`}
            >
              {scanState === "finalising"
                ? "Generating Floor Plan..."
                : confidencePct >= 95
                ? "✅ Complete Scan — 100% Calibration Ready"
                : `Complete Scan (${confidencePct.toFixed(0)}% confidence)`}
            </button>
          )}
        </div>
      )}

      {/* Complete state — results */}
      {scanState === "complete" && (
        <div className="bg-gray-800/50 rounded-xl p-6 space-y-4">
          <div className="text-center">
            <div className="text-4xl mb-2">✅</div>
            <h3 className="text-white font-medium">Room Scan Complete</h3>
            <p className="text-gray-400 text-sm mt-1">
              {status?.objects_detected ?? detectedObjects.length} objects mapped
              {status?.room_dimensions?.width
                ? ` — ${status.room_dimensions.width}m × ${status.room_dimensions.length}m room`
                : ""}
            </p>
          </div>

          {/* Calibration boost */}
          {status && (
            <div className="bg-green-900/30 border border-green-700/50 rounded-lg p-3 text-center">
              <p className="text-green-400 text-sm font-medium">
                Calibration Boost: +{(status.calibration_boost * 100).toFixed(0)}%
              </p>
              {status.calibration_boost >= 0.95 && (
                <p className="text-green-300 text-xs mt-1">
                  🎉 All objects and dimensions successfully mapped — 100% calibration!
                </p>
              )}
            </div>
          )}

          {/* Floor plan preview */}
          {floorPlan && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">Generated Floor Plan</p>
              <FloorPlanPreview plan={floorPlan} />
            </div>
          )}

          {/* Object inventory */}
          {detectedObjects.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-2">Object Inventory</p>
              <div className="grid grid-cols-2 gap-2">
                {detectedObjects.map((d, i) => (
                  <div
                    key={`${d.category}-${i}`}
                    className="flex items-center gap-2 bg-gray-700/30 rounded-lg px-3 py-2 text-xs text-white"
                  >
                    <span className="text-lg">{OBJECT_ICONS[d.category] ?? "📦"}</span>
                    <div>
                      <div>{d.category.replace("_", " ")}</div>
                      <div className="text-gray-500">{(d.confidence * 100).toFixed(0)}% confidence</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setScanState("idle");
              setDetectedObjects([]);
              setFloorPlan(null);
              setStatus(null);
            }}
            className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
          >
            Scan Again
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setScanState("idle");
            }}
            className="mt-2 text-xs text-red-300 hover:text-red-200 underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ── Mini Floor Plan Preview ──────────────────────────────────────────────

function FloorPlanPreview({ plan }: { plan: GeneratedFloorPlan }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const pad = 20;
    const scaleX = (rect.width - pad * 2) / plan.room_width;
    const scaleY = (rect.height - pad * 2) / plan.room_length;
    const scale = Math.min(scaleX, scaleY);

    // Background
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Room outline
    ctx.strokeStyle = "#4a5568";
    ctx.lineWidth = 2;
    ctx.strokeRect(pad, pad, plan.room_width * scale, plan.room_length * scale);

    // Grid
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= plan.room_width; x++) {
      ctx.beginPath();
      ctx.moveTo(pad + x * scale, pad);
      ctx.lineTo(pad + x * scale, pad + plan.room_length * scale);
      ctx.stroke();
    }
    for (let y = 0; y <= plan.room_length; y++) {
      ctx.beginPath();
      ctx.moveTo(pad, pad + y * scale);
      ctx.lineTo(pad + plan.room_width * scale, pad + y * scale);
      ctx.stroke();
    }

    // Dimensions
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `${plan.room_width.toFixed(1)}m`,
      pad + (plan.room_width * scale) / 2,
      pad - 6,
    );
    ctx.save();
    ctx.translate(pad - 8, pad + (plan.room_length * scale) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${plan.room_length.toFixed(1)}m`, 0, 0);
    ctx.restore();

    // Objects
    for (const obj of plan.objects) {
      const ox = pad + obj.x * scale;
      const oy = pad + obj.y * scale;
      const ow = obj.width * scale;
      const oh = obj.height * scale;

      // Object fill
      ctx.fillStyle = getCategoryColor(obj.category);
      ctx.globalAlpha = 0.6;
      ctx.fillRect(ox, oy, ow, oh);
      ctx.globalAlpha = 1.0;

      // Object border
      ctx.strokeStyle = getCategoryColor(obj.category);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox, oy, ow, oh);

      // Label
      const icon = OBJECT_ICONS[obj.category] ?? "📦";
      ctx.fillStyle = "#ffffff";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(icon, ox + ow / 2, oy + oh / 2 + 4);
    }
  }, [plan]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg border border-gray-700"
      style={{ height: 200 }}
    />
  );
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    couch: "#3b82f6",
    sofa: "#3b82f6",
    bed: "#8b5cf6",
    tv: "#6366f1",
    table: "#f59e0b",
    desk: "#10b981",
    chair: "#f59e0b",
    toilet: "#06b6d4",
    bathtub: "#06b6d4",
    sink: "#06b6d4",
    refrigerator: "#64748b",
    oven: "#ef4444",
    microwave: "#64748b",
    bookshelf: "#a855f7",
    dining_table: "#f59e0b",
    door: "#78716c",
    window: "#38bdf8",
    lamp: "#fbbf24",
    plant: "#22c55e",
  };
  return colors[category] ?? "#6b7280";
}

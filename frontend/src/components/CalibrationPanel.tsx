"use client";

import { useEffect, useState } from "react";

/**
 * CalibrationPanel — controls and monitors the 5-step calibration workflow.
 * Displays real-time progress, confidence score, and stage transitions.
 */

interface CalibrationStatus {
  stage: string;
  pose_match_accuracy: number;
  training_epoch: number;
  csi_frames_collected: number;
  vision_frames_collected: number;
  message: string;
}

const STAGE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  setup:      { label: "Setup",      color: "text-gray-400",             icon: "⚙️" },
  trace:      { label: "Tracing",    color: "text-blue-400",             icon: "📐" },
  training:   { label: "Training",   color: "text-yellow-400",           icon: "🧠" },
  confidence: { label: "Synced",     color: "text-[var(--illy-green)]",  icon: "✅" },
  live:       { label: "Live Mode",  color: "text-[var(--illy-green)]",  icon: "🟢" },
  failed:     { label: "Failed",     color: "text-[var(--illy-red)]",    icon: "❌" },
};

interface CalibrationPanelProps {
  environmentId: string;
  token: string;
}

export default function CalibrationPanel({ environmentId, token }: CalibrationPanelProps) {
  const [status, setStatus] = useState<CalibrationStatus | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    // Poll calibration status
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/calibration/status/${environmentId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setStatus(await res.json());
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [environmentId, token]);

  const startCalibration = async () => {
    const res = await fetch("/api/calibration/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ environment_id: environmentId }),
    });
    if (res.ok) {
      setStatus(await res.json());
    }
  };

  const stageInfo = status ? STAGE_LABELS[status.stage] || STAGE_LABELS.setup : STAGE_LABELS.setup;
  const confidence = status?.pose_match_accuracy ?? 0;

  return (
    <div className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800">
      <h2 className="text-lg font-semibold mb-4">Calibration</h2>

      {/* Stage indicator */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">{stageInfo.icon}</span>
        <span className={`text-lg font-medium ${stageInfo.color}`}>{stageInfo.label}</span>
      </div>

      {/* Confidence bar */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-400 mb-1">
          <span>Pose-Match Confidence</span>
          <span>{(confidence * 100).toFixed(1)}%</span>
        </div>
        <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${confidence * 100}%`,
              backgroundColor: confidence >= 0.95 ? "var(--illy-green)" : "var(--illy-blue)",
            }}
          />
        </div>
        <div className="text-xs text-gray-500 mt-1">Target: 95%</div>
      </div>

      {/* Stats */}
      {status && (
        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <div className="text-gray-400">CSI Frames</div>
            <div className="text-xl font-mono">{status.csi_frames_collected}</div>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <div className="text-gray-400">Vision Frames</div>
            <div className="text-xl font-mono">{status.vision_frames_collected}</div>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <div className="text-gray-400">Epoch</div>
            <div className="text-xl font-mono">{status.training_epoch}</div>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <div className="text-gray-400">Stage</div>
            <div className="text-xl">{stageInfo.label}</div>
          </div>
        </div>
      )}

      {/* Message */}
      {status?.message && (
        <div className="p-3 bg-gray-800/50 rounded-lg text-sm text-gray-300 mb-4">
          {status.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {(!status || status.stage === "setup") && (
          <button
            onClick={startCalibration}
            className="px-6 py-2 bg-[var(--illy-blue)] rounded-lg font-medium hover:opacity-90 transition"
          >
            Start 2D3D Map Trace
          </button>
        )}
        {status?.stage === "live" && (
          <div className="flex items-center gap-2 text-[var(--illy-green)]">
            <span className="w-2 h-2 bg-[var(--illy-green)] rounded-full animate-pulse" />
            Environment Synced. Camera no longer required.
          </div>
        )}
      </div>
    </div>
  );
}

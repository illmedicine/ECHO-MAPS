"use client";

import { useEffect, useState } from "react";

/**
 * CalibrationPanel — controls and monitors the full Visual Handshake to RF Handoff pipeline.
 *
 * Phase 1: Visual Handshake       — dual-data ingestion, skeleton-RF blob fusion
 * Phase 2: Anchor Extraction      — gait/breathing/mass RF Signature building
 * Phase 3: RF Handoff             — GAN training → confidence → "Environment Synced"
 * Phase 4: Trajectory Tracking    — Kalman-filtered multi-person tracking
 * Phase 5: Uncertainty Loop       — confidence decay, ghost tags, re-acquisition
 */

interface TrackedPerson {
  track_id: string;
  user_tag: string;
  position: number[];
  velocity: number[];
  speed: number;
  confidence: number;
  is_registered: boolean;
  is_ghosted: boolean;
  last_activity: string;
  breathing_rate: number | null;
  heart_rate: number | null;
}

interface CalibrationStatus {
  stage: string;
  pose_match_accuracy: number;
  training_epoch: number;
  csi_frames_collected: number;
  vision_frames_collected: number;
  message: string;
  // Phase 2
  rf_signatures_extracted: number;
  walking_samples: number;
  stationary_samples: number;
  // Phase 3
  rf_only_accuracy: number;
  rf_sustained_frames: number;
  handoff_triggered: boolean;
  camera_terminated: boolean;
  // Phase 4–5
  active_tracks: number;
  ghosted_tracks: number;
}

const STAGE_LABELS: Record<string, { label: string; color: string; icon: string; phase: string }> = {
  setup:              { label: "Setup",              color: "text-gray-400",             icon: "⚙️",  phase: "" },
  trace:              { label: "Visual Handshake",   color: "text-blue-400",             icon: "📐",  phase: "Phase 1" },
  anchor_extraction:  { label: "Anchor Extraction",  color: "text-purple-400",           icon: "🧬",  phase: "Phase 2" },
  training:           { label: "GAN Training",       color: "text-yellow-400",           icon: "🧠",  phase: "Phase 3" },
  confidence:         { label: "RF Verified",        color: "text-[var(--illy-green)]",  icon: "✅",  phase: "Phase 3" },
  handoff:            { label: "Environment Synced",  color: "text-[var(--illy-green)]",  icon: "📡",  phase: "Phase 3" },
  live:               { label: "Active Sonar",       color: "text-[var(--illy-green)]",  icon: "🟢",  phase: "Phase 4" },
  failed:             { label: "Failed",             color: "text-[var(--illy-red)]",    icon: "❌",  phase: "" },
};

interface CalibrationPanelProps {
  environmentId: string;
  token: string;
}

export default function CalibrationPanel({ environmentId, token }: CalibrationPanelProps) {
  const [status, setStatus] = useState<CalibrationStatus | null>(null);

  useEffect(() => {
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

  const extractSignatures = async () => {
    await fetch(`/api/calibration/extract-signatures/${environmentId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  };

  const stageInfo = status ? STAGE_LABELS[status.stage] || STAGE_LABELS.setup : STAGE_LABELS.setup;
  const confidence = status?.pose_match_accuracy ?? 0;
  const rfAccuracy = status?.rf_only_accuracy ?? 0;

  return (
    <div className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800">
      <h2 className="text-lg font-semibold mb-4">Calibration Pipeline</h2>

      {/* Phase indicator */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">{stageInfo.icon}</span>
        <div>
          {stageInfo.phase && (
            <span className="text-xs text-gray-500 uppercase tracking-wider">{stageInfo.phase}</span>
          )}
          <div className={`text-lg font-medium ${stageInfo.color}`}>{stageInfo.label}</div>
        </div>
      </div>

      {/* Pipeline progress bar */}
      <div className="flex gap-1 mb-4">
        {["trace", "anchor_extraction", "training", "handoff", "live"].map((stage, i) => {
          const stages = ["setup", "trace", "anchor_extraction", "training", "confidence", "handoff", "live"];
          const currentIdx = stages.indexOf(status?.stage ?? "setup");
          const stageIdx = stages.indexOf(stage);
          const isComplete = currentIdx > stageIdx;
          const isCurrent = status?.stage === stage;
          return (
            <div
              key={stage}
              className={`h-2 flex-1 rounded-full transition-all duration-500 ${
                isComplete
                  ? "bg-[var(--illy-green)]"
                  : isCurrent
                  ? "bg-[var(--illy-blue)]"
                  : "bg-gray-800"
              }`}
            />
          );
        })}
      </div>

      {/* Dual confidence bars */}
      <div className="space-y-3 mb-4">
        {/* Pose-Match Confidence */}
        <div>
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
        </div>

        {/* RF-Only Accuracy (Phase 3) */}
        {status && (status.stage === "training" || status.stage === "confidence" || status.stage === "handoff") && (
          <div>
            <div className="flex justify-between text-sm text-gray-400 mb-1">
              <span>RF-Only Accuracy</span>
              <span>{(rfAccuracy * 100).toFixed(1)}%</span>
            </div>
            <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${rfAccuracy * 100}%`,
                  backgroundColor: rfAccuracy >= 0.90 ? "var(--illy-green)" : "var(--illy-yellow, #eab308)",
                }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Target: 90% sustained ({status.rf_sustained_frames} frames)
            </div>
          </div>
        )}
      </div>

      {/* Stats grid */}
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

          {/* Phase 2: Anchor stats */}
          {(status.stage === "anchor_extraction" || status.stage === "trace") && (
            <>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <div className="text-gray-400">Walking Samples</div>
                <div className="text-xl font-mono">{status.walking_samples}</div>
              </div>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <div className="text-gray-400">Stationary Samples</div>
                <div className="text-xl font-mono">{status.stationary_samples}</div>
              </div>
            </>
          )}

          {/* Phase 3: Training stats */}
          {status.stage === "training" && (
            <>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <div className="text-gray-400">Epoch</div>
                <div className="text-xl font-mono">{status.training_epoch}</div>
              </div>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <div className="text-gray-400">RF Signatures</div>
                <div className="text-xl font-mono">{status.rf_signatures_extracted}</div>
              </div>
            </>
          )}

          {/* Phase 4-5: Tracking stats */}
          {(status.stage === "live" || status.stage === "handoff") && (
            <>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <div className="text-gray-400">Active Tracks</div>
                <div className="text-xl font-mono text-[var(--illy-green)]">{status.active_tracks}</div>
              </div>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <div className="text-gray-400">Ghosted</div>
                <div className="text-xl font-mono text-yellow-400">{status.ghosted_tracks}</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Message */}
      {status?.message && (
        <div className="p-3 bg-gray-800/50 rounded-lg text-sm text-gray-300 mb-4">
          {status.message}
        </div>
      )}

      {/* Camera terminated indicator */}
      {status?.camera_terminated && (
        <div className="p-3 bg-gray-800/50 rounded-lg text-sm mb-4 flex items-center gap-2">
          <span className="text-[var(--illy-green)]">📡</span>
          <span className="text-gray-300">Camera feed terminated. Pure CSI tracking active.</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        {(!status || status.stage === "setup") && (
          <button
            onClick={startCalibration}
            className="px-6 py-2 bg-[var(--illy-blue)] rounded-lg font-medium hover:opacity-90 transition"
          >
            Start Visual Handshake
          </button>
        )}
        {status?.stage === "trace" && status.walking_samples > 500 && status.stationary_samples > 300 && (
          <button
            onClick={extractSignatures}
            className="px-6 py-2 bg-purple-600 rounded-lg font-medium hover:opacity-90 transition"
          >
            Extract RF Signatures
          </button>
        )}
        {status?.stage === "handoff" && (
          <div className="flex items-center gap-2 text-[var(--illy-green)]">
            <span className="w-2 h-2 bg-[var(--illy-green)] rounded-full animate-pulse" />
            Environment Synced. Camera no longer required.
          </div>
        )}
        {status?.stage === "live" && (
          <div className="flex items-center gap-2 text-[var(--illy-green)]">
            <span className="w-2 h-2 bg-[var(--illy-green)] rounded-full animate-pulse" />
            Active Sonar Mode — {status.active_tracks} tracked
            {status.ghosted_tracks > 0 && (
              <span className="text-yellow-400 ml-2">({status.ghosted_tracks} ghosted)</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

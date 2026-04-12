"use client";

/**
 * Bridge Management Dashboard Page
 *
 * Discover, bind, and manage Illy Bridge devices (FNK0086).
 * Initiate room-by-room calibration and presence detection scans.
 */

import { useState } from "react";
import BridgeManager from "@/components/BridgeManager";
import BridgeCalibration from "@/components/BridgeCalibration";
import { BridgeDevice, EnvironmentOut, listEnvironments } from "@/lib/api";
import { useEffect } from "react";

type View = "list" | "calibrate";

export default function BridgePage() {
  const [view, setView] = useState<View>("list");
  const [selectedBridge, setSelectedBridge] = useState<BridgeDevice | null>(
    null
  );
  const [environments, setEnvironments] = useState<EnvironmentOut[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<EnvironmentOut | null>(null);

  useEffect(() => {
    listEnvironments()
      .then(setEnvironments)
      .catch(() => setEnvironments([]));
  }, []);

  const handleBridgeSelect = (bridge: BridgeDevice) => {
    setSelectedBridge(bridge);
    if (environments.length > 0 && !selectedEnv) {
      setSelectedEnv(environments[0]);
    }
    setView("calibrate");
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-4xl mx-auto p-6">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-zinc-400 text-sm mb-2">
            <a href="/dashboard" className="hover:text-white transition-colors">
              Dashboard
            </a>
            <span>/</span>
            <span className="text-white">Illy Bridge</span>
          </div>
          <h1 className="text-3xl font-bold">
            <span className="text-cyan-400">Illy</span> Bridge
          </h1>
          <p className="text-zinc-400 mt-1">
            Portable room calibration using the Freenove ESP32-S3 (FNK0086)
          </p>
        </div>

        {/* View: Bridge list or Calibration */}
        {view === "list" && (
          <BridgeManager onBridgeSelect={handleBridgeSelect} />
        )}

        {view === "calibrate" && selectedBridge && (
          <div className="space-y-6">
            {/* Environment selector */}
            {!selectedEnv ? (
              <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
                <h3 className="text-sm font-medium text-zinc-300 mb-3">
                  Select an Environment to Calibrate
                </h3>
                {environments.length === 0 ? (
                  <p className="text-zinc-500 text-sm">
                    No environments found.{" "}
                    <a
                      href="/dashboard/env"
                      className="text-cyan-400 hover:text-cyan-300"
                    >
                      Create one first
                    </a>
                  </p>
                ) : (
                  <div className="space-y-2">
                    {environments.map((env) => (
                      <button
                        key={env.id}
                        onClick={() => setSelectedEnv(env)}
                        className="w-full text-left px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                      >
                        <p className="text-white text-sm font-medium">
                          {env.name}
                        </p>
                        <p className="text-zinc-400 text-xs">
                          {env.is_calibrated
                            ? `Calibrated (${(env.calibration_confidence * 100).toFixed(0)}%)`
                            : "Not calibrated"}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <BridgeCalibration
                bridge={selectedBridge}
                environmentId={selectedEnv.id}
                environmentName={selectedEnv.name}
                onBack={() => {
                  setView("list");
                  setSelectedBridge(null);
                  setSelectedEnv(null);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

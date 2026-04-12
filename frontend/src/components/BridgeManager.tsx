"use client";

/**
 * BridgeManager — Discovery, binding, and management of Illy Bridge devices.
 *
 * Flow:
 *   1. User clicks "Scan for Bridges" → local network scan for _illybridge._tcp
 *   2. Found bridges displayed with device info and status
 *   3. User selects a bridge and clicks "Bind" to associate with their account
 *   4. Bound bridges appear in the device list with status and controls
 */

import { useCallback, useEffect, useState } from "react";
import {
  BridgeDevice,
  bindBridge,
  discoverBridges,
  discoverLocalBridges,
  listBridges,
  unbindBridge,
} from "@/lib/api";

interface BridgeManagerProps {
  onBridgeSelect?: (device: BridgeDevice) => void;
}

export default function BridgeManager({ onBridgeSelect }: BridgeManagerProps) {
  const [bridges, setBridges] = useState<BridgeDevice[]>([]);
  const [discovered, setDiscovered] = useState<
    Array<{ device_id: string; ip_address: string; info: Record<string, unknown> }>
  >([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load bound bridges on mount
  useEffect(() => {
    listBridges()
      .then(setBridges)
      .catch(() => setBridges([]))
      .finally(() => setLoading(false));
  }, []);

  // Local network scan
  const handleScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      // Parallel: local mDNS/IP scan + cloud-known bridges
      const [localResults, cloudResults] = await Promise.allSettled([
        discoverLocalBridges(),
        discoverBridges(),
      ]);

      if (localResults.status === "fulfilled") {
        setDiscovered(localResults.value);
      }

      // Refresh bound bridges
      if (cloudResults.status === "fulfilled") {
        // Cloud results include already-registered devices
      }

      const updatedBridges = await listBridges().catch(() => []);
      setBridges(updatedBridges);
    } catch (e) {
      setError("Scan failed. Ensure you're on the same WiFi network as the bridge.");
    } finally {
      setScanning(false);
    }
  }, []);

  // Bind a discovered bridge
  const handleBind = useCallback(
    async (deviceId: string) => {
      try {
        const device = await bindBridge(deviceId);
        setBridges((prev) => {
          const existing = prev.find((b) => b.device_id === deviceId);
          if (existing) {
            return prev.map((b) => (b.device_id === deviceId ? device : b));
          }
          return [...prev, device];
        });
        setDiscovered((prev) => prev.filter((d) => d.device_id !== deviceId));
      } catch {
        setError("Failed to bind bridge. Try again.");
      }
    },
    []
  );

  // Unbind a bridge
  const handleUnbind = useCallback(async (deviceId: string) => {
    try {
      await unbindBridge(deviceId);
      setBridges((prev) => prev.filter((b) => b.device_id !== deviceId));
    } catch {
      setError("Failed to unbind bridge.");
    }
  }, []);

  const statusColor = (status: string) => {
    switch (status) {
      case "idle":
        return "bg-green-500";
      case "calibrating":
      case "room_scanning":
        return "bg-blue-500";
      case "monitoring":
        return "bg-emerald-500";
      case "presence_scanning":
        return "bg-yellow-500";
      case "offline":
        return "bg-red-500";
      case "provisioning":
        return "bg-orange-500";
      default:
        return "bg-gray-500";
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "idle":
        return "Ready";
      case "calibrating":
        return "Calibrating";
      case "room_scanning":
        return "Room Scan";
      case "monitoring":
        return "Monitoring";
      case "presence_scanning":
        return "Presence Scan";
      case "offline":
        return "Offline";
      case "provisioning":
        return "WiFi Setup";
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Illy Bridge Devices</h2>
          <p className="text-sm text-zinc-400">
            Manage your portable calibration bridges
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-600 rounded-lg text-white text-sm font-medium transition-colors"
        >
          {scanning ? (
            <span className="flex items-center gap-2">
              <svg
                className="animate-spin h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  className="opacity-25"
                />
                <path
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  className="opacity-75"
                />
              </svg>
              Scanning...
            </span>
          ) : (
            "Scan for Bridges"
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Discovered (unbound) bridges */}
      {discovered.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
            Discovered on Network
          </h3>
          {discovered.map((d) => (
            <div
              key={d.device_id}
              className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-900/50 flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-cyan-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-white font-medium text-sm">
                    {(d.info.model as string) || "FNK0086"} — Illy Bridge
                  </p>
                  <p className="text-zinc-400 text-xs">
                    {d.ip_address} · {d.device_id}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleBind(d.device_id)}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded text-white text-xs font-medium transition-colors"
              >
                Bind
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Bound bridges */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          Your Bridges
        </h3>
        {loading ? (
          <div className="text-zinc-500 text-sm">Loading...</div>
        ) : bridges.length === 0 ? (
          <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-lg p-8 text-center">
            <svg
              className="w-12 h-12 text-zinc-600 mx-auto mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <p className="text-zinc-400 text-sm">No bridges connected</p>
            <p className="text-zinc-500 text-xs mt-1">
              Power on your Illy Bridge and connect it to the same WiFi network,
              then click "Scan for Bridges"
            </p>
          </div>
        ) : (
          bridges.map((bridge) => (
            <div
              key={bridge.device_id}
              className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 hover:border-cyan-500/30 transition-colors cursor-pointer"
              onClick={() => onBridgeSelect?.(bridge)}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-cyan-900/50 flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-cyan-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">
                      {bridge.model} — Illy Bridge
                    </p>
                    <p className="text-zinc-400 text-xs">
                      {bridge.ip_address || "IP unknown"} · {bridge.device_id}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${statusColor(bridge.status)}`}
                  />
                  <span className="text-zinc-300 text-xs">
                    {statusLabel(bridge.status)}
                  </span>
                </div>
              </div>

              {/* Hardware capabilities */}
              <div className="flex gap-2 mb-3">
                {bridge.has_camera && (
                  <span className="px-2 py-0.5 bg-blue-900/30 text-blue-300 text-xs rounded">
                    Camera
                  </span>
                )}
                {bridge.has_mic && (
                  <span className="px-2 py-0.5 bg-green-900/30 text-green-300 text-xs rounded">
                    Mic
                  </span>
                )}
                {bridge.has_speaker && (
                  <span className="px-2 py-0.5 bg-purple-900/30 text-purple-300 text-xs rounded">
                    Speaker
                  </span>
                )}
                {bridge.has_lcd && (
                  <span className="px-2 py-0.5 bg-yellow-900/30 text-yellow-300 text-xs rounded">
                    LCD
                  </span>
                )}
              </div>

              {/* Rooms calibrated */}
              {bridge.rooms_calibrated.length > 0 && (
                <div className="mb-3">
                  <p className="text-zinc-400 text-xs mb-1">
                    Rooms calibrated:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {bridge.rooms_calibrated.map((room) => (
                      <span
                        key={room}
                        className="px-2 py-0.5 bg-emerald-900/30 text-emerald-300 text-xs rounded"
                      >
                        {room}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onBridgeSelect?.(bridge);
                  }}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded text-white text-xs font-medium transition-colors"
                >
                  Manage
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUnbind(bridge.device_id);
                  }}
                  className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300 text-xs transition-colors"
                >
                  Unbind
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

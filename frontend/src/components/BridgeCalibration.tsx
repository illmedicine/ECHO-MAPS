"use client";

/**
 * BridgeCalibration — Room-by-room calibration and presence detection
 * using the Illy Bridge portable device (FNK0086).
 *
 * Flow:
 *   1. Select bound bridge device
 *   2. Select/create environment
 *   3. Enter room name and start room scan (camera + mic + CSI)
 *   4. Walk through room with bridge
 *   5. Stop scan → move to next room → repeat
 *   6. All data sent to cloud AI engine for processing
 */

import { useCallback, useEffect, useState } from "react";
import {
  BridgeCalibrationProgress,
  BridgeDevice,
  getBridgeCalibrationProgress,
  startPresenceScan,
  startRoomCalibration,
  stopBridgeCalibration,
} from "@/lib/api";

interface BridgeCalibrationProps {
  bridge: BridgeDevice;
  environmentId: string;
  environmentName: string;
  onBack?: () => void;
}

export default function BridgeCalibration({
  bridge,
  environmentId,
  environmentName,
  onBack,
}: BridgeCalibrationProps) {
  const [roomName, setRoomName] = useState("");
  const [progress, setProgress] = useState<BridgeCalibrationProgress | null>(
    null
  );
  const [isScanning, setIsScanning] = useState(false);
  const [scanType, setScanType] = useState<"room" | "presence">("room");
  const [error, setError] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  // Poll for progress updates while scanning
  useEffect(() => {
    if (isScanning) {
      const interval = setInterval(async () => {
        try {
          const p = await getBridgeCalibrationProgress(bridge.device_id);
          setProgress(p);
          if (p.status === "idle") {
            setIsScanning(false);
          }
        } catch {
          // Ignore poll errors
        }
      }, 2000);
      setPollInterval(interval);
      return () => clearInterval(interval);
    } else if (pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }
  }, [isScanning, bridge.device_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartScan = useCallback(async () => {
    if (!roomName.trim()) {
      setError("Enter a room name");
      return;
    }
    setError(null);
    setIsScanning(true);

    try {
      let p: BridgeCalibrationProgress;
      if (scanType === "room") {
        p = await startRoomCalibration(
          bridge.device_id,
          environmentId,
          roomName.trim()
        );
      } else {
        p = await startPresenceScan(
          bridge.device_id,
          environmentId,
          roomName.trim()
        );
      }
      setProgress(p);
    } catch (e) {
      setError("Failed to start scan. Check bridge connection.");
      setIsScanning(false);
    }
  }, [roomName, scanType, bridge.device_id, environmentId]);

  const handleStopScan = useCallback(async () => {
    try {
      await stopBridgeCalibration(bridge.device_id);
      setIsScanning(false);
      // Refresh progress to get updated rooms list
      const p = await getBridgeCalibrationProgress(bridge.device_id);
      setProgress(p);
    } catch {
      setError("Failed to stop scan");
    }
  }, [bridge.device_id]);

  const statusColor = (status: string) => {
    switch (status) {
      case "room_scanning":
        return "text-blue-400";
      case "presence_scanning":
        return "text-yellow-400";
      case "idle":
        return "text-green-400";
      default:
        return "text-zinc-400";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <svg
              className="w-5 h-5 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        )}
        <div>
          <h2 className="text-xl font-bold text-white">Room Calibration</h2>
          <p className="text-sm text-zinc-400">
            {environmentName} · {bridge.model} ({bridge.device_id})
          </p>
        </div>
      </div>

      {/* Bridge status card */}
      <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-zinc-300 text-sm font-medium">
            Bridge Status
          </span>
          <span className={`text-sm font-medium ${statusColor(progress?.status || bridge.status)}`}>
            {(progress?.status || bridge.status).replace(/_/g, " ").toUpperCase()}
          </span>
        </div>
        {progress?.current_room && (
          <p className="text-zinc-400 text-xs">
            Current room: <span className="text-cyan-400">{progress.current_room}</span>
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Scan Type Selection */}
      {!isScanning && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Scan Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setScanType("room")}
                className={`p-4 rounded-lg border text-left transition-colors ${
                  scanType === "room"
                    ? "border-cyan-500 bg-cyan-900/20"
                    : "border-zinc-700 bg-zinc-800/30 hover:border-zinc-600"
                }`}
              >
                <div className="text-white font-medium text-sm mb-1">
                  Room Scan
                </div>
                <div className="text-zinc-400 text-xs">
                  Camera + Mic + CSI — Full visual calibration for skeleton
                  extraction and RF fingerprinting
                </div>
              </button>
              <button
                onClick={() => setScanType("presence")}
                className={`p-4 rounded-lg border text-left transition-colors ${
                  scanType === "presence"
                    ? "border-yellow-500 bg-yellow-900/20"
                    : "border-zinc-700 bg-zinc-800/30 hover:border-zinc-600"
                }`}
              >
                <div className="text-white font-medium text-sm mb-1">
                  Presence Scan
                </div>
                <div className="text-zinc-400 text-xs">
                  CSI + Mic — Detect occupancy and movement patterns without
                  camera
                </div>
              </button>
            </div>
          </div>

          {/* Room name input */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Room Name
            </label>
            <input
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="e.g., Living Room, Kitchen, Bedroom"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
              maxLength={63}
            />
          </div>

          {/* Start button */}
          <button
            onClick={handleStartScan}
            disabled={!roomName.trim()}
            className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg text-white font-medium transition-colors"
          >
            {scanType === "room"
              ? "Start Room Calibration"
              : "Start Presence Scan"}
          </button>
        </div>
      )}

      {/* Active scan indicator */}
      {isScanning && (
        <div className="space-y-4">
          <div
            className={`border rounded-lg p-6 text-center ${
              scanType === "room"
                ? "border-blue-500/50 bg-blue-900/10"
                : "border-yellow-500/50 bg-yellow-900/10"
            }`}
          >
            {/* Animated scanning indicator */}
            <div className="relative w-24 h-24 mx-auto mb-4">
              <div
                className={`absolute inset-0 rounded-full border-2 animate-ping opacity-20 ${
                  scanType === "room" ? "border-blue-400" : "border-yellow-400"
                }`}
              />
              <div
                className={`absolute inset-2 rounded-full border-2 animate-ping opacity-30 ${
                  scanType === "room" ? "border-blue-400" : "border-yellow-400"
                }`}
                style={{ animationDelay: "0.3s" }}
              />
              <div
                className={`absolute inset-4 rounded-full border-2 animate-ping opacity-40 ${
                  scanType === "room" ? "border-blue-400" : "border-yellow-400"
                }`}
                style={{ animationDelay: "0.6s" }}
              />
              <div
                className={`absolute inset-0 flex items-center justify-center ${
                  scanType === "room" ? "text-blue-400" : "text-yellow-400"
                }`}
              >
                <svg
                  className="w-10 h-10 animate-pulse"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  {scanType === "room" ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0"
                    />
                  )}
                </svg>
              </div>
            </div>

            <h3 className="text-white font-semibold mb-1">
              {scanType === "room"
                ? "Room Calibration Active"
                : "Presence Scan Active"}
            </h3>
            <p className="text-zinc-400 text-sm mb-1">
              Scanning: <span className="text-cyan-400">{roomName}</span>
            </p>
            <p className="text-zinc-500 text-xs">
              {scanType === "room"
                ? "Walk slowly around the room. The bridge is capturing camera, microphone, and WiFi CSI data for the cloud AI engine."
                : "Stay still or walk normally. CSI and microphone data is being captured for presence detection."}
            </p>
          </div>

          <button
            onClick={handleStopScan}
            className="w-full py-3 bg-red-600 hover:bg-red-500 rounded-lg text-white font-medium transition-colors"
          >
            Stop Scan
          </button>
        </div>
      )}

      {/* Rooms calibrated */}
      {(progress?.rooms_calibrated || bridge.rooms_calibrated).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-zinc-300 mb-2">
            Calibrated Rooms
          </h3>
          <div className="space-y-2">
            {(progress?.rooms_calibrated || bridge.rooms_calibrated).map(
              (room) => (
                <div
                  key={room}
                  className="flex items-center gap-2 bg-zinc-800/30 border border-zinc-700/50 rounded-lg px-3 py-2"
                >
                  <svg
                    className="w-4 h-4 text-emerald-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span className="text-zinc-300 text-sm">{room}</span>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">
          How to Calibrate
        </h3>
        <ol className="text-zinc-400 text-xs space-y-1.5 list-decimal list-inside">
          <li>Enter the room name and select scan type</li>
          <li>
            Hold the Illy Bridge and walk slowly through the room
          </li>
          <li>
            For Room Scan: the camera captures visual data for skeleton
            extraction while CSI and mic capture RF fingerprints and acoustics
          </li>
          <li>
            For Presence Scan: only CSI and microphone are used — no camera
          </li>
          <li>
            Stop the scan when done, then move to the next room and repeat
          </li>
          <li>
            All captured data is sent to the Echo Vue cloud AI engine for
            processing and rendering
          </li>
        </ol>
      </div>
    </div>
  );
}

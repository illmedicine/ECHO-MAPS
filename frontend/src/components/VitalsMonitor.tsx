"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * VitalsMonitor — real-time breathing rate and heart rate display
 * from WiFi CSI vital sign extraction (Pro tier only).
 */

interface VitalsData {
  breathing_rate: number | null;
  heart_rate: number | null;
  activity: string;
  timestamp: number;
}

interface VitalsMonitorProps {
  environmentId: string;
  token: string;
  isLive: boolean;
}

export default function VitalsMonitor({ environmentId, token, isLive }: VitalsMonitorProps) {
  const [vitals, setVitals] = useState<VitalsData | null>(null);
  const [breathingHistory, setBreathingHistory] = useState<number[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (!isLive) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/live/stream/${environmentId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ token }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as VitalsData;
      data.timestamp = Date.now();
      setVitals(data);

      if (data.breathing_rate != null) {
        setBreathingHistory((prev) => [...prev.slice(-59), data.breathing_rate!]);
      }
    };

    ws.onclose = () => {
      // Reconnect after 3s
      setTimeout(connect, 3000);
    };
  }, [environmentId, token, isLive]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  if (!isLive) {
    return (
      <div className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800 text-gray-500">
        Vitals monitoring available after calibration (Pro tier).
      </div>
    );
  }

  return (
    <div className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800">
      <h2 className="text-lg font-semibold mb-4">Vital Signs</h2>

      <div className="grid grid-cols-3 gap-4">
        {/* Breathing Rate */}
        <div className="p-4 bg-gray-800/50 rounded-lg text-center">
          <div className="text-gray-400 text-sm mb-1">Breathing</div>
          <div className="text-3xl font-mono text-[var(--illy-green)]">
            {vitals?.breathing_rate != null ? vitals.breathing_rate.toFixed(1) : "--"}
          </div>
          <div className="text-xs text-gray-500">BPM</div>
        </div>

        {/* Heart Rate */}
        <div className="p-4 bg-gray-800/50 rounded-lg text-center">
          <div className="text-gray-400 text-sm mb-1">Heart Rate</div>
          <div className="text-3xl font-mono text-[var(--illy-red)]">
            {vitals?.heart_rate != null ? vitals.heart_rate.toFixed(0) : "--"}
          </div>
          <div className="text-xs text-gray-500">BPM</div>
        </div>

        {/* Activity */}
        <div className="p-4 bg-gray-800/50 rounded-lg text-center">
          <div className="text-gray-400 text-sm mb-1">Activity</div>
          <div className="text-xl font-medium text-[var(--illy-blue)] capitalize">
            {vitals?.activity || "--"}
          </div>
        </div>
      </div>

      {/* Breathing waveform (simple bar chart) */}
      {breathingHistory.length > 0 && (
        <div className="mt-4">
          <div className="text-sm text-gray-400 mb-2">Breathing Pattern (last 60s)</div>
          <div className="flex items-end gap-[1px] h-16">
            {breathingHistory.map((val, i) => (
              <div
                key={i}
                className="flex-1 bg-[var(--illy-green)] rounded-t opacity-70"
                style={{ height: `${Math.min((val / 30) * 100, 100)}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

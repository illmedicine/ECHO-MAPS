"use client";

/**
 * Bridge Management Dashboard Page
 *
 * Discover and bind Illy Bridge devices (FNK0086). Bridges sense WiFi CSI
 * continuously in public areas; there is no manual scan or calibration step.
 */

import dynamic from "next/dynamic";
import BridgeManager from "@/components/BridgeManager";

const LivePresencePanel = dynamic(() => import("@/components/LivePresencePanel"), { ssr: false });

export default function BridgePage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-4xl mx-auto p-4 md:p-6">
        <div className="mb-6 md:mb-8">
          <div className="flex items-center gap-2 text-zinc-400 text-sm mb-2">
            <a href="/dashboard" className="hover:text-white transition-colors">
              Dashboard
            </a>
            <span>/</span>
            <span className="text-white">Illy Bridge</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold">
            <span className="text-cyan-400">Illy</span> Bridge
          </h1>
          <p className="text-zinc-400 mt-1 text-sm md:text-base">
            Continuous WiFi CSI presence sensing in public areas (Freenove ESP32-S3 FNK0086)
          </p>
        </div>

        <div className="mb-6">
          <LivePresencePanel />
        </div>

        <BridgeManager onBridgeSelect={() => {}} />
      </div>
    </div>
  );
}

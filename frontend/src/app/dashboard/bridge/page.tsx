"use client";

/**
 * Illy Bridge Config
 *
 * Name each Illy Bridge (FNK0086) and choose the public area it monitors. Bridges
 * sense WiFi CSI continuously; configuration is relayed through the backend, so any
 * number of bridges can be set up here at once.
 */

import dynamic from "next/dynamic";
import BridgeConfigPanel from "@/components/BridgeConfigPanel";
import { CompanyFooter } from "@/components/CompanyLink";

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
            <span className="text-white">Illy Bridge Config</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold">
            <span className="text-cyan-400">Illy</span> Bridge Config
          </h1>
          <p className="text-zinc-400 mt-1 text-sm md:text-base">
            Name each bridge and assign it to a public area (Freenove ESP32-S3 FNK0086)
          </p>
        </div>

        <div className="mb-6">
          <BridgeConfigPanel />
        </div>

        <div className="mb-6">
          <LivePresencePanel />
        </div>
        <CompanyFooter tone="dark" />
      </div>
    </div>
  );
}

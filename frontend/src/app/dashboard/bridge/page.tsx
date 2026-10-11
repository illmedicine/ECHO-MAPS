"use client";

/**
 * Illy Bridge Config
 *
 * Name each Illy Bridge (FNK0086) and choose the public area it monitors. Bridges
 * sense WiFi CSI continuously; configuration is relayed through the backend, so any
 * number of bridges can be set up here at once.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import AppPageHeader from "@/components/site/AppPageHeader";
import BridgeConfigPanel from "@/components/BridgeConfigPanel";
import { CompanyFooter } from "@/components/CompanyLink";

const LivePresencePanel = dynamic(() => import("@/components/LivePresencePanel"), { ssr: false });

export default function BridgePage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--gh-bg)", color: "var(--gh-text)" }}>
      <div className="max-w-4xl mx-auto p-4 md:p-6">
        <AppPageHeader crumb="Illy Bridge Config" kicker="Illy Bridge" title={"Illy Bridge Config"} subtitle="Name each bridge and assign it to a public area (Freenove ESP32-S3 FNK0086)" />

        <div className="mb-6">
          <BridgeConfigPanel />
        </div>

        <div className="mb-6">
          <LivePresencePanel />
        </div>
        <CompanyFooter />
      </div>
    </div>
  );
}

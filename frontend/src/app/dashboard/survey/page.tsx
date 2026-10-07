"use client";

/**
 * WiFi Site Survey Dashboard Page
 *
 * Property-facing view: map the WiFi infrastructure of a building — how many
 * access points and repeaters are present, where coverage is strong or weak,
 * channel congestion, and a plain-language explainer of WiFi CSI. Built for
 * presenting Echo Vue to property management.
 */

import Link from "next/link";
import dynamic from "next/dynamic";

const WiFiSiteSurvey = dynamic(() => import("@/components/WiFiSiteSurvey"), { ssr: false });
const SensingZonesPanel = dynamic(() => import("@/components/SensingZonesPanel"), { ssr: false });

export default function SurveyPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--gh-bg)", color: "var(--gh-text)" }}>
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm mb-2" style={{ color: "var(--gh-text-muted)" }}>
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            <span>/</span>
            <span style={{ color: "var(--gh-text)" }}>WiFi Site Survey</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">🛰️ WiFi Site Survey</h1>
          <p className="mt-1 text-sm md:text-base" style={{ color: "var(--gh-text-muted)" }}>
            Map a property&apos;s WiFi coverage, repeaters and dead zones using CSI-aware RF sensing.
          </p>
        </div>

        <div className="mb-6">
          <SensingZonesPanel />
        </div>

        <WiFiSiteSurvey />
      </div>
    </main>
  );
}

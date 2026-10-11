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
import AppPageHeader from "@/components/site/AppPageHeader";
import dynamic from "next/dynamic";
import { CompanyFooter } from "@/components/CompanyLink";

const WiFiSiteSurvey = dynamic(() => import("@/components/WiFiSiteSurvey"), { ssr: false });
const LivePresencePanel = dynamic(() => import("@/components/LivePresencePanel"), { ssr: false });
const SensingZonesPanel = dynamic(() => import("@/components/SensingZonesPanel"), { ssr: false });

export default function SurveyPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--gh-bg)", color: "var(--gh-text)" }}>
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <AppPageHeader crumb="WiFi Site Survey" kicker="Site survey" title={"WiFi Site Survey"} subtitle="Map a property&apos;s WiFi coverage, repeaters and dead zones using CSI-aware RF sensing." />

        <div className="mb-6">
          <LivePresencePanel />
        </div>

        <div className="mb-6">
          <SensingZonesPanel />
        </div>

        <WiFiSiteSurvey />
        <CompanyFooter />
      </div>
    </main>
  );
}

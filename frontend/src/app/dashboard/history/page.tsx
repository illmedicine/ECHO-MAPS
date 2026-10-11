"use client";

/**
 * History & Insights page
 *
 * How many people, devices and pets passed through a public area over a period, with an AI-written
 * summary of the pattern. All figures are estimates and are presented with ranges.
 */

import Link from "next/link";
import dynamic from "next/dynamic";
import { CompanyFooter } from "@/components/CompanyLink";

const HistoryInsights = dynamic(() => import("@/components/HistoryInsights"), { ssr: false });

export default function HistoryPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--gh-bg)", color: "var(--gh-text)" }}>
      <div className="max-w-5xl mx-auto p-4 md:p-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm mb-2" style={{ color: "var(--gh-text-muted)" }}>
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            <span>/</span>
            <span style={{ color: "var(--gh-text)" }}>History &amp; Insights</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">📈 History &amp; Insights</h1>
          <p className="mt-1 text-sm md:text-base" style={{ color: "var(--gh-text-muted)" }}>
            Estimated people, devices and pets that passed through an area over time, and what the pattern suggests.
          </p>
        </div>
        <HistoryInsights />
        <CompanyFooter />
      </div>
    </main>
  );
}

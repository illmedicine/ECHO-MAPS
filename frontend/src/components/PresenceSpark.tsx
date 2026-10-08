"use client";

import type { LiveZone } from "@/lib/api";

/** Recent CSI motion score for a zone, with the detection threshold as a dashed line. */
export default function PresenceSpark({ zone, height = 32 }: { zone: LiveZone; height?: number }) {
  const h = zone.history;
  if (h.length < 2) return null;
  const max = Math.max(zone.threshold * 2, ...h.map((p) => p.score), 1e-6);
  const pts = h.map((p, i) => `${(i / (h.length - 1)) * 100},${30 - (p.score / max) * 28}`).join(" ");
  const ty = 30 - (zone.threshold / max) * 28;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full" style={{ height }} aria-label="CSI motion score">
      <line x1="0" x2="100" y1={ty} y2={ty} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="2 2" strokeWidth="0.6" />
      <polyline points={pts} fill="none" stroke={zone.present ? "#B3261E" : "var(--gh-green)"} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

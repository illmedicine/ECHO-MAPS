"use client";

/**
 * LiveOccupants — who the sensors think is in each public area right now.
 *
 * Purely live: nothing here is a saved profile. Each distinct, steady breathing rate a
 * bridge picks up is one occupant (slower = person, faster = pet). That split is a
 * heuristic, so everything is labelled an estimate. Select an occupant to see their
 * breathing stats and the CSI insights for the area they are in.
 */

import { useState } from "react";
import { useLivePresence } from "@/lib/useLivePresence";
import { PETS_BPM_NOTE, occupantsOf, pattern, signalQuality, type Occupant } from "@/lib/occupants";
import PresenceSpark from "./PresenceSpark";
import { ActivityMeter, NearbyBle } from "./ZoneInsights";

const QUALITY_COLOR = { strong: "var(--gh-green)", moderate: "#B8860B", weak: "var(--gh-text-muted)" } as const;

function RateTrend({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const lo = Math.min(...series), hi = Math.max(...series);
  const span = Math.max(hi - lo, 2); // never blow a flat line up into noise
  const mid = (hi + lo) / 2;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${15 - ((v - mid) / span) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full" style={{ height: 56 }} aria-label="Breathing rate over the last readings">
      <polyline points={pts} fill="none" stroke="var(--gh-blue)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function OccupantRow({ o, selected, onSelect }: { o: Occupant; selected: boolean; onSelect: () => void }) {
  const q = signalQuality(o);
  return (
    <li>
      <button
        onClick={onSelect}
        aria-pressed={selected}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition"
        style={{ backgroundColor: "var(--gh-card)", border: `1px solid ${selected ? "var(--gh-blue)" : "var(--gh-border)"}`, boxShadow: selected ? "0 0 0 1px var(--gh-blue)" : undefined }}
      >
        <span className="text-lg">{o.kind === "faster" ? "🐾" : "👤"}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{o.zone.zone}</span>
          <span className="block text-[11px]" style={{ color: "var(--gh-text-muted)" }}>
            ~{Math.round(o.bpm)} breaths/min · <span style={{ color: QUALITY_COLOR[q] }}>{q} signal</span>
          </span>
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(251,188,5,0.12)", color: "#8a6d00" }}>estimate</span>
      </button>
    </li>
  );
}

function OccupantList({ items, selectedKey, onSelect, empty }: { items: Occupant[]; selectedKey: string | null; onSelect: (k: string) => void; empty: string }) {
  if (items.length === 0) {
    return <p className="text-xs py-3 text-center" style={{ color: "var(--gh-text-muted)" }}>{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((o) => <OccupantRow key={o.key} o={o} selected={o.key === selectedKey} onSelect={() => onSelect(o.key)} />)}
    </ul>
  );
}

function Detail({ o }: { o: Occupant }) {
  const z = o.zone;
  const q = signalQuality(o);
  const stats: [string, string, string?][] = [
    ["Breathing rate", `${o.bpm.toFixed(1)} breaths/min`],
    ["Pattern", pattern(o) === "steady" ? "Steady" : "Variable"],
    ["Range", `${o.min.toFixed(1)}–${o.max.toFixed(1)}`],
    ["Signal quality", q, QUALITY_COLOR[q]],
    ["Readings", `${o.readings} (about ${o.readings * 5} s)`],
    ["Heart rate", "Not measured"],
  ];
  return (
    <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--gh-border)" }}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl">{o.kind === "faster" ? "🐾" : "👤"}</span>
        <div className="min-w-0">
          <h4 className="font-semibold">{o.kind === "faster" ? "Pet" : "Person"} <span className="text-xs font-normal" style={{ color: "var(--gh-text-muted)" }}>(estimate)</span></h4>
          <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
            {z.zone}{z.bridge_name ? ` · seen by ${z.bridge_name}` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold mb-2">Breathing</p>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            {stats.map(([k, v, c]) => (
              <div key={k} className="rounded-lg px-3 py-2" style={{ backgroundColor: "var(--gh-card)" }}>
                <dt style={{ color: "var(--gh-text-muted)" }}>{k}</dt>
                <dd className="font-medium" style={c ? { color: c } : undefined}>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="rounded-xl p-2 mt-3" style={{ backgroundColor: "var(--gh-card)" }}>
            <RateTrend series={o.series} />
            <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Breathing rate across recent readings.</p>
          </div>
          <p className="text-[10px] mt-2" style={{ color: "var(--gh-text-muted)" }}>
            Heart rate isn&apos;t reported: it can&apos;t be measured reliably from one WiFi link.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold mb-2">CSI insights for {z.zone}</p>
          <div className="rounded-xl p-2 mb-3" style={{ backgroundColor: "var(--gh-card)" }}>
            <PresenceSpark zone={z} height={56} />
            <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Motion score, last minute. Dashed line = detection threshold.</p>
          </div>
          <div className="space-y-3">
            <ActivityMeter zone={z} />
            <dl className="grid grid-cols-3 gap-2 text-xs">
              {[
                ["Confidence", `${Math.round(z.confidence * 100)}%`],
                ["Signal (RSSI)", `${z.rssi} dBm`],
                ["CSI frames", z.frames.toLocaleString()],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg px-3 py-2" style={{ backgroundColor: "var(--gh-card)" }}>
                  <dt style={{ color: "var(--gh-text-muted)" }}>{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <NearbyBle zone={z} />
          </div>
          <p className="text-[10px] mt-2" style={{ color: "var(--gh-text-muted)" }}>
            Area-level values are shared by everyone in this area; the breathing figures on the left belong to this occupant.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LiveOccupants() {
  const live = useLivePresence(2000);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { people, pets, unclassified } = occupantsOf(live.zones);
  const connected = live.link === "ok";
  const selected = [...people, ...pets].find((o) => o.key === selectedKey) ?? null;
  const toggle = (k: string) => setSelectedKey((cur) => (cur === k ? null : k));

  return (
    <div className="p-5 rounded-2xl mb-6" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold">People &amp; pets detected now</h3>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--gh-text-muted)" }}>
            Live from each area&apos;s breathing signatures. Select one for its breathing stats and CSI insights.
          </p>
        </div>
        {connected && (
          <p className="text-xs flex-shrink-0" style={{ color: "var(--gh-text-muted)" }}>
            <strong style={{ color: "var(--gh-text)" }}>{people.length}</strong> {people.length === 1 ? "person" : "people"} ·{" "}
            <strong style={{ color: "var(--gh-text)" }}>{pets.length}</strong> {pets.length === 1 ? "pet" : "pets"}
          </p>
        )}
      </div>

      {!connected ? (
        <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
          {live.link === "error" ? "Can't read live data right now." : "Waiting for live data…"}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                👤 People
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(91,156,246,0.12)", color: "var(--gh-blue)" }}>{people.length}</span>
              </h4>
              <OccupantList items={people} selectedKey={selectedKey} onSelect={toggle} empty="No people detected" />
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                🐾 Pets
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(245,197,66,0.15)", color: "#8a6d00" }}>{pets.length}</span>
              </h4>
              <OccupantList items={pets} selectedKey={selectedKey} onSelect={toggle} empty="No pets detected" />
            </div>
          </div>

          {unclassified.length > 0 && (
            <div className="mt-3 text-xs px-3 py-2 rounded-xl" style={{ backgroundColor: "rgba(234,67,53,0.08)", color: "var(--gh-text-muted)" }}>
              <strong style={{ color: "#B3261E" }}>Presence, not counted:</strong>{" "}
              {unclassified.map((z) => z.zone).join(", ")}. Movement is detected but there is no steady breathing to count, which is normal for people walking through.
            </div>
          )}

          {selectedKey && !selected && (
            <p className="text-xs mt-4 pt-4" style={{ borderTop: "1px solid var(--gh-border)", color: "var(--gh-text-muted)" }}>
              That occupant is no longer detected (their breathing signal faded or they moved).
            </p>
          )}
          {selected && <Detail o={selected} />}

          <p className="text-[10px] mt-4" style={{ color: "var(--gh-text-muted)" }}>
            How it works: each distinct, steady breathing rate is one occupant. {PETS_BPM_NOTE} Two occupants breathing at nearly the same rate merge into one, and anyone moving about isn&apos;t counted until they settle.
          </p>
        </>
      )}
    </div>
  );
}

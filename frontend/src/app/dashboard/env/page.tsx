"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getEnvironment as getLocalEnv } from "@/lib/environments";
import { classifyRoom, isSensingAllowed } from "@/lib/sensingZones";
import { useLivePresence } from "@/lib/useLivePresence";

const EnvironmentViewer = dynamic(() => import("@/components/EnvironmentViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded-2xl flex items-center justify-center" style={{ backgroundColor: "var(--gh-surface)", color: "var(--gh-text-muted)", height: "400px" }}>
      Loading 3D viewer...
    </div>
  ),
});

const DEFAULT_DIMS = { width: 5, length: 4, height: 2.7 };

interface EnvState {
  id: string;
  name: string;
  type: string;
  dims: { width: number; length: number; height: number };
}

export default function EnvironmentViewPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--gh-blue)] border-t-transparent rounded-full animate-spin" />
      </main>
    }>
      <EnvironmentViewContent />
    </Suspense>
  );
}

function EnvironmentViewContent() {
  const searchParams = useSearchParams();
  const envId = searchParams.get("id");
  const [env, setEnv] = useState<EnvState | null>(null);
  const live = useLivePresence(2000);

  useEffect(() => {
    if (!envId) return;
    const local = getLocalEnv(envId);
    if (local) {
      setEnv({ id: local.id, name: local.name, type: local.type, dims: local.dimensions ?? DEFAULT_DIMS });
    }
  }, [envId]);

  if (!envId) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p style={{ color: "var(--gh-text-muted)" }} className="mb-4">No environment selected</p>
          <Link href="/dashboard" className="hover:underline" style={{ color: "var(--gh-blue)" }}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (!env) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--gh-blue)] border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  const kind = classifyRoom({ id: env.id, name: env.name, type: env.type });
  const sensed = isSensingAllowed({ id: env.id, name: env.name, type: env.type });
  const zone = live.zones.find((z) => z.zone.trim().toLowerCase() === env.name.trim().toLowerCase());

  let status = "No live sensor";
  let color = "var(--gh-text-muted)";
  if (!sensed) {
    status = "Sensing disabled (private room)";
  } else if (zone && zone.state !== "offline") {
    if (zone.state === "learning") { status = `Calibrating baseline ${Math.round(zone.learning_progress * 100)}%`; color = "#B8860B"; }
    else if (zone.present) { status = "Presence detected"; color = "#B3261E"; }
    else { status = "Clear"; color = "var(--gh-green)"; }
  }

  return (
    <main className="min-h-screen p-3 md:p-6" style={{ backgroundColor: "var(--gh-bg)" }}>
      <div className="flex items-center gap-3 md:gap-4 flex-wrap mb-4 md:mb-6 max-w-6xl mx-auto">
        <Link href="/dashboard" className="text-sm transition hover:opacity-80" style={{ color: "var(--gh-text-muted)" }}>← Dashboard</Link>
        <h1 className="text-xl md:text-2xl font-bold">{env.name}</h1>
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>
          {kind === "public" ? "Public area" : "Private room"}
        </span>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
            <div className="px-4 py-2 text-xs font-medium" style={{ color: "var(--gh-text-muted)", borderBottom: "1px solid var(--gh-border)" }}>
              Space Preview — {env.dims.width}m × {env.dims.length}m × {env.dims.height}m
            </div>
            <EnvironmentViewer roomBounds={[env.dims.width, env.dims.length, env.dims.height]} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border p-4" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
            <h3 className="font-semibold mb-3">Live CSI Presence</h3>
            <p className="text-lg font-semibold" style={{ color }}>{status}</p>
            {sensed && zone && zone.state !== "offline" && zone.state !== "learning" && (
              <p className="text-xs mt-1" style={{ color: "var(--gh-text-muted)" }}>
                Confidence {Math.round(zone.confidence * 100)}% · RSSI {zone.rssi} dBm · updated {zone.age_s}s ago
              </p>
            )}
            {sensed && !zone && live.link === "ok" && (
              <p className="text-xs mt-1" style={{ color: "var(--gh-text-muted)" }}>
                No bridge is reporting for a zone named &ldquo;{env.name}&rdquo;. Set the bridge&apos;s zone name to match.
              </p>
            )}
            {live.link === "error" && <p className="text-xs mt-1" style={{ color: "#B3261E" }}>{live.error}</p>}
          </div>

          <div className="rounded-2xl border p-4" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
            <h3 className="font-semibold mb-3">Space</h3>
            <div className="space-y-2 text-sm" style={{ color: "var(--gh-text-muted)" }}>
              <div className="flex justify-between"><span>Dimensions</span><span>{env.dims.width}m × {env.dims.length}m</span></div>
              <div className="flex justify-between"><span>Height</span><span>{env.dims.height}m</span></div>
              <div className="flex justify-between"><span>Area</span><span>{(env.dims.width * env.dims.length).toFixed(1)}m²</span></div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

"use client";

/**
 * LivePresencePanel — real-time WiFi CSI presence for public areas.
 *
 * Data comes from the Illy Bridge sensor(s) streaming CSI motion features to
 * the backend. Nothing here is simulated: a zone with no sensor data reads
 * "Sensor offline", never "Empty".
 */

import { useEffect } from "react";
import { useLivePresence } from "@/lib/useLivePresence";
import { isBackendConfigured, publishPublicAreas, type LiveZone } from "@/lib/api";
import { getEnvironments } from "@/lib/environments";
import { publicAreaNames } from "@/lib/sensingZones";
import PresenceSpark from "./PresenceSpark";
import ZoneInsights from "./ZoneInsights";

const STATE_STYLE: Record<LiveZone["state"], { label: string; color: string; bg: string }> = {
  present: { label: "Presence detected", color: "#B3261E", bg: "rgba(234,67,53,0.10)" },
  empty: { label: "Clear", color: "var(--gh-green)", bg: "rgba(52,168,83,0.10)" },
  learning: { label: "Learning baseline", color: "#B8860B", bg: "rgba(251,188,5,0.12)" },
  offline: { label: "Sensor offline", color: "var(--gh-text-muted)", bg: "var(--gh-card)" },
};

export default function LivePresencePanel({ compact = false }: { compact?: boolean }) {
  const { zones, link, error, occupied } = useLivePresence(2000);

  // Tell the backend which public areas this facility has, so bridges offer exactly those.
  useEffect(() => {
    if (!isBackendConfigured()) return;
    const areas = publicAreaNames(getEnvironments());
    if (areas.length > 0) publishPublicAreas(areas).catch(() => {});
  }, []);

  return (
    <div className="p-5 rounded-2xl" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            📡 Live CSI Presence
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: link === "ok" ? "var(--gh-green)" : "var(--gh-text-muted)" }}
              title={link}
            />
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--gh-text-muted)" }}>
            Continuous WiFi CSI from the bridge sensor, public areas only. No manual scan needed.
          </p>
        </div>
        {link === "ok" && (
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-bold" style={{ color: occupied ? "#B3261E" : "var(--gh-green)" }}>{occupied}</p>
            <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>zone{occupied === 1 ? "" : "s"} occupied</p>
          </div>
        )}
      </div>

      {link === "no-backend" && (
        <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
          No backend configured (NEXT_PUBLIC_API_URL). Live CSI needs the Echo Maps API.
        </p>
      )}
      {link === "connecting" && <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>Connecting to the API…</p>}
      {link === "error" && (
        <p className="text-xs" style={{ color: "#B3261E" }}>
          Can&apos;t read live presence: {error}. {error?.toLowerCase().includes("credential") || error?.toLowerCase().includes("authenticated") ? "Sign in with Google to see sensor data." : "The API may be waking up (free tier can take ~30 s)."}
        </p>
      )}
      {link === "ok" && zones.length === 0 && (
        <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
          No sensor has reported yet. Power on the bridge on the hotel WiFi; it starts sensing on its own and appears here within seconds.
        </p>
      )}

      <div className="space-y-2">
        {zones.map((z) => {
          const st = STATE_STYLE[z.state];
          return (
            <div key={`${z.device_id}-${z.zone}`} className="px-3 py-2.5 rounded-xl" style={{ backgroundColor: st.bg, border: "1px solid var(--gh-border)" }}>
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{z.bridge_name || z.zone}</span>
                  {z.bridge_name && (
                    <span className="block text-[11px] truncate" style={{ color: "var(--gh-text-muted)" }}>
                      Location: {z.zone}
                    </span>
                  )}
                </span>
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: st.color }}>
                  {z.state === "present" ? `👤 ${st.label}` : st.label}
                </span>
              </div>
              {!compact && z.state !== "offline" && (
                <>
                  <div className="flex flex-wrap gap-x-3 text-[10px] mt-1" style={{ color: "var(--gh-text-muted)" }}>
                    {z.state === "learning" ? (
                      <span>Calibrating empty-room baseline… {Math.round(z.learning_progress * 100)}%</span>
                    ) : (
                      <>
                        <span>Confidence {Math.round(z.confidence * 100)}%</span>
                        {z.present && <span>Activity: {z.activity}</span>}
                      </>
                    )}
                    <span>RSSI {z.rssi} dBm</span>
                    <span>{z.frames.toLocaleString()} CSI frames</span>
                    {z.age_s !== null && <span>updated {z.age_s}s ago</span>}
                  </div>
                  <PresenceSpark zone={z} />
                  <ZoneInsights zone={z} />
                </>
              )}
              {z.state === "offline" && z.age_s !== null && (
                <p className="text-[10px] mt-1" style={{ color: "var(--gh-text-muted)" }}>Last data {Math.round(z.age_s)}s ago</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

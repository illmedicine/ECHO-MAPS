"use client";

import { useEffect, useRef, useState } from "react";
import { getLivePresence, isBackendConfigured, type LiveZone } from "./api";

export type LiveLink = "no-backend" | "connecting" | "ok" | "error";

export interface LivePresence {
  zones: LiveZone[];
  link: LiveLink;
  error: string | null;
  /** zones currently reporting someone present */
  occupied: number;
}

/**
 * Polls the backend for real CSI presence. No simulation: if the sensor is not
 * streaming, zones are "offline" (or absent) rather than empty.
 */
export function useLivePresence(intervalMs = 2000): LivePresence {
  const [zones, setZones] = useState<LiveZone[]>([]);
  const [link, setLink] = useState<LiveLink>(isBackendConfigured() ? "connecting" : "no-backend");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!isBackendConfigured()) return;
    let alive = true;
    const tick = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const res = await getLivePresence();
        if (!alive) return;
        setZones(res.zones);
        setLink("ok");
        setError(null);
      } catch (e) {
        if (!alive) return;
        setLink("error");
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy.current = false;
      }
    };
    tick();
    const iv = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [intervalMs]);

  return { zones, link, error, occupied: zones.filter((z) => z.present).length };
}

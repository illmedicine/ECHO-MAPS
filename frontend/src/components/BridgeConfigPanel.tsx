"use client";

/**
 * BridgeConfigPanel — name each Illy Bridge and choose the public area it monitors.
 *
 * The dashboard is served over HTTPS, so it cannot call a bridge's own
 * http://<ip>/zone page. Instead the choice is saved to the backend and the bridge
 * picks it up in the reply to its next upload (a few seconds), so any number of
 * bridges can be configured from here without being on their network.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  configureBridge,
  getBridges,
  isBackendConfigured,
  publishPublicAreas,
  type BridgeInfo,
} from "@/lib/api";
import { getEnvironments } from "@/lib/environments";
import { publicAreaNames } from "@/lib/sensingZones";

const NAME_OK = /^[A-Za-z0-9 \-_.,'/#()]{1,47}$/;
const UNASSIGNED = "";

type Link = "no-backend" | "connecting" | "ok" | "error";

export default function BridgeConfigPanel() {
  const [bridges, setBridges] = useState<BridgeInfo[]>([]);
  const [link, setLink] = useState<Link>(isBackendConfigured() ? "connecting" : "no-backend");
  const [error, setError] = useState<string | null>(null);
  const [areas, setAreas] = useState<string[]>([]);

  // The facility's public areas come from the property layout; publish them so the backend
  // (and each bridge) agree on the list, then offer exactly those.
  useEffect(() => {
    const names = publicAreaNames(getEnvironments());
    setAreas(names);
    if (isBackendConfigured() && names.length > 0) publishPublicAreas(names).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isBackendConfigured()) return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const res = await getBridges();
        if (!alive) return;
        setBridges(res.bridges);
        setLink("ok");
        setError(null);
      } catch (e) {
        if (!alive) return;
        setLink("error");
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy = false;
      }
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return (
    <div className="p-5 rounded-2xl" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            ⚙️ Bridge configuration
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: link === "ok" ? "var(--gh-green)" : link === "error" ? "#B3261E" : "var(--gh-text-muted)" }}
              title={link}
            />
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--gh-text-muted)" }}>
            Give each Illy Bridge a name and choose the public area it monitors. Changes are sent over the internet and the bridge applies them within a few seconds.
          </p>
        </div>
        <span className="text-xs flex-shrink-0" style={{ color: "var(--gh-text-muted)" }}>
          {bridges.length} bridge{bridges.length === 1 ? "" : "s"}
        </span>
      </div>

      {link === "no-backend" && (
        <p className="text-xs mt-3" style={{ color: "var(--gh-text-muted)" }}>No backend configured (NEXT_PUBLIC_API_URL). Bridge configuration needs the Echo Maps API.</p>
      )}
      {link === "connecting" && <p className="text-xs mt-3" style={{ color: "var(--gh-text-muted)" }}>Connecting to the API…</p>}
      {link === "error" && (
        <p className="text-xs mt-3" style={{ color: "#B3261E" }}>
          Can&apos;t read bridges: {error}. The API may be waking up (free tier can take ~30 s), or you may need to sign in with Google.
        </p>
      )}
      {link === "ok" && bridges.length === 0 && (
        <p className="text-xs mt-3" style={{ color: "var(--gh-text-muted)" }}>
          No bridge has reported yet. Power on an Illy Bridge on the facility WiFi; it appears here within seconds, and then you can name it and pick its area.
        </p>
      )}
      {link === "ok" && areas.length === 0 && (
        <p className="text-xs mt-3 p-2.5 rounded-lg" style={{ backgroundColor: "rgba(251,188,5,0.12)", color: "#8a6d00" }}>
          This facility has no public areas yet. Open the Rooms tab and run <strong>Auto-Setup Hotel</strong> (or add an area) so there is something to assign.
        </p>
      )}

      <div className="space-y-3 mt-4">
        {bridges.map((b) => (
          <BridgeCard key={b.device_id} bridge={b} areas={areas} />
        ))}
      </div>
    </div>
  );
}

function BridgeCard({ bridge: b, areas }: { bridge: BridgeInfo; areas: string[] }) {
  // What the bridge will have once any pending change lands.
  const target = { name: b.pending?.bridge_name ?? b.bridge_name, area: b.pending?.area ?? b.area };
  const [name, setName] = useState(target.name);
  const [area, setArea] = useState(areas.includes(target.area) ? target.area : UNASSIGNED);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justApplied, setJustApplied] = useState(false);
  const hadPending = useRef(false);

  // Follow the bridge's real state until the user starts editing.
  useEffect(() => {
    if (touched) return;
    setName(target.name);
    setArea(areas.includes(target.area) ? target.area : UNASSIGNED);
  }, [target.name, target.area, areas, touched]);

  // Pending went away => the bridge adopted the change.
  useEffect(() => {
    if (b.pending) { hadPending.current = true; return; }
    if (hadPending.current) {
      hadPending.current = false;
      setJustApplied(true);
      const t = setTimeout(() => setJustApplied(false), 5000);
      return () => clearTimeout(t);
    }
  }, [b.pending]);

  const options = useMemo(() => areas, [areas]);
  const nameChanged = name.trim() !== b.bridge_name;
  const areaChanged = area !== UNASSIGNED && area !== b.area;
  const nameValid = NAME_OK.test(name.trim());
  const dirty = (nameChanged || areaChanged) && nameValid && !b.pending;
  const online = b.state !== "offline";

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await configureBridge(b.device_id, {
        ...(nameChanged ? { bridge_name: name.trim() } : {}),
        ...(areaChanged ? { area } : {}),
      });
      setTouched(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)" }}>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: online ? "var(--gh-green)" : "var(--gh-text-muted)" }} />
        <span className="font-medium text-sm">{b.bridge_name || "Unnamed bridge"}</span>
        <span className="text-[11px]" style={{ color: "var(--gh-text-muted)" }}>
          {online ? "online" : "offline"}
          {b.age_s !== null ? ` · last data ${Math.round(b.age_s)}s ago` : ""}
        </span>
        <span className="ml-auto text-[11px]" style={{ color: "var(--gh-text-muted)" }}>{b.device_id}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="font-medium">Bridge name</span>
          <input
            value={name}
            maxLength={47}
            onChange={(e) => { setName(e.target.value); setTouched(true); }}
            className="mt-1 w-full px-3 py-2 rounded-lg text-sm"
            style={{ backgroundColor: "var(--gh-surface)", border: `1px solid ${nameValid ? "var(--gh-border)" : "#B3261E"}`, color: "var(--gh-text)" }}
            aria-label={`Bridge name for ${b.device_id}`}
          />
          {!nameValid && <span className="text-[10px]" style={{ color: "#B3261E" }}>Letters, digits, spaces and - _ . , &apos; / # ( ) only.</span>}
        </label>
        <label className="block text-xs">
          <span className="font-medium">Area</span>
          <select
            value={area}
            onChange={(e) => { setArea(e.target.value); setTouched(true); }}
            className="mt-1 w-full px-3 py-2 rounded-lg text-sm"
            style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }}
            aria-label={`Area for ${b.device_id}`}
          >
            <option value={UNASSIGNED}>{b.area && !areas.includes(b.area) ? `${b.area} — choose an area` : "— choose an area —"}</option>
            {options.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3 flex-wrap mt-3">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--gh-blue)", color: "#fff" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {b.pending && (
          <span className="text-xs" style={{ color: "#8a6d00" }}>
            ⏳ Waiting for the bridge to apply{b.state === "offline" ? " (it is offline; it will apply when it reconnects)" : ""}…
          </span>
        )}
        {justApplied && !b.pending && <span className="text-xs" style={{ color: "var(--gh-green)" }}>✓ Applied</span>}
        {err && <span className="text-xs" style={{ color: "#B3261E" }}>{err}</span>}
        {b.ip && (
          <a
            href={`http://${b.ip}/zone`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[11px] hover:underline"
            style={{ color: "var(--gh-text-muted)" }}
            title="Only works from a device on the same network as the bridge"
          >
            Local setup page · {b.ip}
          </a>
        )}
      </div>
    </div>
  );
}

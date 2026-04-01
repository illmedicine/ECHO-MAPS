"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  isBackendConfigured,
  listEnvironments,
  createEnvironment,
  deleteEnvironment,
  healthCheck,
} from "@/lib/api";
import {
  getEnvironments,
  createEnvironment as createLocalEnv,
  deleteEnvironment as deleteLocalEnv,
  Environment,
} from "@/lib/environments";

interface UserData {
  id: string;
  email: string;
  name: string;
  picture: string;
  apiToken?: string;
}

interface SpaceCard {
  id: string;
  name: string;
  type: string;
  isCalibrated: boolean;
  calibrationConfidence: number;
  createdAt: string;
}

const SPACE_ICONS: Record<string, string> = {
  home: "\uD83C\uDFE0",
  office: "\uD83C\uDFE2",
  clinic: "\uD83C\uDFE5",
  kitchen: "\uD83C\uDF73",
  bedroom: "\uD83D\uDECF\uFE0F",
  living_room: "\uD83D\uDECB\uFE0F",
  patio: "\u2600\uFE0F",
  factory: "\uD83C\uDFED",
  other: "\uD83D\uDCCD",
};

type TabView = "spaces" | "automations" | "presence";

export default function DashboardPage() {
  const router = useRouter();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [user, setUser] = useState<UserData | null>(null);
  const [spaces, setSpaces] = useState<SpaceCard[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabView>("spaces");

  useEffect(() => {
    const stored = localStorage.getItem("echo_maps_user");
    if (!stored) { router.push("/auth/signin"); return; }
    setUser(JSON.parse(stored));
  }, [router]);

  const loadSpaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (isBackendConfigured()) {
      try {
        await healthCheck();
        setBackendOnline(true);
        const envs = await listEnvironments();
        setSpaces(envs.map((e) => ({ id: e.id, name: e.name, type: "other", isCalibrated: e.is_calibrated, calibrationConfidence: e.calibration_confidence, createdAt: e.created_at })));
      } catch {
        setBackendOnline(false);
        loadLocal();
      }
    } else {
      setBackendOnline(false);
      loadLocal();
    }
    setLoading(false);
  }, []);

  const loadLocal = () => {
    const local = getEnvironments();
    setSpaces(local.map((e) => ({ id: e.id, name: e.name, type: e.type, isCalibrated: e.isCalibrated, calibrationConfidence: e.calibrationConfidence, createdAt: e.createdAt })));
  };

  useEffect(() => { if (user) loadSpaces(); }, [user, loadSpaces]);

  const handleSignOut = () => { localStorage.removeItem("echo_maps_user"); router.push("/"); };

  const handleCreate = async (name: string, type: string, dims: { width: number; length: number; height: number }) => {
    setError(null);
    try {
      if (backendOnline) { await createEnvironment(name); }
      else { createLocalEnv({ name, type: type as Environment["type"], dimensions: dims }); }
      await loadSpaces();
      setShowNewModal(false);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to create space"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this space?")) return;
    try {
      if (backendOnline) { await deleteEnvironment(id); }
      else { deleteLocalEnv(id); }
      await loadSpaces();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to delete"); }
  };

  if (!user) return <main className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-[var(--gh-blue)] border-t-transparent rounded-full animate-spin" /></main>;

  // Group spaces by type
  const grouped = spaces.reduce<Record<string, SpaceCard[]>>((acc, s) => {
    const key = s.type || "other";
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 border-r flex flex-col" style={{ borderColor: "var(--gh-border)", backgroundColor: "var(--gh-bg)" }}>
        {/* Logo */}
        <div className="p-5 flex items-center gap-3">
          <Image src={`${basePath}/logo.svg`} alt="Echo Vue" width={36} height={36} unoptimized />
          <div>
            <span className="font-bold text-base">
              <span style={{ color: "var(--gh-blue)" }}>Echo</span>{" "}
              <span style={{ color: "var(--gh-green)" }}>Vue</span>
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: backendOnline ? "var(--gh-green)" : "var(--gh-yellow)" }} />
              <span className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{backendOnline ? "Connected" : "Demo"}</span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 mt-2 space-y-1">
          <button onClick={() => setActiveTab("spaces")} className={`sidebar-item w-full ${activeTab === "spaces" ? "active" : ""}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
            Spaces
          </button>
          <button onClick={() => setActiveTab("automations")} className={`sidebar-item w-full ${activeTab === "automations" ? "active" : ""}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            Automations
          </button>
          <button onClick={() => setActiveTab("presence")} className={`sidebar-item w-full ${activeTab === "presence" ? "active" : ""}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            Presence
          </button>
        </nav>

        {/* User */}
        <div className="p-4 border-t" style={{ borderColor: "var(--gh-border)" }}>
          <div className="flex items-center gap-3">
            {user.picture && <img src={user.picture} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-[10px] truncate" style={{ color: "var(--gh-text-muted)" }}>{user.email}</p>
            </div>
            <button onClick={handleSignOut} className="text-xs px-2 py-1 rounded-full hover:bg-white/10 transition" style={{ color: "var(--gh-text-muted)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: "var(--gh-bg)" }}>
        {/* Top bar */}
        <header className="sticky top-0 z-10 px-8 py-4 flex items-center justify-between" style={{ backgroundColor: "var(--gh-bg)", borderBottom: "1px solid var(--gh-border)" }}>
          <h1 className="text-xl font-semibold">{activeTab === "spaces" ? "Spaces" : activeTab === "automations" ? "Automations" : "Presence Detection"}</h1>
          <div className="flex items-center gap-3">
            {activeTab === "spaces" && (
              <button onClick={() => setShowNewModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition hover:opacity-90" style={{ backgroundColor: "var(--gh-blue)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                Add Space
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="mx-8 mt-4 p-3 rounded-xl text-sm flex items-center justify-between" style={{ backgroundColor: "rgba(234,67,53,0.1)", color: "var(--gh-red)" }}>
            <span>{error}</span>
            <button onClick={() => setError(null)}>?</button>
          </div>
        )}

        <div className="p-8">
          {activeTab === "spaces" ? (
            <>
              {loading ? (
                <div className="flex justify-center py-16">
                  <div className="w-8 h-8 border-2 border-[var(--gh-blue)] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : spaces.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-[var(--gh-text-muted)]">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" className="mb-4 opacity-30"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
                  <p className="text-lg mb-2">No spaces yet</p>
                  <p className="text-sm mb-6">Add your first space to start monitoring</p>
                  <button onClick={() => setShowNewModal(true)} className="px-6 py-2.5 rounded-full text-sm font-medium" style={{ backgroundColor: "var(--gh-blue)" }}>Add Space</button>
                </div>
              ) : (
                /* Google Home style: grouped by type */
                Object.entries(grouped).map(([type, items]) => (
                  <div key={type} className="mb-8">
                    <h2 className="text-sm font-medium mb-3 capitalize" style={{ color: "var(--gh-text-muted)" }}>{type === "other" ? "Spaces" : type.replace("_", " ")}</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {items.map((space) => (
                        <div key={space.id} className="device-card group relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDelete(space.id); }}
                            className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-white/10"
                            style={{ color: "var(--gh-text-muted)" }}
                          >?</button>
                          <Link href={`/dashboard/env?id=${space.id}`} className="block">
                            <div className="flex items-center gap-3">
                              <span className="text-xl">{SPACE_ICONS[space.type] ?? "\uD83D\uDCCD"}</span>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-medium text-sm truncate">{space.name}</h3>
                                <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
                                  {space.isCalibrated ? "Active" : "Setup required"}
                                </p>
                              </div>
                            </div>
                            {/* Status bar */}
                            <div className="mt-3 flex items-center gap-2">
                              <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--gh-border)" }}>
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(5, space.calibrationConfidence * 100)}%`, backgroundColor: space.isCalibrated ? "var(--gh-green)" : "var(--gh-blue)" }} />
                              </div>
                              <span className="text-[10px] font-medium" style={{ color: space.isCalibrated ? "var(--gh-green)" : "var(--gh-text-muted)" }}>
                                {space.isCalibrated ? "Live" : `${(space.calibrationConfidence * 100).toFixed(0)}%`}
                              </span>
                            </div>
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </>
          ) : activeTab === "automations" ? (
            <AutomationsView />
          ) : (
            <PresenceView />
          )}
        </div>
      </main>

      {showNewModal && <NewSpaceModal onClose={() => setShowNewModal(false)} onCreate={handleCreate} />}
    </div>
  );
}

/* --- Automations Tab --- */
function AutomationsView() {
  const automations = [
    { id: "1", name: "Lights off when room empty", trigger: "No presence for 5 min", action: "Turn off lights", space: "Living Room", enabled: true, icon: "\uD83D\uDCA1" },
    { id: "2", name: "Lock door at night", trigger: "No activity after 11 PM", action: "Lock front door", space: "Patio", enabled: true, icon: "\uD83D\uDD12" },
    { id: "3", name: "HVAC eco mode", trigger: "Space unoccupied 15 min", action: "Set thermostat to 68F", space: "Office", enabled: false, icon: "\u2744\uFE0F" },
    { id: "4", name: "Alert: unusual activity", trigger: "Movement detected 2-5 AM", action: "Send notification", space: "All spaces", enabled: true, icon: "\uD83D\uDEA8" },
    { id: "5", name: "Welcome routine", trigger: "Person detected entering", action: "Lights on, play music", space: "Kitchen", enabled: false, icon: "\uD83C\uDFB5" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>Create workflows triggered by Echo Vue events. Connect with Google Home, IFTTT, and smart devices.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium opacity-60 cursor-not-allowed" style={{ backgroundColor: "var(--gh-blue)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          New Automation
        </button>
      </div>

      <div className="space-y-3">
        {automations.map((auto) => (
          <div key={auto.id} className="device-card flex items-center gap-4">
            <span className="text-2xl">{auto.icon}</span>
            <div className="flex-1">
              <h3 className="font-medium text-sm">{auto.name}</h3>
              <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
                <span style={{ color: "var(--gh-yellow)" }}>When:</span> {auto.trigger} &nbsp;|&nbsp;
                <span style={{ color: "var(--gh-green)" }}>Then:</span> {auto.action}
              </p>
              <p className="text-[10px] mt-1" style={{ color: "var(--gh-text-muted)" }}>{auto.space}</p>
            </div>
            <div className={`w-10 h-5 rounded-full flex items-center transition-colors duration-200 cursor-pointer ${auto.enabled ? "justify-end" : "justify-start"}`}
              style={{ backgroundColor: auto.enabled ? "var(--gh-blue)" : "var(--gh-border)", padding: "2px" }}>
              <div className="w-4 h-4 rounded-full bg-white shadow" />
            </div>
          </div>
        ))}
      </div>

      {/* Future integrations */}
      <div className="mt-8 p-6 rounded-2xl border border-dashed" style={{ borderColor: "var(--gh-border)" }}>
        <h3 className="font-semibold mb-3">Coming Soon: Integrations</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { name: "Google Home", icon: "\uD83C\uDFE0", status: "Planned" },
            { name: "IFTTT", icon: "\u26A1", status: "Planned" },
            { name: "SmartThings", icon: "\uD83D\uDCF1", status: "Planned" },
            { name: "Home Assistant", icon: "\uD83E\uDD16", status: "Planned" },
          ].map((i) => (
            <div key={i.name} className="p-3 rounded-xl text-center" style={{ backgroundColor: "var(--gh-surface)" }}>
              <span className="text-2xl block mb-1">{i.icon}</span>
              <p className="text-xs font-medium">{i.name}</p>
              <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{i.status}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --- New Space Modal --- */
function NewSpaceModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, type: string, dims: { width: number; length: number; height: number }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("home");
  const [width, setWidth] = useState(5);
  const [length, setLength] = useState(4);
  const [height, setHeight] = useState(2.7);
  const [submitting, setSubmitting] = useState(false);

  const types = [
    { key: "kitchen", label: "Kitchen", icon: "\uD83C\uDF73" },
    { key: "living_room", label: "Living Room", icon: "\uD83D\uDECB\uFE0F" },
    { key: "bedroom", label: "Bedroom", icon: "\uD83D\uDECF\uFE0F" },
    { key: "office", label: "Office", icon: "\uD83C\uDFE2" },
    { key: "patio", label: "Patio", icon: "\u2600\uFE0F" },
    { key: "factory", label: "Factory", icon: "\uD83C\uDFED" },
    { key: "clinic", label: "Clinic", icon: "\uD83C\uDFE5" },
    { key: "other", label: "Other", icon: "\uD83D\uDCCD" },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    await onCreate(name.trim(), type, { width, length, height });
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="rounded-2xl border w-full max-w-md p-6" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Add Space</h2>
          <button onClick={onClose} style={{ color: "var(--gh-text-muted)" }} className="hover:text-white transition">?</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Space Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kitchen, Living Room" className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }} maxLength={100} required autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Type</label>
            <div className="grid grid-cols-4 gap-2">
              {types.map((t) => (
                <button key={t.key} type="button" onClick={() => setType(t.key)}
                  className="p-2 rounded-xl text-center text-xs transition" style={{ backgroundColor: type === t.key ? "rgba(66,133,244,0.15)" : "var(--gh-card)", border: type === t.key ? "1px solid var(--gh-blue)" : "1px solid var(--gh-border)", color: type === t.key ? "var(--gh-blue)" : "var(--gh-text-muted)" }}>
                  <div className="text-lg mb-0.5">{t.icon}</div>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Dimensions (meters)</label>
            <div className="grid grid-cols-3 gap-2">
              {[["Width", width, setWidth], ["Length", length, setLength], ["Height", height, setHeight]].map(([label, val, setter]) => (
                <div key={label as string}>
                  <label className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{label as string}</label>
                  <input type="number" value={val as number} onChange={(e) => (setter as (v: number) => void)(Number(e.target.value))} min={1} max={50} step={0.1} className="w-full px-2 py-1.5 rounded-lg text-sm focus:outline-none" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }} />
                </div>
              ))}
            </div>
          </div>
          <button type="submit" disabled={!name.trim() || submitting} className="w-full py-2.5 rounded-full font-medium text-sm transition disabled:opacity-50" style={{ backgroundColor: "var(--gh-blue)" }}>
            {submitting ? "Creating..." : "Add Space"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Presence Detection Tab ─── */
function PresenceView() {
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);

  const entities = [
    { id: "p1", name: "Person 1", type: "person" as const, status: "active", location: "Living Room", lastSeen: "Just now", confidence: 0.95, rfSignature: "RF-A7B3", activity: "Walking", breathingRate: 16.2, heartRate: 72 },
    { id: "p2", name: "Person 2", type: "person" as const, status: "active", location: "Kitchen", lastSeen: "2 min ago", confidence: 0.88, rfSignature: "RF-C4D1", activity: "Sitting", breathingRate: 14.8, heartRate: 68 },
    { id: "p3", name: "Person 3", type: "person" as const, status: "away", location: "—", lastSeen: "3 hours ago", confidence: 0, rfSignature: "RF-E2F9", activity: "Away", breathingRate: null, heartRate: null },
    { id: "pet1", name: "Dog", type: "pet" as const, status: "active", location: "Patio", lastSeen: "Just now", confidence: 0.82, rfSignature: "RF-P1A2", activity: "Resting", breathingRate: 22.0, heartRate: 90 },
    { id: "pet2", name: "Cat", type: "pet" as const, status: "active", location: "Bedroom", lastSeen: "5 min ago", confidence: 0.76, rfSignature: "RF-P3B4", activity: "Moving", breathingRate: 26.0, heartRate: 140 },
  ];

  const people = entities.filter((e) => e.type === "person");
  const pets = entities.filter((e) => e.type === "pet");
  const selected = entities.find((e) => e.id === selectedEntity);

  return (
    <div>
      <p className="text-sm mb-6" style={{ color: "var(--gh-text-muted)" }}>
        AI-detected entities across all spaces. Tune RF signatures, manage profiles, and review detection data.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Entity List */}
        <div className="lg:col-span-2 space-y-6">
          {/* People */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span>👤</span> People <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(66,133,244,0.15)", color: "var(--gh-blue)" }}>{people.length}</span>
            </h3>
            <div className="space-y-2">
              {people.map((p) => (
                <button key={p.id} onClick={() => setSelectedEntity(p.id)} className={`device-card w-full text-left flex items-center gap-4 ${selectedEntity === p.id ? "ring-1" : ""}`} style={selectedEntity === p.id ? { borderColor: "var(--gh-blue)" } : {}}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ backgroundColor: p.status === "active" ? "rgba(52,168,83,0.15)" : "rgba(154,160,166,0.15)" }}>
                    {p.status === "active" ? "🟢" : "⚫"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-sm">{p.name}</h4>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>{p.rfSignature}</span>
                    </div>
                    <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
                      {p.location} · {p.activity} · {p.lastSeen}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium" style={{ color: p.confidence > 0.5 ? "var(--gh-green)" : "var(--gh-text-muted)" }}>
                      {p.confidence > 0 ? `${(p.confidence * 100).toFixed(0)}%` : "—"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Pets */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span>🐾</span> Pets <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(251,188,5,0.15)", color: "var(--gh-yellow)" }}>{pets.length}</span>
            </h3>
            <div className="space-y-2">
              {pets.map((p) => (
                <button key={p.id} onClick={() => setSelectedEntity(p.id)} className={`device-card w-full text-left flex items-center gap-4 ${selectedEntity === p.id ? "ring-1" : ""}`} style={selectedEntity === p.id ? { borderColor: "var(--gh-yellow)" } : {}}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ backgroundColor: "rgba(251,188,5,0.15)" }}>
                    {p.name === "Dog" ? "🐕" : "🐈"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-sm">{p.name}</h4>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>{p.rfSignature}</span>
                    </div>
                    <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
                      {p.location} · {p.activity} · {p.lastSeen}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium" style={{ color: "var(--gh-yellow)" }}>
                      {(p.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Entity Detail Panel */}
        <div>
          {selected ? (
            <div className="rounded-2xl border p-5 sticky top-20" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
              <div className="text-center mb-4">
                <div className="text-4xl mb-2">{selected.type === "person" ? "👤" : selected.name === "Dog" ? "🐕" : "🐈"}</div>
                <h3 className="font-bold text-lg">{selected.name}</h3>
                <p className="text-xs font-mono" style={{ color: "var(--gh-text-muted)" }}>{selected.rfSignature}</p>
                <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full" style={{
                  backgroundColor: selected.status === "active" ? "rgba(52,168,83,0.15)" : "rgba(154,160,166,0.15)",
                  color: selected.status === "active" ? "var(--gh-green)" : "var(--gh-text-muted)",
                }}>
                  {selected.status === "active" ? "● Active" : "○ Away"}
                </span>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                  <span>Location</span><span className="font-medium" style={{ color: "var(--gh-text)" }}>{selected.location}</span>
                </div>
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                  <span>Activity</span><span className="font-medium" style={{ color: "var(--gh-text)" }}>{selected.activity}</span>
                </div>
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                  <span>Last Seen</span><span>{selected.lastSeen}</span>
                </div>
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                  <span>Confidence</span><span>{selected.confidence > 0 ? `${(selected.confidence * 100).toFixed(0)}%` : "—"}</span>
                </div>

                {/* Vitals */}
                {selected.status === "active" && (
                  <>
                    <hr style={{ borderColor: "var(--gh-border)" }} />
                    <h4 className="font-semibold text-xs" style={{ color: "var(--gh-text-muted)" }}>VITALS</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-lg text-center" style={{ backgroundColor: "var(--gh-card)" }}>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Breathing</p>
                        <p className="text-base font-bold" style={{ color: "var(--gh-blue)" }}>{selected.breathingRate?.toFixed(1) ?? "—"}</p>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>bpm</p>
                      </div>
                      <div className="p-2 rounded-lg text-center" style={{ backgroundColor: "var(--gh-card)" }}>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Heart Rate</p>
                        <p className="text-base font-bold" style={{ color: "var(--gh-red)" }}>{selected.heartRate ?? "—"}</p>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>bpm</p>
                      </div>
                    </div>
                  </>
                )}

                {/* Actions */}
                <hr style={{ borderColor: "var(--gh-border)" }} />
                <div className="space-y-2">
                  <button className="w-full py-2 rounded-full text-xs font-medium transition hover:opacity-90" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text)" }}>
                    Edit Profile
                  </button>
                  <button className="w-full py-2 rounded-full text-xs font-medium transition hover:opacity-90" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text)" }}>
                    Tune RF Signature
                  </button>
                  <button className="w-full py-2 rounded-full text-xs font-medium transition hover:opacity-90" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text)" }}>
                    View Activity History
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border p-8 text-center" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
              <div className="text-4xl mb-3 opacity-30">👤</div>
              <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>Select an entity to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* AI Engine Info */}
      <div className="mt-8 p-5 rounded-2xl border" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xl">🧠</span>
          <h3 className="font-semibold">AI Detection Engine</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Entities Tracked", value: `${entities.filter((e) => e.status === "active").length} active`, color: "var(--gh-green)" },
            { label: "RF Signatures", value: `${entities.length} stored`, color: "var(--gh-blue)" },
            { label: "Detection Model", value: "LatentCSI v2", color: "var(--gh-yellow)" },
            { label: "Avg. Confidence", value: `${(entities.filter((e) => e.confidence > 0).reduce((a, e) => a + e.confidence, 0) / entities.filter((e) => e.confidence > 0).length * 100).toFixed(0)}%`, color: "var(--gh-text)" },
          ].map((stat) => (
            <div key={stat.label} className="p-3 rounded-xl" style={{ backgroundColor: "var(--gh-card)" }}>
              <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{stat.label}</p>
              <p className="text-sm font-bold mt-0.5" style={{ color: stat.color }}>{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

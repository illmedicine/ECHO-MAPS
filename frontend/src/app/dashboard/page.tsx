"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  isBackendConfigured,
  isBackendUnreachable,
  createEnvironment,
  deleteEnvironment,
  healthCheck,
} from "@/lib/api";
import { estimatePose, preloadModel, isModelLoaded } from "@/lib/poseEstimator";
import { storeFrame, getCollectionStats, type CollectedFrame } from "@/lib/collectedData";
import { publishPose, clearPose } from "@/lib/poseBus";
import {
  getEnvironments,
  createEnvironment as createLocalRoom,
  deleteEnvironment as deleteLocalRoom,
  getEchoEnvironments,
  createEchoEnvironment,
  deleteEchoEnvironment,
  getRoomsForEnvironment,
  getCameras,
  getCamerasForRoom,
  getCamerasForEnvironment,
  addCamera,
  removeCamera,
  updateCamera,
  getEntities,
  createEntity,
  updateEntity as updateEntityStorage,
  deleteEntity,
  EchoEnvironment,
  EnvCategory,
  Environment,
  Camera,
  TrackedEntity,
  generateSimulatedSkeleton,
  generateSimulatedPointCloud,
  getFloorPlan,
  saveFloorPlan,
  deleteFloorPlan,
  type FloorPlanRoom,
  type FloorPlan,
  getHousehold,
  addHouseholdMember,
  removeHouseholdMember,
  isHouseholdMember,
  getVisitors,
  type VisitorRecord,
  getDeviceCorrections,
  setDeviceCorrection,
  removeDeviceCorrection,
  getDeviceFingerprint,
  MAC_PREFIX_DB,
  type DeviceCorrection,
  getRouterAnchor,
  setRouterAnchor,
  removeRouterAnchor,
  type RouterAnchor,
  estimateDistanceFromRouter,
} from "@/lib/environments";
import {
  simulateRFPresences,
  simulateBLEDevices,
  resolvePresences,
} from "@/lib/presenceEngine";
import EmojiPicker from "@/components/EmojiPicker";
import { subscribePose, hasActivePose, getLatestPose } from "@/lib/poseBus";
import {
  migrateToUserScope,
  syncPullFromCloud,
  downloadSettingsAsFile,
  importSettingsFromFile,
  detectNetworkFingerprint,
} from "@/lib/cloudSync";
import { updateEchoEnvironment } from "@/lib/environments";
import dynamic from "next/dynamic";

const EnvironmentViewer = dynamic(() => import("@/components/EnvironmentViewer"), { ssr: false });
const FloorPlanEditor = dynamic(() => import("@/components/FloorPlanEditor"), { ssr: false });
const LiveFloorPlanMap = dynamic(() => import("@/components/LiveFloorPlanMap"), { ssr: false });

interface UserData {
  id: string;
  email: string;
  name: string;
  picture: string;
  apiToken?: string;
}

interface RoomCard {
  id: string;
  environmentId?: string;
  name: string;
  type: string;
  isCalibrated: boolean;
  calibrationConfidence: number;
  createdAt: string;
}

const ROOM_ICONS: Record<string, string> = {
  kitchen: "🍳",
  living_room: "🛋️",
  bedroom: "🛏️",
  office: "💻",
  patio: "☀️",
  factory: "🏭",
  clinic: "🏥",
  bathroom: "🚿",
  garage: "🚗",
  home: "🏠",
  other: "📍",
};

const ENV_ICONS: Record<string, string> = {
  home: "🏠",
  work: "🏢",
  school: "🎓",
  friend: "👋",
  business: "💼",
  other: "📍",
};

type TabView = "spaces" | "cameras" | "automations" | "presence";

export default function DashboardPage() {
  const router = useRouter();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [user, setUser] = useState<UserData | null>(null);
  const [echoEnvs, setEchoEnvs] = useState<EchoEnvironment[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomCard[]>([]);
  const [showNewEnvModal, setShowNewEnvModal] = useState(false);
  const [showNewRoomModal, setShowNewRoomModal] = useState(false);
  const [showAddCameraModal, setShowAddCameraModal] = useState(false);
  const [cameraVersion, setCameraVersion] = useState(0);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabView>("spaces");
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initDone = useRef(false);
  const [showFloorPlan, setShowFloorPlan] = useState(false);
  const [currentFloorPlan, setCurrentFloorPlan] = useState<FloorPlan | null>(null);
  const [liveMapRoomId, setLiveMapRoomId] = useState<string | null>(null);
  const [liveEntities, setLiveEntities] = useState<TrackedEntity[]>([]);

  // Single initialization effect — reads user, migrates data, loads environments
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    const stored = localStorage.getItem("echo_maps_user");
    if (!stored) { router.push("/auth/signin"); return; }
    const parsed = JSON.parse(stored);
    setUser(parsed);
    // Migrate unscoped localStorage data to user-scoped keys
    if (parsed.id) migrateToUserScope(parsed.id);

    // Read local environments — _get now auto-recovers from mismatched user scopes
    const envs = getEchoEnvironments();
    setEchoEnvs(envs);
    if (envs.length > 0) setSelectedEnvId(envs[0].id);

    // Background: check backend health + cloud sync (fire and forget)
    (async () => {
      let online = false;
      if (isBackendConfigured() && !isBackendUnreachable()) {
        try { await healthCheck(); setBackendOnline(true); online = true; } catch { setBackendOnline(false); }
      } else { setBackendOnline(false); }
      if (online) {
        setSyncStatus("syncing");
        const localCount = getEchoEnvironments().length;
        const ok = await syncPullFromCloud();
        setSyncStatus(ok ? "synced" : "error");
        // Re-read after sync — but never replace non-empty local with empty cloud
        const refreshed = getEchoEnvironments();
        if (refreshed.length > 0 || localCount === 0) {
          setEchoEnvs(refreshed);
        }
      }
      setLoading(false);
    })();
  }, [router]);

  const reloadRooms = useCallback(() => {
    if (!selectedEnvId) { setRooms([]); return; }
    const local = getRoomsForEnvironment(selectedEnvId);
    setRooms(local.map((e) => ({
      id: e.id, environmentId: e.environmentId, name: e.name, type: e.type,
      isCalibrated: e.isCalibrated, calibrationConfidence: e.calibrationConfidence, createdAt: e.createdAt,
    })));
  }, [selectedEnvId]);

  // Set initial selected environment when envs load (backup for async cloud sync refresh)
  useEffect(() => {
    if (!selectedEnvId && echoEnvs.length > 0) setSelectedEnvId(echoEnvs[0].id);
  }, [echoEnvs, selectedEnvId]);

  useEffect(() => { reloadRooms(); }, [reloadRooms, echoEnvs]);

  // Load floor plan when selected environment changes
  useEffect(() => {
    if (selectedEnvId) {
      setCurrentFloorPlan(getFloorPlan(selectedEnvId));
    } else {
      setCurrentFloorPlan(null);
    }
    setShowFloorPlan(false);
  }, [selectedEnvId]);

  // Poll live entities for the floor plan map (2s interval)
  useEffect(() => {
    setLiveEntities(getEntities());
    const iv = setInterval(() => setLiveEntities(getEntities()), 2000);
    return () => clearInterval(iv);
  }, []);

  const handleSaveFloorPlan = (width: number, height: number, fpRooms: FloorPlanRoom[]) => {
    if (!selectedEnvId) return;
    const plan = saveFloorPlan(selectedEnvId, width, height, fpRooms);
    setCurrentFloorPlan(plan);
    setShowFloorPlan(false);
    reloadRooms();
  };

  const handleSignOut = () => { localStorage.removeItem("echo_maps_user"); router.push("/"); };

  const handleCreateEnv = async (name: string, category: EnvCategory, emoji?: string) => {
    const env = createEchoEnvironment({ name, category, emoji });
    // Auto-detect network fingerprint for new environment
    detectNetworkFingerprint().then((fp) => {
      if (fp) {
        updateEchoEnvironment(env.id, { networkFingerprint: fp });
        setEchoEnvs(getEchoEnvironments());
      }
    }).catch(() => {});
    setEchoEnvs(getEchoEnvironments());
    setSelectedEnvId(env.id);
    setShowNewEnvModal(false);
  };

  const handleDeleteEnv = (id: string) => {
    if (!confirm("Delete this environment and all its rooms?")) return;
    deleteEchoEnvironment(id);
    const remaining = getEchoEnvironments();
    setEchoEnvs(remaining);
    if (selectedEnvId === id) setSelectedEnvId(remaining[0]?.id ?? null);
  };

  const handleCreateRoom = async (name: string, type: string, dims: { width: number; length: number; height: number }, emoji?: string) => {
    if (!selectedEnvId) return;
    setError(null);
    try {
      createLocalRoom({ name, type: type as Environment["type"], dimensions: dims, environmentId: selectedEnvId, emoji });
      if (backendOnline) { try { await createEnvironment(name); } catch { /* backend sync optional */ } }
      reloadRooms();
      setShowNewRoomModal(false);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to create room"); }
  };

  const handleDeleteRoom = async (id: string) => {
    if (!confirm("Remove this room?")) return;
    try {
      deleteLocalRoom(id);
      if (backendOnline) { try { await deleteEnvironment(id); } catch { /* backend sync optional */ } }
      reloadRooms();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to delete"); }
  };

  const handleImportSettings = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ok = await importSettingsFromFile(file);
    if (ok) {
      setEchoEnvs(getEchoEnvironments());
      reloadRooms();
    } else {
      setError("Failed to import settings file");
    }
    e.target.value = "";
  };

  if (!user) return <main className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-[var(--gh-blue)] border-t-transparent rounded-full animate-spin" /></main>;

  const selectedEnv = echoEnvs.find((e) => e.id === selectedEnvId);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 border-r flex flex-col" style={{ borderColor: "var(--gh-border)", backgroundColor: "var(--gh-surface)" }}>
        <div className="p-4 flex items-center justify-center">
          <Image src={`${basePath}/logo.png`} alt="Echo Vue" width={306} height={306} unoptimized style={{ background: "transparent" }} />
        </div>

        {/* Environments list */}
        <div className="px-3 mb-2">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--gh-text-muted)" }}>Environments</span>
            <button onClick={() => setShowNewEnvModal(true)} className="w-5 h-5 rounded flex items-center justify-center hover:bg-black/5 transition" style={{ color: "var(--gh-text-muted)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </button>
          </div>
          <div className="space-y-0.5 max-h-[180px] overflow-y-auto">
            {echoEnvs.map((env) => (
              <button key={env.id} onClick={() => { setSelectedEnvId(env.id); setActiveTab("spaces"); }}
                className={`sidebar-item w-full group ${selectedEnvId === env.id && activeTab === "spaces" ? "active" : ""}`}>
                <span className="text-base">{env.emoji ?? ENV_ICONS[env.category] ?? "📍"}</span>
                <div className="flex-1 min-w-0">
                  <span className="block truncate text-left text-xs">{env.name}</span>
                  {env.networkFingerprint && (
                    <span className="block truncate text-left text-[9px]" style={{ color: "var(--gh-text-muted)" }}>📡 {env.networkFingerprint.networkLabel}</span>
                  )}
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteEnv(env.id); }}
                  className="w-4 h-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/5" style={{ color: "var(--gh-text-muted)", fontSize: "10px" }}>✕</button>
              </button>
            ))}
            {echoEnvs.length === 0 && <p className="text-[10px] px-2 py-2" style={{ color: "var(--gh-text-muted)" }}>No environments yet</p>}
          </div>
        </div>

        <hr style={{ borderColor: "var(--gh-border)" }} />

        <nav className="flex-1 px-3 mt-2 space-y-0.5">
          {([
            { tab: "spaces" as const, label: "Rooms", icon: "🏠" },
            { tab: "cameras" as const, label: "Cameras", icon: "📹" },
            { tab: "automations" as const, label: "Automations", icon: "⚡" },
            { tab: "presence" as const, label: "Presence", icon: "👤" },
          ]).map(({ tab, label, icon }) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`sidebar-item w-full ${activeTab === tab ? "active" : ""}`}>
              <span className="text-lg">{icon}</span>{label}
            </button>
          ))}
        </nav>

        <div className="px-3 mb-2">
          <Link href="/research" className="sidebar-item w-full">
            <span className="text-lg">📄</span>Research
          </Link>
        </div>

        <div className="p-4 border-t" style={{ borderColor: "var(--gh-border)" }}>
          <div className="flex items-center gap-3">
            {user.picture && <img src={user.picture} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-[10px] truncate" style={{ color: "var(--gh-text-muted)" }}>{user.email}</p>
            </div>
            <button onClick={handleSignOut} className="text-xs px-2 py-1 rounded-xl hover:bg-black/5 transition" style={{ color: "var(--gh-text-muted)" }} title="Sign out">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
            </button>
          </div>
          {/* Cloud sync status + settings export/import */}
          <div className="flex items-center gap-1 mt-2">
            <span className="text-[9px] flex-1" style={{ color: "var(--gh-text-muted)" }}>
              {syncStatus === "syncing" ? "☁️ Syncing..." : syncStatus === "synced" ? "☁️ Synced" : syncStatus === "error" ? "⚠️ Offline" : "💾 Local"}
            </span>
            <button onClick={downloadSettingsAsFile} className="text-[9px] px-1.5 py-0.5 rounded hover:bg-black/5" style={{ color: "var(--gh-text-muted)" }} title="Export settings">
              📤
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="text-[9px] px-1.5 py-0.5 rounded hover:bg-black/5" style={{ color: "var(--gh-text-muted)" }} title="Import settings">
              📥
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportSettings} />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: "var(--gh-bg)" }}>
        <header className="sticky top-0 z-10 px-8 py-4 flex items-center justify-between" style={{ backgroundColor: "var(--gh-bg)", borderBottom: "1px solid var(--gh-border)" }}>
          <div>
            <h1 className="text-xl font-semibold">
              {activeTab === "spaces" ? (selectedEnv ? `${selectedEnv.emoji ?? ENV_ICONS[selectedEnv.category] ?? "📍"} ${selectedEnv.name}` : "Select an Environment")
                : activeTab === "cameras" ? "📹 Cameras"
                : activeTab === "automations" ? "⚡ Automations"
                : "👤 Presence Detection"}
            </h1>
            {activeTab === "spaces" && selectedEnv && (
              <p className="text-xs mt-0.5" style={{ color: "var(--gh-text-muted)" }}>
                {rooms.length} room{rooms.length !== 1 ? "s" : ""} · {rooms.filter((r) => r.isCalibrated).length} calibrated
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {activeTab === "spaces" && selectedEnvId && (
              <>
                <button onClick={() => { setShowFloorPlan(true); }} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition"
                  style={{ backgroundColor: currentFloorPlan ? "rgba(52,168,83,0.15)" : "var(--gh-card)", color: currentFloorPlan ? "var(--gh-green)" : "var(--gh-text-muted)", border: "1px solid var(--gh-border)" }}>
                  🏗️ {currentFloorPlan ? "Edit Floor Plan" : "Floor Plan"}
                </button>
                <button onClick={() => setShowNewRoomModal(true)} className="btn-primary flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                  Add Room
                </button>
              </>
            )}
            {activeTab === "cameras" && (
              <button onClick={() => setShowAddCameraModal(true)} className="btn-primary flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                Add Camera
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="mx-8 mt-4 p-3 rounded-xl text-sm flex items-center justify-between" style={{ backgroundColor: "rgba(232,104,90,0.1)", color: "var(--gh-red)" }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="hover:opacity-70">✕</button>
          </div>
        )}

        <div className="p-8">
          {activeTab === "spaces" && !showFloorPlan && (
            <>
              {currentFloorPlan && selectedEnvId && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--gh-text-muted)" }}>🗺️ Live Floor Plan</h2>
                    <div className="flex items-center gap-2">
                      {liveMapRoomId && (
                        <button onClick={() => setLiveMapRoomId(null)} className="text-[10px] px-2 py-1 rounded-lg" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>Clear Selection</button>
                      )}
                    </div>
                  </div>
                  <LiveFloorPlanMap
                    floorPlan={currentFloorPlan}
                    rooms={rooms.map((r) => getRoomsForEnvironment(selectedEnvId).find((e) => e.id === r.id)!).filter(Boolean)}
                    entities={liveEntities.filter((e) => {
                      const envRoomIds = rooms.map((r) => r.id);
                      return envRoomIds.includes(e.roomId);
                    })}
                    selectedRoomId={liveMapRoomId}
                    onSelectRoom={setLiveMapRoomId}
                    routerAnchor={routerAnchor}
                  />
                </div>
              )}
              <RoomsView rooms={rooms} selectedEnvId={selectedEnvId} selectedEnv={selectedEnv ?? null} onAddEnv={() => setShowNewEnvModal(true)} onAddRoom={() => setShowNewRoomModal(true)} onDeleteRoom={handleDeleteRoom} currentFloorPlan={currentFloorPlan} onEditFloorPlan={() => setShowFloorPlan(true)} />
            </>
          )}
          {activeTab === "spaces" && showFloorPlan && selectedEnvId && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={() => setShowFloorPlan(false)} className="text-sm transition hover:opacity-80" style={{ color: "var(--gh-text-muted)" }}>← Back to Rooms</button>
                <h2 className="text-lg font-semibold">Floor Plan — {selectedEnv?.name}</h2>
              </div>
              <FloorPlanEditor
                initialWidth={currentFloorPlan?.width ?? 15}
                initialHeight={currentFloorPlan?.height ?? 12}
                initialRooms={currentFloorPlan?.rooms ?? []}
                onSave={handleSaveFloorPlan}
                onCancel={() => setShowFloorPlan(false)}
              />
            </div>
          )}
          <div style={{ display: activeTab === "cameras" ? "block" : "none" }}>
            <CamerasView version={cameraVersion} onAddCamera={() => setShowAddCameraModal(true)} />
          </div>
          {activeTab === "automations" && (
            <AutomationsView />
          )}
          {activeTab === "presence" && (
            <PresenceView />
          )}
        </div>
      </main>

      {showNewEnvModal && <NewEnvironmentModal onClose={() => setShowNewEnvModal(false)} onCreate={handleCreateEnv} />}
      {showNewRoomModal && <NewRoomModal onClose={() => { setShowNewRoomModal(false); setCameraVersion((v) => v + 1); }} onCreate={handleCreateRoom} />}
      {showAddCameraModal && <AddCameraModal rooms={rooms} selectedEnvId={selectedEnvId} onClose={() => { setShowAddCameraModal(false); setCameraVersion((v) => v + 1); }} onRoomCreated={reloadRooms} />}
    </div>
  );
}

/* ── Rooms View ── */
function RoomsView({ rooms, selectedEnvId, selectedEnv, onAddEnv, onAddRoom, onDeleteRoom, currentFloorPlan, onEditFloorPlan }: {
  rooms: RoomCard[];
  selectedEnvId: string | null;
  selectedEnv: EchoEnvironment | null;
  onAddEnv: () => void;
  onAddRoom: () => void;
  onDeleteRoom: (id: string) => void;
  currentFloorPlan: FloorPlan | null;
  onEditFloorPlan: () => void;
}) {
  if (!selectedEnvId) {
    return (
      <div className="flex flex-col items-center justify-center py-20" style={{ color: "var(--gh-text-muted)" }}>
        <div className="text-6xl mb-4 opacity-30">🏠</div>
        <p className="text-lg mb-2">No environments yet</p>
        <p className="text-sm mb-6">Create your first environment to start mapping rooms</p>
        <button onClick={onAddEnv} className="btn-primary">Create Environment</button>
      </div>
    );
  }
  if (rooms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20" style={{ color: "var(--gh-text-muted)" }}>
        <div className="text-6xl mb-4 opacity-30">🚪</div>
        <p className="text-lg mb-2">No rooms in {selectedEnv?.name}</p>
        <p className="text-sm mb-6">Add rooms individually or create a floor plan to define all rooms at once</p>
        <div className="flex gap-3">
          <button onClick={onEditFloorPlan} className="px-5 py-2.5 rounded-xl text-sm font-medium transition" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text-muted)" }}>
            🏗️ Create Floor Plan
          </button>
          <button onClick={onAddRoom} className="btn-primary">Add Room</button>
        </div>
      </div>
    );
  }
  const grouped = rooms.reduce<Record<string, RoomCard[]>>((acc, r) => {
    const key = r.type || "other";
    (acc[key] = acc[key] || []).push(r);
    return acc;
  }, {});
  return (
    <>
      {currentFloorPlan && (
        <div className="mb-6 p-4 rounded-xl flex items-center justify-between" style={{ backgroundColor: "rgba(52,168,83,0.08)", border: "1px solid rgba(52,168,83,0.2)" }}>
          <div className="flex items-center gap-3">
            <span className="text-xl">🏗️</span>
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--gh-green)" }}>Floor Plan Active</p>
              <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{currentFloorPlan.width}×{currentFloorPlan.height}m · {currentFloorPlan.rooms.length} rooms defined</p>
            </div>
          </div>
          <button onClick={onEditFloorPlan} className="px-3 py-1.5 rounded-lg text-xs font-medium transition" style={{ backgroundColor: "rgba(52,168,83,0.15)", color: "var(--gh-green)" }}>
            Edit Floor Plan
          </button>
        </div>
      )}
      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} className="mb-8">
          <h2 className="text-sm font-medium mb-3 capitalize" style={{ color: "var(--gh-text-muted)" }}>{type.replace("_", " ")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map((room) => (
              <div key={room.id} className="device-card group relative">
                <button onClick={(e) => { e.stopPropagation(); onDeleteRoom(room.id); }}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-white/10"
                  style={{ color: "var(--gh-text-muted)" }}>✕</button>
                <Link href={`/dashboard/env?id=${room.id}`} className="block">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{ROOM_ICONS[room.type] ?? "📍"}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm truncate">{room.name}</h3>
                      <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{room.isCalibrated ? "Active" : "Setup required"}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--gh-border)" }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(5, room.calibrationConfidence * 100)}%`, backgroundColor: room.isCalibrated ? "var(--gh-green)" : "var(--gh-blue)" }} />
                    </div>
                    <span className="text-[10px] font-medium" style={{ color: room.isCalibrated ? "var(--gh-green)" : "var(--gh-text-muted)" }}>
                      {room.isCalibrated ? "Live" : `${(room.calibrationConfidence * 100).toFixed(0)}%`}
                    </span>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/* ── Cameras View ── */
function CamerasView({ onAddCamera, version }: { onAddCamera: () => void; version?: number }) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [activeStreams, setActiveStreams] = useState<Record<string, MediaStream>>({});
  const activeStreamsRef = useRef<Record<string, MediaStream>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const poseLoopRefs = useRef<Record<string, number>>({});
  const [poseStats, setPoseStats] = useState<Record<string, { fps: number; detected: boolean; confidence: number }>>({});
  const [totalFrames, setTotalFrames] = useState(0);
  const frameCountRef = useRef(0);

  useEffect(() => { setCameras(getCameras()); }, [version]);
  useEffect(() => {
    // Load total collected frames count on mount
    getCollectionStats().then((stats) => {
      setTotalFrames(stats.totalFrames);
      frameCountRef.current = stats.totalFrames;
    }).catch(() => {});
  }, []);
  // Keep ref in sync for cleanup
  useEffect(() => { activeStreamsRef.current = activeStreams; }, [activeStreams]);
  // Only clean up streams on actual unmount, not on tab switch
  useEffect(() => {
    return () => {
      Object.values(activeStreamsRef.current).forEach((s) => s.getTracks().forEach((t) => t.stop()));
      Object.values(poseLoopRefs.current).forEach((id) => cancelAnimationFrame(id));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pose extraction loop for a specific camera
  const startPoseLoop = useCallback((camId: string, roomId: string) => {
    let lastTime = 0;
    let framesSinceLastSec = 0;
    let lastSecond = Date.now();
    let storeCounter = 0;

    const loop = async () => {
      const video = videoRefs.current[camId];
      if (!video || video.paused || video.ended || !video.videoWidth) {
        poseLoopRefs.current[camId] = requestAnimationFrame(loop);
        return;
      }

      const now = performance.now();
      if (now - lastTime < 80) { // ~12fps cap to avoid overload
        poseLoopRefs.current[camId] = requestAnimationFrame(loop);
        return;
      }
      lastTime = now;

      try {
        const result = await estimatePose(video, { width: 5, length: 4, height: 2.7 });
        if (result) {
          framesSinceLastSec++;
          const nowMs = Date.now();
          if (nowMs - lastSecond >= 1000) {
            setPoseStats((prev) => ({
              ...prev,
              [camId]: {
                fps: framesSinceLastSec,
                detected: result.isDetected,
                confidence: result.confidence,
              },
            }));
            framesSinceLastSec = 0;
            lastSecond = nowMs;
          }

          // Publish to the global pose bus so the 3D view can use it
          publishPose({
            ...result,
            cameraId: camId,
            roomId,
          });

          // Store every 10th frame for the learning engine
          storeCounter++;
          if (result.isDetected && storeCounter % 10 === 0) {
            const frame: CollectedFrame = {
              id: `${camId}-${Date.now()}`,
              envId: "", // camera may span environments
              roomId,
              timestamp: Date.now(),
              keypoints3d: result.keypoints3d,
              keypoints2d: result.keypoints2d,
              confidence: result.confidence,
              activity: "camera_tuning",
              source: "camera",
            };
            storeFrame(frame).catch(() => {});
            frameCountRef.current++;
            if (storeCounter % 50 === 0) {
              setTotalFrames(frameCountRef.current);
            }
          }
        }
      } catch {
        // pose estimation error — skip frame
      }

      poseLoopRefs.current[camId] = requestAnimationFrame(loop);
    };
    poseLoopRefs.current[camId] = requestAnimationFrame(loop);
  }, []);

  const stopPoseLoop = useCallback((camId: string) => {
    if (poseLoopRefs.current[camId]) {
      cancelAnimationFrame(poseLoopRefs.current[camId]);
      delete poseLoopRefs.current[camId];
    }
    clearPose(camId);
    setPoseStats((prev) => { const copy = { ...prev }; delete copy[camId]; return copy; });
  }, []);

  const startStream = async (cam: Camera) => {
    try {
      // Pre-load pose model before starting the stream
      preloadModel();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: cam.deviceId } }, audio: false });
      setActiveStreams((prev) => ({ ...prev, [cam.id]: stream }));
      setTimeout(() => {
        const el = videoRefs.current[cam.id];
        if (el) { el.srcObject = stream; el.play(); }
        // Start real pose extraction loop
        startPoseLoop(cam.id, cam.roomId);
      }, 50);
      updateCamera(cam.id, { active: true });
      setCameras(getCameras());
    } catch (err) { alert(`Could not start camera: ${err instanceof Error ? err.message : err}`); }
  };

  const stopStream = (camId: string) => {
    stopPoseLoop(camId);
    const stream = activeStreams[camId];
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setActiveStreams((prev) => { const copy = { ...prev }; delete copy[camId]; return copy; });
    const el = videoRefs.current[camId];
    if (el) el.srcObject = null;
    updateCamera(camId, { active: false });
    setCameras(getCameras());
  };

  const handleRemove = (camId: string) => {
    if (!confirm("Remove this camera?")) return;
    stopStream(camId);
    removeCamera(camId);
    setCameras(getCameras());
  };

  const allRooms = getEnvironments();
  const roomMap = Object.fromEntries(allRooms.map((r) => [r.id, r]));

  if (cameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20" style={{ color: "var(--gh-text-muted)" }}>
        <div className="text-6xl mb-4 opacity-30">📹</div>
        <p className="text-lg mb-2">No cameras added yet</p>
        <p className="text-sm mb-4 text-center max-w-md">Add cameras from your device — including OBS Virtual Camera, DroidCam, or built-in webcams. Active cameras continuously improve Echo Vue&apos;s presence detection AI.</p>
        <button onClick={onAddCamera} className="btn-primary">Add Camera</button>
      </div>
    );
  }

  const byRoom = cameras.reduce<Record<string, Camera[]>>((acc, c) => { (acc[c.roomId] = acc[c.roomId] || []).push(c); return acc; }, {});

  return (
    <div>
      <p className="text-sm mb-6" style={{ color: "var(--gh-text-muted)" }}>
        Live camera feeds continuously tune Echo Vue&apos;s CSI presence detection. The AI learns to correlate what the camera sees with WiFi signal patterns.
      </p>
      {Object.entries(byRoom).map(([roomId, cams]) => {
        const room = roomMap[roomId];
        return (
          <div key={roomId} className="mb-8">
            <h2 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: "var(--gh-text-muted)" }}>
              <span>{ROOM_ICONS[room?.type ?? "other"] ?? "📍"}</span>{room?.name ?? "Unknown Room"}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {cams.map((cam) => {
                const isLive = !!activeStreams[cam.id];
                return (
                  <div key={cam.id} className="rounded-2xl overflow-hidden" style={{ backgroundColor: "var(--gh-card)", border: `1px solid ${isLive ? "var(--gh-green)" : "var(--gh-border)"}` }}>
                    <div className="relative bg-black" style={{ minHeight: 200 }}>
                      <video ref={(el) => { videoRefs.current[cam.id] = el; }} autoPlay playsInline muted className="w-full h-[200px] object-cover" style={{ display: isLive ? "block" : "none" }} />
                      {!isLive && (
                        <div className="h-[200px] flex flex-col items-center justify-center" style={{ color: "var(--gh-text-muted)" }}>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" className="opacity-30 mb-2"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                          <span className="text-xs">Camera offline</span>
                        </div>
                      )}
                      {isLive && (
                        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[10px] text-white font-medium">LIVE</span>
                        </div>
                      )}
                      {isLive && (
                        <div className="absolute bottom-2 left-2 px-2 py-1 rounded-lg text-[10px]" style={{ backgroundColor: "rgba(0,0,0,0.6)", color: poseStats[cam.id]?.detected ? "var(--gh-green)" : "var(--gh-yellow)" }}>
                          🧠 {poseStats[cam.id]?.detected
                            ? `Pose detected · ${(poseStats[cam.id].confidence * 100).toFixed(0)}% · ${poseStats[cam.id].fps}fps`
                            : isModelLoaded() ? "Scanning for pose..." : "Loading AI model..."}
                        </div>
                      )}
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{cam.label}</p>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{isLive ? "Streaming · AI tuning" : "Inactive"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => isLive ? stopStream(cam.id) : startStream(cam)}
                          className="px-3 py-1.5 rounded-xl text-xs font-medium transition"
                          style={isLive ? { backgroundColor: "rgba(232,104,90,0.15)", color: "var(--gh-red)" } : { backgroundColor: "rgba(91,156,246,0.15)", color: "var(--gh-blue)" }}>
                          {isLive ? "■ Stop" : "▶ Start"}
                        </button>
                        <button onClick={() => handleRemove(cam.id)} className="p-1.5 rounded-lg hover:bg-white/10 transition" style={{ color: "var(--gh-text-muted)" }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="mt-6 p-5 rounded-2xl" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
        <div className="flex items-center gap-3 mb-3"><span className="text-xl">🧠</span><h3 className="font-semibold">CSI AI Learning Engine</h3></div>
        <p className="text-xs mb-4" style={{ color: "var(--gh-text-muted)" }}>When cameras are active, Echo Vue correlates visual data with WiFi CSI signals to learn presence patterns — standing, sitting, walking, sleeping, device use, and more.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Active Cameras", value: `${Object.keys(activeStreams).length}`, color: "var(--gh-green)" },
            { label: "Frames Collected", value: `${totalFrames}`, color: "var(--gh-blue)" },
            { label: "Detection Model", value: isModelLoaded() ? "MoveNet Lightning" : "Loading...", color: "var(--gh-yellow)" },
            { label: "Learning Mode", value: Object.keys(activeStreams).length > 0 ? "Active" : "Paused", color: Object.keys(activeStreams).length > 0 ? "var(--gh-green)" : "var(--gh-text-muted)" },
          ].map((s) => (
            <div key={s.label} className="p-3 rounded-xl" style={{ backgroundColor: "var(--gh-card)" }}>
              <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{s.label}</p>
              <p className="text-sm font-bold mt-0.5" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Add Camera Modal ── */
function AddCameraModal({ rooms, selectedEnvId, onClose, onRoomCreated }: { rooms: RoomCard[]; selectedEnvId: string | null; onClose: () => void; onRoomCreated?: () => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [cameraEmoji, setCameraEmoji] = useState("📹");
  const [loading, setLoading] = useState(true);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        tempStream.getTracks().forEach((t) => t.stop());
        const videoDevices = allDevices.filter((d) => d.kind === "videoinput");
        setDevices(videoDevices);
        if (videoDevices.length > 0) { setSelectedDevice(videoDevices[0].deviceId); setCustomLabel(videoDevices[0].label || "Camera 1"); }
      } catch (err) { console.error("Could not enumerate cameras:", err); }
      setLoading(false);
    })();
    return () => { if (previewStream) previewStream.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const dev = devices.find((d) => d.deviceId === selectedDevice);
    if (dev) setCustomLabel(dev.label || `Camera ${devices.indexOf(dev) + 1}`);
  }, [selectedDevice, devices]);

  useEffect(() => {
    if (!selectedDevice) return;
    let cancelled = false;
    (async () => {
      if (previewStream) previewStream.getTracks().forEach((t) => t.stop());
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: selectedDevice } } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        setPreviewStream(stream);
        if (previewRef.current) { previewRef.current.srcObject = stream; previewRef.current.play(); }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [selectedDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  const allRooms = rooms.length > 0 ? rooms : getRoomsForEnvironment(selectedEnvId ?? "").map((r) => ({
    id: r.id, environmentId: r.environmentId, name: r.name, type: r.type,
    isCalibrated: r.isCalibrated, calibrationConfidence: r.calibrationConfidence, createdAt: r.createdAt,
  }));

  const handleAdd = () => {
    if (!selectedDevice || !selectedRoom || !selectedEnvId) return;
    addCamera({ label: customLabel, deviceId: selectedDevice, roomId: selectedRoom, environmentId: selectedEnvId, emoji: cameraEmoji, active: false });
    if (previewStream) previewStream.getTracks().forEach((t) => t.stop());
    if (onRoomCreated) onRoomCreated();
    onClose();
  };

  const cleanup = () => { if (previewStream) previewStream.getTracks().forEach((t) => t.stop()); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={cleanup}>
      <div className="rounded-2xl w-full max-w-lg p-6" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Add Camera</h2>
          <button onClick={cleanup} style={{ color: "var(--gh-text-muted)" }}>✕</button>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm" style={{ color: "var(--gh-text-muted)" }}>Scanning for cameras...</div>
        ) : devices.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-2xl mb-2">📹</p>
            <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>No cameras found. Make sure a camera (webcam, DroidCam, or OBS Virtual Camera) is connected.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl overflow-hidden bg-black">
              <video ref={previewRef} autoPlay playsInline muted className="w-full h-[180px] object-cover" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Select Camera</label>
              <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }}>
                {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Camera Name</label>
              <input type="text" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }} maxLength={60} />
            </div>
            <EmojiPicker selected={cameraEmoji} onSelect={setCameraEmoji} label="Camera Icon" />
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Assign to Room</label>
              {allRooms.length === 0 ? (
                <p className="text-xs p-3 rounded-xl" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-yellow)" }}>No rooms yet — create a room first.</p>
              ) : (
                <select value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                  style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }}>
                  <option value="">Choose a room...</option>
                  {allRooms.map((r) => <option key={r.id} value={r.id}>{ROOM_ICONS[r.type] ?? "📍"} {r.name}</option>)}
                </select>
              )}
            </div>
            <button onClick={handleAdd} disabled={!selectedDevice || !selectedRoom} className="btn-primary w-full disabled:opacity-50">Add Camera</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── New Environment Modal ── */
function NewEnvironmentModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, category: EnvCategory, emoji?: string) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<EnvCategory>("home");
  const [emoji, setEmoji] = useState("🏠");
  const categories: { key: EnvCategory; label: string; icon: string }[] = [
    { key: "home", label: "Home", icon: "🏠" }, { key: "work", label: "Work", icon: "🏢" },
    { key: "school", label: "School", icon: "🎓" }, { key: "friend", label: "Friend's Place", icon: "👋" },
    { key: "business", label: "Business", icon: "💼" }, { key: "other", label: "Other", icon: "📍" },
  ];
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-md p-6" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">New Environment</h2>
          <button onClick={onClose} style={{ color: "var(--gh-text-muted)" }}>✕</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), category, emoji); }} className="space-y-5">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Environment Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Apartment, Office" className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }} maxLength={100} required autoFocus />
          </div>
          <EmojiPicker selected={emoji} onSelect={setEmoji} label="Icon" />
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Category</label>
            <div className="grid grid-cols-3 gap-2">
              {categories.map((c) => (
                <button key={c.key} type="button" onClick={() => { setCategory(c.key); if (emoji === categories.find((cat) => cat.key === category)?.icon) setEmoji(c.icon); }}
                  className="p-3 rounded-xl text-center text-xs transition"
                  style={{ backgroundColor: category === c.key ? "rgba(91,156,246,0.12)" : "var(--gh-card)", border: category === c.key ? "1px solid var(--gh-blue)" : "1px solid var(--gh-border)", color: category === c.key ? "var(--gh-blue)" : "var(--gh-text-muted)" }}>
                  <div className="text-xl mb-1">{c.icon}</div>{c.label}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={!name.trim()} className="btn-primary w-full disabled:opacity-50">Create Environment</button>
        </form>
      </div>
    </div>
  );
}

/* ── New Room Modal ── */
function NewRoomModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, type: string, dims: { width: number; length: number; height: number }, emoji?: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("living_room");
  const [emoji, setEmoji] = useState("🛋️");
  const [width, setWidth] = useState(5);
  const [length, setLength] = useState(4);
  const [height, setHeight] = useState(2.7);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const types = [
    { key: "kitchen", label: "Kitchen", icon: "🍳" }, { key: "living_room", label: "Living Room", icon: "🛋️" },
    { key: "bedroom", label: "Bedroom", icon: "🛏️" }, { key: "office", label: "Office", icon: "💻" },
    { key: "bathroom", label: "Bathroom", icon: "🚿" }, { key: "patio", label: "Patio", icon: "☀️" },
    { key: "garage", label: "Garage", icon: "🚗" }, { key: "other", label: "Other", icon: "📍" },
  ];
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLocalError(null);
    setSubmitting(true);
    try {
      await onCreate(name.trim(), type, { width: width || 5, length: length || 4, height: height || 2.7 }, emoji);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Add Room</h2>
          <button onClick={onClose} style={{ color: "var(--gh-text-muted)" }}>✕</button>
        </div>
        {localError && (
          <div className="mb-4 p-3 rounded-xl text-sm" style={{ backgroundColor: "rgba(232,104,90,0.1)", color: "var(--gh-red)" }}>{localError}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Room Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Master Bedroom" className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none" style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }} maxLength={100} required autoFocus />
          </div>
          <EmojiPicker selected={emoji} onSelect={setEmoji} label="Room Icon" />
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Room Type</label>
            <div className="grid grid-cols-4 gap-2">
              {types.map((t) => (
                <button key={t.key} type="button" onClick={() => { setType(t.key); if (emoji === types.find((tp) => tp.key === type)?.icon) setEmoji(t.icon); }}
                  className="p-2 rounded-xl text-center text-xs transition"
                  style={{ backgroundColor: type === t.key ? "rgba(91,156,246,0.12)" : "var(--gh-card)", border: type === t.key ? "1px solid var(--gh-blue)" : "1px solid var(--gh-border)", color: type === t.key ? "var(--gh-blue)" : "var(--gh-text-muted)" }}>
                  <div className="text-lg mb-0.5">{t.icon}</div>{t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Dimensions (meters)</label>
            <div className="grid grid-cols-3 gap-2">
              {([["Width", width, setWidth], ["Length", length, setLength], ["Height", height, setHeight]] as const).map(([label, val, setter]) => (
                <div key={label}>
                  <label className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{label}</label>
                  <input type="number" value={val} onChange={(e) => setter(Number(e.target.value))} min={1} max={50} step={0.1}
                    className="w-full px-2 py-1.5 rounded-lg text-sm focus:outline-none"
                    style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }} />
                </div>
              ))}
            </div>
          </div>
          <button type="submit" disabled={!name.trim() || submitting} className="btn-primary w-full disabled:opacity-50">{submitting ? "Creating..." : "Add Room"}</button>
        </form>
      </div>
    </div>
  );
}
/* ── Automations View ── */
function AutomationsView() {
  const automations = [
    { id: "1", name: "Lights off when room empty", trigger: "No presence for 5 min", action: "Turn off lights", space: "Living Room", enabled: true, icon: "💡" },
    { id: "2", name: "Lock door at night", trigger: "No activity after 11 PM", action: "Lock front door", space: "Patio", enabled: true, icon: "🔒" },
    { id: "3", name: "HVAC eco mode", trigger: "Space unoccupied 15 min", action: "Set thermostat to 68°F", space: "Office", enabled: false, icon: "❄️" },
    { id: "4", name: "Alert: unusual activity", trigger: "Movement detected 2-5 AM", action: "Send notification", space: "All spaces", enabled: true, icon: "🚨" },
    { id: "5", name: "Welcome routine", trigger: "Person detected entering", action: "Lights on, play music", space: "Kitchen", enabled: false, icon: "🎵" },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>Create workflows triggered by Echo Vue events. Connect with Google Home, IFTTT, and smart devices.</p>
        <button className="btn-primary opacity-60 cursor-not-allowed flex items-center gap-2">
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
                <span style={{ color: "var(--gh-yellow)" }}>When:</span> {auto.trigger} &nbsp;·&nbsp;
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
      <div className="mt-8 p-6 rounded-2xl border border-dashed" style={{ borderColor: "var(--gh-border)" }}>
        <h3 className="font-semibold mb-3">Coming Soon: Integrations</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[{ name: "Google Home", icon: "🏠" }, { name: "IFTTT", icon: "⚡" }, { name: "SmartThings", icon: "📱" }, { name: "Home Assistant", icon: "🤖" }].map((i) => (
            <div key={i.name} className="p-3 rounded-xl text-center" style={{ backgroundColor: "var(--gh-card)" }}>
              <span className="text-2xl block mb-1">{i.icon}</span>
              <p className="text-xs font-medium">{i.name}</p>
              <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Planned</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Presence Detection View ── */
function PresenceView() {
  const [entities, setEntities] = useState<TrackedEntity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("\ud83d\udc64");
  const [editLocation, setEditLocation] = useState("");
  const [editType, setEditType] = useState<"person" | "pet">("person");
  const [editFavoriteRoom, setEditFavoriteRoom] = useState("");
  const [tuningRF, setTuningRF] = useState<string | null>(null);
  const [rfProgress, setRfProgress] = useState(0);
  const [activityHistory, setActivityHistory] = useState<string | null>(null);
  const [householdIds, setHouseholdIds] = useState<Set<string>>(new Set());
  const [visitors, setVisitors] = useState<VisitorRecord[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanTarget, setScanTarget] = useState<"all" | string>("all");
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [showScanModal, setShowScanModal] = useState(false);
  const [hasPose, setHasPose] = useState(false);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Beacon editing state
  const [editingBeacon, setEditingBeacon] = useState<string | null>(null);
  const [beaconEditName, setBeaconEditName] = useState("");
  const [beaconEditManuf, setBeaconEditManuf] = useState("");
  const [beaconEditCategory, setBeaconEditCategory] = useState<"phone" | "tablet" | "laptop" | "accessory" | "hub" | "router" | "unknown">("hub");
  const [beaconEditOS, setBeaconEditOS] = useState<"iOS" | "Android" | "Windows" | "Other" | null>(null);
  const [beaconEditRoom, setBeaconEditRoom] = useState<string>("");
  const [beaconEditEmoji, setBeaconEditEmoji] = useState("📡");

  // Router anchor state
  const [routerAnchor, setRouterAnchorState] = useState<RouterAnchor | null>(null);
  const [showRouterSetup, setShowRouterSetup] = useState(false);
  const [routerLabel, setRouterLabel] = useState("Home WiFi Router");
  const [routerRoom, setRouterRoom] = useState("");
  const [routerRoomX, setRouterRoomX] = useState(0);
  const [routerRoomY, setRouterRoomY] = useState(0);
  const [routerOrientation, setRouterOrientation] = useState(0); // degrees
  const [routerTxPower, setRouterTxPower] = useState(20);
  const [routerFrequency, setRouterFrequency] = useState(5.8);
  const [routerAntennas, setRouterAntennas] = useState(4);

  // Per-entity skeleton animation for live 3D rendering
  const [pointCloud, setPointCloud] = useState<number[][]>([]);
  const [animatedPersons, setAnimatedPersons] = useState<Array<{
    track_id: string; user_tag: string; position: number[];
    velocity: number[]; speed: number; confidence: number;
    is_registered: boolean; is_ghosted: boolean; last_activity: string;
    skeleton: number[][]; device_tether_status: string;
  }>>([]);
  const skelTimeRef = useRef(0);
  const prevPosRef = useRef<Record<string, number[]>>({});

  // Animate each active entity with its own skeleton and derive position from it
  useEffect(() => {
    const dims = { width: 5, length: 4, height: 2.7 };
    setPointCloud(generateSimulatedPointCloud(dims, 200));
    const iv = setInterval(() => {
      skelTimeRef.current += 0.1;
      const active = entities.filter((e) => e.status === "active");
      if (active.length === 0) {
        setAnimatedPersons([]);
        return;
      }
      const dt = 0.1;
      const newPersons = active.map((e, i) => {
        // Each entity gets a unique time offset for distinct walking paths
        const phaseOffset = i * 4.2;
        const speedMult = 0.8 + (i % 3) * 0.15; // vary walk speed per entity
        const skel = generateSimulatedSkeleton(
          { width: dims.width, length: dims.length, height: dims.height },
          skelTimeRef.current * speedMult + phaseOffset
        );
        // Derive precise position from hip midpoint (keypoints 23=left hip, 24=right hip)
        const hipL = skel[23] || [2.5, 0.9, 2];
        const hipR = skel[24] || [2.5, 0.9, 2];
        const pos = [(hipL[0] + hipR[0]) / 2, (hipL[1] + hipR[1]) / 2, (hipL[2] + hipR[2]) / 2];
        // Compute velocity from previous position
        const prev = prevPosRef.current[e.id] || pos;
        const vel = [(pos[0] - prev[0]) / dt, (pos[1] - prev[1]) / dt, (pos[2] - prev[2]) / dt];
        const spd = Math.sqrt(vel[0] ** 2 + vel[1] ** 2 + vel[2] ** 2);
        prevPosRef.current[e.id] = pos;
        return {
          track_id: e.id, user_tag: e.name, position: pos,
          velocity: vel, speed: spd, confidence: e.confidence,
          is_registered: true, is_ghosted: false,
          last_activity: e.activity, skeleton: skel,
          device_tether_status: e.deviceTetherStatus ?? "none",
        };
      });
      setAnimatedPersons(newPersons);
    }, 100); // ~10fps
    return () => clearInterval(iv);
  }, [entities]);

  // Load entities, household, visitors, and router anchor from localStorage
  useEffect(() => {
    setEntities(getEntities());
    setHouseholdIds(new Set(getHousehold().map((m) => m.entityId)));
    setVisitors(getVisitors());
    setRouterAnchorState(getRouterAnchor());
  }, []);
  // Subscribe to pose bus for live detection status
  useEffect(() => {
    const unsub = subscribePose(() => setHasPose(hasActivePose()));
    return unsub;
  }, []);

  const allEnvs = getEchoEnvironments();
  const allRooms = allEnvs.flatMap((env) => getRoomsForEnvironment(env.id));

  const people = entities.filter((e) => e.type === "person" && !e.isBeacon);
  const pets = entities.filter((e) => e.type === "pet" && !e.isBeacon);
  const beacons = entities.filter((e) => e.isBeacon);
  const selected = entities.find((e) => e.id === selectedEntity);

  const roomNames: Record<string, string> = {};
  const roomEmojis: Record<string, string> = {};
  allRooms.forEach((r) => { roomNames[r.id] = r.name; roomEmojis[r.id] = r.emoji || ""; });

  // Smart scan: uses presence engine to avoid duplicates for household members
  const runScan = () => {
    setScanning(true);
    setScanProgress(0);
    setScanLog(["Initializing smart presence detection scan..."]);
    let progress = 0;

    scanIntervalRef.current = setInterval(() => {
      progress += Math.random() * 6 + 3;
      if (progress > 100) progress = 100;
      setScanProgress(Math.round(progress));

      // Phased scan log messages
      if (progress > 8 && progress < 12) setScanLog((prev) => prev.length < 3 ? [...prev, "Phase 1: WiFi CSI channel scanning — detecting RF body signatures..."] : prev);
      if (progress > 15 && progress < 19) setScanLog((prev) => prev.length < 4 ? [...prev, "Analyzing breathing micro-motion patterns for body detection..."] : prev);
      if (progress > 22 && progress < 26) setScanLog((prev) => prev.length < 5 ? [...prev, "RF micro-motion analysis — distinguishing human vs pet signatures..."] : prev);
      if (progress > 30 && progress < 34) setScanLog((prev) => prev.length < 6 ? [...prev, "Phase 2: BLE passive scan — inventorying nearby devices..."] : prev);
      if (progress > 38 && progress < 42) setScanLog((prev) => prev.length < 7 ? [...prev, "Classifying BLE devices: phones, laptops, accessories, hubs..."] : prev);
      if (progress > 50 && progress < 54) setScanLog((prev) => prev.length < 8 ? [...prev, "Phase 3: Checking household profile — identifying known members..."] : prev);
      if (progress > 60 && progress < 64) setScanLog((prev) => prev.length < 9 ? [...prev, "Phase 4: Correlating new BLE devices with new RF presences..."] : prev);
      if (progress > 72 && progress < 76) setScanLog((prev) => prev.length < 10 ? [...prev, "Phase 5: Checking visitor registry for recurring devices..."] : prev);
      if (progress > 85 && progress < 89) setScanLog((prev) => prev.length < 11 ? [...prev, "Deduplicating via household-aware CSI Anchor Protocol..."] : prev);

      if (progress >= 100) {
        if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);

        const targetRooms = scanTarget === "all" ? allRooms : allRooms.filter((r) => r.id === scanTarget);
        const roomData = targetRooms.map((r) => ({ id: r.id, name: r.name }));

        const rfPresences = simulateRFPresences(roomData);
        const bleDevices = simulateBLEDevices(roomData);
        const result = resolvePresences(rfPresences, bleDevices);

        setScanLog((prev) => [...prev, ...result.log]);
        setEntities(getEntities());
        setVisitors(getVisitors());
        setScanning(false);
      }
    }, 250);
  };

  const handleToggleHousehold = (entityId: string) => {
    if (householdIds.has(entityId)) {
      removeHouseholdMember(entityId);
    } else {
      const entity = entities.find((e) => e.id === entityId);
      addHouseholdMember(entityId, "household");
      // If it's the first person, mark as owner
      if (entity && entity.type === "person" && getHousehold().filter((m) => {
        const e = entities.find((en) => en.id === m.entityId);
        return e?.type === "person";
      }).length <= 1) {
        removeHouseholdMember(entityId);
        addHouseholdMember(entityId, "owner");
      }
    }
    setHouseholdIds(new Set(getHousehold().map((m) => m.entityId)));
  };

  const handleDeleteEntity = (id: string) => {
    deleteEntity(id);
    removeHouseholdMember(id);
    setEntities(getEntities());
    setHouseholdIds(new Set(getHousehold().map((m) => m.entityId)));
    if (selectedEntity === id) setSelectedEntity(null);
  };

  const handleSaveProfile = () => {
    if (!editingProfile) return;
    updateEntityStorage(editingProfile, {
      name: editName,
      location: editLocation,
      emoji: editEmoji,
      type: editType,
      roomId: editFavoriteRoom || undefined,
    });
    setEntities(getEntities());
    setEditingProfile(null);
  };

  // ── Beacon editing handlers ──
  const handleStartEditBeacon = (beacon: TrackedEntity) => {
    setEditingBeacon(beacon.id);
    setBeaconEditName(beacon.name);
    setBeaconEditManuf(beacon.bleManufacturer || "");
    setBeaconEditCategory((beacon.bleDeviceCategory as typeof beaconEditCategory) || "hub");
    setBeaconEditOS(beacon.bleDeviceOS || null);
    setBeaconEditRoom(beacon.roomId || "");
    setBeaconEditEmoji(beacon.emoji || "📡");
  };

  const handleSaveBeacon = () => {
    if (!editingBeacon) return;
    const beacon = entities.find((e) => e.id === editingBeacon);
    if (!beacon) return;

    const fingerprint = getDeviceFingerprint(beacon);
    const roomObj = allRooms.find((r) => r.id === beaconEditRoom);

    // Save correction for future scans
    setDeviceCorrection(fingerprint, {
      originalName: beacon.bleDeviceName || beacon.name,
      correctedName: beaconEditName,
      correctedManufacturer: beaconEditManuf,
      correctedCategory: beaconEditCategory,
      correctedOS: beaconEditOS,
      correctedRoomId: beaconEditRoom || null,
      correctedRoomName: roomObj?.name || null,
      correctedEmoji: beaconEditEmoji,
      companyId: beacon.bleCompanyId || null,
      createdAt: new Date().toISOString(),
    });

    // Apply correction to entity immediately
    updateEntityStorage(editingBeacon, {
      name: beaconEditName,
      bleManufacturer: beaconEditManuf,
      bleDeviceCategory: beaconEditCategory as TrackedEntity["bleDeviceCategory"],
      bleDeviceOS: beaconEditOS,
      emoji: beaconEditEmoji,
      ...(beaconEditRoom && roomObj ? { roomId: beaconEditRoom, location: roomObj.name, beaconLocationName: roomObj.name } : {}),
    });

    // If category is router, prompt to set up router anchor position
    if (beaconEditCategory === "router") {
      setShowRouterSetup(true);
      setRouterLabel(beaconEditName);
      setRouterRoom(beaconEditRoom || beacon.roomId || "");
    }

    setEntities(getEntities());
    setEditingBeacon(null);
  };

  const handleSaveRouterAnchor = () => {
    const roomObj = allRooms.find((r) => r.id === routerRoom);
    const fpRoom = currentFloorPlan?.rooms.find((r) => r.label === roomObj?.name || r.id === routerRoom);
    // Find the beacon entity for router
    const routerBeacon = entities.find((e) => e.isBeacon && e.bleDeviceCategory === "router");

    const anchor: RouterAnchor = {
      entityId: routerBeacon?.id || "",
      roomId: routerRoom,
      floorPlanRoomId: fpRoom?.id || null,
      roomX: routerRoomX,
      roomY: routerRoomY,
      // Compute absolute position from floor plan room
      absoluteX: fpRoom ? fpRoom.x + routerRoomX : routerRoomX,
      absoluteY: fpRoom ? fpRoom.y + routerRoomY : routerRoomY,
      orientationDeg: routerOrientation,
      txPowerDbm: routerTxPower,
      frequencyGhz: routerFrequency,
      antennaCount: routerAntennas,
      label: routerLabel,
      createdAt: routerAnchor?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setRouterAnchor(anchor);
    setRouterAnchorState(anchor);
    setShowRouterSetup(false);
  };

  const handleRemoveRouterAnchor = () => {
    removeRouterAnchor();
    setRouterAnchorState(null);
    setShowRouterSetup(false);
  };

  const handleDeleteBeacon = (id: string) => {
    const beacon = entities.find((e) => e.id === id);
    if (beacon) {
      const fingerprint = getDeviceFingerprint(beacon);
      removeDeviceCorrection(fingerprint);
    }
    deleteEntity(id);
    setEntities(getEntities());
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>Scan environments to detect entities via RF signatures and camera data. Edit detected entity profiles below.</p>
        <button onClick={() => setShowScanModal(true)} className="btn-primary px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2">
          <span>\ud83d\udce1</span> Run Presence Scan
        </button>
      </div>

      {/* Live Detection Status */}
      <div className="mb-6 p-4 rounded-2xl flex items-center gap-4" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: hasPose ? "var(--gh-green)" : "var(--gh-text-muted)", boxShadow: hasPose ? "0 0 8px rgba(94,187,127,0.5)" : "none" }} />
        <div>
          <p className="text-sm font-medium">{hasPose ? "Live Detection Active" : "No Live Feed"}</p>
          <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{hasPose ? "Camera + MoveNet skeletal tracking is running" : "Start a camera stream in the Cameras tab to enable live detection"}</p>
        </div>
        <div className="ml-auto text-xs font-mono px-2 py-1 rounded" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>
          {entities.length} entities stored
        </div>
      </div>

      {entities.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
          <div className="text-5xl mb-4 opacity-40">\ud83d\udce1</div>
          <h3 className="text-lg font-semibold mb-2">No Entities Detected</h3>
          <p className="text-sm mb-6 max-w-md mx-auto" style={{ color: "var(--gh-text-muted)" }}>
            Run a presence detection scan to discover people and pets in your environments using WiFi CSI RF signatures and camera-based skeletal tracking.
          </p>
          <button onClick={() => setShowScanModal(true)} className="btn-primary px-6 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2">
            <span>\ud83d\udce1</span> Scan Now
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* 3D Viewer — shows tracked entities as dots */}
            <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)", height: 260 }}>
              <EnvironmentViewer
                pointCloud={pointCloud}
                trackedPersons={animatedPersons}
                sourceType={animatedPersons.length > 0 ? "csi" : "simulated"}
                isLive={animatedPersons.length > 0}
              />
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span>\ud83d\udc64</span> People <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(91,156,246,0.12)", color: "var(--gh-blue)" }}>{people.length}</span>
              </h3>
              <div className="space-y-2">
                {people.map((p) => (
                  <div key={p.id} className={`device-card w-full text-left flex items-center gap-4 ${selectedEntity === p.id ? "ring-1" : ""}`} style={selectedEntity === p.id ? { borderColor: "var(--gh-blue)" } : {}}>
                    <button onClick={() => setSelectedEntity(p.id)} className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: p.status === "active" ? "rgba(94,187,127,0.12)" : "rgba(139,143,154,0.12)" }}>
                        {p.emoji || "\ud83d\udc64"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-medium text-sm">{p.name}</h4>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>{p.rfSignature}</span>
                          {householdIds.has(p.id) && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(124,140,248,0.12)", color: "var(--gh-accent)" }}>🏠 Household</span>}
                          {(p.deviceTetherStatus === "connected" || p.deviceTetherStatus === "tethered") && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(91,156,246,0.12)", color: "var(--gh-blue)" }}>BLE</span>}
                          {p.bleDeviceOS && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: p.bleDeviceOS === "iOS" ? "rgba(139,143,154,0.15)" : "rgba(94,187,127,0.12)", color: p.bleDeviceOS === "iOS" ? "var(--gh-text-muted)" : "var(--gh-green)" }}>{p.bleDeviceOS}</span>}
                        </div>
                        <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{p.location} &middot; {p.activity}{p.bleManufacturer ? ` · ${p.bleManufacturer}` : ""} &middot; {p.lastSeen}</p>
                      </div>
                      <p className="text-xs font-medium flex-shrink-0" style={{ color: p.confidence > 0.5 ? "var(--gh-green)" : "var(--gh-text-muted)" }}>
                        {p.confidence > 0 ? `${(p.confidence * 100).toFixed(0)}%` : "\u2014"}
                      </p>
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleToggleHousehold(p.id); }}
                      className="flex-shrink-0 text-[10px] px-2 py-1 rounded-lg transition hover:opacity-80"
                      style={{ backgroundColor: householdIds.has(p.id) ? "rgba(124,140,248,0.15)" : "var(--gh-card)", color: householdIds.has(p.id) ? "var(--gh-accent)" : "var(--gh-text-muted)" }}
                      title={householdIds.has(p.id) ? "Remove from household" : "Add to household"}>
                      {householdIds.has(p.id) ? "🏠" : "＋🏠"}
                    </button>
                  </div>
                ))}
                {people.length === 0 && <p className="text-xs py-4 text-center" style={{ color: "var(--gh-text-muted)" }}>No people detected yet. Run a scan to discover.</p>}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span>\ud83d\udc3e</span> Pets <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(245,197,66,0.12)", color: "var(--gh-yellow)" }}>{pets.length}</span>
              </h3>
              <div className="space-y-2">
                {pets.map((p) => (
                  <div key={p.id} className={`device-card w-full text-left flex items-center gap-4 ${selectedEntity === p.id ? "ring-1" : ""}`} style={selectedEntity === p.id ? { borderColor: "var(--gh-yellow)" } : {}}>
                    <button onClick={() => setSelectedEntity(p.id)} className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: "rgba(245,197,66,0.12)" }}>
                        {p.emoji || "\ud83d\udc3e"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-medium text-sm">{p.name}</h4>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>{p.rfSignature}</span>
                          {householdIds.has(p.id) && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(124,140,248,0.12)", color: "var(--gh-accent)" }}>🏠 Household</span>}
                        </div>
                        <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{p.location} &middot; {p.activity} &middot; {p.lastSeen}</p>
                      </div>
                      <p className="text-xs font-medium flex-shrink-0" style={{ color: "var(--gh-yellow)" }}>{(p.confidence * 100).toFixed(0)}%</p>
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleToggleHousehold(p.id); }}
                      className="flex-shrink-0 text-[10px] px-2 py-1 rounded-lg transition hover:opacity-80"
                      style={{ backgroundColor: householdIds.has(p.id) ? "rgba(124,140,248,0.15)" : "var(--gh-card)", color: householdIds.has(p.id) ? "var(--gh-accent)" : "var(--gh-text-muted)" }}
                      title={householdIds.has(p.id) ? "Remove from household" : "Add to household"}>
                      {householdIds.has(p.id) ? "🏠" : "＋🏠"}
                    </button>
                  </div>
                ))}
                {pets.length === 0 && <p className="text-xs py-4 text-center" style={{ color: "var(--gh-text-muted)" }}>No pets detected yet.</p>}
              </div>
            </div>

            {/* Spatial Beacons */}
            {beacons.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <span>📡</span> Spatial Beacons <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(6,182,212,0.12)", color: "#06b6d4" }}>{beacons.length}</span>
                </h3>
                <div className="space-y-2">
                  {beacons.map((b) => (
                    <div key={b.id}>
                      {editingBeacon === b.id ? (
                        /* ── Beacon Edit Form ── */
                        <div className="rounded-xl border p-3 space-y-2" style={{ backgroundColor: "var(--gh-surface)", borderColor: "rgba(6,182,212,0.3)" }}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg cursor-pointer" title="Click to change emoji">{beaconEditEmoji}</span>
                            <input value={beaconEditName} onChange={(e) => setBeaconEditName(e.target.value)}
                              className="flex-1 text-xs font-medium px-2 py-1 rounded-lg border" placeholder="Device name"
                              style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input value={beaconEditManuf} onChange={(e) => setBeaconEditManuf(e.target.value)}
                              className="text-[11px] px-2 py-1 rounded-lg border" placeholder="Manufacturer"
                              style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
                            <select value={beaconEditCategory} onChange={(e) => setBeaconEditCategory(e.target.value as typeof beaconEditCategory)}
                              className="text-[11px] px-2 py-1 rounded-lg border"
                              style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }}>
                              <option value="hub">Hub / Smart Display</option>
                              <option value="router">WiFi Router / AP</option>
                              <option value="accessory">Accessory / Wearable</option>
                              <option value="phone">Phone</option>
                              <option value="tablet">Tablet</option>
                              <option value="laptop">Laptop</option>
                              <option value="unknown">Other</option>
                            </select>
                            <select value={beaconEditOS || ""} onChange={(e) => setBeaconEditOS(e.target.value as typeof beaconEditOS || null)}
                              className="text-[11px] px-2 py-1 rounded-lg border"
                              style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }}>
                              <option value="">OS: Auto</option>
                              <option value="iOS">iOS</option>
                              <option value="Android">Android</option>
                              <option value="Windows">Windows</option>
                              <option value="Other">Other</option>
                            </select>
                            <select value={beaconEditRoom} onChange={(e) => setBeaconEditRoom(e.target.value)}
                              className="text-[11px] px-2 py-1 rounded-lg border"
                              style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }}>
                              <option value="">Room: Auto</option>
                              {allRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                          </div>
                          {/* Emoji quick picks */}
                          <div className="flex gap-1 flex-wrap">
                            {["📡", "📍", "🎮", "⌚", "🎧", "📺", "🔊", "💡", "📷", "🖥️", "🕶️", "📶"].map((em) => (
                              <button key={em} onClick={() => setBeaconEditEmoji(em)}
                                className="w-6 h-6 rounded text-sm flex items-center justify-center transition"
                                style={{ backgroundColor: beaconEditEmoji === em ? "rgba(6,182,212,0.2)" : "transparent" }}>{em}</button>
                            ))}
                          </div>
                          {/* MAC prefix hint */}
                          {b.bleCompanyId && MAC_PREFIX_DB[b.bleCompanyId] && (
                            <p className="text-[10px] px-2 py-1 rounded-lg" style={{ backgroundColor: "rgba(6,182,212,0.08)", color: "#06b6d4" }}>
                              💡 BLE Company ID {b.bleCompanyId} → {MAC_PREFIX_DB[b.bleCompanyId].manufacturer} ({MAC_PREFIX_DB[b.bleCompanyId].commonDevices.join(", ")})
                            </p>
                          )}
                          <div className="flex gap-2 pt-1">
                            <button onClick={handleSaveBeacon}
                              className="flex-1 text-[11px] py-1.5 rounded-lg font-medium transition hover:opacity-90"
                              style={{ backgroundColor: "rgba(6,182,212,0.15)", color: "#06b6d4" }}>
                              ✓ Save Correction
                            </button>
                            <button onClick={() => setEditingBeacon(null)}
                              className="text-[11px] px-3 py-1.5 rounded-lg transition hover:opacity-80"
                              style={{ color: "var(--gh-text-muted)" }}>
                              Cancel
                            </button>
                            <button onClick={() => { handleDeleteBeacon(b.id); setEditingBeacon(null); }}
                              className="text-[11px] px-3 py-1.5 rounded-lg transition hover:opacity-80"
                              style={{ color: "var(--gh-red)" }}>
                              🗑
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── Beacon Display Card ── */
                        <div className="device-card flex items-center gap-3 cursor-pointer hover:opacity-90 transition" onClick={() => handleStartEditBeacon(b)}>
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ backgroundColor: "rgba(6,182,212,0.12)" }}>
                            {b.emoji || "📡"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-xs">{b.name}</h4>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(6,182,212,0.12)", color: "#06b6d4" }}>Anchor</span>
                              {getDeviceCorrections()[getDeviceFingerprint(b)] && (
                                <span className="text-[10px] px-1 py-0.5 rounded-full" style={{ backgroundColor: "rgba(94,187,127,0.12)", color: "var(--gh-green)" }}>✓ Corrected</span>
                              )}
                            </div>
                            <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>
                              {b.bleManufacturer}{b.location ? ` · ${b.location}` : ""}{b.deviceRssi ? ` · ${b.deviceRssi} dBm` : ""}
                            </p>
                            {b.bleCompanyId && (
                              <p className="text-[9px]" style={{ color: "var(--gh-text-muted)" }}>
                                BLE: {b.bleCompanyId} · {b.bleAddressType || "?"} · {b.bleDeviceCategory || "?"}
                              </p>
                            )}
                          </div>
                          <span className="text-[10px] flex-shrink-0" style={{ color: "var(--gh-text-muted)" }}>✏️</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* WiFi Router Anchor Configuration */}
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span>📶</span> WiFi Router Anchor
                {routerAnchor && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(16,185,129,0.12)", color: "#10b981" }}>Active</span>}
              </h3>
              {routerAnchor && !showRouterSetup ? (
                <div className="device-card space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ backgroundColor: "rgba(16,185,129,0.12)" }}>📶</div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-xs">{routerAnchor.label}</h4>
                      <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>
                        Facing {routerAnchor.orientationDeg}° · {routerAnchor.txPowerDbm} dBm TX · {routerAnchor.frequencyGhz} GHz · {routerAnchor.antennaCount}×MIMO
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>
                        Position: ({routerAnchor.roomX.toFixed(1)}m, {routerAnchor.roomY.toFixed(1)}m) in room · Absolute: ({routerAnchor.absoluteX.toFixed(1)}, {routerAnchor.absoluteY.toFixed(1)})m
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowRouterSetup(true)}
                      className="flex-1 text-[11px] py-1.5 rounded-lg font-medium transition hover:opacity-90"
                      style={{ backgroundColor: "rgba(16,185,129,0.12)", color: "#10b981" }}>
                      ✏️ Edit Position
                    </button>
                    <button onClick={handleRemoveRouterAnchor}
                      className="text-[11px] px-3 py-1.5 rounded-lg transition hover:opacity-80"
                      style={{ color: "var(--gh-red)" }}>
                      Remove
                    </button>
                  </div>
                </div>
              ) : showRouterSetup ? (
                <div className="rounded-xl border p-3 space-y-3" style={{ backgroundColor: "var(--gh-surface)", borderColor: "rgba(16,185,129,0.3)" }}>
                  <p className="text-[11px] font-medium" style={{ color: "#10b981" }}>Configure your WiFi router&apos;s physical location for CSI triangulation</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] block mb-1" style={{ color: "var(--gh-text-muted)" }}>Label</label>
                      <input value={routerLabel} onChange={(e) => setRouterLabel(e.target.value)}
                        className="w-full text-[11px] px-2 py-1 rounded-lg border"
                        style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
                    </div>
                    <div>
                      <label className="text-[10px] block mb-1" style={{ color: "var(--gh-text-muted)" }}>Room</label>
                      <select value={routerRoom} onChange={(e) => setRouterRoom(e.target.value)}
                        className="w-full text-[11px] px-2 py-1 rounded-lg border"
                        style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }}>
                        <option value="">Select room...</option>
                        {allRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] block mb-1" style={{ color: "var(--gh-text-muted)" }}>Position X in room (metres from left wall)</label>
                      <input type="number" step="0.1" min="0" value={routerRoomX} onChange={(e) => setRouterRoomX(parseFloat(e.target.value) || 0)}
                        className="w-full text-[11px] px-2 py-1 rounded-lg border"
                        style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
                    </div>
                    <div>
                      <label className="text-[10px] block mb-1" style={{ color: "var(--gh-text-muted)" }}>Position Y in room (metres from top wall)</label>
                      <input type="number" step="0.1" min="0" value={routerRoomY} onChange={(e) => setRouterRoomY(parseFloat(e.target.value) || 0)}
                        className="w-full text-[11px] px-2 py-1 rounded-lg border"
                        style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] block mb-1" style={{ color: "var(--gh-text-muted)" }}>
                      Facing Direction: <strong>{routerOrientation}°</strong> ({routerOrientation === 0 ? "North" : routerOrientation === 90 ? "East" : routerOrientation === 180 ? "South" : routerOrientation === 270 ? "West" : `${routerOrientation}°`})
                    </label>
                    <input type="range" min="0" max="359" step="1" value={routerOrientation} onChange={(e) => setRouterOrientation(parseInt(e.target.value))}
                      className="w-full" />
                    <div className="flex justify-between text-[9px]" style={{ color: "var(--gh-text-muted)" }}>
                      <span>N (0°)</span><span>E (90°)</span><span>S (180°)</span><span>W (270°)</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] block mb-1" style={{ color: "var(--gh-text-muted)" }}>TX Power (dBm)</label>
                      <input type="number" step="1" value={routerTxPower} onChange={(e) => setRouterTxPower(parseInt(e.target.value) || 20)}
                        className="w-full text-[11px] px-2 py-1 rounded-lg border"
                        style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
                    </div>
                    <div>
                      <label className="text-[10px] block mb-1" style={{ color: "var(--gh-text-muted)" }}>Frequency (GHz)</label>
                      <select value={routerFrequency} onChange={(e) => setRouterFrequency(parseFloat(e.target.value))}
                        className="w-full text-[11px] px-2 py-1 rounded-lg border"
                        style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }}>
                        <option value="2.4">2.4 GHz</option>
                        <option value="5.0">5.0 GHz</option>
                        <option value="5.8">5.8 GHz</option>
                        <option value="6.0">6.0 GHz (WiFi 6E)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] block mb-1" style={{ color: "var(--gh-text-muted)" }}>Antennas</label>
                      <select value={routerAntennas} onChange={(e) => setRouterAntennas(parseInt(e.target.value))}
                        className="w-full text-[11px] px-2 py-1 rounded-lg border"
                        style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }}>
                        <option value="2">2×2 MIMO</option>
                        <option value="4">4×4 MIMO</option>
                        <option value="8">8×8 MIMO</option>
                      </select>
                    </div>
                  </div>
                  <p className="text-[10px] px-2 py-1 rounded-lg" style={{ backgroundColor: "rgba(16,185,129,0.08)", color: "#10b981" }}>
                    💡 The router&apos;s position and facing direction are used by the CSI engine to compute signal distance, angle-of-arrival, and triangulate entity positions on the floor plan.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button onClick={handleSaveRouterAnchor}
                      className="flex-1 text-[11px] py-1.5 rounded-lg font-medium transition hover:opacity-90"
                      style={{ backgroundColor: "rgba(16,185,129,0.15)", color: "#10b981" }}>
                      ✓ Save Router Position
                    </button>
                    <button onClick={() => setShowRouterSetup(false)}
                      className="text-[11px] px-3 py-1.5 rounded-lg transition hover:opacity-80"
                      style={{ color: "var(--gh-text-muted)" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowRouterSetup(true)}
                  className="w-full text-[11px] py-2 rounded-lg border border-dashed transition hover:opacity-80"
                  style={{ borderColor: "rgba(16,185,129,0.3)", color: "#10b981" }}>
                  + Configure WiFi Router Position for CSI Triangulation
                </button>
              )}
            </div>

            {/* Visitor History */}
            {visitors.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <span>🧑‍🦰</span> Visitor History <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(167,139,250,0.12)", color: "var(--gh-accent)" }}>{visitors.length}</span>
                </h3>
                <div className="space-y-2">
                  {visitors.map((v) => (
                    <div key={v.id} className="device-card flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: "rgba(167,139,250,0.12)" }}>
                        {v.emoji || "🧑‍🦰"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm">{v.name}</h4>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(167,139,250,0.12)", color: "var(--gh-accent)" }}>Visit #{v.visitCount}</span>
                        </div>
                        <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
                          {v.bleDeviceName ?? "Unknown device"}{v.bleDeviceOS ? ` · ${v.bleDeviceOS}` : ""}{v.bleManufacturer ? ` · ${v.bleManufacturer}` : ""}
                        </p>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>
                          Last seen: {new Date(v.lastSeen).toLocaleString()} · First: {new Date(v.firstSeen).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {v.entityId ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(94,187,127,0.12)", color: "var(--gh-green)" }}>● Here</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(139,143,154,0.12)", color: "var(--gh-text-muted)" }}>○ Away</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Entity Detail Panel */}
          <div>
            {selected ? (
              <div className="rounded-2xl p-5 sticky top-20" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">{selected.emoji || "\ud83d\udc64"}</div>
                  <h3 className="font-bold text-lg">{selected.name}</h3>
                  <p className="text-xs font-mono" style={{ color: "var(--gh-text-muted)" }}>{selected.rfSignature}</p>
                  <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full" style={{
                    backgroundColor: selected.status === "active" ? "rgba(94,187,127,0.12)" : "rgba(139,143,154,0.12)",
                    color: selected.status === "active" ? "var(--gh-green)" : "var(--gh-text-muted)",
                  }}>{selected.status === "active" ? "\u25cf Active" : "\u25cb Away"}</span>
                  {householdIds.has(selected.id) && (
                    <span className="inline-block ml-1 mt-1 text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(124,140,248,0.12)", color: "var(--gh-accent)" }}>🏠 Household</span>
                  )}
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Location</span><span className="font-medium" style={{ color: "var(--gh-text)" }}>{selected.location}</span></div>
                  <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Activity</span><span className="font-medium" style={{ color: "var(--gh-text)" }}>{selected.activity}</span></div>
                  <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Last Seen</span><span>{selected.lastSeen}</span></div>
                  <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Confidence</span><span>{selected.confidence > 0 ? `${(selected.confidence * 100).toFixed(0)}%` : "\u2014"}</span></div>
                  {selected.deviceTetherStatus !== "none" && (
                    <>
                      <hr style={{ borderColor: "var(--gh-border)" }} />
                      <h4 className="font-semibold text-xs" style={{ color: "var(--gh-text-muted)" }}>BLE DEVICE</h4>
                      <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Tether Status</span><span className="font-medium" style={{ color: (selected.deviceTetherStatus === "connected" || selected.deviceTetherStatus === "tethered") ? "var(--gh-green)" : "var(--gh-text-muted)" }}>{selected.deviceTetherStatus}</span></div>
                      {selected.bleManufacturer && <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Manufacturer</span><span className="font-medium" style={{ color: "var(--gh-text)" }}>{selected.bleManufacturer}</span></div>}
                      {selected.bleDeviceOS && <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Device OS</span><span className="font-medium inline-flex items-center gap-1.5" style={{ color: "var(--gh-text)" }}>{selected.bleDeviceOS === "iOS" ? "\ud83c\udf4e" : selected.bleDeviceOS === "Android" ? "\ud83e\udd16" : "\ud83d\udcbb"} {selected.bleDeviceOS}</span></div>}
                      {selected.bleDeviceName && <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Device Name</span><span className="font-medium" style={{ color: "var(--gh-text)" }}>{selected.bleDeviceName}</span></div>}
                      {selected.bleCompanyId && <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Company ID</span><span className="font-mono text-xs">{selected.bleCompanyId}</span></div>}
                      {selected.deviceMacSuffix && <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>MAC (suffix)</span><span className="font-mono text-xs">**:**:**:**:{selected.deviceMacSuffix}</span></div>}
                      {selected.bleAddressType && <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Address Type</span><span className="font-medium" style={{ color: "var(--gh-text)" }}>{selected.bleAddressType === "random" ? "Random (privacy)" : "Public"}</span></div>}
                      {selected.deviceRssi != null && <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Signal (RSSI)</span><span className="font-medium" style={{ color: selected.deviceRssi > -60 ? "var(--gh-green)" : selected.deviceRssi > -75 ? "var(--gh-yellow)" : "var(--gh-red)" }}>{selected.deviceRssi} dBm</span></div>}
                      {selected.deviceDistanceM != null && <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Est. Distance</span><span className="font-medium" style={{ color: "var(--gh-text)" }}>{selected.deviceDistanceM.toFixed(1)} m</span></div>}
                    </>
                  )}
                  {selected.status === "active" && (
                    <>
                      <hr style={{ borderColor: "var(--gh-border)" }} />
                      <h4 className="font-semibold text-xs" style={{ color: "var(--gh-text-muted)" }}>VITALS</h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 rounded-lg text-center" style={{ backgroundColor: "var(--gh-card)" }}>
                          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Breathing</p>
                          <p className="text-base font-bold" style={{ color: "var(--gh-blue)" }}>{selected.breathingRate?.toFixed(1) ?? "\u2014"}</p>
                          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>bpm</p>
                        </div>
                        <div className="p-2 rounded-lg text-center" style={{ backgroundColor: "var(--gh-card)" }}>
                          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Heart Rate</p>
                          <p className="text-base font-bold" style={{ color: "var(--gh-red)" }}>{selected.heartRate ?? "\u2014"}</p>
                          <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>bpm</p>
                        </div>
                      </div>
                    </>
                  )}
                  <hr style={{ borderColor: "var(--gh-border)" }} />
                  <div className="space-y-2">
                    <button onClick={() => {
                      setEditName(selected.name);
                      setEditLocation(selected.location);
                      setEditEmoji(selected.emoji || "\ud83d\udc64");
                      setEditType(selected.type);
                      setEditFavoriteRoom(selected.roomId || "");
                      setEditingProfile(selected.id);
                    }} className="w-full py-2 rounded-xl text-xs font-medium transition hover:opacity-90" style={{ backgroundColor: "var(--gh-card)" }}>Edit Profile</button>
                    <button onClick={() => { setRfProgress(0); setTuningRF(selected.id); }} className="w-full py-2 rounded-xl text-xs font-medium transition hover:opacity-90" style={{ backgroundColor: "var(--gh-card)" }}>Tune RF Signature</button>
                    <button onClick={() => setActivityHistory(selected.id)} className="w-full py-2 rounded-xl text-xs font-medium transition hover:opacity-90" style={{ backgroundColor: "var(--gh-card)" }}>View Activity History</button>
                    <button onClick={() => { if (confirm(`Remove ${selected.name}? This will delete the RF signature.`)) handleDeleteEntity(selected.id); }} className="w-full py-2 rounded-xl text-xs font-medium transition hover:opacity-90" style={{ backgroundColor: "rgba(248,81,73,0.08)", color: "var(--gh-red)" }}>Remove Entity</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
                <div className="text-4xl mb-3 opacity-30">\ud83d\udc64</div>
                <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>Select an entity to view details and edit profile</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Detection Engine Stats */}
      <div className="mt-8 p-5 rounded-2xl" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
        <div className="flex items-center gap-3 mb-3"><span className="text-xl">\ud83e\udde0</span><h3 className="font-semibold">AI Detection Engine</h3></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Entities Tracked", value: `${entities.filter((e) => e.status === "active").length} active`, color: "var(--gh-green)" },
            { label: "RF Signatures", value: `${entities.length} stored`, color: "var(--gh-blue)" },
            { label: "BLE Tethered", value: `${entities.filter((e) => e.deviceTetherStatus === "tethered" || e.deviceTetherStatus === "connected").length} devices`, color: "var(--gh-accent)" },
            { label: "Avg. Confidence", value: entities.filter((e) => e.confidence > 0).length > 0 ? `${(entities.filter((e) => e.confidence > 0).reduce((a, e) => a + e.confidence, 0) / entities.filter((e) => e.confidence > 0).length * 100).toFixed(0)}%` : "\u2014", color: "var(--gh-text)" },
          ].map((s) => (
            <div key={s.label} className="p-3 rounded-xl" style={{ backgroundColor: "var(--gh-card)" }}>
              <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{s.label}</p>
              <p className="text-sm font-bold mt-0.5" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Run Presence Scan Modal */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { if (!scanning) setShowScanModal(false); }}>
          <div className="rounded-2xl p-6 w-full max-w-lg max-h-[85vh] flex flex-col" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-2xl">\ud83d\udce1</span>
              <h3 className="text-lg font-semibold">Presence Detection Scan</h3>
            </div>
            <p className="text-xs mb-4" style={{ color: "var(--gh-text-muted)" }}>Scan your environment to auto-detect people and pets using WiFi CSI RF signatures{hasPose ? " and live camera skeletal tracking" : ""}.</p>

            {!scanning && scanProgress === 0 && (
              <div className="space-y-3 mb-4">
                <label className="text-xs font-medium block" style={{ color: "var(--gh-text-muted)" }}>Scan Target</label>
                <select value={scanTarget} onChange={(e) => setScanTarget(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm bg-transparent border outline-none" style={{ borderColor: "var(--gh-border)", color: "var(--gh-text)" }}>
                  <option value="all">All Environments & Rooms</option>
                  {allRooms.map((r) => (
                    <option key={r.id} value={r.id}>{roomEmojis[r.id]} {r.name}</option>
                  ))}
                </select>
                <div className="p-3 rounded-xl text-xs space-y-1" style={{ backgroundColor: "var(--gh-card)" }}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--gh-green)" }} />
                    <span>WiFi CSI RF body detection <span style={{ color: "var(--gh-text-muted)" }}>\u2014 primary (always active)</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--gh-blue)" }} />
                    <span>Breathing micro-motion analysis <span style={{ color: "var(--gh-text-muted)" }}>\u2014 human vs pet classification</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--gh-green)" }} />
                    <span>BLE phone-only correlation <span style={{ color: "var(--gh-text-muted)" }}>\u2014 phones only (laptops/hubs/accessories filtered)</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: hasPose ? "var(--gh-green)" : "var(--gh-text-muted)" }} />
                    <span>Camera skeletal tracking <span style={{ color: "var(--gh-text-muted)" }}>\u2014 {hasPose ? "active" : "no feed"}</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--gh-yellow)" }} />
                    <span>BLE beacon registration <span style={{ color: "var(--gh-text-muted)" }}>\u2014 accessories as location hubs</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: householdIds.size > 0 ? "var(--gh-green)" : "var(--gh-text-muted)" }} />
                    <span>Household-aware dedup <span style={{ color: "var(--gh-text-muted)" }}>\u2014 {householdIds.size > 0 ? `${householdIds.size} member(s) locked` : "no household set"}</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: visitors.length > 0 ? "var(--gh-accent)" : "var(--gh-text-muted)" }} />
                    <span>Visitor recognition <span style={{ color: "var(--gh-text-muted)" }}>\u2014 {visitors.length > 0 ? `${visitors.length} known visitor(s)` : "no visitor history"}</span></span>
                  </div>
                </div>
              </div>
            )}

            {(scanning || scanProgress > 0) && (
              <div className="space-y-3 mb-4">
                <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--gh-card)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium">{scanning ? "Scanning..." : "Scan Complete"}</span>
                    <span className="text-xs font-mono" style={{ color: "var(--gh-text-muted)" }}>{scanProgress}%</span>
                  </div>
                  <div className="w-full rounded-full h-2 mb-3" style={{ backgroundColor: "var(--gh-border)" }}>
                    <div className="h-2 rounded-full transition-all duration-300" style={{ width: `${scanProgress}%`, backgroundColor: scanProgress >= 100 ? "var(--gh-green)" : "var(--gh-accent)" }} />
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {scanLog.map((msg, i) => (
                      <p key={i} className="text-[11px] font-mono" style={{ color: msg.startsWith("\u2713") ? "var(--gh-green)" : "var(--gh-text-muted)" }}>{msg}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-auto">
              <button onClick={() => { setShowScanModal(false); setScanProgress(0); setScanLog([]); }} className="flex-1 py-2 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--gh-border)" }} disabled={scanning}>{scanProgress >= 100 ? "Done" : "Cancel"}</button>
              {scanProgress < 100 && (
                <button onClick={runScan} className="flex-1 py-2 rounded-xl text-sm font-medium btn-primary" disabled={scanning}>
                  {scanning ? "Scanning\u2026" : "Start Scan"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editingProfile && (() => {
        const entity = entities.find((e) => e.id === editingProfile);
        if (!entity) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingProfile(null)}>
            <div className="rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-4">Edit Profile \u2014 {entity.name}</h3>
              <div className="space-y-3">
                <div className="flex justify-center mb-2">
                  <div className="text-5xl">{editEmoji}</div>
                </div>
                <EmojiPicker selected={editEmoji} onSelect={setEditEmoji} label="Profile Avatar" />
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--gh-text-muted)" }}>Display Name</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm bg-transparent border outline-none focus:ring-1" style={{ borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--gh-text-muted)" }}>Entity Type</label>
                  <select value={editType} onChange={(e) => setEditType(e.target.value as "person" | "pet")} className="w-full px-3 py-2 rounded-xl text-sm bg-transparent border outline-none" style={{ borderColor: "var(--gh-border)", color: "var(--gh-text)" }}>
                    <option value="person">Person</option>
                    <option value="pet">Pet</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--gh-text-muted)" }}>Current Location</label>
                  <input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm bg-transparent border outline-none focus:ring-1" style={{ borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--gh-text-muted)" }}>Favorite Room</label>
                  <select value={editFavoriteRoom} onChange={(e) => setEditFavoriteRoom(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm bg-transparent border outline-none" style={{ borderColor: "var(--gh-border)", color: "var(--gh-text)" }}>
                    <option value="">No preference</option>
                    {allRooms.map((r) => (
                      <option key={r.id} value={r.id}>{roomEmojis[r.id]} {r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--gh-text-muted)" }}>RF Signature</label>
                  <p className="text-sm font-mono" style={{ color: "var(--gh-text-muted)" }}>{entity.rfSignature}</p>
                </div>
                {entity.bleManufacturer && (
                  <div className="p-3 rounded-xl" style={{ backgroundColor: "var(--gh-card)" }}>
                    <label className="text-xs font-medium block mb-2" style={{ color: "var(--gh-text-muted)" }}>BLE Device Info</label>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span style={{ color: "var(--gh-text-muted)" }}>Manufacturer</span><span>{entity.bleManufacturer}</span></div>
                      {entity.bleDeviceOS && <div className="flex justify-between"><span style={{ color: "var(--gh-text-muted)" }}>OS</span><span>{entity.bleDeviceOS === "iOS" ? "\ud83c\udf4e" : entity.bleDeviceOS === "Android" ? "\ud83e\udd16" : "\ud83d\udcbb"} {entity.bleDeviceOS}</span></div>}
                      {entity.bleDeviceName && <div className="flex justify-between"><span style={{ color: "var(--gh-text-muted)" }}>Device</span><span>{entity.bleDeviceName}</span></div>}
                      {entity.bleCompanyId && <div className="flex justify-between"><span style={{ color: "var(--gh-text-muted)" }}>Company ID</span><span className="font-mono">{entity.bleCompanyId}</span></div>}
                      {entity.deviceRssi != null && <div className="flex justify-between"><span style={{ color: "var(--gh-text-muted)" }}>RSSI</span><span>{entity.deviceRssi} dBm</span></div>}
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--gh-text-muted)" }}>Detected</label>
                  <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>{new Date(entity.createdAt).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setEditingProfile(null)} className="flex-1 py-2 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--gh-border)" }}>Cancel</button>
                <button onClick={handleSaveProfile} className="flex-1 py-2 rounded-xl text-sm font-medium btn-primary">Save Changes</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tune RF Signature Modal */}
      {tuningRF && (() => {
        const entity = entities.find((e) => e.id === tuningRF);
        if (!entity) return null;
        const isRunning = rfProgress > 0 && rfProgress < 100;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { if (!isRunning) setTuningRF(null); }}>
            <div className="rounded-2xl p-6 w-full max-w-md" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-1">Tune RF + BLE Signature</h3>
              <p className="text-xs mb-4" style={{ color: "var(--gh-text-muted)" }}>{entity.name} \u2014 {entity.rfSignature}{entity.bleDeviceOS ? ` \u2014 ${entity.bleDeviceOS}` : ""}</p>
              <div className="p-4 rounded-xl mb-4" style={{ backgroundColor: "var(--gh-card)" }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl" style={{ backgroundColor: "rgba(124,140,248,0.12)" }}>\ud83d\udce1</div>
                  <div>
                    <p className="text-sm font-medium">WiFi CSI + BLE Signal</p>
                    <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Capturing RF & BLE patterns for {entity.name}</p>
                  </div>
                </div>
                <div className="w-full rounded-full h-2 mb-1" style={{ backgroundColor: "var(--gh-border)" }}>
                  <div className="h-2 rounded-full transition-all duration-300" style={{ width: `${rfProgress}%`, backgroundColor: rfProgress >= 100 ? "var(--gh-green)" : "var(--gh-accent)" }} />
                </div>
                <p className="text-[10px] text-right" style={{ color: "var(--gh-text-muted)" }}>{rfProgress}%</p>
              </div>
              {rfProgress >= 100 && (
                <div className="p-3 rounded-xl mb-4 text-sm space-y-1" style={{ backgroundColor: "rgba(94,187,127,0.1)", color: "var(--gh-green)" }}>
                  <p>\u2713 RF signature tuned successfully. Confidence improved.</p>
                  {entity.bleManufacturer && <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>BLE tether re-calibrated \u2014 {entity.bleManufacturer} ({entity.bleDeviceOS ?? "unknown OS"})</p>}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setTuningRF(null)} className="flex-1 py-2 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--gh-border)" }} disabled={isRunning}>{rfProgress >= 100 ? "Done" : "Cancel"}</button>
                {rfProgress < 100 && (
                  <button onClick={() => {
                    setRfProgress(1);
                    let p = 0;
                    const iv = setInterval(() => { p += Math.random() * 8 + 2; if (p >= 100) { p = 100; clearInterval(iv); updateEntityStorage(entity.id, { confidence: Math.min(entity.confidence + 0.05, 0.99) }); setEntities(getEntities()); } setRfProgress(Math.round(p)); }, 200);
                  }} className="flex-1 py-2 rounded-xl text-sm font-medium btn-primary" disabled={isRunning}>{isRunning ? "Tuning\u2026" : "Start Tuning"}</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* View Activity History Modal */}
      {activityHistory && (() => {
        const entity = entities.find((e) => e.id === activityHistory);
        if (!entity) return null;
        const mockHistory = [
          { time: "Just now", activity: entity.activity, location: entity.location, confidence: entity.confidence },
          { time: "5 min ago", activity: "Standing", location: entity.location, confidence: 0.92 },
          { time: "12 min ago", activity: "Walking", location: "Hallway", confidence: 0.87 },
          { time: "25 min ago", activity: "Sitting", location: entity.location, confidence: 0.94 },
          { time: "1 hour ago", activity: "Walking", location: "Kitchen", confidence: 0.89 },
          { time: "1.5 hours ago", activity: "Standing", location: "Living Room", confidence: 0.91 },
        ];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setActivityHistory(null)}>
            <div className="rounded-2xl p-6 w-full max-w-lg max-h-[80vh] flex flex-col" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-1">Activity History</h3>
              <p className="text-xs mb-4" style={{ color: "var(--gh-text-muted)" }}>{entity.name} \u2014 {entity.rfSignature}</p>
              <div className="flex-1 overflow-y-auto space-y-1">
                {mockHistory.map((h, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ backgroundColor: i === 0 ? "rgba(91,156,246,0.06)" : "transparent" }}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: i === 0 ? "var(--gh-green)" : "var(--gh-text-muted)" }} />
                    <span className="text-[10px] w-20 flex-shrink-0" style={{ color: "var(--gh-text-muted)" }}>{h.time}</span>
                    <span className="text-xs font-medium flex-1">{h.activity}</span>
                    <span className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{h.location}</span>
                    <span className="text-[10px] font-mono" style={{ color: "var(--gh-green)" }}>{(h.confidence * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setActivityHistory(null)} className="mt-4 w-full py-2 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--gh-border)" }}>Close</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  isBackendConfigured,
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
} from "@/lib/environments";
import EmojiPicker from "@/components/EmojiPicker";
import { subscribePose, hasActivePose, getLatestPose } from "@/lib/poseBus";
import dynamic from "next/dynamic";

const EnvironmentViewer = dynamic(() => import("@/components/EnvironmentViewer"), { ssr: false });

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
  kitchen: "ðŸ³",
  living_room: "ðŸ›‹ï¸",
  bedroom: "ðŸ›ï¸",
  office: "ðŸ’»",
  patio: "â˜€ï¸",
  factory: "ðŸ­",
  clinic: "ðŸ¥",
  bathroom: "ðŸš¿",
  garage: "ðŸš—",
  home: "ðŸ ",
  other: "ðŸ“",
};

const ENV_ICONS: Record<string, string> = {
  home: "ðŸ ",
  work: "ðŸ¢",
  school: "ðŸŽ“",
  friend: "ðŸ‘‹",
  business: "ðŸ’¼",
  other: "ðŸ“",
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

  useEffect(() => {
    const stored = localStorage.getItem("echo_maps_user");
    if (!stored) { router.push("/auth/signin"); return; }
    setUser(JSON.parse(stored));
  }, [router]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (isBackendConfigured()) {
      try { await healthCheck(); setBackendOnline(true); } catch { setBackendOnline(false); }
    } else { setBackendOnline(false); }
    const envs = getEchoEnvironments();
    setEchoEnvs(envs);
    if (!selectedEnvId && envs.length > 0) setSelectedEnvId(envs[0].id);
    setLoading(false);
  }, [selectedEnvId]);

  const reloadRooms = useCallback(() => {
    if (!selectedEnvId) { setRooms([]); return; }
    const local = getRoomsForEnvironment(selectedEnvId);
    setRooms(local.map((e) => ({
      id: e.id, environmentId: e.environmentId, name: e.name, type: e.type,
      isCalibrated: e.isCalibrated, calibrationConfidence: e.calibrationConfidence, createdAt: e.createdAt,
    })));
  }, [selectedEnvId]);

  useEffect(() => { reloadRooms(); }, [reloadRooms, echoEnvs]);
  useEffect(() => { if (user) loadData(); }, [user, loadData]);

  const handleSignOut = () => { localStorage.removeItem("echo_maps_user"); router.push("/"); };

  const handleCreateEnv = (name: string, category: EnvCategory, emoji?: string) => {
    const env = createEchoEnvironment({ name, category, emoji });
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
                <span className="text-base">{env.emoji ?? ENV_ICONS[env.category] ?? "ðŸ“"}</span>
                <span className="flex-1 truncate text-left text-xs">{env.name}</span>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteEnv(env.id); }}
                  className="w-4 h-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/5" style={{ color: "var(--gh-text-muted)", fontSize: "10px" }}>âœ•</button>
              </button>
            ))}
            {echoEnvs.length === 0 && <p className="text-[10px] px-2 py-2" style={{ color: "var(--gh-text-muted)" }}>No environments yet</p>}
          </div>
        </div>

        <hr style={{ borderColor: "var(--gh-border)" }} />

        <nav className="flex-1 px-3 mt-2 space-y-0.5">
          {([
            { tab: "spaces" as const, label: "Rooms", icon: "ðŸ " },
            { tab: "cameras" as const, label: "Cameras", icon: "ðŸ“¹" },
            { tab: "automations" as const, label: "Automations", icon: "âš¡" },
            { tab: "presence" as const, label: "Presence", icon: "ðŸ‘¤" },
          ]).map(({ tab, label, icon }) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`sidebar-item w-full ${activeTab === tab ? "active" : ""}`}>
              <span className="text-lg">{icon}</span>{label}
            </button>
          ))}
        </nav>

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
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: "var(--gh-bg)" }}>
        <header className="sticky top-0 z-10 px-8 py-4 flex items-center justify-between" style={{ backgroundColor: "var(--gh-bg)", borderBottom: "1px solid var(--gh-border)" }}>
          <div>
            <h1 className="text-xl font-semibold">
              {activeTab === "spaces" ? (selectedEnv ? `${selectedEnv.emoji ?? ENV_ICONS[selectedEnv.category] ?? "ðŸ“"} ${selectedEnv.name}` : "Select an Environment")
                : activeTab === "cameras" ? "ðŸ“¹ Cameras"
                : activeTab === "automations" ? "âš¡ Automations"
                : "ðŸ‘¤ Presence Detection"}
            </h1>
            {activeTab === "spaces" && selectedEnv && (
              <p className="text-xs mt-0.5" style={{ color: "var(--gh-text-muted)" }}>
                {rooms.length} room{rooms.length !== 1 ? "s" : ""} Â· {rooms.filter((r) => r.isCalibrated).length} calibrated
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {activeTab === "spaces" && selectedEnvId && (
              <button onClick={() => setShowNewRoomModal(true)} className="btn-primary flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                Add Room
              </button>
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
            <button onClick={() => setError(null)} className="hover:opacity-70">âœ•</button>
          </div>
        )}

        <div className="p-8">
          {activeTab === "spaces" && (
            <RoomsView rooms={rooms} selectedEnvId={selectedEnvId} selectedEnv={selectedEnv ?? null} onAddEnv={() => setShowNewEnvModal(true)} onAddRoom={() => setShowNewRoomModal(true)} onDeleteRoom={handleDeleteRoom} />
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

/* â”€â”€ Rooms View â”€â”€ */
function RoomsView({ rooms, selectedEnvId, selectedEnv, onAddEnv, onAddRoom, onDeleteRoom }: {
  rooms: RoomCard[];
  selectedEnvId: string | null;
  selectedEnv: EchoEnvironment | null;
  onAddEnv: () => void;
  onAddRoom: () => void;
  onDeleteRoom: (id: string) => void;
}) {
  if (!selectedEnvId) {
    return (
      <div className="flex flex-col items-center justify-center py-20" style={{ color: "var(--gh-text-muted)" }}>
        <div className="text-6xl mb-4 opacity-30">ðŸ </div>
        <p className="text-lg mb-2">No environments yet</p>
        <p className="text-sm mb-6">Create your first environment to start mapping rooms</p>
        <button onClick={onAddEnv} className="btn-primary">Create Environment</button>
      </div>
    );
  }
  if (rooms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20" style={{ color: "var(--gh-text-muted)" }}>
        <div className="text-6xl mb-4 opacity-30">ðŸšª</div>
        <p className="text-lg mb-2">No rooms in {selectedEnv?.name}</p>
        <p className="text-sm mb-6">Add rooms to map and calibrate each space</p>
        <button onClick={onAddRoom} className="btn-primary">Add Room</button>
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
      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} className="mb-8">
          <h2 className="text-sm font-medium mb-3 capitalize" style={{ color: "var(--gh-text-muted)" }}>{type.replace("_", " ")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map((room) => (
              <div key={room.id} className="device-card group relative">
                <button onClick={(e) => { e.stopPropagation(); onDeleteRoom(room.id); }}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-white/10"
                  style={{ color: "var(--gh-text-muted)" }}>âœ•</button>
                <Link href={`/dashboard/env?id=${room.id}`} className="block">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{ROOM_ICONS[room.type] ?? "ðŸ“"}</span>
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

/* â”€â”€ Cameras View â”€â”€ */
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
  // Only clean up streams on actual unmount (navigation away), not on tab switch
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
        // pose estimation error â€” skip frame
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
        <div className="text-6xl mb-4 opacity-30">ðŸ“¹</div>
        <p className="text-lg mb-2">No cameras added yet</p>
        <p className="text-sm mb-4 text-center max-w-md">Add cameras from your device â€” including OBS Virtual Camera, DroidCam, or built-in webcams. Active cameras continuously improve Echo Vue&apos;s presence detection AI.</p>
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
              <span>{ROOM_ICONS[room?.type ?? "other"] ?? "ðŸ“"}</span>{room?.name ?? "Unknown Room"}
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
                          ðŸ§  {poseStats[cam.id]?.detected
                            ? `Pose detected Â· ${(poseStats[cam.id].confidence * 100).toFixed(0)}% Â· ${poseStats[cam.id].fps}fps`
                            : isModelLoaded() ? "Scanning for pose..." : "Loading AI model..."}
                        </div>
                      )}
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{cam.label}</p>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{isLive ? "Streaming Â· AI tuning" : "Inactive"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => isLive ? stopStream(cam.id) : startStream(cam)}
                          className="px-3 py-1.5 rounded-xl text-xs font-medium transition"
                          style={isLive ? { backgroundColor: "rgba(232,104,90,0.15)", color: "var(--gh-red)" } : { backgroundColor: "rgba(91,156,246,0.15)", color: "var(--gh-blue)" }}>
                          {isLive ? "â–  Stop" : "â–¶ Start"}
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
        <div className="flex items-center gap-3 mb-3"><span className="text-xl">ðŸ§ </span><h3 className="font-semibold">CSI AI Learning Engine</h3></div>
        <p className="text-xs mb-4" style={{ color: "var(--gh-text-muted)" }}>When cameras are active, Echo Vue correlates visual data with WiFi CSI signals to learn presence patterns â€” standing, sitting, walking, sleeping, device use, and more.</p>
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

/* â”€â”€ Add Camera Modal â”€â”€ */
function AddCameraModal({ rooms, selectedEnvId, onClose, onRoomCreated }: { rooms: RoomCard[]; selectedEnvId: string | null; onClose: () => void; onRoomCreated?: () => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [cameraEmoji, setCameraEmoji] = useState("ðŸ“¹");
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
          <button onClick={cleanup} style={{ color: "var(--gh-text-muted)" }}>âœ•</button>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm" style={{ color: "var(--gh-text-muted)" }}>Scanning for cameras...</div>
        ) : devices.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-2xl mb-2">ðŸ“¹</p>
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
                <p className="text-xs p-3 rounded-xl" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-yellow)" }}>No rooms yet â€” create a room first.</p>
              ) : (
                <select value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                  style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }}>
                  <option value="">Choose a room...</option>
                  {allRooms.map((r) => <option key={r.id} value={r.id}>{ROOM_ICONS[r.type] ?? "ðŸ“"} {r.name}</option>)}
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

/* â”€â”€ New Environment Modal â”€â”€ */
function NewEnvironmentModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, category: EnvCategory, emoji?: string) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<EnvCategory>("home");
  const [emoji, setEmoji] = useState("ðŸ ");
  const categories: { key: EnvCategory; label: string; icon: string }[] = [
    { key: "home", label: "Home", icon: "ðŸ " }, { key: "work", label: "Work", icon: "ðŸ¢" },
    { key: "school", label: "School", icon: "ðŸŽ“" }, { key: "friend", label: "Friend's Place", icon: "ðŸ‘‹" },
    { key: "business", label: "Business", icon: "ðŸ’¼" }, { key: "other", label: "Other", icon: "ðŸ“" },
  ];
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-md p-6" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">New Environment</h2>
          <button onClick={onClose} style={{ color: "var(--gh-text-muted)" }}>âœ•</button>
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

/* â”€â”€ New Room Modal â”€â”€ */
function NewRoomModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, type: string, dims: { width: number; length: number; height: number }, emoji?: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("living_room");
  const [emoji, setEmoji] = useState("ðŸ›‹ï¸");
  const [width, setWidth] = useState(5);
  const [length, setLength] = useState(4);
  const [height, setHeight] = useState(2.7);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const types = [
    { key: "kitchen", label: "Kitchen", icon: "ðŸ³" }, { key: "living_room", label: "Living Room", icon: "ðŸ›‹ï¸" },
    { key: "bedroom", label: "Bedroom", icon: "ðŸ›ï¸" }, { key: "office", label: "Office", icon: "ðŸ’»" },
    { key: "bathroom", label: "Bathroom", icon: "ðŸš¿" }, { key: "patio", label: "Patio", icon: "â˜€ï¸" },
    { key: "garage", label: "Garage", icon: "ðŸš—" }, { key: "other", label: "Other", icon: "ðŸ“" },
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
          <button onClick={onClose} style={{ color: "var(--gh-text-muted)" }}>âœ•</button>
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
/* â”€â”€ Automations View â”€â”€ */
function AutomationsView() {
  const automations = [
    { id: "1", name: "Lights off when room empty", trigger: "No presence for 5 min", action: "Turn off lights", space: "Living Room", enabled: true, icon: "ðŸ’¡" },
    { id: "2", name: "Lock door at night", trigger: "No activity after 11 PM", action: "Lock front door", space: "Patio", enabled: true, icon: "ðŸ”’" },
    { id: "3", name: "HVAC eco mode", trigger: "Space unoccupied 15 min", action: "Set thermostat to 68Â°F", space: "Office", enabled: false, icon: "â„ï¸" },
    { id: "4", name: "Alert: unusual activity", trigger: "Movement detected 2-5 AM", action: "Send notification", space: "All spaces", enabled: true, icon: "ðŸš¨" },
    { id: "5", name: "Welcome routine", trigger: "Person detected entering", action: "Lights on, play music", space: "Kitchen", enabled: false, icon: "ðŸŽµ" },
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
                <span style={{ color: "var(--gh-yellow)" }}>When:</span> {auto.trigger} &nbsp;Â·&nbsp;
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
          {[{ name: "Google Home", icon: "ðŸ " }, { name: "IFTTT", icon: "âš¡" }, { name: "SmartThings", icon: "ðŸ“±" }, { name: "Home Assistant", icon: "ðŸ¤–" }].map((i) => (
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

/* â”€â”€ Presence Detection View â”€â”€ */
function PresenceView() {
  const [entities, setEntities] = useState<TrackedEntity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("ðŸ‘¤");
  const [editLocation, setEditLocation] = useState("");
  const [tuningRF, setTuningRF] = useState<string | null>(null);
  const [rfProgress, setRfProgress] = useState(0);
  const [showAddEntity, setShowAddEntity] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");
  const [newEntityType, setNewEntityType] = useState<"person" | "pet">("person");
  const [newEntityEmoji, setNewEntityEmoji] = useState("ðŸ‘¤");
  const [liveKeypoints, setLiveKeypoints] = useState<number[][] | null>(null);
  const [poseLive, setPoseLive] = useState(false);
  const poseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load entities from localStorage
  useEffect(() => { setEntities(getEntities()); }, []);

  // Subscribe to poseBus for live skeletal data
  useEffect(() => {
    const unsub = subscribePose((frame) => {
      if (frame.isDetected && frame.keypoints3d.length >= 17) {
        setLiveKeypoints(frame.keypoints3d);
        setPoseLive(true);
        // Reset liveness timeout
        if (poseTimeoutRef.current) clearTimeout(poseTimeoutRef.current);
        poseTimeoutRef.current = setTimeout(() => setPoseLive(false), 3000);
      }
    });
    return () => { unsub(); if (poseTimeoutRef.current) clearTimeout(poseTimeoutRef.current); };
  }, []);

  const people = entities.filter((e) => e.type === "person");
  const pets = entities.filter((e) => e.type === "pet");
  const selected = entities.find((e) => e.id === selectedEntity);
  const activeCameras = getCameras().filter((c) => c.active).length;

  const handleAddEntity = () => {
    if (!newEntityName.trim()) return;
    createEntity({ name: newEntityName.trim(), type: newEntityType, emoji: newEntityEmoji, roomId: "", location: "Unassigned" });
    setEntities(getEntities());
    setNewEntityName("");
    setNewEntityEmoji(newEntityType === "person" ? "ðŸ‘¤" : "ðŸ¾");
    setShowAddEntity(false);
  };

  const handleDeleteEntity = (id: string) => {
    if (!confirm("Remove this entity?")) return;
    deleteEntity(id);
    setEntities(getEntities());
    if (selectedEntity === id) setSelectedEntity(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>Tracked entities across all environments. Tune RF signatures, manage profiles, and view live detection.</p>
        <button onClick={() => setShowAddEntity(true)} className="btn-primary flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          Add Entity
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* People */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span>ðŸ‘¤</span> People <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(91,156,246,0.12)", color: "var(--gh-blue)" }}>{people.length}</span>
            </h3>
            {people.length === 0 ? (
              <p className="text-xs p-4 rounded-xl text-center" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>No people added yet. Click &quot;Add Entity&quot; to register a person.</p>
            ) : (
              <div className="space-y-2">
                {people.map((p) => (
                  <button key={p.id} onClick={() => setSelectedEntity(p.id)} className={`device-card w-full text-left flex items-center gap-4 ${selectedEntity === p.id ? "ring-1" : ""}`} style={selectedEntity === p.id ? { borderColor: "var(--gh-blue)" } : {}}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ backgroundColor: p.status === "active" ? "rgba(94,187,127,0.12)" : "rgba(139,143,154,0.12)" }}>
                      {p.emoji || "ðŸ‘¤"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm">{p.name}</h4>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>{p.rfSignature}</span>
                        {p.deviceTetherStatus === "tethered" && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(91,156,246,0.12)", color: "var(--gh-blue)" }}>ðŸ“± BLE</span>}
                        {p.deviceTetherStatus === "awaiting_new_mac" && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(245,197,66,0.12)", color: "var(--gh-yellow)" }}>ðŸ“± Scanning</span>}
                      </div>
                      <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{p.location} Â· {p.activity} Â· {p.lastSeen}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium" style={{ color: p.confidence > 0.5 ? "var(--gh-green)" : "var(--gh-text-muted)" }}>
                        {p.confidence > 0 ? `${(p.confidence * 100).toFixed(0)}%` : "â€”"}
                      </p>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteEntity(p.id); }} className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-50 hover:!opacity-100" style={{ color: "var(--gh-text-muted)", fontSize: "10px" }}>âœ•</button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Pets */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span>ðŸ¾</span> Pets <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(245,197,66,0.12)", color: "var(--gh-yellow)" }}>{pets.length}</span>
            </h3>
            {pets.length === 0 ? (
              <p className="text-xs p-4 rounded-xl text-center" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>No pets added yet.</p>
            ) : (
              <div className="space-y-2">
                {pets.map((p) => (
                  <button key={p.id} onClick={() => setSelectedEntity(p.id)} className={`device-card w-full text-left flex items-center gap-4 ${selectedEntity === p.id ? "ring-1" : ""}`} style={selectedEntity === p.id ? { borderColor: "var(--gh-yellow)" } : {}}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ backgroundColor: "rgba(245,197,66,0.12)" }}>
                      {p.emoji || "ðŸ¾"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm">{p.name}</h4>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>{p.rfSignature}</span>
                        {p.deviceTetherStatus === "tethered" && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(91,156,246,0.12)", color: "var(--gh-blue)" }}>ðŸ“± BLE</span>}
                      </div>
                      <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>{p.location} Â· {p.activity} Â· {p.lastSeen}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium" style={{ color: "var(--gh-yellow)" }}>{p.confidence > 0 ? `${(p.confidence * 100).toFixed(0)}%` : "â€”"}</p>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteEntity(p.id); }} className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-50 hover:!opacity-100" style={{ color: "var(--gh-text-muted)", fontSize: "10px" }}>âœ•</button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Detail Panel */}
        <div>
          {selected ? (
            <div className="rounded-2xl p-5 sticky top-20 space-y-4" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
              <div className="text-center mb-4">
                <div className="text-4xl mb-2">{selected.emoji || "ðŸ‘¤"}</div>
                <h3 className="font-bold text-lg">{selected.name}</h3>
                <p className="text-xs font-mono" style={{ color: "var(--gh-text-muted)" }}>{selected.rfSignature}</p>
                <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full" style={{
                  backgroundColor: selected.status === "active" ? "rgba(94,187,127,0.12)" : "rgba(139,143,154,0.12)",
                  color: selected.status === "active" ? "var(--gh-green)" : "var(--gh-text-muted)",
                }}>{selected.status === "active" ? "â— Active" : "â—‹ Away"}</span>
              </div>

              {/* Live Skeletal Viewer */}
              {poseLive && liveKeypoints && liveKeypoints.length >= 17 && (
                <div className="rounded-xl overflow-hidden" style={{ height: 220 }}>
                  <EnvironmentViewer
                    skeleton={liveKeypoints}
                    roomBounds={[5, 4, 2.7]}
                    sourceType="camera"
                    isLive={true}
                  />
                </div>
              )}
              {!poseLive && (
                <div className="rounded-xl p-4 text-center" style={{ backgroundColor: "var(--gh-card)", height: 100 }}>
                  <p className="text-2xl mb-1 opacity-30">ðŸ¦´</p>
                  <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>{activeCameras > 0 ? "Waiting for pose detection..." : "Start a camera to see live skeleton"}</p>
                </div>
              )}

              <div className="space-y-3 text-sm">
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Location</span><span className="font-medium" style={{ color: "var(--gh-text)" }}>{selected.location}</span></div>
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Activity</span><span className="font-medium" style={{ color: "var(--gh-text)" }}>{selected.activity}</span></div>
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Last Seen</span><span>{selected.lastSeen}</span></div>
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Confidence</span><span>{selected.confidence > 0 ? `${(selected.confidence * 100).toFixed(0)}%` : "â€”"}</span></div>

                {/* BLE Tether Status */}
                <hr style={{ borderColor: "var(--gh-border)" }} />
                <h4 className="font-semibold text-xs" style={{ color: "var(--gh-text-muted)" }}>BLE DEVICE TETHER</h4>
                <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
                  <span>Status</span>
                  <span className="font-medium" style={{ color: selected.deviceTetherStatus === "tethered" ? "var(--gh-green)" : selected.deviceTetherStatus === "awaiting_new_mac" ? "var(--gh-yellow)" : "var(--gh-text-muted)" }}>
                    {selected.deviceTetherStatus === "tethered" ? "ðŸ“± Tethered" : selected.deviceTetherStatus === "awaiting_new_mac" ? "ðŸ” Scanning" : "Not connected"}
                  </span>
                </div>
                {selected.deviceMacSuffix && (
                  <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>MAC Suffix</span><span className="font-mono text-xs">{selected.deviceMacSuffix}</span></div>
                )}
                {selected.deviceRssi != null && (
                  <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>RSSI</span><span>{selected.deviceRssi} dBm</span></div>
                )}
                {selected.deviceDistanceM != null && (
                  <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}><span>Distance</span><span>{selected.deviceDistanceM.toFixed(1)} m</span></div>
                )}

                {selected.status === "active" && selected.breathingRate != null && (
                  <>
                    <hr style={{ borderColor: "var(--gh-border)" }} />
                    <h4 className="font-semibold text-xs" style={{ color: "var(--gh-text-muted)" }}>VITALS</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-lg text-center" style={{ backgroundColor: "var(--gh-card)" }}>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Breathing</p>
                        <p className="text-base font-bold" style={{ color: "var(--gh-blue)" }}>{selected.breathingRate?.toFixed(1) ?? "â€”"}</p>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>bpm</p>
                      </div>
                      <div className="p-2 rounded-lg text-center" style={{ backgroundColor: "var(--gh-card)" }}>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>Heart Rate</p>
                        <p className="text-base font-bold" style={{ color: "var(--gh-red)" }}>{selected.heartRate ?? "â€”"}</p>
                        <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>bpm</p>
                      </div>
                    </div>
                  </>
                )}
                <hr style={{ borderColor: "var(--gh-border)" }} />
                <div className="space-y-2">
                  <button onClick={() => { setEditName(selected.name); setEditLocation(selected.location); setEditEmoji(selected.emoji || "ðŸ‘¤"); setEditingProfile(selected.id); }} className="w-full py-2 rounded-xl text-xs font-medium transition hover:opacity-90" style={{ backgroundColor: "var(--gh-card)" }}>Edit Profile</button>
                  <button onClick={() => { setRfProgress(0); setTuningRF(selected.id); }} className="w-full py-2 rounded-xl text-xs font-medium transition hover:opacity-90" style={{ backgroundColor: "var(--gh-card)" }}>Tune RF Signature</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
              <div className="text-4xl mb-3 opacity-30">ðŸ‘¤</div>
              <p className="text-sm" style={{ color: "var(--gh-text-muted)" }}>Select an entity to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* Edit Profile Modal */}
      {editingProfile && (() => {
        const entity = entities.find((e) => e.id === editingProfile);
        if (!entity) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingProfile(null)}>
            <div className="rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-4">Edit Profile â€” {entity.name}</h3>
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
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--gh-text-muted)" }}>Assigned Location</label>
                  <input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm bg-transparent border outline-none focus:ring-1" style={{ borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--gh-text-muted)" }}>Entity Type</label>
                  <p className="text-sm capitalize">{entity.type}</p>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--gh-text-muted)" }}>RF Signature</label>
                  <p className="text-sm font-mono">{entity.rfSignature}</p>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setEditingProfile(null)} className="flex-1 py-2 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--gh-border)" }}>Cancel</button>
                <button onClick={() => {
                  updateEntityStorage(editingProfile, { name: editName, location: editLocation, emoji: editEmoji });
                  setEntities(getEntities());
                  setEditingProfile(null);
                }} className="flex-1 py-2 rounded-xl text-sm font-medium btn-primary">Save Changes</button>
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
              <h3 className="text-lg font-semibold mb-1">Tune RF Signature</h3>
              <p className="text-xs mb-4" style={{ color: "var(--gh-text-muted)" }}>{entity.name} â€” {entity.rfSignature}</p>
              <div className="p-4 rounded-xl mb-4" style={{ backgroundColor: "var(--gh-card)" }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl" style={{ backgroundColor: "rgba(124,140,248,0.12)" }}>ðŸ“¡</div>
                  <div>
                    <p className="text-sm font-medium">WiFi CSI Signal</p>
                    <p className="text-[10px]" style={{ color: "var(--gh-text-muted)" }}>
                      {poseLive ? "Camera active â€” correlating pose with RF" : "Capturing RF patterns for"} {entity.name}
                    </p>
                  </div>
                </div>
                {poseLive && (
                  <div className="mb-2 p-2 rounded-lg text-[10px] flex items-center gap-1.5" style={{ backgroundColor: "rgba(94,187,127,0.08)", color: "var(--gh-green)" }}>
                    âœ“ Camera pose data flowing â€” AI correlating visual + RF signals
                  </div>
                )}
                <div className="w-full rounded-full h-2 mb-1" style={{ backgroundColor: "var(--gh-border)" }}>
                  <div className="h-2 rounded-full transition-all duration-300" style={{ width: `${rfProgress}%`, backgroundColor: rfProgress >= 100 ? "var(--gh-green)" : "var(--gh-accent)" }} />
                </div>
                <p className="text-[10px] text-right" style={{ color: "var(--gh-text-muted)" }}>{rfProgress}%</p>
              </div>
              {rfProgress >= 100 && (
                <div className="p-3 rounded-xl mb-4 text-sm flex items-center gap-2" style={{ backgroundColor: "rgba(94,187,127,0.1)", color: "var(--gh-green)" }}>
                  âœ“ RF signature tuned successfully. Confidence improved.
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setTuningRF(null)} className="flex-1 py-2 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--gh-border)" }} disabled={isRunning}>{rfProgress >= 100 ? "Done" : "Cancel"}</button>
                {rfProgress < 100 && (
                  <button onClick={() => {
                    setRfProgress(1);
                    let p = 0;
                    const iv = setInterval(() => { p += Math.random() * 8 + 2; if (p >= 100) { p = 100; clearInterval(iv); updateEntityStorage(entity.id, { confidence: Math.min(1, entity.confidence + 0.15) }); setEntities(getEntities()); } setRfProgress(Math.round(p)); }, 200);
                  }} className="flex-1 py-2 rounded-xl text-sm font-medium btn-primary" disabled={isRunning}>{isRunning ? "Tuningâ€¦" : "Start Tuning"}</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add Entity Modal */}
      {showAddEntity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddEntity(false)}>
          <div className="rounded-2xl p-6 w-full max-w-md" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Add Entity</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Entity Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {([{ key: "person" as const, label: "Person", icon: "ðŸ‘¤" }, { key: "pet" as const, label: "Pet", icon: "ðŸ¾" }]).map((t) => (
                    <button key={t.key} type="button" onClick={() => { setNewEntityType(t.key); setNewEntityEmoji(t.icon); }}
                      className="p-3 rounded-xl text-center text-xs transition"
                      style={{ backgroundColor: newEntityType === t.key ? "rgba(91,156,246,0.12)" : "var(--gh-card)", border: newEntityType === t.key ? "1px solid var(--gh-blue)" : "1px solid var(--gh-border)", color: newEntityType === t.key ? "var(--gh-blue)" : "var(--gh-text-muted)" }}>
                      <div className="text-2xl mb-1">{t.icon}</div>{t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--gh-text-muted)" }}>Name</label>
                <input value={newEntityName} onChange={(e) => setNewEntityName(e.target.value)} placeholder={newEntityType === "person" ? "e.g. John" : "e.g. Max"} className="w-full px-3 py-2.5 rounded-xl text-sm bg-transparent border outline-none focus:ring-1" style={{ borderColor: "var(--gh-border)", color: "var(--gh-text)" }} maxLength={60} autoFocus />
              </div>
              <EmojiPicker selected={newEntityEmoji} onSelect={setNewEntityEmoji} label="Avatar" />
              <div className="flex gap-2">
                <button onClick={() => setShowAddEntity(false)} className="flex-1 py-2 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--gh-border)" }}>Cancel</button>
                <button onClick={handleAddEntity} disabled={!newEntityName.trim()} className="flex-1 py-2 rounded-xl text-sm font-medium btn-primary disabled:opacity-50">Add Entity</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Detection Engine */}
      <div className="mt-8 p-5 rounded-2xl" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
        <div className="flex items-center gap-3 mb-3"><span className="text-xl">ðŸ§ </span><h3 className="font-semibold">AI Detection Engine</h3></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Entities Tracked", value: entities.length > 0 ? `${entities.filter((e) => e.status === "active").length} active / ${entities.length}` : "0", color: entities.length > 0 ? "var(--gh-green)" : "var(--gh-text-muted)" },
            { label: "RF Signatures", value: `${entities.length} stored`, color: "var(--gh-blue)" },
            { label: "Camera Feeds", value: activeCameras > 0 ? `${activeCameras} active` : "None", color: activeCameras > 0 ? "var(--gh-green)" : "var(--gh-text-muted)" },
            { label: "Pose Stream", value: poseLive ? "Live" : "Inactive", color: poseLive ? "var(--gh-green)" : "var(--gh-text-muted)" },
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

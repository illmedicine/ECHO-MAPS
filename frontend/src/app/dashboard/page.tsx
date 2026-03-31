"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  isBackendConfigured,
  listEnvironments,
  createEnvironment,
  deleteEnvironment,
  healthCheck,
  EnvironmentOut,
} from "@/lib/api";
import {
  getEnvironments,
  createEnvironment as createLocalEnv,
  deleteEnvironment as deleteLocalEnv,
  ENV_TYPE_ICONS,
  Environment,
} from "@/lib/environments";

interface UserData {
  id: string;
  email: string;
  name: string;
  picture: string;
  apiToken?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [environments, setEnvironments] = useState<EnvironmentCard[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Normalized card type for both API and local environments
  interface EnvironmentCard {
    id: string;
    name: string;
    type: string;
    isCalibrated: boolean;
    calibrationConfidence: number;
    createdAt: string;
  }

  // Check auth
  useEffect(() => {
    const stored = localStorage.getItem("echo_maps_user");
    if (!stored) {
      router.push("/auth/signin");
      return;
    }
    setUser(JSON.parse(stored));
  }, [router]);

  // Check backend & load environments
  const loadEnvironments = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (isBackendConfigured()) {
      try {
        await healthCheck();
        setBackendOnline(true);
        const envs = await listEnvironments();
        setEnvironments(
          envs.map((e) => ({
            id: e.id,
            name: e.name,
            type: "other",
            isCalibrated: e.is_calibrated,
            calibrationConfidence: e.calibration_confidence,
            createdAt: e.created_at,
          }))
        );
      } catch {
        setBackendOnline(false);
        // Fall back to local storage
        loadLocalEnvironments();
      }
    } else {
      setBackendOnline(false);
      loadLocalEnvironments();
    }
    setLoading(false);
  }, []);

  const loadLocalEnvironments = () => {
    const local = getEnvironments();
    setEnvironments(
      local.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        isCalibrated: e.isCalibrated,
        calibrationConfidence: e.calibrationConfidence,
        createdAt: e.createdAt,
      }))
    );
  };

  useEffect(() => {
    if (user) loadEnvironments();
  }, [user, loadEnvironments]);

  const handleSignOut = () => {
    localStorage.removeItem("echo_maps_user");
    router.push("/");
  };

  const handleCreateEnvironment = async (name: string, type: string, dims: { width: number; length: number; height: number }) => {
    setError(null);
    try {
      if (backendOnline) {
        await createEnvironment(name);
      } else {
        createLocalEnv({ name, type: type as Environment["type"], dimensions: dims });
      }
      await loadEnvironments();
      setShowNewModal(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create environment");
    }
  };

  const handleDeleteEnvironment = async (id: string) => {
    if (!confirm("Delete this environment? This cannot be undone.")) return;
    setError(null);
    try {
      if (backendOnline) {
        await deleteEnvironment(id);
      } else {
        deleteLocalEnv(id);
      }
      await loadEnvironments();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete environment");
    }
  };

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 max-w-5xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-[var(--illy-blue)] to-[var(--illy-green)] bg-clip-text text-transparent">
            Echo Maps
          </h1>
          <p className="text-sm text-gray-500">Dashboard</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Backend status indicator */}
          <div className="flex items-center gap-1.5" title={backendOnline ? "Backend connected" : "Demo mode (local storage)"}>
            <span className={`w-2 h-2 rounded-full ${backendOnline ? "bg-[var(--illy-green)] animate-pulse" : "bg-yellow-500"}`} />
            <span className="text-xs text-gray-500">{backendOnline ? "Live" : "Demo"}</span>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-gray-500">{user.email}</p>
          </div>
          {user.picture && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.picture}
              alt={user.name}
              className="w-9 h-9 rounded-full"
              referrerPolicy="no-referrer"
            />
          )}
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-500 hover:text-white transition px-3 py-1 border border-gray-700 rounded"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="max-w-5xl mx-auto mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Environments Grid */}
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Your Environments</h2>
          <button
            onClick={() => setShowNewModal(true)}
            className="px-4 py-2 bg-[var(--illy-blue)] rounded-lg text-sm font-semibold hover:opacity-90 transition"
          >
            + New Environment
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-[var(--illy-blue)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {environments.map((env) => (
              <div
                key={env.id}
                className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800 hover:border-gray-600 transition group relative"
              >
                {/* Delete button */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteEnvironment(env.id); }}
                  className="absolute top-3 right-3 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition text-sm"
                  title="Delete environment"
                >
                  ✕
                </button>

                <Link href={`/dashboard/${env.id}`} className="block">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-2xl">{ENV_TYPE_ICONS[env.type as keyof typeof ENV_TYPE_ICONS] ?? "📍"}</span>
                    <div>
                      <h3 className="font-semibold">{env.name}</h3>
                      <p className="text-xs text-gray-500">
                        {new Date(env.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {/* Calibration status */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>{env.isCalibrated ? "Calibrated" : "Needs calibration"}</span>
                      <span>{(env.calibrationConfidence * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${env.calibrationConfidence * 100}%`,
                          backgroundColor: env.isCalibrated ? "var(--illy-green)" : "var(--illy-blue)",
                        }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-xs">
                    {env.isCalibrated ? (
                      <>
                        <span className="w-1.5 h-1.5 bg-[var(--illy-green)] rounded-full" />
                        <span className="text-[var(--illy-green)]">Live</span>
                      </>
                    ) : (
                      <>
                        <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                        <span className="text-yellow-500">Setup required</span>
                      </>
                    )}
                  </div>
                </Link>
              </div>
            ))}

            {/* Add new card */}
            <button
              onClick={() => setShowNewModal(true)}
              className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800 border-dashed flex flex-col items-center justify-center min-h-[180px] text-gray-500 hover:border-gray-600 hover:text-gray-400 transition cursor-pointer"
            >
              <span className="text-3xl mb-2">+</span>
              <p className="text-sm">Add environment</p>
            </button>
          </div>
        )}

        {/* Quick Info */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
          <InfoCard title="Subscription" value="Personal" detail="2 places included" />
          <InfoCard
            title="Environments"
            value={`${environments.length}`}
            detail={`${Math.max(0, 2 - environments.length)} remaining`}
          />
          <InfoCard
            title="Backend"
            value={backendOnline ? "Connected" : "Demo Mode"}
            detail={backendOnline ? "Live API connected" : "Using local storage"}
          />
        </div>
      </div>

      {/* New Environment Modal */}
      {showNewModal && (
        <NewEnvironmentModal
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreateEnvironment}
        />
      )}
    </main>
  );
}

// ── Modal Component ──

function NewEnvironmentModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, type: string, dims: { width: number; length: number; height: number }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("home");
  const [width, setWidth] = useState(5);
  const [length, setLength] = useState(4);
  const [height, setHeight] = useState(2.7);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    await onCreate(name.trim(), type, { width, length, height });
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[var(--illy-surface)] rounded-xl border border-gray-700 w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">New Environment</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Living Room, Office"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-[var(--illy-blue)] focus:outline-none"
              maxLength={100}
              required
              autoFocus
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Type</label>
            <div className="grid grid-cols-4 gap-2">
              {(["home", "office", "clinic", "other"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`p-2 rounded-lg border text-center text-sm transition ${
                    type === t
                      ? "border-[var(--illy-blue)] bg-[var(--illy-blue)]/10 text-white"
                      : "border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <div className="text-xl mb-0.5">{ENV_TYPE_ICONS[t]}</div>
                  <div className="capitalize">{t}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Dimensions */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Room Dimensions (meters)</label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-500">Width</label>
                <input
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  min={1}
                  max={50}
                  step={0.1}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:border-[var(--illy-blue)] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Length</label>
                <input
                  type="number"
                  value={length}
                  onChange={(e) => setLength(Number(e.target.value))}
                  min={1}
                  max={50}
                  step={0.1}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:border-[var(--illy-blue)] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Height</label>
                <input
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  min={1}
                  max={10}
                  step={0.1}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:border-[var(--illy-blue)] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="w-full py-2.5 bg-[var(--illy-blue)] rounded-lg font-semibold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating..." : "Create Environment"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Info Card ──

function InfoCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="p-4 bg-[var(--illy-surface)] rounded-lg border border-gray-800">
      <p className="text-xs text-gray-500 mb-1">{title}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{detail}</p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface UserData {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("echo_maps_user");
    if (!stored) {
      router.push("/auth/signin");
      return;
    }
    setUser(JSON.parse(stored));
  }, [router]);

  const handleSignOut = () => {
    localStorage.removeItem("echo_maps_user");
    router.push("/");
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

      {/* Environments Grid */}
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Your Environments</h2>
          <button className="px-4 py-2 bg-[var(--illy-blue)] rounded-lg text-sm font-semibold hover:opacity-90 transition">
            + New Environment
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Placeholder cards — will connect to API when backend is running */}
          <div className="p-6 bg-[var(--illy-surface)] rounded-xl border border-gray-800 border-dashed flex flex-col items-center justify-center min-h-[180px] text-gray-500 hover:border-gray-600 transition cursor-pointer">
            <span className="text-3xl mb-2">🏠</span>
            <p className="text-sm">Add your first environment</p>
            <p className="text-xs mt-1">Connect an Illy Bridge to get started</p>
          </div>
        </div>

        {/* Quick Info */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
          <InfoCard title="Subscription" value="Personal" detail="2 places included" />
          <InfoCard title="Connected Bridges" value="0" detail="No devices found" />
          <InfoCard title="Uptime" value="—" detail="Start monitoring to track" />
        </div>
      </div>
    </main>
  );
}

function InfoCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="p-4 bg-[var(--illy-surface)] rounded-lg border border-gray-800">
      <p className="text-xs text-gray-500 mb-1">{title}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{detail}</p>
    </div>
  );
}

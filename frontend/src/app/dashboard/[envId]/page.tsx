"use client";

import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import CalibrationPanel from "@/components/CalibrationPanel";
import VitalsMonitor from "@/components/VitalsMonitor";

// EnvironmentViewer uses Three.js — must be client-only
const EnvironmentViewer = dynamic(() => import("@/components/EnvironmentViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[600px] bg-[var(--illy-surface)] rounded-xl flex items-center justify-center text-gray-500">
      Loading 3D viewer...
    </div>
  ),
});

// Required for static export with dynamic routes
export function generateStaticParams() {
  return [{ envId: "demo" }];
}

export default function DashboardPage() {
  const params = useParams();
  // In production, token comes from auth context
  const token = "";
  const envId = (params?.envId as string) || "demo";

  return (
    <div className="min-h-screen p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Environment Dashboard</h1>
          <p className="text-gray-400 text-sm">ID: {envId}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-[var(--illy-green)] rounded-full animate-pulse" />
          <span className="text-sm text-gray-400">Connected</span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 3D Viewer — Main panel */}
        <div className="lg:col-span-2">
          <EnvironmentViewer />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <CalibrationPanel environmentId={envId} token={token} />
          <VitalsMonitor environmentId={envId} token={token} isLive={false} />
        </div>
      </div>
    </div>
  );
}

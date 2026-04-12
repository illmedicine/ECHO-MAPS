"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import RoomScanner from "@/components/RoomScanner";
import { getEnvironments, getEchoEnvironments, type Environment } from "@/lib/environments";
import type { GeneratedFloorPlan } from "@/lib/roomScanApi";

export default function ScanPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const envId = searchParams.get("env");
  const [rooms, setRooms] = useState<Environment[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Environment | null>(null);
  const [completedPlan, setCompletedPlan] = useState<GeneratedFloorPlan | null>(null);

  useEffect(() => {
    const allRooms = getEnvironments();
    setRooms(allRooms);
    if (envId) {
      const match = allRooms.find((r) => r.id === envId);
      if (match) setSelectedRoom(match);
    }
  }, [envId]);

  const handleComplete = (plan: GeneratedFloorPlan) => {
    setCompletedPlan(plan);
  };

  const handleCancel = () => {
    setSelectedRoom(null);
    setCompletedPlan(null);
  };

  const handleDone = () => {
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-gray-400 hover:text-white text-sm"
          >
            ← Dashboard
          </button>
          <h1 className="text-sm font-medium">Room Scanner</h1>
          <div className="w-16" /> {/* spacer */}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Room selection */}
        {!selectedRoom && (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <div className="text-3xl mb-2">🏠</div>
              <h2 className="text-lg font-semibold">Select a Room to Scan</h2>
              <p className="text-gray-400 text-sm mt-1">
                Choose which room you want to visually map with your phone camera.
                This enhances calibration by mapping furniture and room dimensions to CSI data.
              </p>
            </div>

            {rooms.length === 0 ? (
              <div className="bg-gray-800/50 rounded-xl p-6 text-center">
                <p className="text-gray-400 text-sm">
                  No rooms created yet. Go to the dashboard to add rooms first.
                </p>
                <button
                  onClick={() => router.push("/dashboard")}
                  className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm"
                >
                  Go to Dashboard
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => setSelectedRoom(room)}
                    className="flex items-center gap-3 bg-gray-800/50 hover:bg-gray-800 rounded-xl p-4 text-left transition-colors w-full"
                  >
                    <span className="text-2xl">{room.emoji ?? "🏠"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-medium">{room.name}</div>
                      <div className="text-gray-400 text-xs">
                        {room.type.replace("_", " ")} · {room.dimensions.width}m × {room.dimensions.length}m
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xs font-medium ${
                        room.calibrationConfidence >= 1 ? "text-green-400" :
                        room.calibrationConfidence >= 0.7 ? "text-yellow-400" : "text-orange-400"
                      }`}>
                        {(room.calibrationConfidence * 100).toFixed(0)}%
                      </div>
                      <div className="text-gray-500 text-xs">calibrated</div>
                    </div>
                    <span className="text-gray-600">→</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Active scanner */}
        {selectedRoom && !completedPlan && (
          <RoomScanner
            environmentId={selectedRoom.id}
            roomName={selectedRoom.name}
            onComplete={handleComplete}
            onCancel={handleCancel}
          />
        )}

        {/* Completed state */}
        {completedPlan && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-4xl mb-2">🎉</div>
              <h2 className="text-lg font-semibold">Floor Plan Generated!</h2>
              <p className="text-gray-400 text-sm mt-1">
                The visual scan data has been cross-analysed with CSI data.
                {completedPlan.is_fully_mapped
                  ? " All objects and dimensions mapped successfully — calibration at 100%!"
                  : " Partial mapping complete. Run another scan to improve accuracy."}
              </p>
            </div>

            {/* Summary card */}
            <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-700/30 rounded-lg p-3">
                  <div className="text-gray-400 text-xs">Room Size</div>
                  <div className="text-white font-medium">
                    {completedPlan.room_width}m × {completedPlan.room_length}m
                  </div>
                </div>
                <div className="bg-gray-700/30 rounded-lg p-3">
                  <div className="text-gray-400 text-xs">Objects Found</div>
                  <div className="text-white font-medium">{completedPlan.objects.length}</div>
                </div>
                <div className="bg-gray-700/30 rounded-lg p-3">
                  <div className="text-gray-400 text-xs">Scan Confidence</div>
                  <div className={`font-medium ${
                    completedPlan.scan_confidence >= 0.95 ? "text-green-400" : "text-yellow-400"
                  }`}>
                    {(completedPlan.scan_confidence * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="bg-gray-700/30 rounded-lg p-3">
                  <div className="text-gray-400 text-xs">Calibration</div>
                  <div className={`font-medium ${
                    completedPlan.is_fully_mapped ? "text-green-400" : "text-yellow-400"
                  }`}>
                    {completedPlan.is_fully_mapped ? "100%" : "Partial"}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setCompletedPlan(null);
                  setSelectedRoom(null);
                }}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
              >
                Scan Another Room
              </button>
              <button
                onClick={handleDone}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

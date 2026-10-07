"use client";

/**
 * HotelSetupModal — bulk-generate a hotel/motel's rooms + floor plan into an
 * environment, so an operator never has to add rooms one at a time.
 */

import { useMemo, useState } from "react";
import { saveFloorPlan, updateEchoEnvironment } from "@/lib/environments";
import { generateHotel, DEFAULT_HOTEL, type HotelConfig } from "@/lib/hotelSetup";

interface Props {
  environmentId: string;
  environmentName: string;
  defaultAddress?: string;
  onClose: () => void;
  onComplete: () => void;
}

export default function HotelSetupModal({ environmentId, environmentName, defaultAddress, onClose, onComplete }: Props) {
  const [cfg, setCfg] = useState<HotelConfig>(DEFAULT_HOTEL);
  const [address, setAddress] = useState(defaultAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const preview = useMemo(() => generateHotel(cfg), [cfg]);
  const totalRooms = preview.rooms.length;

  const set = (patch: Partial<HotelConfig>) => setCfg((c) => ({ ...c, ...patch }));

  const handleGenerate = async () => {
    setBusy(true);
    setProgress(10);
    // Let the spinner paint before the synchronous room creation runs.
    await new Promise((res) => setTimeout(res, 30));
    const { floorPlan } = generateHotel(cfg);
    // saveFloorPlan is the single source of truth — it creates one Environment
    // room per plan room, so every floor + amenity is generated in one step.
    saveFloorPlan(environmentId, floorPlan.width, floorPlan.height, floorPlan.rooms);
    if (address.trim()) updateEchoEnvironment(environmentId, { address: address.trim() });
    setProgress(100);
    setBusy(false);
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.4)" }} onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-lg rounded-2xl p-5 md:p-6" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold flex items-center gap-2">🏨 Auto-Setup Hotel</h2>
          {!busy && <button onClick={onClose} className="text-sm" style={{ color: "var(--gh-text-muted)" }}>✕</button>}
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--gh-text-muted)" }}>
          Generates every guest room and the amenities for <strong>{environmentName}</strong> in one step, plus a motel floor plan. Set the real counts below.
        </p>

        {busy ? (
          <div className="py-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 relative">
              <div className="absolute inset-0 border-4 rounded-full" style={{ borderColor: "var(--gh-border)" }} />
              <div className="absolute inset-0 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--gh-blue)", borderTopColor: "transparent" }} />
            </div>
            <p className="text-sm font-medium">Creating {totalRooms} rooms… {progress}%</p>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <Field label="Floors">
                <NumberInput value={cfg.floors} min={1} max={20} onChange={(v) => set({ floors: v })} />
              </Field>
              <Field label="Guest rooms per floor">
                <NumberInput value={cfg.roomsPerFloor} min={1} max={200} onChange={(v) => set({ roomsPerFloor: v })} />
              </Field>
              <Field label="Accessible rooms per floor">
                <NumberInput value={cfg.accessiblePerFloor} min={0} max={10} onChange={(v) => set({ accessiblePerFloor: v })} />
              </Field>
              <Field label="Address">
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street, City, ST"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={cfg.includeAmenities} onChange={(e) => set({ includeAmenities: e.target.checked })} />
                Include amenities (pool, laundry, terrace, deli, vending, lobby, elevator, stairwell)
              </label>
            </div>

            <div className="mt-4 p-3 rounded-xl text-sm" style={{ backgroundColor: "var(--gh-card)" }}>
              Will create <strong>{preview.summary.guestRooms}</strong> guest rooms
              {preview.summary.amenities > 0 && <> + <strong>{preview.summary.amenities}</strong> amenity spaces</>} across{" "}
              <strong>{preview.summary.floors}</strong> floor{preview.summary.floors !== 1 ? "s" : ""} = <strong>{totalRooms}</strong> rooms total.
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm" style={{ backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}>Cancel</button>
              <button onClick={handleGenerate} className="btn-primary px-5 py-2">Generate {totalRooms} Rooms</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm" style={{ color: "var(--gh-text)" }}>{label}</label>
      <div className="w-40">{children}</div>
    </div>
  );
}

function NumberInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const v = parseInt(e.target.value, 10);
        if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
      className="w-full px-3 py-2 rounded-xl text-sm outline-none text-right"
      style={{ backgroundColor: "var(--gh-card)", border: "1px solid var(--gh-border)", color: "var(--gh-text)" }}
    />
  );
}

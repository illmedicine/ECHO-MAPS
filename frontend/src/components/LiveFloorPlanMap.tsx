"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { FloorPlan, FloorPlanRoom, Environment, TrackedEntity } from "@/lib/environments";

const ROOM_COLORS: Record<string, string> = {
  kitchen: "#f59e0b",
  living_room: "#3b82f6",
  bedroom: "#8b5cf6",
  bathroom: "#06b6d4",
  office: "#10b981",
  garage: "#6b7280",
  patio: "#84cc16",
  other: "#ec4899",
};

const ENTITY_COLORS = {
  person: "#5b9cf6",
  pet: "#f5c542",
  visitor: "#a78bfa",
};

interface LiveFloorPlanMapProps {
  floorPlan: FloorPlan;
  rooms: Environment[];
  entities: TrackedEntity[];
  /** Currently selected room id */
  selectedRoomId?: string | null;
  onSelectRoom?: (roomId: string | null) => void;
}

interface AvatarPos {
  entityId: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

export default function LiveFloorPlanMap({ floorPlan, rooms, entities, selectedRoomId, onSelectRoom }: LiveFloorPlanMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const avatarPosRef = useRef<Map<string, AvatarPos>>(new Map());
  const animFrameRef = useRef<number>(0);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 400 });
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);

  // Build room→environment lookup
  const roomEnvMap = useCallback(() => {
    const m: Record<string, Environment> = {};
    for (const r of rooms) m[r.id] = r;
    return m;
  }, [rooms]);

  // Map floor-plan room id → Environment id (match by name)
  const fpRoomToEnv = useCallback((fpRoom: FloorPlanRoom): Environment | null => {
    const envMap = roomEnvMap();
    // FloorPlanRoom.id may match Environment.id, or match by label→name
    if (envMap[fpRoom.id]) return envMap[fpRoom.id];
    return rooms.find((r) => r.name === fpRoom.label) ?? null;
  }, [rooms, roomEnvMap]);

  // Scaling
  const padding = 24;
  const scaleX = (canvasSize.w - padding * 2) / floorPlan.width;
  const scaleY = (canvasSize.h - padding * 2) / floorPlan.height;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (canvasSize.w - floorPlan.width * scale) / 2;
  const offsetY = (canvasSize.h - floorPlan.height * scale) / 2;

  const toPixel = useCallback((mx: number, my: number) => [offsetX + mx * scale, offsetY + my * scale], [offsetX, offsetY, scale]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize({ w: Math.floor(width), h: Math.floor(Math.max(height, 300)) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Assign entity positions within their rooms
  useEffect(() => {
    const posMap = avatarPosRef.current;
    const activeEntities = entities.filter((e) => e.status === "active");

    // Remove stale
    for (const key of posMap.keys()) {
      if (!activeEntities.find((e) => e.id === key)) posMap.delete(key);
    }

    // Group entities by room
    const byRoom: Record<string, TrackedEntity[]> = {};
    for (const e of activeEntities) {
      const roomId = e.roomId;
      if (!roomId) continue;
      (byRoom[roomId] = byRoom[roomId] || []).push(e);
    }

    for (const fpRoom of floorPlan.rooms) {
      const env = fpRoomToEnv(fpRoom);
      if (!env) continue;
      const roomEntities = byRoom[env.id] || [];
      roomEntities.forEach((entity, idx) => {
        // Compute a target position within the room
        const slots = roomEntities.length;
        const angle = (idx / Math.max(slots, 1)) * Math.PI * 2 + Date.now() * 0.0003;
        const rx = fpRoom.w * 0.3 * Math.cos(angle);
        const ry = fpRoom.h * 0.3 * Math.sin(angle);
        const tx = fpRoom.x + fpRoom.w / 2 + rx;
        const ty = fpRoom.y + fpRoom.h / 2 + ry;

        const existing = posMap.get(entity.id);
        if (existing) {
          existing.targetX = tx;
          existing.targetY = ty;
        } else {
          posMap.set(entity.id, { entityId: entity.id, x: tx, y: ty, targetX: tx, targetY: ty });
        }
      });
    }
  }, [entities, floorPlan, fpRoomToEnv]);

  // Hit test
  const hitTestRoom = useCallback((px: number, py: number): FloorPlanRoom | null => {
    // Convert pixel to metre
    const mx = (px - offsetX) / scale;
    const my = (py - offsetY) / scale;
    for (let i = floorPlan.rooms.length - 1; i >= 0; i--) {
      const r = floorPlan.rooms[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r;
    }
    return null;
  }, [floorPlan, offsetX, offsetY, scale]);

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const room = hitTestRoom(px, py);
    setHoveredRoom(room?.id ?? null);
  }, [hitTestRoom]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const room = hitTestRoom(px, py);
    if (room) {
      const env = fpRoomToEnv(room);
      onSelectRoom?.(env?.id ?? room.id);
    } else {
      onSelectRoom?.(null);
    }
  }, [hitTestRoom, fpRoomToEnv, onSelectRoom]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvasSize.w * dpr;
      canvas.height = canvasSize.h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

      // Grid
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 0.5;
      for (let mx = 0; mx <= floorPlan.width; mx++) {
        const [px] = toPixel(mx, 0);
        ctx.beginPath(); ctx.moveTo(px, offsetY); ctx.lineTo(px, offsetY + floorPlan.height * scale); ctx.stroke();
      }
      for (let my = 0; my <= floorPlan.height; my++) {
        const [, py] = toPixel(0, my);
        ctx.beginPath(); ctx.moveTo(offsetX, py); ctx.lineTo(offsetX + floorPlan.width * scale, py); ctx.stroke();
      }

      // Rooms
      for (const fpRoom of floorPlan.rooms) {
        const env = fpRoomToEnv(fpRoom);
        const isCalibrated = env?.isCalibrated ?? false;
        const confidence = env?.calibrationConfidence ?? 0;
        const color = ROOM_COLORS[fpRoom.type] ?? "#6b7280";
        const isSelected = env && selectedRoomId === env.id;
        const isHovered = hoveredRoom === fpRoom.id;

        const [rx, ry] = toPixel(fpRoom.x, fpRoom.y);
        const rw = fpRoom.w * scale;
        const rh = fpRoom.h * scale;

        // Room fill
        ctx.globalAlpha = isSelected ? 0.35 : isHovered ? 0.25 : 0.15;
        ctx.fillStyle = color;
        ctx.beginPath();
        const radius = 4;
        ctx.moveTo(rx + radius, ry);
        ctx.lineTo(rx + rw - radius, ry);
        ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + radius);
        ctx.lineTo(rx + rw, ry + rh - radius);
        ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - radius, ry + rh);
        ctx.lineTo(rx + radius, ry + rh);
        ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - radius);
        ctx.lineTo(rx, ry + radius);
        ctx.quadraticCurveTo(rx, ry, rx + radius, ry);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;

        // Room border
        ctx.strokeStyle = isSelected ? color : isHovered ? color : "rgba(255,255,255,0.12)";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();

        // Calibration indicator (small dot top-right)
        const dotR = 4;
        ctx.beginPath();
        ctx.arc(rx + rw - 8, ry + 8, dotR, 0, Math.PI * 2);
        ctx.fillStyle = isCalibrated ? "#5ebb7f" : "#8b8f9a";
        ctx.fill();

        // Room label
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = `${Math.min(12, rw / fpRoom.label.length * 1.2)}px -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(fpRoom.label, rx + rw / 2, ry + rh / 2 - 6);

        // Confidence percentage
        ctx.fillStyle = isCalibrated ? "rgba(94,187,127,0.8)" : "rgba(139,143,154,0.6)";
        ctx.font = "bold 10px -apple-system, sans-serif";
        ctx.fillText(
          isCalibrated ? `${(confidence * 100).toFixed(0)}%` : "—",
          rx + rw / 2,
          ry + rh / 2 + 8
        );

        // Entity count badge
        const roomEntities = entities.filter((e) => {
          if (!env) return false;
          return e.roomId === env.id && e.status === "active";
        });
        if (roomEntities.length > 0) {
          const badgeX = rx + 10;
          const badgeY = ry + rh - 12;
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.beginPath();
          ctx.roundRect(badgeX - 4, badgeY - 7, 28, 14, 7);
          ctx.fill();
          ctx.fillStyle = "#5ebb7f";
          ctx.font = "bold 9px -apple-system, sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(`${roomEntities.length}👤`, badgeX, badgeY + 1);
        }
      }

      // Animate entity avatars
      const posMap = avatarPosRef.current;
      for (const [entityId, pos] of posMap.entries()) {
        // Smooth interpolation toward target
        pos.x += (pos.targetX - pos.x) * 0.08;
        pos.y += (pos.targetY - pos.y) * 0.08;

        const entity = entities.find((e) => e.id === entityId);
        if (!entity || entity.status !== "active") continue;

        const [px, py] = toPixel(pos.x, pos.y);
        const dotRadius = entity.type === "pet" ? 5 : 7;
        const color = entity.type === "pet" ? ENTITY_COLORS.pet : ENTITY_COLORS.person;

        // Glow
        const grad = ctx.createRadialGradient(px, py, 0, px, py, dotRadius * 3);
        grad.addColorStop(0, color + "40");
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, dotRadius * 3, 0, Math.PI * 2);
        ctx.fill();

        // Avatar dot
        ctx.beginPath();
        ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Emoji
        ctx.font = `${dotRadius * 1.4}px -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(entity.emoji || (entity.type === "pet" ? "🐾" : "👤"), px, py - dotRadius - 6);

        // Name label
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "9px -apple-system, sans-serif";
        ctx.fillText(entity.name, px, py + dotRadius + 10);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [canvasSize, floorPlan, entities, selectedRoomId, hoveredRoom, toPixel, offsetX, offsetY, scale, fpRoomToEnv]);

  // Selected room detail panel data
  const selectedFpRoom = selectedRoomId ? floorPlan.rooms.find((r) => {
    const env = fpRoomToEnv(r);
    return env?.id === selectedRoomId;
  }) : null;
  const selectedEnv = selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) : null;
  const selectedEntities = selectedRoomId ? entities.filter((e) => e.roomId === selectedRoomId && e.status === "active") : [];

  return (
    <div className="flex gap-4">
      <div ref={containerRef} className="flex-1 rounded-2xl overflow-hidden relative" style={{ backgroundColor: "#0d1117", border: "1px solid var(--gh-border)", minHeight: 350 }}>
        <canvas
          ref={canvasRef}
          style={{ width: canvasSize.w, height: canvasSize.h, cursor: hoveredRoom ? "pointer" : "default" }}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onMouseLeave={() => setHoveredRoom(null)}
        />
        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex gap-3 text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: "#5ebb7f" }} /> Calibrated</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: "#8b8f9a" }} /> Pending</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: ENTITY_COLORS.person }} /> Person</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: ENTITY_COLORS.pet }} /> Pet</span>
        </div>
      </div>

      {/* Room detail panel */}
      {selectedFpRoom && selectedEnv && (
        <div className="w-64 rounded-2xl p-4 flex-shrink-0" style={{ backgroundColor: "var(--gh-surface)", border: "1px solid var(--gh-border)" }}>
          <div className="text-center mb-3">
            <div className="text-2xl mb-1">{selectedEnv.emoji || "📍"}</div>
            <h4 className="font-semibold text-sm">{selectedEnv.name}</h4>
            <span className="text-[10px] px-2 py-0.5 rounded-full inline-block mt-1" style={{
              backgroundColor: selectedEnv.isCalibrated ? "rgba(94,187,127,0.12)" : "rgba(139,143,154,0.12)",
              color: selectedEnv.isCalibrated ? "var(--gh-green)" : "var(--gh-text-muted)",
            }}>
              {selectedEnv.isCalibrated ? `Calibrated · ${(selectedEnv.calibrationConfidence * 100).toFixed(0)}%` : "Not Calibrated"}
            </span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
              <span>Dimensions</span>
              <span>{selectedEnv.dimensions.width}×{selectedEnv.dimensions.length}m</span>
            </div>
            <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
              <span>Type</span>
              <span className="capitalize">{selectedEnv.type.replace("_", " ")}</span>
            </div>
            <div className="flex justify-between" style={{ color: "var(--gh-text-muted)" }}>
              <span>Active Entities</span>
              <span style={{ color: "var(--gh-green)" }}>{selectedEntities.length}</span>
            </div>
          </div>
          {selectedEntities.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase" style={{ color: "var(--gh-text-muted)" }}>In Room</p>
              {selectedEntities.map((e) => (
                <div key={e.id} className="flex items-center gap-2 p-2 rounded-lg" style={{ backgroundColor: "var(--gh-card)" }}>
                  <span className="text-sm">{e.emoji || "👤"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{e.name}</p>
                    <p className="text-[9px]" style={{ color: "var(--gh-text-muted)" }}>{e.activity} · {e.lastSeen}</p>
                  </div>
                  {e.heartRate && (
                    <span className="text-[9px]" style={{ color: "var(--gh-red)" }}>♥ {e.heartRate}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

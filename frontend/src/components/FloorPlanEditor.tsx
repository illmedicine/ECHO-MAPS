"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { FloorPlanRoom, Environment } from "@/lib/environments";

const ROOM_TYPES: { value: Environment["type"]; label: string; icon: string }[] = [
  { value: "kitchen", label: "Kitchen", icon: "🍳" },
  { value: "living_room", label: "Living Room", icon: "🛋️" },
  { value: "bedroom", label: "Bedroom", icon: "🛏️" },
  { value: "bathroom", label: "Bathroom", icon: "🚿" },
  { value: "office", label: "Office", icon: "💻" },
  { value: "garage", label: "Garage", icon: "🚗" },
  { value: "patio", label: "Patio", icon: "☀️" },
  { value: "other", label: "Other", icon: "📍" },
];

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

interface FloorPlanEditorProps {
  initialWidth?: number;
  initialHeight?: number;
  initialRooms?: FloorPlanRoom[];
  onSave: (width: number, height: number, rooms: FloorPlanRoom[]) => void;
  onCancel: () => void;
}

type Tool = "select" | "draw";

export default function FloorPlanEditor({
  initialWidth = 15,
  initialHeight = 12,
  initialRooms = [],
  onSave,
  onCancel,
}: FloorPlanEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [planWidth, setPlanWidth] = useState(initialWidth);
  const [planHeight, setPlanHeight] = useState(initialHeight);
  const [rooms, setRooms] = useState<FloorPlanRoom[]>(initialRooms);
  const [tool, setTool] = useState<Tool>("draw");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [newRoomType, setNewRoomType] = useState<Environment["type"]>("bedroom");
  const [newRoomLabel, setNewRoomLabel] = useState("");
  const [showLabelPrompt, setShowLabelPrompt] = useState(false);
  const [pendingRect, setPendingRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [resizing, setResizing] = useState<{ roomId: string; corner: string } | null>(null);

  const GRID_SIZE = 0.5; // snap to half-metre grid
  const CANVAS_PADDING = 40;

  const getScale = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 40;
    const availW = canvas.width - CANVAS_PADDING * 2;
    const availH = canvas.height - CANVAS_PADDING * 2;
    return Math.min(availW / planWidth, availH / planHeight);
  }, [planWidth, planHeight]);

  const toCanvas = useCallback((mx: number, my: number): { x: number; y: number } => {
    const scale = getScale();
    return { x: CANVAS_PADDING + mx * scale, y: CANVAS_PADDING + my * scale };
  }, [getScale]);

  const toMetres = useCallback((cx: number, cy: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scale = getScale();
    const px = (cx - rect.left) * (canvas.width / rect.width);
    const py = (cy - rect.top) * (canvas.height / rect.height);
    const mx = (px - CANVAS_PADDING) / scale;
    const my = (py - CANVAS_PADDING) / scale;
    return { x: Math.round(mx / GRID_SIZE) * GRID_SIZE, y: Math.round(my / GRID_SIZE) * GRID_SIZE };
  }, [getScale]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const scale = getScale() / dpr * dpr; // use un-scaled for drawing
    const pad = CANVAS_PADDING / dpr * dpr;

    // Background
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Grid
    ctx.strokeStyle = "#1a2040";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= planWidth; x += GRID_SIZE) {
      const cx = pad + x * (getScale());
      ctx.beginPath();
      ctx.moveTo(cx, pad);
      ctx.lineTo(cx, pad + planHeight * getScale());
      ctx.stroke();
    }
    for (let y = 0; y <= planHeight; y += GRID_SIZE) {
      const cy = pad + y * getScale();
      ctx.beginPath();
      ctx.moveTo(pad, cy);
      ctx.lineTo(pad + planWidth * getScale(), cy);
      ctx.stroke();
    }

    // Metre marks
    ctx.fillStyle = "#4a5568";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    for (let x = 0; x <= planWidth; x++) {
      const cx = pad + x * getScale();
      ctx.fillText(`${x}m`, cx, pad - 8);
    }
    ctx.textAlign = "right";
    for (let y = 0; y <= planHeight; y++) {
      const cy = pad + y * getScale();
      ctx.fillText(`${y}m`, pad - 8, cy + 4);
    }

    // Outer boundary
    ctx.strokeStyle = "#4a5568";
    ctx.lineWidth = 2;
    ctx.strokeRect(pad, pad, planWidth * getScale(), planHeight * getScale());

    // Existing rooms
    for (const room of rooms) {
      const color = ROOM_COLORS[room.type] ?? "#6b7280";
      const cx = pad + room.x * getScale();
      const cy = pad + room.y * getScale();
      const cw = room.w * getScale();
      const ch = room.h * getScale();

      ctx.fillStyle = color + "22";
      ctx.fillRect(cx, cy, cw, ch);

      ctx.strokeStyle = selectedRoomId === room.id ? "#ffffff" : color;
      ctx.lineWidth = selectedRoomId === room.id ? 2.5 : 1.5;
      ctx.strokeRect(cx, cy, cw, ch);

      // Room label
      ctx.fillStyle = color;
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "left";
      const typeInfo = ROOM_TYPES.find((t) => t.value === room.type);
      ctx.fillText(`${typeInfo?.icon ?? ""} ${room.label}`, cx + 6, cy + 16);

      // Dimensions
      ctx.fillStyle = "#8b9cb5";
      ctx.font = "10px sans-serif";
      ctx.fillText(`${room.w.toFixed(1)}×${room.h.toFixed(1)}m`, cx + 6, cy + 30);

      // Resize handles for selected room
      if (selectedRoomId === room.id) {
        const handleSize = 6;
        ctx.fillStyle = "#ffffff";
        for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
          ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
        }
      }
    }

    // Draw preview rect
    if (drawStart && drawCurrent) {
      const sx = pad + Math.min(drawStart.x, drawCurrent.x) * getScale();
      const sy = pad + Math.min(drawStart.y, drawCurrent.y) * getScale();
      const sw = Math.abs(drawCurrent.x - drawStart.x) * getScale();
      const sh = Math.abs(drawCurrent.y - drawStart.y) * getScale();
      const color = ROOM_COLORS[newRoomType] ?? "#6b7280";
      ctx.fillStyle = color + "33";
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);

      // Preview dimensions
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);
      if (w > 0.3 && h > 0.3) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${w.toFixed(1)}×${h.toFixed(1)}m`, sx + sw / 2, sy + sh / 2 + 4);
      }
    }
  }, [rooms, planWidth, planHeight, drawStart, drawCurrent, selectedRoomId, newRoomType, getScale]);

  const hitTestRoom = useCallback((mx: number, my: number): FloorPlanRoom | null => {
    // Reverse order for z-order (last drawn = on top)
    for (let i = rooms.length - 1; i >= 0; i--) {
      const r = rooms[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r;
    }
    return null;
  }, [rooms]);

  const hitTestHandle = useCallback((mx: number, my: number): { roomId: string; corner: string } | null => {
    if (!selectedRoomId) return null;
    const room = rooms.find((r) => r.id === selectedRoomId);
    if (!room) return null;
    const threshold = 0.4; // metres
    const corners: [number, number, string][] = [
      [room.x, room.y, "tl"],
      [room.x + room.w, room.y, "tr"],
      [room.x, room.y + room.h, "bl"],
      [room.x + room.w, room.y + room.h, "br"],
    ];
    for (const [cx, cy, corner] of corners) {
      if (Math.abs(mx - cx) < threshold && Math.abs(my - cy) < threshold) {
        return { roomId: room.id, corner };
      }
    }
    return null;
  }, [rooms, selectedRoomId]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const { x, y } = toMetres(e.clientX, e.clientY);
    if (x < 0 || y < 0 || x > planWidth || y > planHeight) return;

    if (tool === "select") {
      const handle = hitTestHandle(x, y);
      if (handle) {
        setResizing(handle);
        return;
      }
      const hit = hitTestRoom(x, y);
      if (hit) {
        setSelectedRoomId(hit.id);
        setDragOffset({ x: x - hit.x, y: y - hit.y });
      } else {
        setSelectedRoomId(null);
      }
    } else {
      setDrawStart({ x: Math.max(0, x), y: Math.max(0, y) });
      setDrawCurrent({ x: Math.max(0, x), y: Math.max(0, y) });
    }
  }, [tool, toMetres, planWidth, planHeight, hitTestRoom, hitTestHandle]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const { x, y } = toMetres(e.clientX, e.clientY);
    const clampX = Math.max(0, Math.min(planWidth, x));
    const clampY = Math.max(0, Math.min(planHeight, y));

    if (tool === "draw" && drawStart) {
      setDrawCurrent({ x: clampX, y: clampY });
    } else if (tool === "select" && dragOffset && selectedRoomId) {
      setRooms((prev) =>
        prev.map((r) => {
          if (r.id !== selectedRoomId) return r;
          const nx = Math.max(0, Math.min(planWidth - r.w, Math.round((clampX - dragOffset.x) / GRID_SIZE) * GRID_SIZE));
          const ny = Math.max(0, Math.min(planHeight - r.h, Math.round((clampY - dragOffset.y) / GRID_SIZE) * GRID_SIZE));
          return { ...r, x: nx, y: ny };
        })
      );
    } else if (resizing && selectedRoomId) {
      setRooms((prev) =>
        prev.map((r) => {
          if (r.id !== selectedRoomId) return r;
          const minSize = 1;
          let { x: rx, y: ry, w: rw, h: rh } = r;
          if (resizing.corner.includes("r")) { rw = Math.max(minSize, clampX - rx); }
          if (resizing.corner.includes("l")) { const newX = Math.min(clampX, rx + rw - minSize); rw = rx + rw - newX; rx = newX; }
          if (resizing.corner.includes("b")) { rh = Math.max(minSize, clampY - ry); }
          if (resizing.corner.includes("t")) { const newY = Math.min(clampY, ry + rh - minSize); rh = ry + rh - newY; ry = newY; }
          return { ...r, x: Math.round(rx / GRID_SIZE) * GRID_SIZE, y: Math.round(ry / GRID_SIZE) * GRID_SIZE, w: Math.round(rw / GRID_SIZE) * GRID_SIZE, h: Math.round(rh / GRID_SIZE) * GRID_SIZE };
        })
      );
    }
  }, [tool, drawStart, dragOffset, selectedRoomId, resizing, toMetres, planWidth, planHeight]);

  const handleMouseUp = useCallback(() => {
    if (tool === "draw" && drawStart && drawCurrent) {
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);

      if (w >= 1 && h >= 1) {
        setPendingRect({ x, y, w, h });
        setNewRoomLabel("");
        setShowLabelPrompt(true);
      }
      setDrawStart(null);
      setDrawCurrent(null);
    }
    setDragOffset(null);
    setResizing(null);
  }, [tool, drawStart, drawCurrent]);

  const confirmRoom = () => {
    if (!pendingRect) return;
    const typeInfo = ROOM_TYPES.find((t) => t.value === newRoomType);
    const label = newRoomLabel.trim() || `${typeInfo?.label ?? "Room"} ${rooms.length + 1}`;
    setRooms((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label,
        type: newRoomType,
        ...pendingRect,
      },
    ]);
    setShowLabelPrompt(false);
    setPendingRect(null);
  };

  const deleteSelected = () => {
    if (!selectedRoomId) return;
    setRooms((prev) => prev.filter((r) => r.id !== selectedRoomId));
    setSelectedRoomId(null);
  };

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setTool("draw"); setSelectedRoomId(null); }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition"
            style={tool === "draw" ? { backgroundColor: "var(--gh-blue)", color: "#fff" } : { backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}
          >
            ✏️ Draw Room
          </button>
          <button
            onClick={() => setTool("select")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition"
            style={tool === "select" ? { backgroundColor: "var(--gh-blue)", color: "#fff" } : { backgroundColor: "var(--gh-card)", color: "var(--gh-text-muted)" }}
          >
            👆 Select / Move
          </button>
          {tool === "draw" && (
            <select
              value={newRoomType}
              onChange={(e) => setNewRoomType(e.target.value as Environment["type"])}
              className="px-2 py-1.5 rounded-lg text-xs border"
              style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }}
            >
              {ROOM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
              ))}
            </select>
          )}
          {selectedRoomId && (
            <button onClick={deleteSelected} className="px-3 py-1.5 rounded-lg text-xs font-medium transition" style={{ backgroundColor: "rgba(232,104,90,0.15)", color: "var(--gh-red)" }}>
              🗑️ Delete Room
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--gh-text-muted)" }}>
          <label>W:</label>
          <input type="number" value={planWidth} min={5} max={50} step={1} onChange={(e) => setPlanWidth(Number(e.target.value) || 15)}
            className="w-14 px-2 py-1 rounded border text-xs" style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
          <label>H:</label>
          <input type="number" value={planHeight} min={5} max={50} step={1} onChange={(e) => setPlanHeight(Number(e.target.value) || 12)}
            className="w-14 px-2 py-1 rounded border text-xs" style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }} />
          <span>metres</span>
        </div>
      </div>

      {/* Canvas */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--gh-border)" }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="w-full cursor-crosshair"
          style={{ height: "450px", backgroundColor: "#0d1117" }}
        />
      </div>

      {/* Room label prompt modal */}
      {showLabelPrompt && pendingRect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-2xl border p-6 w-80" style={{ backgroundColor: "var(--gh-surface)", borderColor: "var(--gh-border)" }}>
            <h3 className="font-semibold mb-3">Name this room</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--gh-text-muted)" }}>Room Type</label>
                <select
                  value={newRoomType}
                  onChange={(e) => setNewRoomType(e.target.value as Environment["type"])}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }}
                >
                  {ROOM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--gh-text-muted)" }}>Room Name</label>
                <input
                  type="text"
                  value={newRoomLabel}
                  onChange={(e) => setNewRoomLabel(e.target.value)}
                  placeholder={`${ROOM_TYPES.find((t) => t.value === newRoomType)?.label ?? "Room"} ${rooms.length + 1}`}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ backgroundColor: "var(--gh-card)", borderColor: "var(--gh-border)", color: "var(--gh-text)" }}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") confirmRoom(); }}
                />
              </div>
              <div className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
                Size: {pendingRect.w.toFixed(1)}m × {pendingRect.h.toFixed(1)}m
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowLabelPrompt(false); setPendingRect(null); }} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: "var(--gh-text-muted)" }}>Cancel</button>
                <button onClick={confirmRoom} className="px-4 py-1.5 rounded-lg text-xs font-medium" style={{ backgroundColor: "var(--gh-blue)", color: "#fff" }}>Add Room</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Room list */}
      {rooms.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold" style={{ color: "var(--gh-text-muted)" }}>Rooms ({rooms.length})</p>
          <div className="flex flex-wrap gap-2">
            {rooms.map((r) => {
              const color = ROOM_COLORS[r.type] ?? "#6b7280";
              const typeInfo = ROOM_TYPES.find((t) => t.value === r.type);
              return (
                <button
                  key={r.id}
                  onClick={() => { setTool("select"); setSelectedRoomId(r.id); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition"
                  style={{
                    backgroundColor: selectedRoomId === r.id ? color + "33" : "var(--gh-card)",
                    borderColor: selectedRoomId === r.id ? color : "var(--gh-border)",
                    color: selectedRoomId === r.id ? color : "var(--gh-text-muted)",
                  }}
                >
                  {typeInfo?.icon} {r.label} ({r.w.toFixed(1)}×{r.h.toFixed(1)}m)
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: "var(--gh-border)" }}>
        <p className="text-xs" style={{ color: "var(--gh-text-muted)" }}>
          {rooms.length === 0 ? "Draw rooms on the grid to create your floor plan" : `${rooms.length} room${rooms.length !== 1 ? "s" : ""} · ${planWidth}×${planHeight}m footprint`}
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm" style={{ color: "var(--gh-text-muted)" }}>Cancel</button>
          <button
            onClick={() => onSave(planWidth, planHeight, rooms)}
            disabled={rooms.length === 0}
            className="px-5 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40"
            style={{ backgroundColor: "var(--gh-blue)", color: "#fff" }}
          >
            Save Floor Plan
          </button>
        </div>
      </div>
    </div>
  );
}

---
date: 2026-04-07
commit: a33691f
branch: main
---

# ECHO-MAPS (Echo Vue) — Release Summary

**Illy Robotics** | April 7, 2026 | Commit `a33691f`

---

## Expanded 3D Skeletal Viewer

- 3D viewer now fills most of the viewport (`calc(100vh - 10rem)`, min 500px) instead of a fixed 600px box
- Applies to both the main environment view and the context-lost recovery state
- Loading placeholder also scales to match

## Floor Plan Editor (New Feature)

**Visual room layout tool** built into the dashboard for defining home/office floor plans:

- **Draw mode** — Click and drag on a metre-scale grid to draw room rectangles (snaps to 0.5m)
- **Select mode** — Click rooms to select, drag to reposition, corner handles to resize
- **Room types** — Kitchen, Living Room, Bedroom, Bathroom, Office, Garage, Patio, Other — each color-coded
- **Name prompt** — After drawing, prompted for room name and type before confirming
- **Live dimensions** — Shows room size in metres while drawing and on each room card
- **Room list** — All rooms displayed as selectable chips below the canvas
- **Configurable footprint** — Set overall floor plan width/height in metres

## Floor Plan → Room Override Logic

- Saving a floor plan **automatically deletes all existing manually-added rooms** for that environment
- Rooms are recreated from the floor plan's spatial layout (name, type, dimensions)
- This ensures the floor plan is the single source of truth when active
- Manual room adding still works independently if no floor plan exists

## Dashboard Integration

- **"Floor Plan" button** in the header alongside "Add Room" (shows green when a plan exists)
- **Floor plan editor** opens inline, replacing the room grid
- **Active floor plan banner** appears above rooms showing footprint size and room count
- **Empty state** now offers both "Create Floor Plan" and "Add Room" as entry points

## Backend Model

- New `FloorPlan` SQLAlchemy model: `floor_plans` table with JSONB `rooms_json`, `width`/`height` floats, one-per-environment unique constraint

---

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/EnvironmentViewer.tsx` | Expanded viewer height to viewport-relative |
| `frontend/src/components/FloorPlanEditor.tsx` | **New** — Canvas-based floor plan editor |
| `frontend/src/lib/environments.ts` | Added FloorPlan types, CRUD, room override logic |
| `frontend/src/app/dashboard/page.tsx` | Integrated floor plan editor, button, banner |
| `frontend/src/app/dashboard/env/page.tsx` | Updated 3D viewer loading placeholder size |
| `echo_maps/db/models.py` | Added FloorPlan SQLAlchemy model |

## Backend & Deployment

| Commit | Fix |
|--------|-----|
| `48e01b0` | Full frontend-backend architecture for production (Render) |
| `b11188a` | Lazy-load PyTorch for lightweight API deployment |
| `b784ff7` | Remove unsupported `dockerTarget` from `render.yaml` |
| `0180734` | Use `connectionString` instead of `connectionURI` in Render config |

## Routing & Navigation Crashes

| Commit | Fix |
|--------|-----|
| `d3c8fd1` | Query-param routing for environment detail (eliminated 404s on static export) |
| `0f653e0` | Wrap `useSearchParams` in Suspense for static export compatibility |
| `9bce4d0` | Default dimensions fallback to prevent `undefined width` error |
| `c024c06` | Dimensions fallback in data layer and all components |
| `80bf8a9` | Remove old `[envId]` dynamic route intercepting `/dashboard/env` |
| `d5e2fb4` | Pass `dims` argument to `generateSimulatedSkeleton` (fixed `width` crash) |

## UI/UX & Branding

| Commit | Change |
|--------|--------|
| `1813037` | **Echo Vue rebrand** — Google Home-inspired dark theme with automations panel |
| `4824030` | Calibration wizard + presence detection tab |
| `70a2eaa` | Cameras tab, environment hierarchy (Environments → Rooms → Cameras), warmer UI |
| `4238647` | Enlarged logo, removed redundant "by Illy Robotics" text |
| `7ba817d` | Transparent-background logo asset |
| `2864e8f` | Light theme support, logo replaces sidebar text, emoji tab icons, billing limits |
| `34cf707` | Logo +70%, transparent watermark, emoji pickers for all entities, room creation fix |
| `22ddd0d` | Watermark renders above page backgrounds on all pages |

## Authentication

| Commit | Change |
|--------|--------|
| `6a138d6` | Google OAuth sign-in page, dashboard shell, and callback handler |

## Real-Time Skeletal Tracking

| Commit | Change |
|--------|--------|
| `7dc3fff` | **TF.js MoveNet pose estimation** — real-time skeletal tracking from camera feed |
| `7561632` | Resolve `@mediapipe/pose` runtime errors, wire real camera data to 3D viewer |
| `5b6196e` | Fix WebGL context lost by reducing GPU contention (`frameloop="demand"`, throttled invalidation) |
| `1e53e54` | Auto-recover from stale chunk errors after deploys (`ChunkErrorRecover` component) |
| `cbb84bc` | Restore live skeletal animation in PresenceView 3D viewer after entity dedup regression |
| `2f182c8` | **Per-entity skeletal animation** — each person gets unique walking skeleton with position derived from hip midpoints, velocity/speed from frame deltas |

## Presence Detection & Entity Tracking

| Commit | Change |
|--------|--------|
| `f1f36c0` | **CSI Anchor Protocol** — BLE MAC tethering via RF Signature anchors, device-to-person binding |
| `f15fe18` | Persist entity profiles across tabs, keep camera stream alive during navigation |
| `ef78679` | Restore emojis, scan-based presence detection, entity profile editing (name, emoji, type, room) |
| `ed304bf` | **BLE device discovery** — manufacturer/OS identification (Apple, Google, Samsung, etc.) in presence scans |
| `1724ead` | **Entity deduplication** — CSI Anchor Protocol groups BLE devices by manufacturer into single entities; prevents 7-entity false positives for 2 people + 1 pet |

## Cloud Sync & Networking

| Commit | Change |
|--------|--------|
| `045c43c` | **Cross-device cloud sync** — user-scoped localStorage with Google account, JSON export/import, network fingerprint labels per environment |
| `1724ead` | Circuit breaker for `/api/settings` 404 spam (exponential backoff 30s → 10min) |

## Research & Documentation

| Commit | Change |
|--------|--------|
| `acbee2d` | Research white paper page with Forbes-style editorial layout |
| `9975a32` | Full SVG architecture infographic replacing placeholder Figure 1 — 3-phase pipeline, 6 industry verticals, onboarding flow |

---

## Summary Statistics

- **Total commits**: 40
- **Features added**: 16
- **Bugs fixed**: 20
- **CI/infra fixes**: 4
- **Development span**: 4 days (Mar 31 – Apr 3, 2026)

## Key Capabilities at HEAD (`2f182c8`)

1. **Real-time skeletal tracking** — TF.js MoveNet 33-keypoint pose estimation from any camera
2. **CSI Anchor Protocol** — BLE device tethering with manufacturer-aware entity deduplication
3. **Per-entity 3D animation** — each tracked person rendered with unique walking skeleton, position derived from hip midpoints
4. **Cross-device cloud sync** — Google-authenticated settings persistence with network fingerprint labels
5. **Environment hierarchy** — Environments → Rooms → Cameras with emoji customization
6. **Research documentation** — Full white paper with interactive architecture infographic
7. **WebGL resilience** — GPU contention management, context loss recovery, chunk error auto-reload

---
date: 2026-04-03
commit: 2f182c8
branch: main
---

# ECHO-MAPS (Echo Vue) — Full Release Notes

**Illy Robotics** | March 31 – April 3, 2026 | 40 commits | `da16b8d` → `2f182c8`

---

## v1.0 — Initial Release (Mar 31)

`da16b8d` — Initial Echo Maps codebase: WiFi CSI sensing platform with Next.js frontend, FastAPI backend, ESP32 firmware, AI models (WaveFormer, CalibrationGAN, spatial attention), multi-person Kalman tracking, federated learning stubs, and PostgreSQL/pgvector DB layer.

---

## Infrastructure & CI/CD

| Commit | Fix |
|--------|-----|
| `db2f4d3` | GitHub Actions workflow for Next.js static deployment to GitHub Pages |
| `cd0969f` | CI trigger for GitHub Pages |
| `eaa7316` | Remove npm cache dependency on missing lock file |
| `17f7ea6` | Remove duplicate workflow, fix TS build errors |
| `21ec655` | Add `.npmrc` with `legacy-peer-deps` for TF.js CI compatibility |
| `fc240d5` | Webpack IgnorePlugin for TF.js optional deps (`@mediapipe/pose`, `webgpu`) |
| `6033e62` | Re-trigger deploy with IgnorePlugin fix |

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

# Echo Vue — Production Architecture Topology & Validation

> Generated: 2025-04-09 | Workspace: ECHO-MAPS  
> Purpose: Validate production architecture vision against current codebase

---

## 1. ARCHITECTURE VALIDATION SUMMARY

**Your vision is correct. The Gemini USPTO drawing is misleading.** Here's what it gets wrong:

| Issue in USPTO Drawing | Your Correct Vision |
|------------------------|-------------------|
| "AI Brain" shown as local/on-premise box | AI MBL Engine runs in the **cloud** — GPU-intensive compute |
| No cloud backend depicted | Cloud is the **central nervous system** of Echo Vue |
| No multi-tenant isolation shown | Each user/org gets **isolated data pipelines** |
| Camera/ESP32 seem to do processing | ESP32 = **dumb sensor**, Camera = **calibration-only then OFF** |
| No network binding concept | Environments are **bound to network IPs** — can't manage remotely |
| Monolithic single-user flow | **Multi-tenant SaaS** serving homes, hospitals, businesses simultaneously |

---

## 2. PRODUCTION ARCHITECTURE — 3-Layer Topology

### Layer 1: Edge (On-Premise Per Environment)

```
┌─────────────────────────────────────────────────┐
│  ON-PREMISE (Hospital Floor / Home / Business)   │
│                                                   │
│  ┌──────────┐    WiFi CSI     ┌──────────────┐  │
│  │ WiFi 6   │ ──────────────► │ ESP32-S3     │  │
│  │ Router   │    Subcarrier   │ Bridge Node  │  │
│  │          │    Data         │              │  │
│  └──────────┘                 │ • CSI Extract │  │
│                               │ • BLE Scan    │  │
│  ┌──────────┐    BLE RSSI     │ • TLS Stream  │  │
│  │ BLE Tags │ ──────────────► │ • NO AI/ML    │  │
│  │ (Staff,  │                 └──────┬───────┘  │
│  │ Patient) │                        │           │
│  └──────────┘                        │ TLS 1.3   │
│                                      ▼           │
│                              ═══ TO CLOUD ═══    │
└─────────────────────────────────────────────────┘
```

**ESP32 does NOT:**
- Run any ML models
- Render any images
- Store persistent data
- Make decisions about presence

**ESP32 ONLY:**
- Extracts raw CSI (242 subcarriers × 2x2 MIMO × 100Hz)
- Passively scans BLE advertisements (RSSI + MAC)
- Streams both over TLS 1.3 to cloud

### Layer 2: Frontend (User Devices — Same Network Required)

```
┌─────────────────────────────────────────────────┐
│  USER DEVICES (Must be on same network as env)   │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │  Echo Vue Web Portal (Next.js)               │ │
│  │                                               │ │
│  │  • Environment Setup & Floor Plan Editor      │ │
│  │  • Calibration Wizard (temp camera for onboard)│ │
│  │  • Live 3D Floor Plan Viewer                  │ │
│  │  • Vitals Dashboard                           │ │
│  │  • Staff/Patient Presence Overlay             │ │
│  │                                               │ │
│  │  DOES NOT:                                    │ │
│  │  ✗ Run AI models in production                │ │
│  │  ✗ Process CSI data                           │ │
│  │  ✗ Compute skeletal poses                     │ │
│  │  ✗ Store other tenants' data                  │ │
│  │                                               │ │
│  │  ONLY:                                        │ │
│  │  ✓ Renders pre-computed vectors from cloud    │ │
│  │  ✓ Displays 3D floor plans with avatars       │ │
│  │  ✓ Shows vitals and alerts                    │ │
│  │  ✓ Sends calibration data during setup        │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Layer 3: Cloud Backend — AI MBL Engine (The Heavy Lifter)

```
┌═══════════════════════════════════════════════════════════════┐
║  ☁️  ECHO VUE CLOUD — AI MBL ENGINE                          ║
║                                                               ║
║  ┌───────────────────────────────────────────────────────┐   ║
║  │  API GATEWAY                                           │   ║
║  │  • TLS Termination        • Rate Limiting              │   ║
║  │  • JWT Validation         • DDoS Protection            │   ║
║  │  • Network Origin Check   • Subscription Tier Enforce  │   ║
║  └───────────────────────────────────────────────────────┘   ║
║                          │                                    ║
║  ┌───────────────────────┴───────────────────────────────┐   ║
║  │  TENANT ISOLATION LAYER                                │   ║
║  │  • User UUID scoping on ALL queries                    │   ║
║  │  • Environment ownership verification                  │   ║
║  │  • Network IP/ID binding (env ↔ network)               │   ║
║  │  • Subscription tier enforcement                       │   ║
║  └───────────────────────────────────────────────────────┘   ║
║                          │                                    ║
║  ┌───────────────────────┴───────────────────────────────┐   ║
║  │  AI MBL COMPUTE ENGINE (GPU + CPU Workers)             │   ║
║  │                                                         │   ║
║  │  GPU Workloads:                                         │   ║
║  │  ├─ LatentCSI Encoder (CSI → 512-dim vectors)          │   ║
║  │  ├─ CalibrationGAN (adversarial training, 500 epochs)  │   ║
║  │  └─ Pose Inference (3D skeletal reconstruction)        │   ║
║  │                                                         │   ║
║  │  CPU Workloads:                                         │   ║
║  │  ├─ CSI Filtering (bandpass, Hampel outlier removal)   │   ║
║  │  ├─ Kalman Tracking (6-state filter, multi-person)     │   ║
║  │  ├─ RF Signature Engine (gait+breath+mass features)    │   ║
║  │  └─ Vitals Processor (HR, breathing, fall detection)   │   ║
║  └───────────────────────────────────────────────────────┘   ║
║                          │                                    ║
║  ┌───────────────────────┴───────────────────────────────┐   ║
║  │  DATA LAYER                                            │   ║
║  │  ├─ PostgreSQL (users, environments, activity logs)    │   ║
║  │  ├─ Milvus (RF embeddings, partitioned by env_id)      │   ║
║  │  ├─ Redis (session state, real-time pubsub, cache)     │   ║
║  │  └─ Object Storage (floor plans, snapshots, heatmaps) │   ║
║  └───────────────────────────────────────────────────────┘   ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## 3. MULTI-TENANT ISOLATION — Network Binding

### The Hospital A vs Hospital B Scenario

```
Hospital A (Public IP: 203.0.113.10)      Hospital B (Public IP: 198.51.100.20)
┌────────────────────────────┐           ┌────────────────────────────┐
│ 12 ESP32 nodes (4/floor)  │           │ 8 ESP32 nodes (2/floor)   │
│ Admin: admin@hosp-a.com   │           │ Admin: admin@hosp-b.com   │
│ Network: 192.168.1.0/24   │           │ Network: 10.0.0.0/24      │
│ Env bound to: 203.0.113.10│           │ Env bound to: 198.51.100.20│
└────────────┬───────────────┘           └────────────┬───────────────┘
             │                                          │
             └──────────────┬───────────────────────────┘
                            │
                 ┌──────────▼──────────┐
                 │  ☁️ AI MBL Engine    │
                 │                      │
                 │  ┌────────────────┐  │
                 │  │ Tenant Router  │  │
                 │  │ JWT + Network  │  │
                 │  │ Verification   │  │
                 │  └───────┬────────┘  │
                 │          │           │
                 │  ┌───────┴────────┐  │
                 │  │                │  │
                 │  ▼                ▼  │
                 │ Pipeline A   Pipeline B │
                 │ (Hosp A      (Hosp B    │
                 │  data ONLY)   data ONLY)│
                 │                      │
                 │  DB: Row-Level Security │
                 │  Milvus: Partitioned    │
                 │  by environment_id      │
                 └──────────────────────┘

❌ Hospital A admin at HOME (IP: 72.14.200.5):
   → Tries to run presence scan for Hospital A
   → Cloud checks: 72.14.200.5 ≠ 203.0.113.10
   → ACCESS DENIED: "Must be on environment's network"

✅ Hospital A admin ON-SITE (IP: 203.0.113.10):
   → Runs presence scan for Hospital A
   → Cloud checks: 203.0.113.10 = 203.0.113.10
   → ACCESS GRANTED: Returns Hospital A data ONLY
   → Hospital B data is NEVER visible regardless
```

### Isolation Guarantees:

1. **Authentication**: Google OAuth → JWT with user UUID
2. **Authorization**: Every DB query scoped to `WHERE user_id = {jwt.sub}`
3. **Network Binding**: Environment creation records `network_id` (public IP); presence scans verify request origin matches
4. **Vector DB Isolation**: Milvus collections partitioned by `environment_id` — RF signatures from Hospital A are physically separate from Hospital B
5. **Subscription Enforcement**: Tier limits (Personal: 10 envs, Pro: 50 envs) enforced at API gateway

---

## 4. DATA FLOW — Complete Lifecycle

```
SETUP:
User creates account → Google OAuth → JWT issued
User creates Environment → binds to current network IP
User registers ESP32 node → binds to environment

CALIBRATION (one-time per person):
1. Camera ON briefly (privacy-preserving)
2. Frontend captures MoveNet keypoints (17-point pose)
3. ESP32 streams CSI simultaneously
4. Both sent to Cloud via WebSocket
5. Cloud: LatentCSI encodes CSI → 512-dim vectors
6. Cloud: CalibrationGAN trains (CSI ↔ pose mapping)
7. Cloud: RF Signature extracted (gait + breathing + mass)
8. Cloud: Embeddings stored in Milvus (env-partitioned)
9. Camera OFF permanently → RF-only mode

LIVE PRESENCE (continuous, camera-free):
1. ESP32 streams CSI at 100Hz → TLS → Cloud
2. Cloud: Filters CSI (bandpass, outlier removal)
3. Cloud: LatentCSI decodes → pose vectors
4. Cloud: Kalman tracker predicts multi-person state
5. Cloud: Vitals extracted (HR, breathing, falls)
6. Cloud: Returns tracking snapshot + vitals + alerts
7. Frontend: Renders pre-computed 3D vectors on floor plan
```

---

## 5. GAPS IN CURRENT CODEBASE vs PRODUCTION VISION

| Component | Current State | Production Need | Priority |
|-----------|---------------|-----------------|----------|
| **Network Binding** | Not implemented | Environment ↔ network IP binding + verification on every request | 🔴 Critical |
| **ESP32 TLS Connection** | Protocol defined, manager is stub | Full TLS 1.3 connection handler with device lifecycle | 🔴 Critical |
| **API Gateway** | No rate limiting, no WAF | Rate limiting, DDoS protection, request validation | 🔴 Critical |
| **Subscription Enforcement** | Tiers defined in code, not enforced | Middleware check before accepting CSI streams | 🟡 High |
| **Redis Session State** | In-memory singleton `_engine` | Redis-backed state for horizontal scaling | 🟡 High |
| **Real-Time PubSub** | REST polling (stale data) | WebSocket push via Redis PubSub | 🟡 High |
| **Cloud Storage** | Config exists, never used | Persist floor plans, snapshots, calibration artifacts | 🟡 High |
| **BLE Tethering** | Stub with placeholder logic | Full MAC → person matching, RSSI distance estimation | 🟢 Medium |
| **Federated Learning** | Flower framework stubs | Cross-environment model improvement without sharing raw data | 🟢 Medium |
| **Edge ML Filtering** | Firmware placeholder comments | Optional pre-filtering on ESP32 to reduce bandwidth | ⚪ Low |
| **Monitoring** | No observability stack | Prometheus + Grafana + Sentry for production SLA | 🟡 High |

---

## 6. WHAT THE USPTO DRAWING SHOULD SHOW

The Gemini USPTO drawing is misleading because it depicts the system as a self-contained on-premise unit. For accurate patent drawings, the architecture should clearly show:

1. **Three distinct zones**: Edge (ESP32), Cloud (AI MBL), Frontend (User Devices)
2. **Cloud as the processing center**: ALL AI/ML computation happens in the cloud
3. **Network arrows**: TLS 1.3 from edge → cloud, HTTPS/WSS from frontend → cloud
4. **Multi-tenancy**: Multiple environments served by one cloud engine with isolation
5. **Network binding**: Dashed line showing environment-to-network-IP binding
6. **Data return path**: Cloud → frontend with "rendered vectors only" annotation
7. **Camera lifecycle**: Clearly show camera ON during calibration → OFF during live mode

# Echo Maps by Illy Robotics

**Privacy-first environmental digital twin via WiFi CSI sensing.**

All the insight of cameras — with none of the cameras.

---

## Overview

Echo Maps transforms WiFi Channel State Information (CSI) into real-time 3D environmental awareness. After a brief camera-assisted calibration phase, the system monitors human activity, breathing patterns, and heart rate using only WiFi signals — no cameras required.

### How It Works

| Step | User Action | What Happens |
|:-----|:------------|:-------------|
| **1. Setup** | Sign in via Google; name your Place ("Home Office") | Provisions storage + blank environment vector |
| **2. Trace** | Run "2D3D Map Trace" (webcam ON + WiFi ON) | Vision-CSI pairing: skeletal keypoints stamped onto CSI signals |
| **3. Training** | Perform movements (walk, sit, stand) | GAN trains to predict pose from CSI alone, using video as ground truth |
| **4. Confidence** | AI reaches ~95% pose-match accuracy | UI notifies: *"Environment Synced. Camera no longer required."* |
| **5. Live Mode** | Camera OFF | CSI-to-Latent-Diffusion pipeline renders 3D scene in real-time |

---

## Architecture

```
┌──────────────┐    TLS 1.3     ┌──────────────────┐     ┌────────────────┐
│  Illy Bridge │ ──────────────▶│  Echo Maps API   │────▶│  Milvus VecDB  │
│  (ESP32-S3)  │   CSI Stream   │  (FastAPI)       │     │  RF Signatures │
└──────────────┘                │                  │     └────────────────┘
                                │  ┌────────────┐  │     ┌────────────────┐
   ┌──────────┐   WebSocket     │  │ LatentCSI  │  │────▶│  PostgreSQL    │
   │ Frontend │◀───────────────▶│  │ WaveFormer │  │     │  Users/Envs    │
   │ (Next.js)│   Pose+Vitals   │  │ CroSSL     │  │     └────────────────┘
   └──────────┘                 │  │ GAN        │  │
                                │  └────────────┘  │     ┌────────────────┐
                                │                  │────▶│  Federated LoRA│
                                └──────────────────┘     │  (Flower)      │
                                                         └────────────────┘
```

### Core AI Stack

- **LatentCSI** — VAE encoder mapping CSI amplitude/phase into generative latent space → 3D point clouds
- **WaveFormer** — Temporal transformer for CSI sequences → activity recognition + vital sign extraction
- **CroSSL** — Cross-modal self-supervised contrastive learning (CLIP-style) aligning CSI ↔ skeletal keypoints
- **CalibrationGAN** — Adversarial training for camera-free pose prediction confidence scoring

### Hardware: Illy Bridge

- **Chipset:** ESP32-S3-WROOM-1 with AI Vector Instructions
- **WiFi:** 802.11ax (WiFi 6), up to 242 OFDMA subcarriers
- **Antenna:** 2×2 MIMO for Angle-of-Arrival computation
- **CSI Rate:** Configurable up to 100 Hz
- **Edge AI:** TinyML noise filter (human vs pet vs background)
- **Security:** TLS 1.3, Google OAuth 2.0 hardware handshake
- **LED Ring:** Blue (calibrating) / Green (CSI-only) / Red (offline)

---

## Project Structure

```
echo_maps/
├── ai/                     # Core AI models
│   ├── latent_csi.py       #   CSI → latent → 3D point cloud (VAE)
│   ├── wave_former.py      #   Temporal transformer + vital sign heads
│   ├── cross_modal.py      #   CroSSL contrastive alignment
│   ├── calibration_gan.py  #   Adversarial pose confidence training
│   └── losses.py           #   Training loss functions
├── csi/                    # CSI signal processing
│   ├── parser.py           #   ESP32 / WiFi6 packet parsing
│   ├── filters.py          #   Bandpass, hampel, phase sanitization
│   └── pointcloud.py       #   CSI → 3D point cloud conversion
├── vision/                 # Camera-phase processing
│   └── skeletal.py         #   MediaPipe 3D pose extraction
├── calibration/            # 5-step calibration workflow engine
├── api/                    # FastAPI backend
│   ├── app.py              #   Application factory
│   ├── deps.py             #   Auth / JWT dependencies
│   └── routes/             #   REST + WebSocket endpoints
├── db/                     # Data layer
│   ├── models.py           #   SQLAlchemy models (User, Environment, ActivityLog)
│   ├── session.py          #   Async session management
│   └── vector_store.py     #   Milvus RF signature storage
├── bridge/                 # Illy Bridge communication
│   ├── protocol.py         #   Binary packet protocol (CRC32)
│   └── manager.py          #   Device lifecycle management
├── billing/                # Subscription tier management
├── federated/              # Federated LoRA (Flower)
├── config.py               # Environment configuration
└── __main__.py             # Entry point

firmware/                   # ESP32-S3 firmware (PlatformIO / ESP-IDF)
frontend/                   # Next.js web portal
tests/                      # Test suite
```

---

## Subscription Tiers

| Feature | Personal | Pro |
|:--------|:---------|:----|
| Places (environments) | 2 | 5 |
| 2D/3D Playback | 24 hours | 30 days |
| Activity Detection | ✓ | ✓ |
| Breathing & Heart Rate | — | ✓ |
| Real-time Alerts | — | ✓ |
| Historical Heatmaps | — | 30 days |

---

## Development

### Prerequisites

- Python 3.11+
- Docker & Docker Compose
- Node.js 20+ (frontend)
- PlatformIO (firmware, optional)

### Quick Start

```bash
# Clone
git clone https://github.com/illy-robotics/echo-maps.git
cd echo-maps

# Configure
cp .env.example .env
# Edit .env with your Google OAuth credentials and secrets

# Start all services
docker compose up -d

# Or run backend locally
pip install -e ".[dev]"
python -m echo_maps

# Run tests
pytest
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

---

## Privacy & Security

- **No visual data stored** — Camera is only used during the brief calibration phase, then permanently disabled
- **Federated Learning** — Global model improves without accessing individual user data
- **TLS 1.3** — All bridge-to-cloud communication encrypted
- **Vector DB isolation** — Each environment's RF signatures stored in separate embeddings
- **Google OAuth 2.0** — Hardware-level authentication for Illy Bridge devices
- **OWASP-compliant** — JWT tokens with expiry, parameterized queries, input validation

---

## License

Proprietary — Illy Robotics © 2026

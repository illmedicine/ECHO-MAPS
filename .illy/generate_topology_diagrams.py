"""
Generate Echo Vue Architecture Topology Diagrams as PNG images.
4 Visio-style topology diagrams viewable natively on Windows.
All text labels -- no emoji characters -- fully compatible with Segoe UI.
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "diagrams")
os.makedirs(OUT, exist_ok=True)

C = {
    "bg": "#0B1120", "edge_zone": "#1A2744", "frontend_zone": "#162040",
    "cloud_zone": "#0F2550", "gpu_box": "#4A1A5E", "cpu_box": "#1A3A5E",
    "data_box": "#2A1A3E", "api_box": "#3A1A4E", "queue_box": "#5E1A1A",
    "obs_box": "#1A2E3E", "esp32": "#E94560", "router": "#3498DB",
    "ble": "#2ECC71", "frontend": "#1ABC9C", "text_dim": "#A0B0C0",
    "arrow_tls": "#E94560", "arrow_wss": "#3498DB", "arrow_data": "#2ECC71",
    "title": "#FFFFFF", "hosp_a": "#1A6B3A", "hosp_b": "#1A3A6B",
    "home": "#4A1A5E", "tenant": "#2A0A3E",
}

def _lighten(hc, a=0.3):
    h = hc.lstrip("#")
    r, g, b = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
    return f"#{min(255,int(r+(255-r)*a)):02x}{min(255,int(g+(255-g)*a)):02x}{min(255,int(b+(255-b)*a)):02x}"

def sbox(ax, x, y, w, h, label, color, fs=8, tc="#FFFFFF", bc=None, bw=1.5):
    bc = bc or _lighten(color, 0.3)
    ax.add_patch(FancyBboxPatch((x,y),w,h, boxstyle="round,pad=0.02",
        facecolor=color, edgecolor=bc, linewidth=bw, alpha=0.9, zorder=2))
    ax.text(x+w/2, y+h/2, label, ha="center", va="center", fontsize=fs,
        color=tc, fontweight="bold", zorder=3, fontfamily="Segoe UI")

def zbox(ax, x, y, w, h, label, color, bc=None, fs=10):
    bc = bc or _lighten(color, 0.4)
    ax.add_patch(FancyBboxPatch((x,y),w,h, boxstyle="round,pad=0.01",
        facecolor=color, edgecolor=bc, linewidth=2.5, alpha=0.85, zorder=1))
    if label:
        ax.text(x+0.015, y+h-0.03, label, ha="left", va="top", fontsize=fs,
            color="#FFFFFF", fontweight="bold", zorder=3, fontfamily="Segoe UI",
            bbox=dict(boxstyle="round,pad=0.004", facecolor=bc, alpha=0.6, edgecolor="none"))

def arr(ax, x1, y1, x2, y2, color="#7B8CA0", lw=1.5, label="", fs=6):
    ax.annotate("", xy=(x2,y2), xytext=(x1,y1),
        arrowprops=dict(arrowstyle="-|>", color=color, lw=lw,
        connectionstyle="arc3,rad=0.05"), zorder=4)
    if label:
        mx, my = (x1+x2)/2, (y1+y2)/2
        ax.text(mx, my+0.015, label, ha="center", va="bottom", fontsize=fs,
            color=color, fontweight="bold", fontfamily="Segoe UI", zorder=5,
            bbox=dict(boxstyle="round,pad=0.003", facecolor=C["bg"], alpha=0.7, edgecolor="none"))

def mkfig(title, w=20, h=14):
    fig, ax = plt.subplots(1, 1, figsize=(w, h), facecolor=C["bg"])
    ax.set_facecolor(C["bg"]); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.set_aspect("equal"); ax.axis("off")
    ax.text(0.5, 0.97, title, ha="center", va="top", fontsize=16,
        color=C["title"], fontweight="bold", fontfamily="Segoe UI", zorder=10)
    return fig, ax


# ================================================================
# DIAGRAM 1 -- Full 3-Layer Production Architecture
# ================================================================
def diagram_1():
    fig, ax = mkfig("Echo Vue  --  Production Architecture (3-Layer Cloud-Centric)", 22, 16)

    # -- EDGE --
    zbox(ax, 0.01, 0.02, 0.30, 0.38, "EDGE LAYER -- On-Premise", C["edge_zone"], bc=C["esp32"])
    sbox(ax, 0.03, 0.25, 0.12, 0.07, "[ROUTER]\nWiFi 6 Router\n(CSI Source)", C["router"], fs=7)
    sbox(ax, 0.17, 0.25, 0.12, 0.07, "[ESP32-S3]\nBridge Node\n(Sensor ONLY)", C["esp32"], fs=7)
    sbox(ax, 0.03, 0.14, 0.12, 0.06, "[BLE]\nBLE Devices\nTags / Wearables", C["ble"], fs=6.5)
    sbox(ax, 0.17, 0.14, 0.12, 0.06, "X  NO AI/ML\nX  NO Rendering\nX  NO Storage", "#3A1A1A", fs=6, bc="#E74C3C", tc="#FF6B6B")
    ax.text(0.16, 0.06, "Raw CSI + BLE --> TLS 1.3 --> Cloud", ha="center", fontsize=7,
        color=C["arrow_tls"], fontweight="bold", fontfamily="Segoe UI",
        bbox=dict(boxstyle="round,pad=0.005", facecolor="#1A0A1A", alpha=0.8, edgecolor=C["arrow_tls"]))
    arr(ax, 0.15, 0.285, 0.17, 0.285, C["router"], label="WiFi CSI", fs=5)
    arr(ax, 0.15, 0.17, 0.17, 0.17, C["ble"], label="BLE RSSI", fs=5)

    # -- FRONTEND --
    zbox(ax, 0.34, 0.02, 0.30, 0.38, "FRONTEND -- User Devices (Same Network)", C["frontend_zone"], bc=C["frontend"])
    sbox(ax, 0.36, 0.23, 0.13, 0.09, "[WEB PORTAL]\nEcho Vue\nNext.js / React", C["frontend"], fs=7)
    sbox(ax, 0.51, 0.23, 0.11, 0.09, "[MOBILE]\nApp / Tablet\n(PWA)", C["frontend"], fs=7)
    sbox(ax, 0.36, 0.09, 0.26, 0.10,
        "DISPLAY ONLY:\n+ Render pre-computed vectors\n+ 3D floor plan + avatars\n+ Vitals dashboard + alerts\n-- Zero AI processing --",
        "#0A2A2A", fs=6, bc=C["frontend"], tc="#80E0D0")
    ax.text(0.49, 0.05, "HTTPS / WSS <--> Cloud", ha="center", fontsize=7,
        color=C["arrow_wss"], fontweight="bold", fontfamily="Segoe UI",
        bbox=dict(boxstyle="round,pad=0.005", facecolor="#1A0A1A", alpha=0.8, edgecolor=C["arrow_wss"]))

    # -- CLOUD --
    zbox(ax, 0.01, 0.44, 0.97, 0.50, "CLOUD BACKEND -- AI MBL Engine (Centralized Heavy Compute)", C["cloud_zone"], bc="#533483", fs=12)

    sbox(ax, 0.03, 0.82, 0.28, 0.08,
        "[API GATEWAY]\nTLS Termination | JWT Validation\nRate Limiting | DDoS Protection\nNetwork Origin Verification",
        C["api_box"], fs=6.5, bc="#E94560")
    sbox(ax, 0.34, 0.82, 0.28, 0.08,
        "[TENANT ISOLATION]\nUser UUID Scoping | Env Ownership\nNetwork IP Binding | Tier Enforcement",
        C["tenant"], fs=6.5, bc="#9B59B6")
    sbox(ax, 0.66, 0.82, 0.28, 0.08,
        "[MESSAGE QUEUE]\nKafka / RabbitMQ\nCSI Frame Ingestion\nAsync Job Distribution",
        C["queue_box"], fs=7, bc="#E74C3C")

    # GPU pods
    zbox(ax, 0.03, 0.57, 0.28, 0.22, "GPU Compute Pods", C["gpu_box"], bc="#9B59B6", fs=8)
    sbox(ax, 0.05, 0.70, 0.24, 0.05, "[GPU] LatentCSI Encoder (T4/A100)\nCSI --> 512-dim Vectors", "#5A2A6E", fs=6.5)
    sbox(ax, 0.05, 0.63, 0.24, 0.05, "[GPU] CalibrationGAN Training (A100)\n500-epoch Adversarial Loop", "#5A2A6E", fs=6.5)
    sbox(ax, 0.05, 0.56, 0.24, 0.05, "[GPU] Pose Inference (T4)\n3D Skeletal Reconstruction", "#5A2A6E", fs=6.5)

    # CPU pods
    zbox(ax, 0.34, 0.57, 0.28, 0.22, "CPU Compute Pods", C["cpu_box"], bc="#3498DB", fs=8)
    sbox(ax, 0.36, 0.70, 0.24, 0.05, "[CPU] Kalman Tracker\nMulti-Person State Estimation", "#1A4A6E", fs=6.5)
    sbox(ax, 0.36, 0.63, 0.24, 0.05, "[CPU] CSI Filter Pipeline\nBandpass + Hampel Outlier", "#1A4A6E", fs=6.5)
    sbox(ax, 0.36, 0.56, 0.24, 0.05, "[CPU] RF Signature Engine\nGait + Breathing + Mass", "#1A4A6E", fs=6.5)

    # Data services
    zbox(ax, 0.66, 0.47, 0.28, 0.32, "Managed Data Services", C["data_box"], bc="#E43F5A", fs=8)
    sbox(ax, 0.68, 0.69, 0.24, 0.05, "[DB] PostgreSQL (RDS)\nUsers | Envs | Logs | RLS", "#2A1A4E", fs=6)
    sbox(ax, 0.68, 0.62, 0.24, 0.05, "[VEC] Milvus Vector DB\nRF Embeddings | COSINE Search", "#2A1A4E", fs=6)
    sbox(ax, 0.68, 0.55, 0.24, 0.05, "[CACHE] Redis Cluster\nSession State | PubSub", "#2A1A4E", fs=6)
    sbox(ax, 0.68, 0.48, 0.24, 0.05, "[STORE] Object Storage (S3/GCS)\nFloor Plans | Snapshots", "#2A1A4E", fs=6)

    sbox(ax, 0.34, 0.48, 0.28, 0.06, "[CPU] Vitals Processor\nHeart Rate | Breathing | Fall Detection", "#1A4A6E", fs=6.5, bc="#E74C3C")
    sbox(ax, 0.03, 0.48, 0.28, 0.06, "[OBS] Prometheus -> Grafana + Sentry", C["obs_box"], fs=6.5, bc="#AEB6BF")

    # Cross-layer arrows
    arr(ax, 0.23, 0.34, 0.17, 0.82, C["arrow_tls"], lw=2.5, label="TLS 1.3\nCSI+BLE Stream", fs=6)
    arr(ax, 0.49, 0.36, 0.48, 0.82, C["arrow_wss"], lw=2.5, label="HTTPS/WSS\nCalibration+Queries", fs=6)
    arr(ax, 0.55, 0.82, 0.55, 0.36, C["arrow_data"], lw=2.0, label="Rendered Vectors\n3D Skeletal+Vitals", fs=6)
    for p in [(0.31,0.86,0.34,0.86),(0.62,0.86,0.66,0.86),(0.31,0.68,0.34,0.68),(0.62,0.68,0.66,0.68)]:
        arr(ax, *p, "#A0A0C0", lw=1)

    # Legend
    ax.text(0.68, 0.38, "LEGEND:", fontsize=7, color="#FFF", fontweight="bold", fontfamily="Segoe UI")
    for i,(clr,lbl) in enumerate([(C["arrow_tls"],"TLS 1.3 (ESP32 -> Cloud)"),
        (C["arrow_wss"],"HTTPS/WSS (Frontend <-> Cloud)"),(C["arrow_data"],"Rendered Data Return")]):
        ax.plot([0.68,0.72],[0.36-i*0.02]*2, color=clr, lw=2.5)
        ax.text(0.73, 0.36-i*0.02, lbl, fontsize=6, color=clr, fontfamily="Segoe UI", va="center")

    ax.text(0.5, 0.005, "Echo Vue by Illy Robotics  |  Confidential  |  April 2026",
        ha="center", fontsize=7, color="#506080", fontfamily="Segoe UI")
    p = os.path.join(OUT, "01_Full_Production_Topology.png")
    fig.savefig(p, dpi=200, bbox_inches="tight", facecolor=C["bg"], edgecolor="none")
    plt.close(fig); print(f"  [OK] {p}"); return p


# ================================================================
# DIAGRAM 2 -- Multi-Tenant Network Isolation
# ================================================================
def diagram_2():
    fig, ax = mkfig("Echo Vue -- Multi-Tenant Network Isolation", 22, 14)

    # Tenants
    zbox(ax, 0.01, 0.60, 0.30, 0.30, "Hospital A Network", C["hosp_a"], bc="#2ECC71", fs=9)
    sbox(ax, 0.03, 0.76, 0.12, 0.06, "[ESP32] x12\n(4 per floor)", C["esp32"], fs=6.5)
    sbox(ax, 0.17, 0.76, 0.12, 0.06, "[DEVICES]\nAdmin PC\nNurse Tablets", C["frontend"], fs=6.5)
    sbox(ax, 0.03, 0.64, 0.26, 0.07, "Net: 192.168.1.0/24\nPublic IP: 203.0.113.10\nadmin@hospital-a.com", "#0A3A1A", fs=6, bc="#2ECC71")

    zbox(ax, 0.35, 0.60, 0.30, 0.30, "Hospital B Network", C["hosp_b"], bc="#3498DB", fs=9)
    sbox(ax, 0.37, 0.76, 0.12, 0.06, "[ESP32] x8\n(2 per floor)", C["esp32"], fs=6.5)
    sbox(ax, 0.51, 0.76, 0.12, 0.06, "[DEVICES]\nAdmin PC\nStaff Laptops", C["frontend"], fs=6.5)
    sbox(ax, 0.37, 0.64, 0.26, 0.07, "Net: 10.0.0.0/24\nPublic IP: 198.51.100.20\nadmin@hospital-b.com", "#0A1A3A", fs=6, bc="#3498DB")

    zbox(ax, 0.69, 0.60, 0.30, 0.30, "Home User Network", C["home"], bc="#9B59B6", fs=9)
    sbox(ax, 0.71, 0.76, 0.12, 0.06, "[ESP32] x1", C["esp32"], fs=6.5)
    sbox(ax, 0.85, 0.76, 0.12, 0.06, "[DEVICE]\nUser Laptop", C["frontend"], fs=6.5)
    sbox(ax, 0.71, 0.64, 0.26, 0.07, "Net: 192.168.0.0/24\nPublic IP: 72.14.200.5\njohn@gmail.com", "#2A0A3A", fs=6, bc="#9B59B6")

    # Cloud
    zbox(ax, 0.15, 0.18, 0.70, 0.36, "CLOUD -- Echo Vue AI MBL Engine", C["cloud_zone"], bc="#533483", fs=11)
    sbox(ax, 0.17, 0.42, 0.22, 0.07, "[AUTH]\nJWT Validation\nGoogle OAuth 2.0", C["api_box"], fs=7, bc="#E94560")
    sbox(ax, 0.42, 0.42, 0.22, 0.07, "[NETWORK VERIFY]\nIP Origin Check\nBinding Enforcement", C["api_box"], fs=7, bc="#E94560")
    sbox(ax, 0.67, 0.42, 0.16, 0.07, "[TENANT ROUTER]", C["tenant"], fs=7, bc="#9B59B6")

    sbox(ax, 0.20, 0.26, 0.18, 0.10, "Pipeline A\nHospital A ONLY\n203.0.113.10", C["hosp_a"], fs=6, bc="#2ECC71")
    sbox(ax, 0.42, 0.26, 0.18, 0.10, "Pipeline B\nHospital B ONLY\n198.51.100.20", C["hosp_b"], fs=6, bc="#3498DB")
    sbox(ax, 0.64, 0.26, 0.18, 0.10, "Pipeline C\nHome User ONLY\n72.14.200.5", C["home"], fs=6, bc="#9B59B6")
    sbox(ax, 0.30, 0.19, 0.40, 0.05, "Databases: Row-Level Security (user_id) | Milvus Partitioned (env_id)",
        C["data_box"], fs=6.5, bc="#E43F5A")

    arr(ax, 0.16, 0.60, 0.28, 0.50, C["hosp_a"], lw=2.5, label="TLS 1.3", fs=6)
    arr(ax, 0.50, 0.60, 0.50, 0.50, C["hosp_b"], lw=2.5, label="TLS 1.3", fs=6)
    arr(ax, 0.84, 0.60, 0.73, 0.50, C["home"], lw=2.5, label="TLS 1.3", fs=6)
    arr(ax, 0.39, 0.455, 0.42, 0.455, "#A0A0C0", lw=1)
    arr(ax, 0.64, 0.455, 0.67, 0.455, "#A0A0C0", lw=1)
    arr(ax, 0.75, 0.42, 0.29, 0.37, "#2ECC71", lw=1)
    arr(ax, 0.75, 0.42, 0.51, 0.37, "#3498DB", lw=1)
    arr(ax, 0.75, 0.42, 0.73, 0.37, "#9B59B6", lw=1)

    # Blocked / Allowed
    zbox(ax, 0.01, 0.01, 0.48, 0.14, "[X] BLOCKED SCENARIO", "#3A0A0A", bc="#E74C3C", fs=9)
    sbox(ax, 0.03, 0.04, 0.20, 0.07, "Hospital A Admin\nat HOME\n(IP: 72.14.200.5)", "#5E1A1A", fs=6.5, bc="#E74C3C")
    sbox(ax, 0.26, 0.04, 0.20, 0.07, "ACCESS DENIED\n72.14.200.5 != 203.0.113.10\nMust be on Hosp A network", "#5E1A1A", fs=6, bc="#E74C3C", tc="#FF6B6B")
    arr(ax, 0.23, 0.075, 0.26, 0.075, "#E74C3C", lw=2, label="Scan -->", fs=5)

    zbox(ax, 0.52, 0.01, 0.47, 0.14, "[OK] ALLOWED SCENARIO", "#0A3A1A", bc="#2ECC71", fs=9)
    sbox(ax, 0.54, 0.04, 0.20, 0.07, "Hospital A Admin\nON-SITE\n(IP: 203.0.113.10)", "#1A4A2A", fs=6.5, bc="#2ECC71")
    sbox(ax, 0.77, 0.04, 0.20, 0.07, "ACCESS GRANTED\n203.0.113.10 = 203.0.113.10\nReturns Hosp A ONLY", "#1A4A2A", fs=6, bc="#2ECC71", tc="#80FFB0")
    arr(ax, 0.74, 0.075, 0.77, 0.075, "#2ECC71", lw=2, label="Scan -->", fs=5)

    ax.text(0.5, 0.005, "Echo Vue by Illy Robotics  |  Confidential  |  April 2026",
        ha="center", fontsize=7, color="#506080", fontfamily="Segoe UI")
    p = os.path.join(OUT, "02_MultiTenant_Network_Isolation.png")
    fig.savefig(p, dpi=200, bbox_inches="tight", facecolor=C["bg"], edgecolor="none")
    plt.close(fig); print(f"  [OK] {p}"); return p


# ================================================================
# DIAGRAM 3 -- Data Flow Sequence
# ================================================================
def diagram_3():
    fig, ax = mkfig("Echo Vue -- End-to-End Data Flow (Setup -> Calibration -> Live)", 24, 16)

    cols = {"esp": 0.08, "fe": 0.30, "gw": 0.50, "mbl": 0.70, "db": 0.90}
    cw = 0.14
    hdrs = [("esp","[ESP32 BRIDGE]\nEdge Sensor",C["esp32"]),
            ("fe","[ECHO VUE]\nUser Device",C["frontend"]),
            ("gw","[API GATEWAY]\nCloud Entry",C["api_box"]),
            ("mbl","[AI MBL ENGINE]\nGPU/CPU",C["gpu_box"]),
            ("db","[DATABASES]\nPG+Milvus+Redis",C["data_box"])]
    for k, l, c in hdrs:
        x = cols[k]
        sbox(ax, x, 0.88, cw, 0.06, l, c, fs=6.5, bc=_lighten(c, 0.3))
        ax.plot([x + cw/2]*2, [0.04, 0.88], color="#304060", lw=1, ls="--", zorder=1)

    # Phase 1 -- Auth
    y = 0.84
    ax.text(0.02, y, "PHASE 1:\nAUTH &\nSETUP", fontsize=7, color="#FFD700",
        fontweight="bold", fontfamily="Segoe UI", va="top")
    zbox(ax, 0.01, y-0.14, 0.98, 0.15, "", C["bg"], bc="#FFD700", fs=1)

    y = 0.82
    arr(ax, cols["fe"]+cw, y, cols["gw"], y, C["arrow_wss"], lw=2, label="POST /auth/google/verify", fs=5)
    y -= 0.03
    arr(ax, cols["gw"]+cw, y, cols["db"], y, "#A0A0C0", lw=1.5, label="Upsert User + check tier", fs=5)
    y -= 0.03
    arr(ax, cols["gw"], y, cols["fe"]+cw, y, C["arrow_data"], lw=2, label="JWT Token (24h)", fs=5)
    y -= 0.03
    arr(ax, cols["fe"]+cw, y, cols["gw"], y, C["arrow_wss"], lw=2, label="POST /environments (+network_id)", fs=5)
    y -= 0.03
    arr(ax, cols["gw"]+cw, y, cols["db"], y, "#A0A0C0", lw=1.5, label="Create env (user_id, network_ip)", fs=5)

    # Phase 2 -- Calibration
    y2 = 0.63
    ax.text(0.02, y2+0.02, "PHASE 2:\nCALIB.\n(Camera ON)", fontsize=6.5, color="#FF6B6B",
        fontweight="bold", fontfamily="Segoe UI", va="top")
    zbox(ax, 0.01, y2-0.18, 0.98, 0.21, "", C["bg"], bc="#E94560", fs=1)

    arr(ax, cols["fe"]+cw, y2, cols["gw"], y2, C["arrow_wss"], lw=2, label="WSS /calibration/stream", fs=5)
    ax.text(cols["fe"]+0.01, y2-0.015, "(CSI + MoveNet keypoints)", fontsize=5,
        color=C["text_dim"], fontfamily="Segoe UI")
    y2 -= 0.04
    arr(ax, cols["gw"]+cw, y2, cols["mbl"], y2, "#A0A0C0", lw=1.5, label="Forward paired data", fs=5)
    for t in ["LatentCSI encode -> 512-dim", "CalibrationGAN train (500 epochs)",
              "RF Signature extract (gait+breath+mass)"]:
        y2 -= 0.025
        ax.text(cols["mbl"]+0.01, y2, t, fontsize=5.5, color="#DDA0DD",
            fontweight="bold", fontfamily="Segoe UI")
    y2 -= 0.03
    arr(ax, cols["mbl"]+cw, y2, cols["db"], y2, "#A0A0C0", lw=1.5, label="Store embeddings (Milvus)", fs=5)
    y2 -= 0.035
    arr(ax, cols["gw"], y2, cols["fe"]+cw, y2, C["arrow_data"], lw=2, label="Calibration complete -> Camera OFF", fs=5)

    # Phase 3 -- Live
    y3 = 0.37
    ax.text(0.02, y3+0.02, "PHASE 3-5:\nLIVE\n(Camera OFF)", fontsize=6.5, color="#2ECC71",
        fontweight="bold", fontfamily="Segoe UI", va="top")
    zbox(ax, 0.01, y3-0.24, 0.98, 0.27, "", C["bg"], bc="#2ECC71", fs=1)
    sbox(ax, 0.06, y3-0.22, 0.05, 0.24, "LOOP\nevery\n100ms", "#0A2A0A", fs=5.5, bc="#2ECC71", tc="#80FFB0")

    arr(ax, cols["esp"]+cw, y3, cols["gw"], y3, C["arrow_tls"], lw=2.5, label="CSI frame (TLS 1.3)", fs=5)
    y3 -= 0.035
    arr(ax, cols["gw"]+cw, y3, cols["mbl"], y3, "#A0A0C0", lw=1.5, label="Verify network -> forward", fs=5)
    for t in ["CSI filter (bandpass + outlier)", "LatentCSI decode -> pose vectors",
              "Kalman tracking (multi-person)", "Vitals: HR, breathing, fall detect"]:
        y3 -= 0.025
        ax.text(cols["mbl"]+0.01, y3, t, fontsize=5.5, color="#87CEEB",
            fontweight="bold", fontfamily="Segoe UI")
    y3 -= 0.03
    arr(ax, cols["mbl"]+cw, y3, cols["db"], y3, "#A0A0C0", lw=1.5, label="Update Redis cache", fs=5)
    y3 -= 0.04
    arr(ax, cols["gw"], y3, cols["fe"]+cw, y3, C["arrow_data"], lw=2.5, label="Tracking snapshot + vitals + alerts", fs=5)
    y3 -= 0.025
    ax.text(cols["fe"]+0.01, y3, "Frontend renders pre-computed vectors", fontsize=5.5,
        color="#80E0D0", fontweight="bold", fontfamily="Segoe UI")
    ax.text(cols["fe"]+0.01, y3-0.02, "ZERO AI PROCESSING ON FRONTEND", fontsize=6,
        color="#FF6B6B", fontweight="bold", fontfamily="Segoe UI")

    ax.text(0.5, 0.005, "Echo Vue by Illy Robotics  |  Confidential  |  April 2026",
        ha="center", fontsize=7, color="#506080", fontfamily="Segoe UI")
    p = os.path.join(OUT, "03_Data_Flow_Sequence.png")
    fig.savefig(p, dpi=200, bbox_inches="tight", facecolor=C["bg"], edgecolor="none")
    plt.close(fig); print(f"  [OK] {p}"); return p


# ================================================================
# DIAGRAM 4 -- Processing Distribution
# ================================================================
def diagram_4():
    fig, ax = mkfig("Echo Vue -- Processing Distribution (What Runs Where)", 20, 12)
    cx = [0.02, 0.35, 0.68]; cw = 0.30; zh = 0.82

    # Edge column
    zbox(ax, cx[0], 0.08, cw, zh, "EDGE (ESP32-S3)", C["edge_zone"], bc=C["esp32"], fs=10)
    for i, (t, d) in enumerate([
        ("[SENSOR] Raw CSI Extraction", "242 subcarriers x 2x2 MIMO\n100 Hz sampling rate"),
        ("[BLE] Passive Scanning", "RSSI + MAC advertisements\nBatch to cloud"),
        ("[TLS] 1.3 Streaming", "Encrypted transport to cloud\nNo data stored locally"),
        ("[LED] Status Ring", "Local visual feedback only\nNo computation"),
    ]):
        sbox(ax, cx[0]+0.02, 0.72-i*0.14, cw-0.04, 0.10, f"{t}\n{d}",
            "#2A1020", fs=6.5, bc=C["esp32"])
    sbox(ax, cx[0]+0.02, 0.12, cw-0.04, 0.10,
        "X  NO AI / ML\nX  NO Rendering\nX  NO Storage\nX  NO Decisions",
        "#3A0A0A", fs=7, bc="#E74C3C", tc="#FF6B6B")

    # Cloud column
    zbox(ax, cx[1], 0.08, cw, zh, "CLOUD (AI MBL Engine)", C["cloud_zone"], bc="#533483", fs=10)
    for i, (t, d, c) in enumerate([
        ("[GPU] LatentCSI Encoding", "CSI->512-dim | T4/A100", C["gpu_box"]),
        ("[GPU] CalibrationGAN", "500-epoch adv. | A100", C["gpu_box"]),
        ("[GPU] Pose Inference", "3D skeletal | T4", C["gpu_box"]),
        ("[CPU] CSI Filtering", "Bandpass+Hampel | Stateful", C["cpu_box"]),
        ("[CPU] Kalman Tracking", "6-state multi-person", C["cpu_box"]),
        ("[CPU] RF Signatures", "Gait+breath+mass->Milvus", C["cpu_box"]),
        ("[CPU] Vitals", "HR, breathing, falls", C["cpu_box"]),
    ]):
        sbox(ax, cx[1]+0.02, 0.74-i*0.085, cw-0.04, 0.065, f"{t}\n{d}",
            c, fs=6, bc=_lighten(c, 0.3))

    # Frontend column
    zbox(ax, cx[2], 0.08, cw, zh, "FRONTEND (User Device)", C["frontend_zone"], bc=C["frontend"], fs=10)
    for i, (t, d) in enumerate([
        ("[VIEW] 3D Floor Plan", "Pre-computed vectors\nfrom cloud backend"),
        ("[VIEW] Avatar Overlay", "Skeletal avatars on\nfloor plan positions"),
        ("[VIEW] Vitals Dashboard", "HR, breathing, alerts\nfrom cloud snapshots"),
        ("[SETUP] Calibration UI", "MoveNet keypoints\nsetup ONLY (not live)"),
    ]):
        sbox(ax, cx[2]+0.02, 0.72-i*0.14, cw-0.04, 0.10, f"{t}\n{d}",
            "#0A2A2A", fs=6.5, bc=C["frontend"])
    sbox(ax, cx[2]+0.02, 0.12, cw-0.04, 0.10,
        "+ Display ONLY\n+ Renders vectors from cloud\n+ No AI in production\n+ Same-network required",
        "#0A3A2A", fs=7, bc="#2ECC71", tc="#80FFB0")

    # Cross-column arrows
    arr(ax, cx[0]+cw, 0.53, cx[1], 0.53, C["arrow_tls"], lw=2.5, label="CSI + BLE Stream", fs=6)
    arr(ax, cx[0]+cw, 0.60, cx[1], 0.60, C["arrow_tls"], lw=2)
    arr(ax, cx[0]+cw, 0.45, cx[1], 0.45, C["arrow_tls"], lw=2)
    arr(ax, cx[1]+cw, 0.53, cx[2], 0.53, C["arrow_data"], lw=2.5, label="Rendered Vectors + Vitals", fs=6)
    arr(ax, cx[1]+cw, 0.45, cx[2], 0.45, C["arrow_data"], lw=2)

    ax.text(0.5, 0.005, "Echo Vue by Illy Robotics  |  Confidential  |  April 2026",
        ha="center", fontsize=7, color="#506080", fontfamily="Segoe UI")
    p = os.path.join(OUT, "04_Processing_Distribution.png")
    fig.savefig(p, dpi=200, bbox_inches="tight", facecolor=C["bg"], edgecolor="none")
    plt.close(fig); print(f"  [OK] {p}"); return p


if __name__ == "__main__":
    print("Generating Echo Vue Architecture Topology Diagrams...\n")
    for fn in [diagram_1, diagram_2, diagram_3, diagram_4]:
        fn()
    print(f"\nAll 4 diagrams saved to: {OUT}")
    print("Open with Windows Photo Viewer or any image viewer.")

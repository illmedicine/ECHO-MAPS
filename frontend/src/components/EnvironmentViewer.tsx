"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";

/**
 * 3D Environment Viewer — renders the CSI-derived point cloud,
 * skeletal pose overlay, and multi-person tracking with ghost states.
 *
 * Uses frameloop="demand" to avoid competing with TF.js for GPU contexts.
 * An Invalidator component triggers re-renders at a throttled rate.
 */

/** Triggers re-renders at ~20fps when live, stops when static */
function Invalidator({ isLive, compact = false }: { isLive: boolean; compact?: boolean }) {
  const { invalidate: inv } = useThree();
  useEffect(() => {
    if (!isLive) return;
    const interval = compact ? 125 : 50; // ~8fps during calibration, ~20fps normal
    const id = setInterval(() => inv(), interval);
    return () => clearInterval(id);
  }, [isLive, inv, compact]);
  return null;
}

interface PointCloudProps {
  points: number[][]; // [[x, y, z], ...]
  color?: string;
  size?: number;
}

function PointCloud({ points, color = "#00cc88", size = 0.05 }: PointCloudProps) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(points.flat());
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [points]);

  return (
    <points geometry={geometry}>
      <pointsMaterial color={color} size={size} sizeAttenuation />
    </points>
  );
}

interface SkeletonProps {
  keypoints: number[][]; // 33 × [x, y, z]
  opacity?: number;
  color?: string;
  sourceType?: "csi" | "camera" | "simulated" | "disconnected";
}

/* Full MediaPipe Pose 33-keypoint connections with body-part grouping */
const BODY_CONNECTIONS: { joints: [number, number]; group: string; radius: number }[] = [
  // Face
  { joints: [0, 1], group: "face", radius: 0.008 },
  { joints: [1, 2], group: "face", radius: 0.008 },
  { joints: [2, 3], group: "face", radius: 0.008 },
  { joints: [3, 7], group: "face", radius: 0.008 },
  { joints: [0, 4], group: "face", radius: 0.008 },
  { joints: [4, 5], group: "face", radius: 0.008 },
  { joints: [5, 6], group: "face", radius: 0.008 },
  { joints: [6, 8], group: "face", radius: 0.008 },
  { joints: [9, 10], group: "face", radius: 0.008 },
  // Torso
  { joints: [11, 12], group: "torso", radius: 0.025 },
  { joints: [11, 23], group: "torso", radius: 0.022 },
  { joints: [12, 24], group: "torso", radius: 0.022 },
  { joints: [23, 24], group: "torso", radius: 0.022 },
  // Left arm
  { joints: [11, 13], group: "leftArm", radius: 0.018 },
  { joints: [13, 15], group: "leftArm", radius: 0.015 },
  { joints: [15, 17], group: "leftHand", radius: 0.008 },
  { joints: [15, 19], group: "leftHand", radius: 0.008 },
  { joints: [15, 21], group: "leftHand", radius: 0.008 },
  { joints: [17, 19], group: "leftHand", radius: 0.006 },
  // Right arm
  { joints: [12, 14], group: "rightArm", radius: 0.018 },
  { joints: [14, 16], group: "rightArm", radius: 0.015 },
  { joints: [16, 18], group: "rightHand", radius: 0.008 },
  { joints: [16, 20], group: "rightHand", radius: 0.008 },
  { joints: [16, 22], group: "rightHand", radius: 0.008 },
  { joints: [18, 20], group: "rightHand", radius: 0.006 },
  // Left leg
  { joints: [23, 25], group: "leftLeg", radius: 0.022 },
  { joints: [25, 27], group: "leftLeg", radius: 0.018 },
  { joints: [27, 29], group: "leftFoot", radius: 0.012 },
  { joints: [27, 31], group: "leftFoot", radius: 0.012 },
  { joints: [29, 31], group: "leftFoot", radius: 0.008 },
  // Right leg
  { joints: [24, 26], group: "rightLeg", radius: 0.022 },
  { joints: [26, 28], group: "rightLeg", radius: 0.018 },
  { joints: [28, 30], group: "rightFoot", radius: 0.012 },
  { joints: [28, 32], group: "rightFoot", radius: 0.012 },
  { joints: [30, 32], group: "rightFoot", radius: 0.008 },
];

const GROUP_COLORS: Record<string, string> = {
  face: "#88aaff",
  torso: "#0088ff",
  leftArm: "#00bbcc",
  rightArm: "#00bbcc",
  leftHand: "#00ddaa",
  rightHand: "#00ddaa",
  leftLeg: "#6644ff",
  rightLeg: "#6644ff",
  leftFoot: "#8866ff",
  rightFoot: "#8866ff",
};

const JOINT_SIZES: Record<string, number> = {
  face: 0.015,
  torso: 0.035,
  leftArm: 0.025,
  rightArm: 0.025,
  leftHand: 0.015,
  rightHand: 0.015,
  leftLeg: 0.03,
  rightLeg: 0.03,
  leftFoot: 0.02,
  rightFoot: 0.02,
};

function getJointGroup(idx: number): string {
  if (idx <= 10) return "face";
  if (idx === 11 || idx === 12 || idx === 23 || idx === 24) return "torso";
  if (idx === 13 || idx === 15) return "leftArm";
  if (idx === 14 || idx === 16) return "rightArm";
  if (idx === 17 || idx === 19 || idx === 21) return "leftHand";
  if (idx === 18 || idx === 20 || idx === 22) return "rightHand";
  if (idx === 25 || idx === 27) return "leftLeg";
  if (idx === 26 || idx === 28) return "rightLeg";
  if (idx === 29 || idx === 31) return "leftFoot";
  if (idx === 30 || idx === 32) return "rightFoot";
  return "torso";
}

/** Bone rendered as a cylinder between two joints */
function Bone({
  start,
  end,
  radius,
  color,
  opacity,
}: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
  color: string;
  opacity: number;
}) {
  const { position, quaternion, length } = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const quat = new THREE.Quaternion();
    if (len > 0.001) {
      const up = new THREE.Vector3(0, 1, 0);
      quat.setFromUnitVectors(up, dir.clone().normalize());
    }
    return { position: mid, quaternion: quat, length: len };
  }, [start, end]);

  if (length < 0.001) return null;

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius * 1.1, length, 8]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={opacity}
        roughness={0.4}
        metalness={0.1}
      />
    </mesh>
  );
}

/** Smoothly interpolated skeleton with per-frame lerping */
function LiveSkeleton({ keypoints, opacity = 1.0, color, sourceType = "simulated" }: SkeletonProps) {
  const currentRef = useRef<number[][]>(keypoints);
  const groupRef = useRef<THREE.Group>(null);

  // Smooth lerp toward target keypoints each frame
  useFrame(() => {
    if (keypoints.length === 0) return;
    const lerp = 0.25; // smooth factor — higher = snappier
    currentRef.current = keypoints.map((target, i) => {
      const prev = currentRef.current[i] ?? target;
      return [
        prev[0] + (target[0] - prev[0]) * lerp,
        prev[1] + (target[1] - prev[1]) * lerp,
        prev[2] + (target[2] - prev[2]) * lerp,
      ];
    });
  });

  const kp = currentRef.current.length === keypoints.length ? currentRef.current : keypoints;
  if (kp.length < 33) return null;

  const useGroupColors = !color;
  const baseOpacity = opacity;
  const sourceGlow = sourceType === "csi" ? "#00ff88" : sourceType === "camera" ? "#ffcc00" : "#0066ff";

  return (
    <group ref={groupRef}>
      {/* Bones — cylinders between joints */}
      {BODY_CONNECTIONS.map((conn, i) => {
        const [a, b] = conn.joints;
        if (!kp[a] || !kp[b]) return null;
        const boneColor = useGroupColors ? (GROUP_COLORS[conn.group] ?? "#0066ff") : color!;
        return (
          <Bone
            key={`bone-${i}`}
            start={new THREE.Vector3(kp[a][0], kp[a][1], kp[a][2])}
            end={new THREE.Vector3(kp[b][0], kp[b][1], kp[b][2])}
            radius={conn.radius}
            color={boneColor}
            opacity={baseOpacity * 0.85}
          />
        );
      })}

      {/* Joints — spheres at each keypoint */}
      {kp.map((point, i) => {
        const group = getJointGroup(i);
        const size = JOINT_SIZES[group] ?? 0.02;
        const jointColor = useGroupColors ? (GROUP_COLORS[group] ?? "#0066ff") : color!;
        return (
          <mesh key={`joint-${i}`} position={[point[0], point[1], point[2]]}>
            <sphereGeometry args={[size, 12, 12]} />
            <meshStandardMaterial
              color={jointColor}
              transparent
              opacity={baseOpacity}
              emissive={jointColor}
              emissiveIntensity={0.15}
              roughness={0.3}
              metalness={0.2}
            />
          </mesh>
        );
      })}

      {/* Head sphere — larger, semi-transparent */}
      {kp[0] && (
        <mesh position={[kp[0][0], kp[0][1] + 0.05, kp[0][2]]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial
            color={sourceGlow}
            transparent
            opacity={baseOpacity * 0.25}
            roughness={0.5}
          />
        </mesh>
      )}

      {/* Source indicator glow at chest center */}
      {kp[11] && kp[12] && (
        <mesh position={[
          (kp[11][0] + kp[12][0]) / 2,
          (kp[11][1] + kp[12][1]) / 2,
          (kp[11][2] + kp[12][2]) / 2,
        ]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshBasicMaterial color={sourceGlow} transparent opacity={baseOpacity * 0.6} />
        </mesh>
      )}
    </group>
  );
}

/** Phase 4–5: Tracked person indicator (position dot + confidence ring) */
interface TrackedPersonMarkerProps {
  position: number[];  // [x, y, z]
  userTag: string;
  confidence: number;
  isGhosted: boolean;
  isRegistered: boolean;
}

function TrackedPersonMarker({
  position,
  confidence,
  isGhosted,
  isRegistered,
}: TrackedPersonMarkerProps) {
  const color = isGhosted ? "#eab308" : isRegistered ? "#00cc88" : "#0066ff";
  const opacity = isGhosted ? 0.35 : Math.max(0.5, confidence);
  const ringScale = 0.3 + confidence * 0.2;

  return (
    <group position={[position[0], position[1], position[2]]}>
      {/* Core dot */}
      <mesh>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      {/* Confidence ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.14, 0]}>
        <ringGeometry args={[ringScale, ringScale + 0.05, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isGhosted ? 0.2 : 0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

interface TrackedPerson {
  track_id: string;
  user_tag: string;
  position: number[];
  velocity: number[];
  speed: number;
  confidence: number;
  is_registered: boolean;
  is_ghosted: boolean;
  last_activity: string;
  skeleton?: number[][];
  device_mac_suffix?: string | null;
  device_tether_status?: string;
  device_rssi?: number | null;
  device_distance_m?: number | null;
}

interface EnvironmentViewerProps {
  pointCloud?: number[][];
  skeleton?: number[][];
  skeletonGhosted?: boolean;
  trackedPersons?: TrackedPerson[];
  roomBounds?: [number, number, number];
  sourceType?: "csi" | "camera" | "simulated" | "disconnected";
  isLive?: boolean;
  /** Compact mode: smaller canvas & lower GPU usage (used during calibration) */
  compact?: boolean;
}

export default function EnvironmentViewer({
  pointCloud = [],
  skeleton = [],
  skeletonGhosted = false,
  trackedPersons = [],
  roomBounds = [10, 10, 3.5],
  sourceType = "simulated",
  isLive = false,
  compact = false,
}: EnvironmentViewerProps) {
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const contextLossCountRef = useRef(0);

  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    const canvas = gl.domElement;
    const onLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
      contextLossCountRef.current++;
      // Auto-recover after a delay, up to 6 times to handle calibration GPU contention
      if (contextLossCountRef.current <= 6) {
        setTimeout(() => {
          setContextLost(false);
          setCanvasKey((k) => k + 1);
        }, compact ? 3000 : 2000);
      }
    };
    const onRestored = () => {
      setContextLost(false);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
  }, []);

  const viewerHeight = compact ? "350px" : "calc(100vh - 10rem)";
  const viewerMinHeight = compact ? "250px" : "500px";

  if (contextLost) {
    return (
      <div className="w-full bg-[var(--illy-dark)] rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center" style={{ height: viewerHeight, minHeight: viewerMinHeight }}>
        <div className="text-center">
          <p className="text-2xl mb-2">🔄</p>
          <p className="text-sm font-medium" style={{ color: "var(--gh-text-muted)" }}>{compact ? "Recovering 3D view..." : "3D context lost"}</p>
          {!compact && (
            <button
              onClick={() => { setContextLost(false); setCanvasKey((k) => k + 1); }}
              className="mt-3 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: "var(--gh-blue)" }}
            >
              Reload Viewer
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-[var(--illy-dark)] rounded-xl overflow-hidden border border-gray-800" style={{ height: viewerHeight, minHeight: viewerMinHeight }}>
      <Canvas key={canvasKey} camera={{ position: compact ? [6, 4.5, 6] : [8, 6, 8], fov: 50 }} onCreated={handleCreated} frameloop="demand" gl={{ powerPreference: compact ? "low-power" : "default", antialias: false, alpha: false, stencil: false, depth: true, failIfMajorPerformanceCaveat: false }}>
        <Invalidator isLive={isLive} compact={compact} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[10, 10, 5]} intensity={0.5} />

        {/* Floor grid */}
        <Grid
          args={[roomBounds[0], roomBounds[1]]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#1a2040"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#2a3060"
          fadeDistance={30}
          position={[roomBounds[0] / 2, 0, roomBounds[1] / 2]}
        />

        {/* Room wireframe */}
        <lineSegments>
          <edgesGeometry
            args={[new THREE.BoxGeometry(roomBounds[0], roomBounds[2], roomBounds[1])]}
          />
          <lineBasicMaterial color="#333" />
        </lineSegments>

        {/* CSI Point Cloud */}
        {pointCloud.length > 0 && <PointCloud points={pointCloud} />}

        {/* Live Skeletal Overlay — full MediaPipe 33-point body */}
        {skeleton.length > 0 && (
          <LiveSkeleton
            keypoints={skeleton}
            opacity={skeletonGhosted ? 0.3 : 1.0}
            color={skeletonGhosted ? "#eab308" : undefined}
            sourceType={sourceType}
          />
        )}

        {/* Per-person skeletons from multi-person tracking */}
        {trackedPersons.map((person) => (
          <group key={person.track_id}>
            {person.skeleton && person.skeleton.length >= 33 && (
              <LiveSkeleton
                keypoints={person.skeleton}
                opacity={person.is_ghosted ? 0.3 : Math.max(0.5, person.confidence)}
                color={person.is_ghosted ? "#eab308" : undefined}
                sourceType={sourceType}
              />
            )}
            <TrackedPersonMarker
              position={person.position}
              userTag={person.user_tag}
              confidence={person.confidence}
              isGhosted={person.is_ghosted}
              isRegistered={person.is_registered}
            />
          </group>
        ))}

        <OrbitControls enableDamping dampingFactor={0.05} makeDefault />

        {/* Live indicator light */}
        {isLive && (
          <pointLight
            position={[roomBounds[0] / 2, roomBounds[2], roomBounds[1] / 2]}
            color={sourceType === "csi" ? "#00ff88" : sourceType === "camera" ? "#ffcc00" : "#0066ff"}
            intensity={0.3}
            distance={15}
          />
        )}
      </Canvas>
    </div>
  );
}

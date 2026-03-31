"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";

/**
 * 3D Environment Viewer — renders the CSI-derived point cloud
 * and skeletal pose overlay on a floor-plan grid.
 */

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
}

const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // torso + arms
  [11, 23], [12, 24], [23, 24],                       // hips
  [23, 25], [25, 27], [24, 26], [26, 28],             // legs
  [0, 1], [1, 2], [2, 3], [3, 7],                     // face
];

function Skeleton({ keypoints }: SkeletonProps) {
  const lines = useMemo(() => {
    return POSE_CONNECTIONS.map(([a, b]) => {
      if (!keypoints[a] || !keypoints[b]) return null;
      const points = [
        new THREE.Vector3(...keypoints[a]),
        new THREE.Vector3(...keypoints[b]),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      return geometry;
    }).filter(Boolean) as THREE.BufferGeometry[];
  }, [keypoints]);

  return (
    <group>
      {lines.map((geo, i) => (
        <line key={i} geometry={geo}>
          <lineBasicMaterial color="#0066ff" linewidth={2} />
        </line>
      ))}
      {keypoints.map((kp, i) => (
        <mesh key={i} position={[kp[0], kp[1], kp[2]]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshBasicMaterial color="#0066ff" />
        </mesh>
      ))}
    </group>
  );
}

interface EnvironmentViewerProps {
  pointCloud?: number[][];
  skeleton?: number[][];
  roomBounds?: [number, number, number];
}

export default function EnvironmentViewer({
  pointCloud = [],
  skeleton = [],
  roomBounds = [10, 10, 3.5],
}: EnvironmentViewerProps) {
  return (
    <div className="w-full h-[600px] bg-[var(--illy-dark)] rounded-xl overflow-hidden border border-gray-800">
      <Canvas camera={{ position: [8, 6, 8], fov: 50 }}>
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

        {/* Skeletal Overlay */}
        {skeleton.length > 0 && <Skeleton keypoints={skeleton} />}

        <OrbitControls enableDamping dampingFactor={0.05} />
      </Canvas>
    </div>
  );
}

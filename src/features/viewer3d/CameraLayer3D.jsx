import React, { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useCameraStore } from '@/store/useCameraStore'
import { useWallStore } from '@/store/useWallStore'
import { buildBlockingSegments, computeFovPolygon } from '@/features/cameras/fovPolygon'

// Surveillance cameras in 3D (Phase 34): a small CCTV body at mount height
// aimed along its azimuth, plus the wall-clipped FOV visibility polygon laid
// flat on the floor (same fovPolygon engine as 2D, so glass/window
// transparency and 360° panoramas behave identically). Rendered only while
// the editor is in CAMERA mode (Viewer3D gates the mount).

const CAMERA_COLOR = '#10b981'
const BODY_COLOR = '#e2e8f0'
const FOV_ALPHA = 0.16

// Canvas px → world: (x, y) ↦ (x·pxToM, h, y·pxToM); yaw = −atan2 (wall conv).
function CameraBody({ camera, pxToM, dimOpacity }) {
  const x = camera.x * pxToM
  const z = camera.y * pxToM
  const y = Math.max(0.3, camera.z ?? 2.5)
  const yaw = -((camera.azimuth ?? 0) * Math.PI / 180)
  const transparent = dimOpacity < 1
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      {/* body — small housing box, long axis = view axis */}
      <mesh castShadow>
        <boxGeometry args={[0.42, 0.16, 0.16]} />
        <meshStandardMaterial
          color={BODY_COLOR} roughness={0.6} metalness={0.2}
          transparent={transparent} opacity={dimOpacity} depthWrite={!transparent}
        />
      </mesh>
      {/* lens ring at the front */}
      <mesh position={[0.24, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.09, 0.08, 16]} />
        <meshStandardMaterial
          color={CAMERA_COLOR} roughness={0.4} metalness={0.3}
          transparent={transparent} opacity={dimOpacity} depthWrite={!transparent}
        />
      </mesh>
      {/* wall/ceiling stem so the body doesn't float unexplained */}
      <mesh position={[-0.18, 0.12, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.24, 8]} />
        <meshStandardMaterial
          color="#64748b"
          transparent={transparent} opacity={dimOpacity} depthWrite={!transparent}
        />
      </mesh>
    </group>
  )
}

// Flat translucent visibility polygon on the floor. Shape is authored in
// canvas-metric XY and rotated +90° about X so shape-Y lands on world +Z.
function FovGround({ poly, pxToM, dimOpacity }) {
  const geometry = useMemo(() => {
    if (!poly || poly.length < 6) return null
    const shape = new THREE.Shape()
    shape.moveTo(poly[0] * pxToM, poly[1] * pxToM)
    for (let i = 2; i < poly.length; i += 2) {
      shape.lineTo(poly[i] * pxToM, poly[i + 1] * pxToM)
    }
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [poly, pxToM])

  useEffect(() => () => { if (geometry) geometry.dispose() }, [geometry])
  if (!geometry) return null

  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <primitive object={geometry} attach="geometry" />
      <meshBasicMaterial
        color={CAMERA_COLOR}
        transparent
        opacity={FOV_ALPHA * dimOpacity}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

export default function CameraLayer3D({ floorId, pxToM, dimOpacity = 1 }) {
  const cameras = useCameraStore((s) => s.camerasByFloor[floorId] ?? [])
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? [])

  const segments = useMemo(() => buildBlockingSegments(walls), [walls])
  const polys = useMemo(() => cameras.map((cam) => computeFovPolygon({
    cx: cam.x,
    cy: cam.y,
    azimuthDeg: cam.azimuth ?? 0,
    fovDeg: cam.fovDeg ?? 90,
    rangePx: Math.max(1, (cam.rangeM ?? 12) / pxToM),
    segments,
  })), [cameras, segments, pxToM])

  if (!cameras.length || !pxToM) return null
  return (
    <group>
      {cameras.map((cam, i) => (
        <group key={cam.id}>
          <CameraBody camera={cam} pxToM={pxToM} dimOpacity={dimOpacity} />
          {polys[i] && <FovGround poly={polys[i]} pxToM={pxToM} dimOpacity={dimOpacity} />}
        </group>
      ))}
    </group>
  )
}

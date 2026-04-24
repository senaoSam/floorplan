import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useWallStore } from '@/store/useWallStore'

// Fixed visual thickness for wall boxes (meters). Walls are semantically 2D
// line segments in the rest of the app, so we pick a small value that still
// renders clearly in 3D without distorting the floorplan's geometry.
const WALL_THICKNESS_M = 0.1

// Default color when a wall's material has no color attribute (shouldn't
// happen for materials from constants/materials.js, but mock imports might).
const DEFAULT_WALL_COLOR = '#94a3b8'

function WallMesh({ wall, pxToM }) {
  const {
    startX, startY, endX, endY,
    topHeight = 3, bottomHeight = 0,
    material,
  } = wall

  // Derive box dimensions + pose in world units.
  const { length, height, center, rotationY } = useMemo(() => {
    const x1 = startX * pxToM, z1 = startY * pxToM
    const x2 = endX   * pxToM, z2 = endY   * pxToM
    const dx = x2 - x1, dz = z2 - z1
    const len = Math.sqrt(dx * dx + dz * dz)
    const h = Math.max(topHeight - bottomHeight, 0.01)
    return {
      length: len,
      height: h,
      center: [
        (x1 + x2) / 2,
        bottomHeight + h / 2,
        (z1 + z2) / 2,
      ],
      // Box is authored along local +X. atan2(dz, dx) rotates around +Y so
      // the box's long axis lines up with the wall segment.
      rotationY: -Math.atan2(dz, dx),
    }
  }, [startX, startY, endX, endY, topHeight, bottomHeight, pxToM])

  if (length === 0) return null

  const color = material?.color ?? DEFAULT_WALL_COLOR

  return (
    <mesh
      position={center}
      rotation={[0, rotationY, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[length, height, WALL_THICKNESS_M]} />
      <meshStandardMaterial
        color={color}
        roughness={0.85}
        metalness={0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export default function WallLayer3D({ floorId, pxToM }) {
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
  if (!walls.length || !pxToM) return null
  return (
    <group>
      {walls.map((w) => (
        <WallMesh key={w.id} wall={w} pxToM={pxToM} />
      ))}
    </group>
  )
}

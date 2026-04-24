import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useWallStore } from '@/store/useWallStore'
import OpeningsDetail from './OpeningDetail3D'

// Fixed visual thickness for wall boxes (meters). Walls are semantically 2D
// line segments in the rest of the app, so we pick a small value that still
// renders clearly in 3D without distorting the floorplan's geometry.
const WALL_THICKNESS_M = 0.1

// Default color when a wall's material has no color attribute (shouldn't
// happen for materials from constants/materials.js, but mock imports might).
const DEFAULT_WALL_COLOR = '#94a3b8'

// Build an ExtrudeGeometry for a wall segment whose "side view" is a rectangle
// of size length × height with rectangular holes per opening. Geometry is
// authored centered on (0, 0, 0) so the caller can position it with a single
// center translate + Y rotate, matching the no-openings Box path.
function buildWallGeometry(length, height, openings, wallBottom, thickness) {
  const halfL = length / 2
  const halfH = height / 2

  const shape = new THREE.Shape()
  shape.moveTo(-halfL, -halfH)
  shape.lineTo( halfL, -halfH)
  shape.lineTo( halfL,  halfH)
  shape.lineTo(-halfL,  halfH)
  shape.lineTo(-halfL, -halfH)

  for (const op of openings ?? []) {
    const s = Math.max(0, Math.min(1, op.startFrac ?? 0))
    const e = Math.max(0, Math.min(1, op.endFrac   ?? 0))
    if (e <= s) continue

    // Opening height range is stored in absolute meters; convert to wall-local.
    const opBottom = (op.bottomHeight ?? 0) - wallBottom
    const opTop    = (op.topHeight    ?? height + wallBottom) - wallBottom
    const yLo = Math.max(-halfH, Math.min(halfH, opBottom - halfH))
    const yHi = Math.max(-halfH, Math.min(halfH, opTop    - halfH))
    if (yHi <= yLo) continue

    const xLo = s * length - halfL
    const xHi = e * length - halfL

    // Three.js Shape treats holes as paths with opposite winding from the
    // outer contour. Authoring the hole counter-clockwise relative to the
    // shape's CCW outline reliably produces a subtraction.
    const hole = new THREE.Path()
    hole.moveTo(xLo, yLo)
    hole.lineTo(xLo, yHi)
    hole.lineTo(xHi, yHi)
    hole.lineTo(xHi, yLo)
    hole.lineTo(xLo, yLo)
    shape.holes.push(hole)
  }

  // Extrude along +Z for "thickness", then shift -depth/2 so the geometry is
  // centered on the Z axis as well. bevelEnabled=false keeps edges crisp.
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  })
  geom.translate(0, 0, -thickness / 2)
  return geom
}

function WallMesh({ wall, pxToM, dimOpacity }) {
  const {
    startX, startY, endX, endY,
    topHeight = 3, bottomHeight = 0,
    material,
    openings,
  } = wall

  // Derive the wall's length / height / pose from its 2D endpoints.
  const { length, height, center, rotationY } = useMemo(() => {
    const x1 = startX * pxToM, z1 = startY * pxToM
    const x2 = endX   * pxToM, z2 = endY   * pxToM
    const dx = x2 - x1, dz = z2 - z1
    const len = Math.sqrt(dx * dx + dz * dz)
    const h = Math.max(topHeight - bottomHeight, 0.01)
    return {
      length: len,
      height: h,
      center: [(x1 + x2) / 2, bottomHeight + h / 2, (z1 + z2) / 2],
      // Box / extruded face is authored along local +X. atan2(dz, dx) rotates
      // around +Y so the long axis lines up with the wall segment.
      rotationY: -Math.atan2(dz, dx),
    }
  }, [startX, startY, endX, endY, topHeight, bottomHeight, pxToM])

  // Recompute extruded geometry only when topology actually changes. Dimming
  // opacity changes don't need a geometry rebuild.
  const geometry = useMemo(() => {
    if (length === 0) return null
    return buildWallGeometry(length, height, openings, bottomHeight, WALL_THICKNESS_M)
  }, [length, height, openings, bottomHeight])

  // Dispose the extruded geometry when the mesh unmounts / rebuilds so we
  // don't leak GPU buffers on frequent wall edits.
  React.useEffect(() => {
    return () => { if (geometry) geometry.dispose() }
  }, [geometry])

  if (length === 0 || !geometry) return null

  const color = material?.color ?? DEFAULT_WALL_COLOR
  const transparent = dimOpacity < 1
  const hasOpenings = (wall.openings?.length ?? 0) > 0

  return (
    <group position={center} rotation={[0, rotationY, 0]}>
      <mesh castShadow receiveShadow>
        <primitive object={geometry} attach="geometry" />
        <meshStandardMaterial
          color={color}
          roughness={0.85}
          metalness={0.05}
          side={THREE.DoubleSide}
          transparent={transparent}
          opacity={dimOpacity}
          depthWrite={!transparent}
        />
      </mesh>
      {hasOpenings && (
        <OpeningsDetail
          wall={wall}
          length={length}
          height={height}
          wallThickness={WALL_THICKNESS_M}
        />
      )}
    </group>
  )
}

export default function WallLayer3D({ floorId, pxToM, dimOpacity = 1 }) {
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
  if (!walls.length || !pxToM) return null
  return (
    <group>
      {walls.map((w) => (
        <WallMesh key={w.id} wall={w} pxToM={pxToM} dimOpacity={dimOpacity} />
      ))}
    </group>
  )
}

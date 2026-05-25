import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useFloorStore, DEFAULT_FLOOR_HEIGHT_M } from '@/store/useFloorStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { computeFloorElevations } from './floorStacking'

const HOLE_COLOR   = '#a855f7'
const STROKE_COLOR = '#7c3aed'
const SIDE_ALPHA   = 0.35
const STROKE_ALPHA = 1.0

function buildShape(pointsM) {
  if (!pointsM || pointsM.length < 6) return null
  const shape = new THREE.Shape()
  shape.moveTo(pointsM[0], pointsM[1])
  for (let i = 2; i < pointsM.length; i += 2) shape.lineTo(pointsM[i], pointsM[i + 1])
  shape.closePath()
  return shape
}

function pointsToMeters(pts, pxToM) {
  const out = new Array(pts.length)
  for (let i = 0; i < pts.length; i++) out[i] = pts[i] * pxToM
  return out
}

// Outline ring geometry on the XZ plane at world y = 0 (caller positions group
// at the desired elevation). Closed loop.
function buildOutlinePositions(pointsM) {
  const arr = new Float32Array((pointsM.length / 2 + 1) * 3)
  for (let i = 0, j = 0; i < pointsM.length; i += 2, j += 3) {
    arr[j]     = pointsM[i]
    arr[j + 1] = 0
    arr[j + 2] = pointsM[i + 1]
  }
  arr[arr.length - 3] = pointsM[0]
  arr[arr.length - 2] = 0
  arr[arr.length - 1] = pointsM[1]
  return arr
}

function HoleVolume({ pointsM, yBottom, yTop, dimOpacity }) {
  const shape = useMemo(() => buildShape(pointsM), [pointsM])

  // ExtrudeGeometry along +Z by depth = (yTop − yBottom). Authored in XY then
  // tilted onto XZ with +π/2 around X (matches ScopeLayer3D's mapping). The
  // extrusion's local +Z becomes world +Y after the tilt → vertical column.
  const geom = useMemo(() => {
    if (!shape) return null
    const depth = Math.max(yTop - yBottom, 0.01)
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
    return g
  }, [shape, yBottom, yTop])

  const outlinePositions = useMemo(() => buildOutlinePositions(pointsM), [pointsM])

  if (!geom) return null

  return (
    <group>
      {/* Volume sides + caps. Tilt XY → XZ; translate so the bottom cap sits
          at world y = yBottom (after tilt, local z=0 maps to world y=0 of the
          group, so we offset the whole group instead — see parent <group>). */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, yBottom, 0]}>
        <primitive object={geom} attach="geometry" />
        <meshBasicMaterial
          color={HOLE_COLOR}
          transparent
          opacity={SIDE_ALPHA * dimOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Bottom + top outline rings so the column reads as a discrete object
          even when its sides go nearly transparent against the floor image. */}
      <line position={[0, yBottom, 0]}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={outlinePositions.length / 3}
            array={outlinePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={STROKE_COLOR}
          transparent
          opacity={STROKE_ALPHA * dimOpacity}
          linewidth={2}
        />
      </line>
      <line position={[0, yTop, 0]}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={outlinePositions.length / 3}
            array={outlinePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={STROKE_COLOR}
          transparent
          opacity={STROKE_ALPHA * dimOpacity}
          linewidth={2}
        />
      </line>
    </group>
  )
}

// Renders every floor hole's vertical extent (bottomFloorId → topFloorId) as
// a translucent purple column spanning the full inter-slab range. Lives at
// scene root (not inside a FloorStack group) so the column survives across
// multiple floors' transforms.
export default function FloorHoleVolume3D({ activeFloorId }) {
  const floors      = useFloorStore((s) => s.floors)
  const holesByFloor = useFloorHoleStore((s) => s.floorHolesByFloor)

  const elevations = useMemo(() => computeFloorElevations(floors), [floors])

  // Flatten all holes across all floors with their resolved Y range.
  const items = useMemo(() => {
    const acc = []
    const idxOf = (id) => floors.findIndex((f) => f.id === id)
    for (const f of floors) {
      const list = holesByFloor[f.id] ?? []
      if (!list.length) continue
      const pxToM = 1 / (f.scale || 100)
      for (const h of list) {
        const bottomId = h.bottomFloorId ?? f.id
        const topId    = h.topFloorId    ?? f.id
        const bIdx = idxOf(bottomId)
        const tIdx = idxOf(topId)
        if (bIdx < 0 || tIdx < 0) continue
        const lo = Math.min(bIdx, tIdx)
        const hi = Math.max(bIdx, tIdx)
        const bottomFloor = floors[lo]
        const topFloor    = floors[hi]
        const yBottom = elevations[bottomFloor.id] ?? 0
        // Top of the hole = the topFloor's ceiling = its elevation + its
        // floorHeight. This makes the column visibly extend through the
        // top floor's full height, not just up to its slab.
        const yTop = (elevations[topFloor.id] ?? 0)
                   + (topFloor.floorHeight ?? DEFAULT_FLOOR_HEIGHT_M)
        // Hole's polygon is authored on its own floor's canvas — convert with
        // that floor's pxToM. (Multi-floor span still uses the home floor's
        // calibration, since the polygon only exists there.)
        const pointsM = pointsToMeters(h.points, pxToM)
        const isActiveOwn = f.id === activeFloorId
        acc.push({
          key: `${f.id}::${h.id}`,
          pointsM,
          yBottom,
          yTop,
          dimOpacity: isActiveOwn ? 1 : 0.6,
        })
      }
    }
    return acc
  }, [floors, holesByFloor, elevations, activeFloorId])

  if (!items.length) return null

  return (
    <group>
      {items.map((it) => (
        <HoleVolume
          key={it.key}
          pointsM={it.pointsM}
          yBottom={it.yBottom}
          yTop={it.yTop}
          dimOpacity={it.dimOpacity}
        />
      ))}
    </group>
  )
}

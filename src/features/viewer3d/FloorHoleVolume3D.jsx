import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial'
import { useFloorStore, DEFAULT_FLOOR_HEIGHT_M } from '@/store/useFloorStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { computeFloorElevations } from '@/utils/floorStacking'
import { makeAlignMatrixM, applyAlignMatrix, isIdentityAlign } from '@/utils/floorAlign'

const HOLE_COLOR   = '#a855f7'
const STROKE_COLOR = '#7c3aed'
const SIDE_ALPHA   = 0.35
const STROKE_ALPHA = 1.0
// 51-8: ring thickness in world units. Slightly heavier than a cable (0.10)
// because the ring marks a structural opening, not a run of wire.
const RING_WIDTH_M = 0.12

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

// 51-8: one run of the hole outline (a ring, or a corner vertical), drawn
// with real width via Line2.
function OutlineLine({ y, positions, opacity }) {
  const size = useThree((s) => s.size)

  const geom = useMemo(() => {
    const g = new LineGeometry()
    g.setPositions(positions)
    return g
  }, [positions])
  React.useEffect(() => () => geom.dispose(), [geom])

  const material = useMemo(() => new LineMaterial({
    color: new THREE.Color(STROKE_COLOR),
    // World units so the ring keeps a constant physical thickness as the user
    // zooms, matching how the cables in 51-7 behave.
    worldUnits: true,
    linewidth: RING_WIDTH_M,
    transparent: true,
    opacity,
    // Same reasoning as 51-3: the purple identifies this as a floor opening.
    fog: false,
  }), [opacity])
  React.useEffect(() => () => material.dispose(), [material])

  React.useEffect(() => {
    material.resolution.set(size.width, size.height)
  }, [material, size.width, size.height])

  const line = useMemo(() => {
    const l = new Line2(geom, material)
    l.computeLineDistances()
    l.raycast = () => null
    return l
  }, [geom, material])

  return <primitive object={line} position={[0, y, 0]} />
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
  // Shape fed to the extruder, with Y negated. The mesh is tilted by −π/2
  // about X (so the extrusion rises to +Y); that tilt also sends shape Y to
  // world −Z, and negating here cancels it so the column lands on the same
  // XZ footprint as the outline.
  const shape = useMemo(() => {
    if (!pointsM || pointsM.length < 6) return null
    const flipped = new Array(pointsM.length)
    for (let i = 0; i < pointsM.length; i += 2) {
      flipped[i] = pointsM[i]
      flipped[i + 1] = -pointsM[i + 1]
    }
    return buildShape(flipped)
  }, [pointsM])

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

  // One vertical per polygon corner, joining the two rings. Each is its own
  // 2-point line (rather than one zigzag polyline) so no spurious diagonal
  // appears between the top of one corner and the bottom of the next.
  //
  // Note these bake absolute Y into the geometry and mount at y=0, whereas the
  // rings are authored flat at y=0 and lifted by the `y` prop. Both end up in
  // the same world space; the split just avoids rebuilding ring geometry per
  // elevation.
  const cornerEdges = useMemo(() => {
    const out = []
    for (let i = 0; i < pointsM.length; i += 2) {
      out.push(new Float32Array([
        pointsM[i], yBottom, pointsM[i + 1],
        pointsM[i], yTop,    pointsM[i + 1],
      ]))
    }
    return out
  }, [pointsM, yBottom, yTop])

  if (!geom) return null

  return (
    <group>
      {/* Volume sides + caps, tilted from the authoring XY plane onto XZ.
          51-8: the tilt was +π/2, which maps the extrusion depth to −Y — the
          column hung BELOW its floor instead of rising through it. It went
          unnoticed while the outline was a 1px hairline; giving the outline a
          real width made the volume and its frame visibly disagree. −π/2 maps
          shape (x, y) → world (x, ·, y) as before but sends depth to +Y.
          Shape Y now maps to −Z, so the polygon is mirrored on Z; buildShape
          is fed a Z-negated copy to compensate (see shapeForExtrude). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, yBottom, 0]}>
        <primitive object={geom} attach="geometry" />
        <meshBasicMaterial
          color={HOLE_COLOR}
          transparent
          opacity={SIDE_ALPHA * dimOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Outline: both rings plus a vertical at every corner, so the opening
          reads as a framed volume rather than two rings floating apart.
          51-8: the rings carried `linewidth={2}`, which WebGL ignores — they
          were hairlines, invisible against the translucent fill. Line2 (same
          approach 51-7 took for cables) gives them a real width. The verticals
          are new: the polygon has hard corners, so unlike the round riser
          shaft its silhouette needs them to close. */}
      <OutlineLine y={yBottom} positions={outlinePositions} opacity={STROKE_ALPHA * dimOpacity} />
      <OutlineLine y={yTop}    positions={outlinePositions} opacity={STROKE_ALPHA * dimOpacity} />
      {cornerEdges.map((seg, i) => (
        <OutlineLine key={i} y={0} positions={seg} opacity={STROKE_ALPHA * dimOpacity} />
      ))}
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
        // This layer lives at scene root (doesn't inherit FloorStack's align
        // group), so apply the home floor's meter-space align here. A column
        // spanning differently-aligned floors approximates with the home
        // floor's transform — a vertical shaft can't bend per level.
        if (!isIdentityAlign(f)) {
          const m = makeAlignMatrixM(f, pxToM)
          for (let i = 0; i < pointsM.length; i += 2) {
            const p = applyAlignMatrix(m, pointsM[i], pointsM[i + 1])
            pointsM[i] = p.x
            pointsM[i + 1] = p.y
          }
        }
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

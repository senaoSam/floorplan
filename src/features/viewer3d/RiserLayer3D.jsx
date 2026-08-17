import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useFloorStore, DEFAULT_FLOOR_HEIGHT_M, getPxPerM } from '@/store/useFloorStore'
import { useCableStore } from '@/store/useCableStore'
import { computeFloorElevations } from '@/utils/floorStacking'
import { makeAlignMatrixM, applyAlignMatrix, isIdentityAlign } from '@/utils/floorAlign'

// Riser column: vertical chase from the lowest to the highest floor the riser
// passes through. We extend the column slightly above the topmost floor's
// ceiling so it visibly pokes out (matches how real risers terminate at a
// rooftop manhole or attic). Lives at scene root, not inside a FloorStack —
// otherwise non-active floors would dim the column away and a single-floor
// view would chop it off.
const RISER_COLOR  = '#a78bfa'   // violet-400 (matches 2D RiserLayer)
const STROKE_COLOR = '#7c3aed'
const RADIUS_M     = 0.18        // ~18 cm — small but readable in a typical scene
const RISER_SEGMENTS = 32        // 51-8: was 16, visibly faceted at this radius
// Verticals drawn down the shaft. Four reads as a round column being outlined;
// more starts to look like the netting this replaced.
const RISER_SPINES = 4

// 51-8 Riser outline: two end rings plus a few verticals. Built as one
// LineSegments so the whole outline is a single object per riser.
function RiserOutline({ height, opacity }) {
  const geom = useMemo(() => {
    const r = RADIUS_M * 1.02   // just outside the shaft so it isn't z-fought
    const hy = height / 2
    const pts = []
    // Two rings: consecutive point pairs around the circumference.
    for (const y of [-hy, hy]) {
      for (let i = 0; i < RISER_SEGMENTS; i++) {
        const a0 = (i / RISER_SEGMENTS) * Math.PI * 2
        const a1 = ((i + 1) / RISER_SEGMENTS) * Math.PI * 2
        pts.push(Math.cos(a0) * r, y, Math.sin(a0) * r)
        pts.push(Math.cos(a1) * r, y, Math.sin(a1) * r)
      }
    }
    // Verticals joining the rings.
    for (let i = 0; i < RISER_SPINES; i++) {
      const a = (i / RISER_SPINES) * Math.PI * 2
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      pts.push(x, -hy, z, x, hy, z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [height])
  React.useEffect(() => () => geom.dispose(), [geom])

  return (
    <lineSegments raycast={() => null}>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color={STROKE_COLOR} transparent opacity={opacity} />
    </lineSegments>
  )
}

export default function RiserLayer3D({ activeFloorId }) {
  const floors = useFloorStore((s) => s.floors)
  const risers = useCableStore((s) => s.risers)

  const elevations = useMemo(() => computeFloorElevations(floors), [floors])

  const items = useMemo(() => {
    const acc = []
    for (const r of risers) {
      const floorIds = r.floorIds ?? []
      if (floorIds.length === 0) continue
      // Anchor canvas xy → meters using the lowest floor's scale. All floors
      // share the riser's xy by spec, so any floor's scale would do — pick the
      // lowest for determinism. (If a floor is missing scale we fall back to
      // the conventional 100 px/m used elsewhere in viewer3d.)
      const fs = floorIds
        .map((id) => floors.find((f) => f.id === id))
        .filter(Boolean)
        .sort((a, b) => (elevations[a.id] ?? 0) - (elevations[b.id] ?? 0))
      if (fs.length === 0) continue
      const anchor = fs[0]
      const pxToM = 1 / getPxPerM(anchor)   // 53-G8: was `|| 100` (2D used 40)
      let x = r.x * pxToM
      let z = r.y * pxToM
      // Scene-root layer — apply the anchor floor's meter-space align so the
      // shaft tracks its floor plane (approximation when the spanned floors
      // are aligned differently; the column stays vertical).
      if (!isIdentityAlign(anchor)) {
        const p = applyAlignMatrix(makeAlignMatrixM(anchor, pxToM), x, z)
        x = p.x
        z = p.y
      }

      const bottom = fs[0]
      const top    = fs[fs.length - 1]
      const yBottom = elevations[bottom.id] ?? 0
      const yTop    = (elevations[top.id] ?? 0) + (top.floorHeight ?? DEFAULT_FLOOR_HEIGHT_M)

      const isActiveOwn = floorIds.includes(activeFloorId)
      acc.push({
        key: r.id,
        x, z,
        yBottom, yTop,
        dimOpacity: isActiveOwn ? 1 : 0.55,
      })
    }
    return acc
  }, [risers, floors, elevations, activeFloorId])

  if (!items.length) return null

  return (
    <group>
      {items.map((it) => {
        const height = Math.max(it.yTop - it.yBottom, 0.01)
        const yCenter = (it.yTop + it.yBottom) / 2
        return (
          <group key={it.key} position={[it.x, yCenter, it.z]}>
            <mesh castShadow receiveShadow>
              {/* 51-8: 16 → 32 segments. At 18cm radius the facets on a
                  16-segment cylinder are visible as a polygon rather than a
                  round shaft. */}
              <cylinderGeometry args={[RADIUS_M, RADIUS_M, height, RISER_SEGMENTS]} />
              <meshStandardMaterial
                color={RISER_COLOR}
                transparent
                opacity={0.55 * it.dimOpacity}
                depthWrite={false}
              />
            </mesh>
            {/* Outline so the column reads as a discrete object even when it
                overlaps a floor plane.
                51-8: was a `wireframe` cylinder, which draws every triangle
                edge — including the diagonal across each side quad — so the
                shaft looked wrapped in netting rather than outlined. Rings at
                the two ends plus a few verticals give the silhouette without
                the mesh triangulation showing through. */}
            <RiserOutline height={height} opacity={0.55 * it.dimOpacity} />
          </group>
        )
      })}
    </group>
  )
}

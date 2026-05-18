import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useFloorStore, DEFAULT_FLOOR_HEIGHT_M } from '@/store/useFloorStore'
import { useCableStore } from '@/store/useCableStore'
import { computeFloorElevations } from './floorStacking'

// Riser column: vertical chase from the lowest to the highest floor the riser
// passes through. We extend the column slightly above the topmost floor's
// ceiling so it visibly pokes out (matches how real risers terminate at a
// rooftop manhole or attic). Lives at scene root, not inside a FloorStack —
// otherwise non-active floors would dim the column away and a single-floor
// view would chop it off.
const RISER_COLOR  = '#a78bfa'   // violet-400 (matches 2D RiserLayer)
const STROKE_COLOR = '#7c3aed'
const RADIUS_M     = 0.18        // ~18 cm — small but readable in a typical scene

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
      const pxToM = 1 / (anchor.scale || 100)
      const x = r.x * pxToM
      const z = r.y * pxToM

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
            <mesh>
              <cylinderGeometry args={[RADIUS_M, RADIUS_M, height, 16]} />
              <meshStandardMaterial
                color={RISER_COLOR}
                transparent
                opacity={0.55 * it.dimOpacity}
                depthWrite={false}
              />
            </mesh>
            {/* Sharper outline so the column reads as a discrete object even
                when it overlaps a floor plane. */}
            <mesh>
              <cylinderGeometry args={[RADIUS_M * 1.02, RADIUS_M * 1.02, height, 16, 1, true]} />
              <meshBasicMaterial
                color={STROKE_COLOR}
                wireframe
                transparent
                opacity={0.4 * it.dimOpacity}
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

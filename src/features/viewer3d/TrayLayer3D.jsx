import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useCableStore } from '@/store/useCableStore'

// 3D cable tray rendering — each tray polyline becomes a chain of thin
// blue boxes pinned just below the ceiling. We sit slightly below ceiling
// (0.05 m) so heatmap planes or other ceiling-mounted geometry on the
// active floor don't z-fight with the tray surface.
const TRAY_COLOR = '#60a5fa'   // matches 2D CableTrayLayer
const STROKE     = '#1d4ed8'
const TRAY_WIDTH = 0.06         // 6 cm cross-section — visible but not bulky
const TRAY_HEIGHT = 0.04
const CEILING_INSET = 0.05      // metres below ceiling

// One thin oriented box between two polyline vertices in ceiling-plane.
// Positions assume the parent group is already at the correct elevation.
function TraySegment({ a, b, dimOpacity, pxToM }) {
  const ax = a.x * pxToM
  const az = a.y * pxToM        // canvas y → world z (per FloorPlane convention)
  const bx = b.x * pxToM
  const bz = b.y * pxToM
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) return null
  const cx = (ax + bx) / 2
  const cz = (az + bz) / 2
  // Rotate the box around world Y so its X axis aligns with the segment.
  const yaw = Math.atan2(dz, dx)
  return (
    <group position={[cx, 0, cz]} rotation={[0, -yaw, 0]}>
      <mesh>
        <boxGeometry args={[len, TRAY_HEIGHT, TRAY_WIDTH]} />
        <meshStandardMaterial
          color={TRAY_COLOR}
          transparent={dimOpacity < 1}
          opacity={dimOpacity}
        />
      </mesh>
    </group>
  )
}

// Renders all trays for one floor. Lives inside the floor's FloorStack
// group so floor-elevation/dim treatment applies automatically — caller
// supplies pxToM and the ceiling height for this floor.
export default function TrayLayer3D({ floorId, pxToM, ceilingHeight, dimOpacity = 1 }) {
  const trays = useCableStore((s) => s.traysByFloor[floorId] ?? [])

  const segments = useMemo(() => {
    const out = []
    for (const tray of trays) {
      const pts = tray.points ?? []
      for (let i = 0; i < pts.length - 1; i++) {
        out.push({ key: `${tray.id}-${i}`, a: pts[i], b: pts[i + 1] })
      }
    }
    return out
  }, [trays])

  if (segments.length === 0) return null
  const ceilingY = (ceilingHeight ?? 3) - CEILING_INSET

  return (
    <group position={[0, ceilingY, 0]}>
      {segments.map((s) => (
        <TraySegment key={s.key} a={s.a} b={s.b} dimOpacity={dimOpacity} pxToM={pxToM} />
      ))}
    </group>
  )
}

import React, { useMemo } from 'react'
import { useCableStore, resolveTrayMountHeight } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'

// 3D cable tray rendering — each tray polyline becomes a chain of thin
// blue boxes pinned at the tray's per-tray mountHeight (19-2). Trays grouped
// by mountHeight so each elevation is one positioned <group>.
const TRAY_COLOR = '#60a5fa'   // matches 2D CableTrayLayer
const TRAY_WIDTH = 0.06         // 6 cm cross-section — visible but not bulky
const TRAY_HEIGHT = 0.04

// One thin oriented box between two polyline vertices.
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
// group so floor-elevation/dim treatment applies automatically. Caller
// supplies pxToM; we read the floor from the store ourselves so the
// `ceiling` preset can resolve against floor.floorHeight dynamically.
export default function TrayLayer3D({ floorId, pxToM, dimOpacity = 1 }) {
  const trays = useCableStore((s) => s.traysByFloor[floorId] ?? [])
  const floor = useFloorStore((s) => s.floors.find((f) => f.id === floorId))

  // Bucket trays by their resolved mountHeight so each Y plane gets one
  // positioned group. Most builds have all trays on the same height; this
  // keeps it cheap when they do, and still correct when they don't.
  const buckets = useMemo(() => {
    const map = new Map()  // y → [{ trayId, segIdx, a, b }]
    for (const tray of trays) {
      const y = resolveTrayMountHeight(tray, floor)
      const pts = tray.points ?? []
      for (let i = 0; i < pts.length - 1; i++) {
        if (!map.has(y)) map.set(y, [])
        map.get(y).push({ key: `${tray.id}-${i}`, a: pts[i], b: pts[i + 1] })
      }
    }
    return [...map.entries()]
  }, [trays, floor])

  if (buckets.length === 0) return null

  return (
    <>
      {buckets.map(([y, segs]) => (
        <group key={y} position={[0, y, 0]}>
          {segs.map((s) => (
            <TraySegment key={s.key} a={s.a} b={s.b} dimOpacity={dimOpacity} pxToM={pxToM} />
          ))}
        </group>
      ))}
    </>
  )
}

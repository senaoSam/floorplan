import React, { useMemo, useRef, useEffect } from 'react'
import * as THREE from 'three'
import { useCableStore, resolveTrayMountHeight, getTraySystem } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'

// 3D cable tray rendering — each tray segment is a translucent "channel"
// box matching the 2D channel visual: body fill + visible border edges + a
// dashed centerline along the top. Colors come from the tray's system
// (19-3 TRAY_SYSTEMS legend) so 2D and 3D views match at a glance.
const TRAY_BODY_ALPHA = 0.4
const TRAY_WIDTH      = 0.10          // 10 cm cross-section, slightly wider
const TRAY_HEIGHT     = 0.05          // so the channel reads volumetrically

// One channel segment between two polyline vertices.
// Positions assume the parent group is already at the correct elevation.
function TraySegment({ a, b, dimOpacity, pxToM, color }) {
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

  // EdgesGeometry — outlines the box with crisp lines so the border reads
  // even when the body is translucent. Cached to one shared geom per segment.
  const bodyGeom = useMemo(() => new THREE.BoxGeometry(len, TRAY_HEIGHT, TRAY_WIDTH), [len])
  const edgesGeom = useMemo(() => new THREE.EdgesGeometry(bodyGeom), [bodyGeom])
  useEffect(() => () => { bodyGeom.dispose(); edgesGeom.dispose() }, [bodyGeom, edgesGeom])

  // Dashed centerline along the top of the channel (matches 2D dashed
  // centreline). Sits half a height above the box centre + a tiny epsilon
  // so it doesn't z-fight with the top face.
  const centerLineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const yTop = TRAY_HEIGHT / 2 + 0.002
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -len / 2, yTop, 0,
       len / 2, yTop, 0,
    ]), 3))
    return g
  }, [len])
  useEffect(() => () => centerLineGeom.dispose(), [centerLineGeom])
  const centerLineRef = useRef(null)
  useEffect(() => { centerLineRef.current?.computeLineDistances?.() }, [centerLineGeom])

  return (
    <group position={[cx, 0, cz]} rotation={[0, -yaw, 0]}>
      {/* Body — translucent indigo fill */}
      <mesh castShadow receiveShadow>
        <primitive object={bodyGeom} attach="geometry" />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={TRAY_BODY_ALPHA * dimOpacity}
          depthWrite={false}
          roughness={0.6}
        />
      </mesh>
      {/* Border — edge outline */}
      <lineSegments>
        <primitive object={edgesGeom} attach="geometry" />
        <lineBasicMaterial
          color={color}
          transparent={dimOpacity < 1}
          opacity={dimOpacity}
          // 51-3: opt out of scene fog. Tray colour is the 19-3 TRAY_SYSTEMS
          // legend, matched by eye against 2D; a long run would otherwise
          // appear to change system colour along its length.
          fog={false}
        />
      </lineSegments>
      {/* Dashed centreline on the top face */}
      <line ref={centerLineRef}>
        <primitive object={centerLineGeom} attach="geometry" />
        <lineDashedMaterial
          color={color}
          transparent={dimOpacity < 1}
          opacity={0.85 * dimOpacity}
          dashSize={0.12}
          gapSize={0.08}
          // 51-3: legend colour, see the edge outline above.
          fog={false}
        />
      </line>
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
    const map = new Map()  // y → [{ trayId, segIdx, a, b, color }]
    for (const tray of trays) {
      const y = resolveTrayMountHeight(tray, floor)
      const color = getTraySystem(tray.system).color
      const pts = tray.points ?? []
      for (let i = 0; i < pts.length - 1; i++) {
        if (!map.has(y)) map.set(y, [])
        map.get(y).push({ key: `${tray.id}-${i}`, a: pts[i], b: pts[i + 1], color })
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
            <TraySegment key={s.key} a={s.a} b={s.b} color={s.color} dimOpacity={dimOpacity} pxToM={pxToM} />
          ))}
        </group>
      ))}
    </>
  )
}

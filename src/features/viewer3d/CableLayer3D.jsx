import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore, resolveTrayMountHeight } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { computeRoutes } from '@/features/cable/computeRoutes'

// 3D rendering of Stage-3 route results: each AP→switch route and each
// switch-to-switch uplink becomes a 3D polyline. Mirrors 2D CableLayer's
// colour scheme so the views stay consistent.
//
// Y mapping for route points:
//   endpoint (AP)         → ap.z (mountHeight)
//   endpoint (switch)     → sw.mountHeight
//   endpoint-foot         → tray plenum (per-floor average tray mountHeight,
//                            falling back to ceiling - 0.05)
//   tray / riser*         → tray plenum (same)
//
// Per-tray mountHeight precision needs the route to carry the source tray
// id; for MVP we use the floor's average tray height which is correct in
// the common "all trays on one ceiling" layout.

const CABLE_COLOR    = '#22d3ee'    // cyan — AP-to-switch via tray
const FALLBACK_COLOR = '#9ca3af'    // grey — Manhattan fallback
const TRUNK_COLOR    = '#a78bfa'    // violet — copper S2S
const TRUNK_FIBER    = '#fb7185'    // rose  — fiber S2S
const TUBE_RADIUS    = 0.018        // 1.8 cm — thin enough to read as wire

function plenumYForFloor(floor, traysOnFloor) {
  // If trays exist, average their resolved mountHeights. Otherwise fall
  // back to (ceiling - 0.05) so cables still float at a sensible height.
  if (traysOnFloor && traysOnFloor.length) {
    let sum = 0
    for (const t of traysOnFloor) sum += resolveTrayMountHeight(t, floor)
    return sum / traysOnFloor.length
  }
  return Math.max(0, (floor?.floorHeight ?? 3) - 0.05)
}

// Lift a route point to 3D. Route points carry only { x, y, kind, floorId }
// (see computeRoutes) — they don't carry the AP/Switch id. So we identify
// endpoint points by their position in the array (first = source endpoint,
// last = target endpoint) and look up the device on the route itself
// (route.apId / route.switchId or route.srcId / route.targetId).
function liftPoint(p, idx, lastIdx, route, ctx) {
  const { pxToM, plenumY, apById, swById } = ctx
  const x = p.x * pxToM
  const z = p.y * pxToM
  if (p.kind === 'endpoint') {
    // Identify which end this is via index, then look up the device.
    let dev = null
    if ('apId' in route) {
      // AP route: first endpoint = AP, last endpoint = switch.
      if (idx === 0)             dev = apById.get(route.apId) ?? null
      else if (idx === lastIdx)  dev = swById.get(route.switchId) ?? null
    } else {
      // Switch-to-switch link: first = src, last = target.
      if (idx === 0)             dev = swById.get(route.srcId) ?? null
      else if (idx === lastIdx)  dev = swById.get(route.targetId) ?? null
    }
    if (dev) {
      // APs carry `z` (install height); switches carry `mountHeight`.
      const y = dev.z != null ? dev.z : (dev.mountHeight ?? 0.5)
      return [x, y, z]
    }
    return [x, plenumY, z]
  }
  // tray, endpoint-foot, riser@floor, riser-foot, corner (Manhattan) —
  // all sit at plenum height so the cable runs horizontally up there.
  return [x, plenumY, z]
}

// Build a BufferGeometry from a polyline. For dashed materials the caller
// must run computeLineDistances on the resulting line — without that the
// dashed shader has no parameter to gap on and renders solid.
function buildLineGeom(pts3) {
  const g = new THREE.BufferGeometry()
  const flat = new Float32Array(pts3.length * 3)
  pts3.forEach((p, i) => { flat[i * 3] = p[0]; flat[i * 3 + 1] = p[1]; flat[i * 3 + 2] = p[2] })
  g.setAttribute('position', new THREE.BufferAttribute(flat, 3))
  return g
}

function PolylineTube({ pts3, color, dimOpacity, dashed = false, dashSize = 0.18, gapSize = 0.10 }) {
  const geom = useMemo(() => buildLineGeom(pts3), [pts3])
  React.useEffect(() => () => geom.dispose(), [geom])
  // Critical for dashed lines: distance attribute drives the dash UV.
  const lineRef = React.useRef(null)
  React.useEffect(() => {
    if (dashed && lineRef.current) lineRef.current.computeLineDistances()
  }, [dashed, geom])

  if (dashed) {
    return (
      <line ref={lineRef}>
        <primitive object={geom} attach="geometry" />
        <lineDashedMaterial
          color={color}
          transparent={dimOpacity < 1}
          opacity={dimOpacity}
          dashSize={dashSize}
          gapSize={gapSize}
        />
      </line>
    )
  }
  return (
    <line>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial
        color={color}
        transparent={dimOpacity < 1}
        opacity={dimOpacity}
      />
    </line>
  )
}

// Filter a route's points down to the on-floor segments. Returns the
// (aIdx, bIdx) pairs so the caller can index into a pre-lifted pts3 array
// (we need the indices to know which endpoints are the route's source vs
// target when liftPoint resolves them to AP/Switch heights).
function buildSegments(pts, floorId) {
  if (!pts || pts.length < 2) return []
  const segs = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (a.floorId !== floorId || b.floorId !== floorId) continue
    const isDrop = a.kind === 'endpoint' || b.kind === 'endpoint'
    segs.push({ aIdx: i, bIdx: i + 1, isDrop })
  }
  return segs
}

export default function CableLayer3D({ floorId, pxToM, dimOpacity = 1 }) {
  const floors          = useFloorStore((s) => s.floors)
  const floor           = floors.find((f) => f.id === floorId)
  const apsByFloor      = useAPStore((s) => s.apsByFloor)
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const traysByFloor    = useCableStore((s) => s.traysByFloor)
  const risers          = useCableStore((s) => s.risers)

  const { routes, switchLinks } = useMemo(() => (
    computeRoutes({ floors, apsByFloor, switchesByFloor, traysByFloor, risers })
  ), [floors, apsByFloor, switchesByFloor, traysByFloor, risers])

  const ctx = useMemo(() => {
    const traysOnFloor = traysByFloor[floorId] ?? []
    const plenumY = plenumYForFloor(floor, traysOnFloor)
    const apById = new Map()
    for (const ap of apsByFloor[floorId] ?? []) apById.set(ap.id, ap)
    const swById = new Map()
    for (const sw of switchesByFloor[floorId] ?? []) swById.set(sw.id, sw)
    return { pxToM, plenumY, apById, swById }
  }, [pxToM, floor, traysByFloor, apsByFloor, switchesByFloor, floorId])

  if (!pxToM) return null
  if (routes.size === 0 && switchLinks.size === 0) return null

  // Convert each route to a chain of 3D lines on this floor. Per-segment
  // dashing matches 2D CableLayer:
  //   fallback-manhattan        → dashed (whole route)
  //   tray + endpoint drop legs → dashed (the AP↔plenum / plenum↔SW drops)
  //   tray + horizontal runs    → solid
  //   fiber S2S                 → dashed with longer dash
  const renderRoute = (r, key, baseColor, isFiber = false) => {
    if (r.routeStatus === 'unroutable') return null    // shown only in 2D
    if (r.routeStatus === 'fallback-manhattan' && r.homeFloorId !== floorId) return null
    const pts = r.points
    if (!pts || pts.length < 2) return null
    const lastIdx = pts.length - 1
    const pts3 = pts.map((p, i) => liftPoint(p, i, lastIdx, r, ctx))
    const segs = buildSegments(pts, floorId)
    if (!segs.length) return null
    const isFallback = r.routeStatus === 'fallback-manhattan'
    const color = isFallback ? FALLBACK_COLOR : baseColor
    return (
      <group key={key}>
        {segs.map((s, i) => {
          // Fallback whole route + tray drop legs + fiber all use dashed.
          const dashed = isFallback || s.isDrop || isFiber
          // Longer dash for fiber to read as different material, matches 2D.
          const dashSize = isFiber ? 0.30 : 0.18
          const gapSize  = isFiber ? 0.14 : 0.10
          return (
            <PolylineTube
              key={i}
              pts3={[pts3[s.aIdx], pts3[s.bIdx]]}
              color={color}
              dimOpacity={dimOpacity}
              dashed={dashed}
              dashSize={dashSize}
              gapSize={gapSize}
            />
          )
        })}
      </group>
    )
  }

  return (
    <>
      {Array.from(routes.values()).map((r) => renderRoute(r, `r-${r.apId}`, CABLE_COLOR))}
      {Array.from(switchLinks.values()).map((link) => {
        const isFiber = link.cableType === 'fiber'
        const baseColor = isFiber ? TRUNK_FIBER : TRUNK_COLOR
        return renderRoute(link, `sl-${link.srcId}`, baseColor, isFiber)
      })}
    </>
  )
}

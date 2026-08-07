import React, { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore, resolveTrayMountHeight } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
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
// 51-7: cable diameter in world units, driving LineMaterial's world-space
// linewidth. (Replaces a TUBE_RADIUS constant that was declared for a tube
// implementation that never happened and sat unused while cables rendered as
// 1px hairlines.)
//
// Deliberately NOT the true ~3cm of a real Cat6 run. At the default iso
// framing of a 30m floor that is well under a pixel, and the cables simply
// vanish — which is what the first attempt at this did. 10cm is the smallest
// value that still reads at normal zoom while staying thinner than the
// AP drop poles it runs alongside.
const CABLE_WIDTH_M  = 0.10

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

// 51-7: build a LineGeometry (the instanced-quad geometry Line2 expects)
// rather than a plain BufferGeometry. `line` with lineBasicMaterial ignores
// linewidth on every desktop GL backend, so cables rendered as 1px hairlines
// no matter what — invisible at a glance and impossible to tell apart from
// the dashed variants at distance. LineGeometry expands each segment into a
// camera-facing quad, so LineMaterial's linewidth actually applies.
//
// setPositions wants a flat array; LineGeometry computes its own instance
// distances, so dashes work without a computeLineDistances call on the object
// (Line2.computeLineDistances is still needed and is done at mount).
function buildLineGeom(pts3) {
  const g = new LineGeometry()
  const flat = new Float32Array(pts3.length * 3)
  pts3.forEach((p, i) => { flat[i * 3] = p[0]; flat[i * 3 + 1] = p[1]; flat[i * 3 + 2] = p[2] })
  g.setPositions(flat)
  return g
}

// Memoized BY VALUE (see comparator below): computeRoutes rebuilds every
// route object on any AP/cable-store change, so the pts3 arrays are always
// fresh references even when the cable didn't move. Reference-based memo
// would never bail out — on a 300-AP scene every AP edit recreated ~2000
// segment geometries (the dominant share of a ~2 s stall on drag release,
// with the 3D view hidden). Comparing the handful of coordinates is cheap
// and lets unchanged segments keep their geometry + VAO.
const PolylineTube = React.memo(function PolylineTube({ pts3, color, dimOpacity, dashed = false, dashSize = 0.18, gapSize = 0.10 }) {
  const geom = useMemo(() => buildLineGeom(pts3), [pts3])
  React.useEffect(() => () => geom.dispose(), [geom])

  // LineMaterial sizes its quads in screen space, so it needs the drawing
  // buffer size. Without this every line collapses to nothing.
  const size = useThree((s) => s.size)

  const material = useMemo(() => new LineMaterial({
    color: new THREE.Color(color),
    // World units: a cable should read as a physical thing that gets thinner
    // with distance, not a constant-width screen annotation. linewidth is a
    // world-space width here, so CABLE_WIDTH_M is the cable's diameter.
    worldUnits: true,
    linewidth: CABLE_WIDTH_M,
    dashed,
    dashSize,
    gapSize,
    transparent: dimOpacity < 1,
    opacity: dimOpacity,
    // 51-3: opt out of scene fog. Cable colour is a status code (cyan =
    // routed via tray, grey = Manhattan fallback, violet/rose = copper /
    // fibre trunk) and a route spans the whole floor, so fog would
    // desaturate cyan toward the grey that means "needs attention".
    fog: false,
  }), [color, dashed, dashSize, gapSize, dimOpacity])
  React.useEffect(() => () => material.dispose(), [material])

  // Keep the material's resolution in step with the canvas.
  React.useEffect(() => {
    material.resolution.set(size.width, size.height)
  }, [material, size.width, size.height])

  const line = useMemo(() => {
    const l = new Line2(geom, material)
    // Line2 needs its own distance pass for dashes; harmless when solid.
    l.computeLineDistances()
    // Cables are reference geometry — never intercept a click meant for a
    // device behind them.
    l.raycast = () => null
    return l
  }, [geom, material])

  return <primitive object={line} />
}, (a, b) => {
  if (a.color !== b.color || a.dimOpacity !== b.dimOpacity ||
      a.dashed !== b.dashed || a.dashSize !== b.dashSize || a.gapSize !== b.gapSize) return false
  const p = a.pts3, q = b.pts3
  if (p.length !== q.length) return false
  for (let i = 0; i < p.length; i++) {
    if (p[i][0] !== q[i][0] || p[i][1] !== q[i][1] || p[i][2] !== q[i][2]) return false
  }
  return true
})

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

// 51-7: merge consecutive segments that share a dash style into one polyline.
//
// Line2 is far heavier per object than a plain line — it carries an instanced
// geometry and its own shader material — so the old one-component-per-segment
// shape did not survive the switch: a 300-AP scene built ~19,400 Line2s and
// pushed steady-state long tasks from 157ms to 232ms. Segments within a route
// genuinely differ (drop legs dash, tray runs are solid), so they can't all
// collapse into one line, but consecutive segments of the SAME style can.
// That is the difference between one object per segment and one per style run.
//
// Returns [{ dashed, idxs }] where idxs are indices into the route's pts3,
// forming a continuous polyline.
function groupRuns(segs, isDashed) {
  const runs = []
  let cur = null
  for (const s of segs) {
    const dashed = isDashed(s)
    // A run continues only if the style matches AND this segment starts where
    // the last one ended — a gap means the route left this floor and came
    // back, and joining across it would draw a cable that doesn't exist.
    const contiguous = cur && cur.dashed === dashed && cur.idxs[cur.idxs.length - 1] === s.aIdx
    if (contiguous) {
      cur.idxs.push(s.bIdx)
    } else {
      cur = { dashed, idxs: [s.aIdx, s.bIdx] }
      runs.push(cur)
    }
  }
  return runs
}

export default function CableLayer3D({ floorId, pxToM, dimOpacity = 1 }) {
  const floors          = useFloorStore((s) => s.floors)
  const floor           = floors.find((f) => f.id === floorId)
  const apsByFloor      = useAPStore((s) => s.apsByFloor)
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const traysByFloor    = useCableStore((s) => s.traysByFloor)
  const risers          = useCableStore((s) => s.risers)
  const isVisible       = useEditorStore((s) => s.viewMode === VIEW_MODE.THREE_D)

  // Freeze-while-hidden (Viewer3D stays mounted in 2D): computeRoutes runs
  // Dijkstra per AP, which showed up as ~200 ms of 2D drag jank on a software
  // renderer — for a layer nobody could see. A plain useMemo can't express
  // "skip while hidden but DON'T recompute on re-entry when nothing changed",
  // so the cache is manual: recompute only when visible AND an input ref
  // changed; while hidden, keep returning the last computed value (stale is
  // fine — the frozen frameloop isn't painting anyway). Unchanged inputs make
  // the 2D→3D switch reuse everything; changed inputs re-route once on entry.
  const routesCacheRef = useRef({ deps: null, value: { routes: new Map(), switchLinks: new Map() } })
  if (isVisible) {
    const deps = [floors, apsByFloor, switchesByFloor, traysByFloor, risers]
    const prev = routesCacheRef.current.deps
    if (!prev || deps.some((d, i) => d !== prev[i])) {
      routesCacheRef.current = {
        deps,
        value: computeRoutes({ floors, apsByFloor, switchesByFloor, traysByFloor, risers }),
      }
    }
  }
  const { routes, switchLinks } = routesCacheRef.current.value

  const ctx = useMemo(() => {
    const traysOnFloor = traysByFloor[floorId] ?? []
    const plenumY = plenumYForFloor(floor, traysOnFloor)
    const apById = new Map()
    for (const ap of apsByFloor[floorId] ?? []) apById.set(ap.id, ap)
    const swById = new Map()
    for (const sw of switchesByFloor[floorId] ?? []) swById.set(sw.id, sw)
    return { pxToM, plenumY, apById, swById }
  }, [pxToM, floor, traysByFloor, apsByFloor, switchesByFloor, floorId])

  // While hidden, hand back the exact element tree from the last visible
  // render: identical element references make React bail out of reconciling
  // the ~2 segments-per-route subtree, so 2D store churn costs this component
  // almost nothing. Rebuilt fresh on the first visible render. Every visible
  // code path below MUST write jsxCacheRef (including the null returns) —
  // caching only the non-empty tree would let a hidden render resurrect a
  // tree older than the last visible one.
  const jsxCacheRef = useRef(null)
  if (!isVisible) return jsxCacheRef.current

  if (!pxToM || (routes.size === 0 && switchLinks.size === 0)) {
    jsxCacheRef.current = null
    return null
  }

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
    // Longer dash for fiber to read as different material, matches 2D.
    const dashSize = isFiber ? 0.30 : 0.18
    const gapSize  = isFiber ? 0.14 : 0.10
    // Fallback whole route + tray drop legs + fiber all use dashed.
    const runs = groupRuns(segs, (s) => isFallback || s.isDrop || isFiber)
    return (
      <group key={key}>
        {runs.map((run, i) => (
          <PolylineTube
            key={i}
            pts3={run.idxs.map((ix) => pts3[ix])}
            color={color}
            dimOpacity={dimOpacity}
            dashed={run.dashed}
            dashSize={dashSize}
            gapSize={gapSize}
          />
        ))}
      </group>
    )
  }

  const jsx = (
    <>
      {Array.from(routes.values()).map((r) => renderRoute(r, `r-${r.apId}`, CABLE_COLOR))}
      {Array.from(switchLinks.values()).map((link) => {
        const isFiber = link.cableType === 'fiber'
        const baseColor = isFiber ? TRUNK_FIBER : TRUNK_COLOR
        return renderRoute(link, `sl-${link.srcId}`, baseColor, isFiber)
      })}
    </>
  )
  jsxCacheRef.current = jsx
  return jsx
}

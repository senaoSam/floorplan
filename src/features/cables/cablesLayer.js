import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import {
  computeRoutes,
  buildRoutingContext,
  routeOneAP,
  routeOneSwitchLink,
} from '@/features/cable/computeRoutes'
import { useEditorStore } from '@/store/useEditorStore'
import { useViewportStore } from '@/store/useViewportStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'

// Cable adapter — runs computeRoutes against the full building data on
// every change to floor / AP / wall / cable stores, then draws the routes
// landing on the active floor. Visual ports oldSrc CableLayer.jsx 1:1:
//
//   AP → Switch (TrayRoute, hard-coded cyan):
//     tray (graph route)         — solid #22d3ee main run + dashed drop legs
//     fallback-manhattan         — long-dash pale grey + elbow marker
//     unroutable                 — red badge "!" at AP location
//     node markers (foot / riser-foot / riser@floor): filled circles in
//       trayColor with cyan-700 stroke
//
//   Switch → Switch (SwitchLinkRoute, 14-2):
//     copper trunk #a78bfa violet, stroke2 #6d28d9
//     fiber  trunk #fb7185 rose,   stroke2 #9f1239, longer dash
//
// 17-2 selection-driven focus:
//   AP selected     → routes hitting that AP keep full opacity, others dim
//   Switch selected → routes hitting that switch + S2S trunks keep opacity
//   Focused routes additionally get an indigo highlight band underneath
//
// All sizes are world-px multiplied by inverseScale (= 1/viewport.scale)
// so cables render at constant screen-px size regardless of zoom.

const TRAY_COLOR        = '#22d3ee'
const TRAY_NODE_STROKE  = '#0e7490'
const FALLBACK_COLOR    = '#9ca3af'
const UNROUTABLE_COLOR  = '#ef4444'
const HIGHLIGHT_FILL    = 'rgba(129, 140, 248, 0.55)'  // indigo-400 @ 55%
const S2S_COPPER_TRUNK  = '#a78bfa'                    // violet-400
const S2S_COPPER_STROKE = '#6d28d9'                    // violet-700
const S2S_FIBER_TRUNK   = '#fb7185'                    // rose-400
const S2S_FIBER_STROKE  = '#9f1239'                    // rose-800
const DIM_OPACITY       = 0.18

// Badge text style for "!" — recreated per-draw if size changes.
const BADGE_TEXT_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  fontWeight: '700',
  align: 'center',
})

function drawDashedSegment(g, ax, ay, bx, by, color, width, dashOn, dashOff, alpha) {
  const len = Math.hypot(bx - ax, by - ay)
  if (len <= 1e-9) return
  const ux = (bx - ax) / len
  const uy = (by - ay) / len
  let cursor = 0
  let phaseOn = true
  let remain = dashOn
  while (cursor < len) {
    const step = Math.min(len - cursor, remain)
    const x1 = ax + ux * cursor
    const y1 = ay + uy * cursor
    const x2 = ax + ux * (cursor + step)
    const y2 = ay + uy * (cursor + step)
    if (phaseOn) {
      g.moveTo(x1, y1).lineTo(x2, y2)
        .stroke({ width, color, alpha, cap: 'round' })
    }
    cursor += step
    remain -= step
    if (remain <= 1e-9) {
      phaseOn = !phaseOn
      remain = phaseOn ? dashOn : dashOff
    }
  }
}

function drawSolidSegment(g, ax, ay, bx, by, color, width, alpha) {
  g.moveTo(ax, ay).lineTo(bx, by)
    .stroke({ width, color, alpha, cap: 'round' })
}

// Returns the node-marker radius for this point kind (oldSrc TrayRoute):
//   endpoint-foot / riser-foot : 2.5
//   riser@floor                : 3
//   other (tray-vertex / cross): 2
// Switch-link variant uses slightly larger radii (2.6 / 3.1 / 2.2).
function trayNodeRadius(p) {
  if (p.kind === 'endpoint-foot' || p.kind === 'riser-foot') return 2.5
  if (p.kind === 'riser@floor') return 3
  return 2
}
function switchLinkNodeRadius(p) {
  if (p.kind === 'endpoint-foot' || p.kind === 'riser-foot') return 2.6
  if (p.kind === 'riser@floor') return 3.1
  return 2.2
}

// Whether this node renders a stroked outline (foot / riser hubs do).
function nodeHasOutline(p) {
  return p.kind === 'endpoint-foot' || p.kind === 'riser-foot' || p.kind === 'riser@floor'
}

export function attachCablesLayer({
  scene,
  useFloorStore,
  useAPStore,
  useCableStore,
}) {
  const layer = scene.layers.cables
  const g = new Graphics()
  g.eventMode = 'none' // pure visual — never intercept clicks
  layer.addChild(g)
  // Badges go in a separate Container so we can manage Text children
  // without rebuilding them per-redraw beyond clearing.
  const badgeRoot = new Container()
  badgeRoot.eventMode = 'none'
  layer.addChild(badgeRoot)

  const clearBadges = () => {
    while (badgeRoot.children.length > 0) {
      const c = badgeRoot.children[0]
      badgeRoot.removeChild(c)
      c.destroy({ children: true })
    }
  }

  const drawUnroutableBadge = (x, y, s, alpha) => {
    // oldSrc: Circle radius 8*s at (ap.x + 14*s, ap.y - 18*s),
    // fill #ef4444, stroke #fff width 1.5*s, then Text "!" fontSize 12*s.
    const bx = x + 14 * s
    const by = y - 18 * s
    g.circle(bx, by, 8 * s)
      .fill({ color: UNROUTABLE_COLOR, alpha: 1 * alpha })
      .stroke({ width: 1.5 * s, color: 0xffffff, alpha: 1 * alpha })
    const t = new Text({ text: '!', style: BADGE_TEXT_STYLE })
    t.anchor.set(0.5, 0.5)
    t.position.set(bx, by)
    t.scale.set(s)
    t.alpha = alpha
    t.eventMode = 'none'
    badgeRoot.addChild(t)
  }

  // Apply drag overlay onto canonical stores so cables redraw LIVE while
  // the user moves an AP / switch / tray (user-flagged improvement —
  // oldSrc froze cables until dragend with comment "26-2 P3b — DON'T
  // subscribe to dragAP/dragSwitch"; PIXI now updates per pointermove).
  const overlayedApsByFloor = (apsByFloor, override) => {
    if (!override) return apsByFloor
    const out = {}
    for (const fid in apsByFloor) {
      out[fid] = apsByFloor[fid].map((a) =>
        a.id === override.id ? { ...a, x: override.x, y: override.y } : a,
      )
    }
    return out
  }
  const overlayedSwitchesByFloor = (switchesByFloor, override) => {
    if (!override) return switchesByFloor
    const out = {}
    for (const fid in switchesByFloor) {
      out[fid] = switchesByFloor[fid].map((sw) =>
        sw.id === override.id ? { ...sw, x: override.x, y: override.y } : sw,
      )
    }
    return out
  }
  const overlayedTraysByFloor = (traysByFloor, bodyOverride, vertexOverride) => {
    if (!bodyOverride && !vertexOverride) return traysByFloor
    const out = {}
    for (const fid in traysByFloor) {
      out[fid] = traysByFloor[fid].map((t) => {
        if (bodyOverride && t.id === bodyOverride.id) {
          return {
            ...t,
            points: t.points.map((p) => ({
              x: p.x + bodyOverride.dx,
              y: p.y + bodyOverride.dy,
            })),
          }
        }
        if (vertexOverride && t.id === vertexOverride.trayId) {
          return {
            ...t,
            points: t.points.map((p, i) =>
              i === vertexOverride.vertexIdx
                ? { x: vertexOverride.x, y: vertexOverride.y }
                : p,
            ),
          }
        }
        return t
      })
    }
    return out
  }

  // 32-C incremental routing cache. `baseResult` holds the last FULL
  // computeRoutes output. While dragging a single AP / switch we rebuild the
  // graph (~1ms) but run Dijkstra for ONLY the dragged object (the other
  // ~999 routes are reused from baseResult), dropping per-frame cost from
  // ~93ms to ~1ms at 1000 APs. See .claude/perf-baseline.md §32-0.
  //
  // Identity guarantee: the incremental path derives from the SAME graph +
  // the SAME routeOneAP / routeOneSwitchLink helpers computeRoutes uses, so
  // the drag-time route equals what dragend's full recompute produces — the
  // cable never jumps on release (verified by scripts/test-incremental-routing.mjs).
  let baseResult = null  // { routes: Map, switchLinks: Map }

  // Produce { routes, switchLinks } for drawing, choosing full vs incremental
  // based on what (if anything) is being dragged. `building` already has the
  // drag overlay applied to the relevant store slice.
  const computeRoutesForDraw = (building, drag) => {
    const draggingAP   = !!drag.ap
    const draggingSW   = !!drag.sw
    // Tray / trayVertex drag mutates the shared graph topology — safe
    // incremental isn't worth it, so we FREEZE: keep drawing baseResult
    // unchanged until dragend triggers a full recompute. (User-approved 32-C
    // scope decision.)
    const freezing     = !!drag.tray || !!drag.trayVertex

    if (freezing && baseResult) {
      return baseResult
    }

    // No single-object drag in flight, OR no cache yet → full recompute and
    // refresh the cache. This is also the dragend path (overlay back to null).
    if ((!draggingAP && !draggingSW) || !baseResult) {
      baseResult = computeRoutes(building)
      return baseResult
    }

    // Incremental: rebuild the graph from the overlayed building data, then
    // recompute only the dragged object's route(s).
    const ctx = buildRoutingContext(building)
    const routes = new Map(baseResult.routes)
    const switchLinks = new Map(baseResult.switchLinks)

    if (draggingAP) {
      // Find the dragged AP (with overlayed coords) and its home floor.
      for (const [floorId, list] of Object.entries(building.apsByFloor ?? {})) {
        const ap = (list ?? []).find((a) => a.id === drag.ap.id)
        if (ap) { routes.set(ap.id, routeOneAP(ctx, ap, floorId)); break }
      }
    }

    if (draggingSW) {
      // The moved switch's own S2S uplink changes...
      const movedSw = ctx.swById.get(drag.sw.id)
      if (movedSw) {
        const link = routeOneSwitchLink(ctx, movedSw)
        if (link) switchLinks.set(movedSw.id, link)
        else switchLinks.delete(movedSw.id)
      }
      // ...and every AP route that lands on this switch (its drop endpoint
      // moved). Recompute those from the cached set.
      for (const [floorId, list] of Object.entries(building.apsByFloor ?? {})) {
        for (const ap of list ?? []) {
          const prior = baseResult.routes.get(ap.id)
          if (prior && prior.switchId === drag.sw.id) {
            routes.set(ap.id, routeOneAP(ctx, ap, floorId))
          }
        }
      }
    }

    return { routes, switchLinks }
  }

  const rebuild = () => {
    const { floors, activeFloorId } = useFloorStore.getState()
    let apsByFloor = useAPStore.getState().apsByFloor
    let switchesByFloor = useCableStore.getState().switchesByFloor
    let traysByFloor = useCableStore.getState().traysByFloor
    const risers = useCableStore.getState().risers
    const drag = useDragOverlayStore.getState()
    apsByFloor      = overlayedApsByFloor(apsByFloor, drag.ap)
    switchesByFloor = overlayedSwitchesByFloor(switchesByFloor, drag.sw)
    traysByFloor    = overlayedTraysByFloor(traysByFloor, drag.tray, drag.trayVertex)
    const editor = useEditorStore.getState()
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale

    g.clear()
    clearBadges()
    if (!activeFloorId || floors.length === 0) {
      baseResult = null  // stale once there's no floor; force full next time
      return
    }

    const { routes, switchLinks } = computeRoutesForDraw(
      { floors, apsByFloor, switchesByFloor, traysByFloor, risers },
      drag,
    )

    const hasFocus = editor.selectedId && (editor.selectedType === 'ap' || editor.selectedType === 'switch')
    const isRouteRelevant = (r) => {
      if (!hasFocus) return true
      if (editor.selectedType === 'ap')     return r.apId     === editor.selectedId
      if (editor.selectedType === 'switch') return r.switchId === editor.selectedId
      return true
    }
    const isLinkRelevant = (link) => {
      if (!hasFocus) return true
      if (editor.selectedType === 'switch') return link.srcId === editor.selectedId || link.targetId === editor.selectedId
      return false
    }
    const isRouteFocused = (r) => hasFocus && isRouteRelevant(r)
    const isLinkFocused  = (link) => hasFocus && isLinkRelevant(link)

    // First pass: indigo highlight band UNDER focused routes/links.
    const drawHighlightBand = (pts) => {
      if (!pts || pts.length < 2) return
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
        g.moveTo(a.x, a.y).lineTo(b.x, b.y)
          .stroke({ width: 10 * s, color: HIGHLIGHT_FILL, alpha: 1, cap: 'round' })
      }
    }
    if (hasFocus) {
      for (const r of routes.values()) {
        if (!isRouteFocused(r)) continue
        if (r.routeStatus === 'unroutable') continue
        drawHighlightBand(r.points)
      }
      for (const link of switchLinks.values()) {
        if (!isLinkFocused(link)) continue
        if (link.routeStatus === 'unroutable') continue
        drawHighlightBand(link.points)
      }
    }

    // Routes (AP → Switch).
    const apsOnFloor = apsByFloor[activeFloorId] ?? []
    for (const r of routes.values()) {
      const relevant = isRouteRelevant(r)
      const baseAlpha = hasFocus && !relevant ? DIM_OPACITY : 1
      if (r.routeStatus === 'unroutable') {
        if (r.homeFloorId !== activeFloorId) continue
        const ap = apsOnFloor.find((a) => a.id === r.apId)
        if (!ap) continue
        drawUnroutableBadge(ap.x, ap.y, s, baseAlpha)
        continue
      }
      const pts = r.points
      if (!pts || pts.length < 2) continue

      if (r.routeStatus === 'fallback-manhattan') {
        if (r.homeFloorId !== activeFloorId) continue
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i]
          if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
          drawDashedSegment(g, a.x, a.y, b.x, b.y, FALLBACK_COLOR, 1.2 * s, 14 * s, 10 * s, 0.7 * baseAlpha)
        }
        // Elbow marker (only when there are exactly 3 points = single bend).
        if (pts.length === 3) {
          g.circle(pts[1].x, pts[1].y, 2 * s)
            .fill({ color: FALLBACK_COLOR, alpha: 0.85 * baseAlpha })
        }
        continue
      }

      // Tray route — per-segment dashed drop / solid main + node markers.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
        const isDrop = a.kind === 'endpoint' || b.kind === 'endpoint'
        if (isDrop) {
          drawDashedSegment(g, a.x, a.y, b.x, b.y, TRAY_COLOR, 1.4 * s, 6 * s, 4 * s, 0.85 * baseAlpha)
        } else {
          drawSolidSegment(g, a.x, a.y, b.x, b.y, TRAY_COLOR, 1.6 * s, 0.95 * baseAlpha)
        }
      }
      // Node markers for tray points on this floor (skip endpoints — they
      // belong to AP / Switch icons).
      for (const p of pts) {
        if (p.floorId !== activeFloorId) continue
        if (p.kind === 'endpoint') continue
        const radius = trayNodeRadius(p) * s
        g.circle(p.x, p.y, radius)
          .fill({ color: TRAY_COLOR, alpha: 0.9 * baseAlpha })
        if (nodeHasOutline(p)) {
          g.circle(p.x, p.y, radius)
            .stroke({ width: 0.6 * s, color: TRAY_NODE_STROKE, alpha: 0.9 * baseAlpha })
        }
      }
    }

    // Switch-to-switch links.
    for (const link of switchLinks.values()) {
      const relevant = isLinkRelevant(link)
      const baseAlpha = hasFocus && !relevant ? DIM_OPACITY : 1
      const isFiber = link.cableType === 'fiber'
      const trunk = isFiber ? S2S_FIBER_TRUNK : S2S_COPPER_TRUNK
      const stroke2 = isFiber ? S2S_FIBER_STROKE : S2S_COPPER_STROKE
      if (link.routeStatus === 'unroutable') {
        if (link.srcFloorId !== activeFloorId) continue
        const switchesOnFloor = switchesByFloor[activeFloorId] ?? []
        const sw = switchesOnFloor.find((sw) => sw.id === link.srcId)
        if (!sw) continue
        drawUnroutableBadge(sw.x, sw.y, s, baseAlpha)
        continue
      }
      const pts = link.points
      if (!pts || pts.length < 2) continue

      if (link.routeStatus === 'fallback-manhattan') {
        if (link.srcFloorId !== activeFloorId) continue
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i]
          if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
          const dashOn  = isFiber ? 18 * s : 14 * s
          const dashOff = isFiber ?  8 * s : 10 * s
          drawDashedSegment(g, a.x, a.y, b.x, b.y, trunk, 1.6 * s, dashOn, dashOff, 0.8 * baseAlpha)
        }
        continue
      }

      // Tray-routed S2S — solid main 1.9*s, dashed drop 1.5*s.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
        const isDrop = a.kind === 'endpoint' || b.kind === 'endpoint'
        if (isDrop) {
          drawDashedSegment(g, a.x, a.y, b.x, b.y, trunk, 1.5 * s, 6 * s, 4 * s, 0.85 * baseAlpha)
        } else if (isFiber) {
          drawDashedSegment(g, a.x, a.y, b.x, b.y, trunk, 1.9 * s, 12 * s, 6 * s, 0.95 * baseAlpha)
        } else {
          drawSolidSegment(g, a.x, a.y, b.x, b.y, trunk, 1.9 * s, 0.95 * baseAlpha)
        }
      }
      for (const p of pts) {
        if (p.floorId !== activeFloorId) continue
        if (p.kind === 'endpoint') continue
        const radius = switchLinkNodeRadius(p) * s
        g.circle(p.x, p.y, radius)
          .fill({ color: trunk, alpha: 0.9 * baseAlpha })
        if (nodeHasOutline(p)) {
          g.circle(p.x, p.y, radius)
            .stroke({ width: 0.6 * s, color: stroke2, alpha: 0.9 * baseAlpha })
        }
      }
    }
  }

  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubAP = useAPStore.subscribe(rebuild)
  const unsubCable = useCableStore.subscribe(rebuild)
  const unsubViewport = useViewportStore.subscribe(rebuild)
  // Live cable redraw during AP/SW/tray drag. Subscribe gated by checking
  // whether any relevant override key changed so unrelated dragOverlay
  // mutations (e.g. wall drag dx/dy) don't trigger a route recompute.
  let lastDragAp = useDragOverlayStore.getState().ap
  let lastDragSw = useDragOverlayStore.getState().sw
  let lastDragTray = useDragOverlayStore.getState().tray
  let lastDragTrayVtx = useDragOverlayStore.getState().trayVertex
  const unsubDrag = useDragOverlayStore.subscribe(() => {
    const d = useDragOverlayStore.getState()
    if (d.ap === lastDragAp && d.sw === lastDragSw &&
        d.tray === lastDragTray && d.trayVertex === lastDragTrayVtx) return
    lastDragAp = d.ap
    lastDragSw = d.sw
    lastDragTray = d.tray
    lastDragTrayVtx = d.trayVertex
    rebuild()
  })
  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  const unsubEditor = useEditorStore.subscribe(() => {
    const s = useEditorStore.getState()
    if (s.selectedId === lastSelectedId && s.selectedType === lastSelectedType) return
    lastSelectedId = s.selectedId
    lastSelectedType = s.selectedType
    rebuild()
  })
  rebuild()

  return () => {
    unsubFloor()
    unsubAP()
    unsubCable()
    unsubEditor()
    unsubViewport()
    unsubDrag()
    layer.removeChild(g)
    g.destroy()
    clearBadges()
    layer.removeChild(badgeRoot)
    badgeRoot.destroy({ children: true })
  }
}

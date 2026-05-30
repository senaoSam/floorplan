import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import {
  computeRoutes,
  buildRoutingContext,
  routeOneAP,
  routeOneSwitchLink,
} from '@/features/cable/computeRoutes'
import { clearRoutesCache } from '@/features/cable/routesCache'
import { perfOn, probe, probeEvent } from '@/features/cable/perfProbe'
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
//
// 32-E perf — two draw-side bottlenecks fixed (routing was already made
// incremental in 32-C; see .claude/perf-baseline.md §32-E):
//   A. selection / viewport rebuilds re-ran the FULL computeRoutes even
//      though neither changes route geometry (selection only dims/highlights,
//      viewport only rescales widths). `routingDirty` now gates the cache so
//      those rebuilds reuse baseResult and skip Dijkstra entirely — selecting
//      an AP at 300 AP went from ~2.4-3.4s to draw-only cost.
//   B. dragging one AP/SW redrew ALL ~26,850 stroke segments per frame. The
//      single Graphics is split into gStatic (the un-dragged routes, drawn
//      once at drag start and frozen) + gDynamic (only the dragged route's,
//      cleared and redrawn each frame). Outside a drag everything draws into
//      gStatic and gDynamic stays empty.

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

  // 32-E static/dynamic split. Outside a drag, all cables draw into gStatic
  // (gDynamic empty). During an AP/SW drag, the un-affected routes are drawn
  // once into gStatic and frozen, while only the dragged route(s) redraw into
  // gDynamic each frame. Each Graphics gets its own badge Container so a frozen
  // static badge isn't wiped when the dynamic layer clears mid-drag.
  // staticDim wraps gStatic + its badges; the focus dim sets this wrapper's
  // alpha to DIM_OPACITY. (gStatic draws as plain vector — no cacheAsTexture —
  // so the lines stay crisp/full-brightness at any zoom. An earlier version
  // cached gStatic to a texture for software-render perf, but the static/dynamic
  // split already avoids per-frame re-tessellation, so the cache was unnecessary
  // and caused upsample blur + alpha-bake dimming bugs; removed.)
  const staticDim = new Container()
  staticDim.eventMode = 'none'
  layer.addChild(staticDim)
  const gStatic = new Graphics()
  gStatic.eventMode = 'none' // pure visual — never intercept clicks
  staticDim.addChild(gStatic)
  const badgeStatic = new Container()
  badgeStatic.eventMode = 'none'
  staticDim.addChild(badgeStatic)

  const gDynamic = new Graphics()
  gDynamic.eventMode = 'none'
  layer.addChild(gDynamic)
  const badgeDynamic = new Container()
  badgeDynamic.eventMode = 'none'
  layer.addChild(badgeDynamic)

  const clearBadges = (root) => {
    while (root.children.length > 0) {
      const c = root.children[0]
      root.removeChild(c)
      c.destroy({ children: true })
    }
  }

  // Draw the unroutable "!" badge: a circle into `g` and the text into the
  // matching badge Container. oldSrc: Circle radius 8*s at (x + 14*s, y - 18*s),
  // fill #ef4444, stroke #fff width 1.5*s, then Text "!" fontSize 12*s.
  const drawUnroutableBadge = (g, badgeRoot, x, y, s, alpha) => {
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
  // 32-E: only floor / ap / cable store changes alter route geometry.
  // selection (editor) and viewport changes do NOT — so they reuse baseResult
  // without re-running Dijkstra. routingDirty is set true by those three
  // subscriptions and on drag end; cleared after a full recompute.
  let routingDirty = true
  // 32-E: bumped every time baseResult is RECOMPUTED (full or incremental). The
  // static-layer draw records the epoch it baked; if baseResult changed since,
  // gStatic must rebuild even when splitKey is unchanged. Without this, a tray
  // drag commit (which fires while drag.tray is still set → the freeze path
  // bakes the STALE pre-move routes into gStatic, then the drag-clear rebuild
  // gets fresh routes but skips the static redraw because splitKey didn't
  // change) leaves stale cable geometry frozen in the cached texture.
  let routesEpoch = 0
  let staticEpoch = -1
  // 32-E: the store-slice refs from the last FULL computeRoutes, so a dirty
  // rebuild can diff what actually changed. A drag COMMIT (updateAP on release)
  // or any single-AP edit changes only that AP's object (Zustand immutable
  // update) while trays / switches / risers keep identity — then we reroute
  // just the changed AP(s) (~1 ms) instead of a full building Dijkstra
  // (~400–600 ms at 300 AP + a spanning tray, which was the "放下卡一下"). Full
  // recompute still runs when the tray/switch/riser graph changed or APs were
  // added/removed (topology shift).
  let lastInputs = null  // { floors, apsByFloor, switchesByFloor, traysByFloor, risers }

  // Reroute only the APs whose data object changed since lastInputs, reusing
  // baseResult for everything else. Returns a fresh { routes, switchLinks } or
  // null if an incremental update isn't safe (graph topology changed / AP set
  // changed / no prior result) → caller falls back to full computeRoutes.
  const tryIncrementalDirty = (building) => {
    if (!baseResult || !lastInputs) return null
    // Graph topology must be unchanged (same tray / riser / switch refs) — any
    // of those shifts edge weights for many routes, so reroute-all is needed.
    if (building.traysByFloor !== lastInputs.traysByFloor) return null
    if (building.switchesByFloor !== lastInputs.switchesByFloor) return null
    if (building.risers !== lastInputs.risers) return null
    if (building.floors !== lastInputs.floors) return null
    // Find changed AP ids by object identity, same floor set.
    const changed = []  // [{ ap, floorId }]
    const prevByFloor = lastInputs.apsByFloor
    const curByFloor = building.apsByFloor
    const prevFloors = Object.keys(prevByFloor)
    const curFloors = Object.keys(curByFloor)
    if (prevFloors.length !== curFloors.length) return null
    for (const floorId of curFloors) {
      const prevList = prevByFloor[floorId]
      const curList = curByFloor[floorId]
      if (!prevList || prevList.length !== curList.length) return null  // add/remove → full
      const prevById = new Map(prevList.map((a) => [a.id, a]))
      for (const ap of curList) {
        const prev = prevById.get(ap.id)
        if (prev === undefined) return null   // id set changed → full
        if (prev !== ap) changed.push({ ap, floorId })
      }
    }
    // Too many changed → full is simpler/safer (and not a single-edit gesture).
    if (changed.length === 0) return baseResult
    if (changed.length > 4) return null

    const ctx = buildRoutingContext(building)
    const routes = new Map(baseResult.routes)
    const switchLinks = new Map(baseResult.switchLinks)
    for (const { ap, floorId } of changed) {
      routes.set(ap.id, routeOneAP(ctx, ap, floorId))
    }
    baseResult = { routes, switchLinks }
    lastInputs = building
    routingDirty = false
    return baseResult
  }

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

    // No single-object drag in flight. Reuse the cache unless routing inputs
    // actually changed (routingDirty) or there is no cache yet. This is the
    // 32-E fast path for selection / viewport rebuilds, and also the dragend
    // path (drag overlay back to null, routingDirty set by the drag sub).
    if (!draggingAP && !draggingSW) {
      if (!baseResult || routingDirty) {
        // Try a cheap incremental update first (e.g. a drag-commit / single-AP
        // edit changed only that AP). Falls back to full when topology or the
        // AP set changed.
        const inc = tryIncrementalDirty(building)
        if (inc) { routesEpoch++; return inc }
        baseResult = computeRoutes(building)
        lastInputs = building
        routingDirty = false
        routesEpoch++
      }
      return baseResult
    }

    // No cache yet but mid-drag (e.g. first frame after a fresh load) → full.
    if (!baseResult) {
      baseResult = computeRoutes(building)
      lastInputs = building
      routingDirty = false
      routesEpoch++
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

  // 32-E: compute the set of route apIds + switchLink srcIds that a single
  // AP/SW drag mutates. These (and only these) redraw into gDynamic each
  // frame; everything else is frozen in gStatic. Mirrors the incremental
  // routing's affected-set so the split is exact.
  const computeAffected = (drag, routes, switchLinks) => {
    const apIds = new Set()
    const linkIds = new Set()
    if (drag.ap) {
      apIds.add(drag.ap.id)
    }
    if (drag.sw) {
      linkIds.add(drag.sw.id)
      for (const r of routes.values()) {
        if (r.switchId === drag.sw.id) apIds.add(r.apId)
      }
    }
    return { apIds, linkIds }
  }

  // Pure draw of routes + switch links into a single Graphics / badge
  // Container, gated by `keep(kind, idObj)`. Extracted from rebuild() (32-E) —
  // every color / width / dash / radius constant is unchanged.
  //
  // 32-E dimming change: focus-dim is NOT applied per-route here anymore.
  // Drawing 300 routes at alpha 0.18 was ~16× slower than at alpha 1 (PIXI
  // can't batch translucent strokes the same way) → selecting an AP cost
  // ~2080ms. Instead every route draws at its FULL base alpha and the caller
  // dims the whole background layer via `staticDim.alpha = DIM_OPACITY` (one
  // property, no redraw — on the uncached wrapper so it isn't baked in). Per-element effective alpha is identical
  // (e.g. 0.95 × 0.18); only translucent-overlap blending differs slightly
  // (within the §32-E visual tolerance — cables rarely overlap densely).
  // So `keep` doubles as the focus split: focused routes go to gDynamic
  // (alpha 1, with highlight band), the rest to gStatic (dimmed by container).
  //   keep('route', route)  → draw this AP→Switch route?
  //   keep('link',  link)   → draw this Switch→Switch link?
  const drawRoutes = (g, badgeRoot, routes, switchLinks, dctx, keep) => {
    const {
      s, activeFloorId, hasFocus,
      isRouteFocused, isLinkFocused,
      apsByFloor, switchesByFloor,
    } = dctx

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
        if (!keep('route', r)) continue
        if (!isRouteFocused(r)) continue
        if (r.routeStatus === 'unroutable') continue
        drawHighlightBand(r.points)
      }
      for (const link of switchLinks.values()) {
        if (!keep('link', link)) continue
        if (!isLinkFocused(link)) continue
        if (link.routeStatus === 'unroutable') continue
        drawHighlightBand(link.points)
      }
    }

    // Routes (AP → Switch).
    const apsOnFloor = apsByFloor[activeFloorId] ?? []
    for (const r of routes.values()) {
      if (!keep('route', r)) continue
      // Full base alpha — focus-dim is applied at the container level (see header).
      if (r.routeStatus === 'unroutable') {
        if (r.homeFloorId !== activeFloorId) continue
        const ap = apsOnFloor.find((a) => a.id === r.apId)
        if (!ap) continue
        drawUnroutableBadge(g, badgeRoot, ap.x, ap.y, s, 1)
        continue
      }
      const pts = r.points
      if (!pts || pts.length < 2) continue

      if (r.routeStatus === 'fallback-manhattan') {
        if (r.homeFloorId !== activeFloorId) continue
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i]
          if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
          drawDashedSegment(g, a.x, a.y, b.x, b.y, FALLBACK_COLOR, 1.2 * s, 14 * s, 10 * s, 0.7)
        }
        // Elbow marker (only when there are exactly 3 points = single bend).
        if (pts.length === 3) {
          g.circle(pts[1].x, pts[1].y, 2 * s)
            .fill({ color: FALLBACK_COLOR, alpha: 0.85 })
        }
        continue
      }

      // Tray route — per-segment dashed drop / solid main + node markers.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
        const isDrop = a.kind === 'endpoint' || b.kind === 'endpoint'
        if (isDrop) {
          drawDashedSegment(g, a.x, a.y, b.x, b.y, TRAY_COLOR, 1.4 * s, 6 * s, 4 * s, 0.85)
        } else {
          drawSolidSegment(g, a.x, a.y, b.x, b.y, TRAY_COLOR, 1.6 * s, 0.95)
        }
      }
      // Node markers for tray points on this floor (skip endpoints — they
      // belong to AP / Switch icons).
      for (const p of pts) {
        if (p.floorId !== activeFloorId) continue
        if (p.kind === 'endpoint') continue
        const radius = trayNodeRadius(p) * s
        g.circle(p.x, p.y, radius)
          .fill({ color: TRAY_COLOR, alpha: 0.9 })
        if (nodeHasOutline(p)) {
          g.circle(p.x, p.y, radius)
            .stroke({ width: 0.6 * s, color: TRAY_NODE_STROKE, alpha: 0.9 })
        }
      }
    }

    // Switch-to-switch links.
    for (const link of switchLinks.values()) {
      if (!keep('link', link)) continue
      // Full base alpha — focus-dim is applied at the container level (see header).
      const isFiber = link.cableType === 'fiber'
      const trunk = isFiber ? S2S_FIBER_TRUNK : S2S_COPPER_TRUNK
      const stroke2 = isFiber ? S2S_FIBER_STROKE : S2S_COPPER_STROKE
      if (link.routeStatus === 'unroutable') {
        if (link.srcFloorId !== activeFloorId) continue
        const switchesOnFloor = switchesByFloor[activeFloorId] ?? []
        const sw = switchesOnFloor.find((sw) => sw.id === link.srcId)
        if (!sw) continue
        drawUnroutableBadge(g, badgeRoot, sw.x, sw.y, s, 1)
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
          drawDashedSegment(g, a.x, a.y, b.x, b.y, trunk, 1.6 * s, dashOn, dashOff, 0.8)
        }
        continue
      }

      // Tray-routed S2S — solid main 1.9*s, dashed drop 1.5*s.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
        const isDrop = a.kind === 'endpoint' || b.kind === 'endpoint'
        if (isDrop) {
          drawDashedSegment(g, a.x, a.y, b.x, b.y, trunk, 1.5 * s, 6 * s, 4 * s, 0.85)
        } else if (isFiber) {
          drawDashedSegment(g, a.x, a.y, b.x, b.y, trunk, 1.9 * s, 12 * s, 6 * s, 0.95)
        } else {
          drawSolidSegment(g, a.x, a.y, b.x, b.y, trunk, 1.9 * s, 0.95)
        }
      }
      for (const p of pts) {
        if (p.floorId !== activeFloorId) continue
        if (p.kind === 'endpoint') continue
        const radius = switchLinkNodeRadius(p) * s
        g.circle(p.x, p.y, radius)
          .fill({ color: trunk, alpha: 0.9 })
        if (nodeHasOutline(p)) {
          g.circle(p.x, p.y, radius)
            .stroke({ width: 0.6 * s, color: stroke2, alpha: 0.9 })
        }
      }
    }
  }

  // 32-E split-state tracking. gStatic holds the frozen BACKGROUND (drawn once
  // per split-key change); gDynamic holds the FOREGROUND (focused + dragged
  // routes), redrawn each frame. `splitKey` fingerprints what's in each layer
  // so we only rebuild gStatic when the selection or drag target actually
  // changes — continuous drag of the same object touches gDynamic only.
  let splitKey = null
  // 32-E dragend fast path — the affected set + drag key from the last in-drag
  // frame, so release can append just those route(s) to gStatic instead of
  // rebuilding all (only when unfocused; focus forces a full rebuild).
  let lastDragAffected = null
  let lastDragKey = ''

  const rebuildImpl = () => {
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

    if (!activeFloorId || floors.length === 0) {
      gStatic.clear()
      gDynamic.clear()
      clearBadges(badgeStatic)
      clearBadges(badgeDynamic)
      staticDim.alpha = 1
      baseResult = null      // stale once there's no floor; force full next time
      routingDirty = false   // !baseResult already forces a full recompute
      splitKey = null
      staticEpoch = -1       // force a full rebuild on the next real rebuild
      lastDragAffected = null
      lastDragKey = ''
      return
    }

    const { routes, switchLinks } = computeRoutesForDraw(
      { floors, apsByFloor, switchesByFloor, traysByFloor, risers },
      drag,
    )

    // hasFocus requires the selected object to still EXIST. A dangling
    // selectedId — e.g. undo/redo removes the selected AP/switch from the store
    // without touching editor selection (useHistoryStore doesn't snapshot
    // selection) — would otherwise keep hasFocus true with no route to focus,
    // dimming the whole layer to DIM_OPACITY forever (stuck-dim residue). The
    // panel already tolerates this (APPanel returns null when the AP is gone);
    // mirror that here so the cable layer reads as "nothing selected" too.
    const selExists =
      editor.selectedType === 'ap'
        ? Object.values(apsByFloor).some((list) => list.some((a) => a.id === editor.selectedId))
        : editor.selectedType === 'switch'
          ? Object.values(switchesByFloor).some((list) => list.some((sw) => sw.id === editor.selectedId))
          : false
    const hasFocus =
      editor.selectedId &&
      (editor.selectedType === 'ap' || editor.selectedType === 'switch') &&
      selExists
    const isRouteFocused = (r) => {
      if (!hasFocus) return false
      if (editor.selectedType === 'ap')     return r.apId     === editor.selectedId
      if (editor.selectedType === 'switch') return r.switchId === editor.selectedId
      return false
    }
    const isLinkFocused = (link) => {
      if (!hasFocus) return false
      if (editor.selectedType === 'switch') return link.srcId === editor.selectedId || link.targetId === editor.selectedId
      return false
    }

    const dctx = {
      s, activeFloorId, hasFocus,
      isRouteFocused, isLinkFocused,
      apsByFloor, switchesByFloor,
    }

    // 32-E unified static/dynamic split.
    //
    // gStatic = the heavy background, drawn at FULL base alpha. Selection-dim
    //   is applied via `gStatic.alpha` (a single property — NOT a redraw, and
    //   NOT per-route alpha, which costs ~16× more to tessellate; see
    //   drawRoutes header). gStatic excludes only the DRAG-affected routes,
    //   because a frozen copy at the drag-start position would show as a stale
    //   duplicate while the live one moves. Focused (selected) routes DO stay
    //   in gStatic — they're simply occluded by the full-bright copy gDynamic
    //   paints on top, so selection never has to rebuild this layer.
    //
    // gDynamic = the foreground overlay, redrawn each frame (cheap): focused
    //   routes/links (full alpha + indigo highlight band) and drag-affected
    //   routes/links (at their live position).
    //
    // Net effect: SELECTING an AP touches only gDynamic (1 route) + one alpha
    //   assignment (~5 ms), instead of redrawing all ~300 dimmed routes
    //   (~2080 ms before 32-E). DRAGGING redraws only the dragged route.
    const affected = computeAffected(drag, routes, switchLinks)
    const inForeground = (kind, o) => {
      if (kind === 'route') return isRouteFocused(o) || affected.apIds.has(o.apId)
      return isLinkFocused(o) || affected.linkIds.has(o.srcId)
    }
    // gStatic = everything NOT in the foreground. Foreground (focused + drag-
    // affected) lives only in gDynamic at full alpha. We deliberately do NOT
    // leave focused routes in gStatic-and-occlude-them: that invariant broke
    // when a focused route was also drag-excluded (after moving a selected AP
    // then changing selection, its route vanished / double-dimmed). Excluding
    // foreground from gStatic outright + rebuilding gStatic on selection change
    // (focus is in the split key below) keeps it always correct.
    const inStatic = (kind, o) => !inForeground(kind, o)

    // Focus dim: drop the whole background to DIM_OPACITY via the staticDim
    // wrapper's alpha (one property, no per-route alpha → keeps draw cheap; see
    // drawRoutes header).
    const wantDim = hasFocus

    // splitKey fingerprints what gStatic holds. It now includes the FOCUS
    // target (not just the drag target), so changing selection rebuilds gStatic
    // — the dragged-then-reselected residue fix. Data / viewport changes
    // force-null it via invalidateStatic.
    const focusKey = hasFocus ? `${editor.selectedType}:${editor.selectedId}` : ''
    const dragKey = drag.ap ? `ap:${drag.ap.id}` : drag.sw ? `sw:${drag.sw.id}` : ''
    const nextStaticKey = `${focusKey}|${dragKey}`

    // 32-E dragend fast path. When a single-object drag RELEASES (splitKey was
    // 'ap:X'/'sw:X', now 'none') the only diff between the current gStatic and
    // the desired one is that the just-dropped route(s) must rejoin it — the
    // other ~299 are already there, unchanged. Rebuilding all 300 costs ~0.5–
    // 0.9 s on WebGL2 / multi-seconds on software renderers (the "放下卡一下"),
    // so instead we APPEND just the settled route(s) onto the existing gStatic.
    // Guarded to the exact transition: no drag now, the prior frame was a
    // single-object drag, the background wasn't force-invalidated (splitKey !==
    // null, i.e. no data/viewport change), and we actually know which routes to
    // re-add (lastDragAffected). Anything else → full rebuild.
    // gStatic is stale if the routes themselves changed since we last baked it
    // (routesEpoch bump) — even if splitKey is unchanged. This catches the tray-
    // drag-commit case where the freeze path baked pre-move geometry and the
    // follow-up rebuild would otherwise skip the static redraw.
    const routesStale = staticEpoch !== routesEpoch

    let staticRedrawn = false
    // dragend append fast-path — when an UNFOCUSED single-object drag releases,
    // the only gStatic diff is the dropped route rejoining it, so append just
    // that instead of rebuilding all ~299. Guarded to: no drag now, no focus
    // (focus would need the full rebuild to re-dim correctly), the prior frame
    // was a single drag (lastDragAffected), routes not stale, and gStatic was
    // actually holding the un-dragged set (splitKey was a drag key).
    const releasing =
      !drag.ap && !drag.sw && !hasFocus &&
      splitKey === `|${lastDragKey}` && lastDragKey !== '' &&
      lastDragAffected &&
      (lastDragAffected.apIds.size + lastDragAffected.linkIds.size) > 0
    if (releasing && !routesStale) {
      // Append the dropped route(s) into frozen gStatic (no clear → keep the
      // other 299). Only safe when the rest of the routes are still current
      // (routesStale guards the tray-move case where they all changed).
      const a = lastDragAffected
      const onlySettled = (kind, o) =>
        kind === 'route' ? a.apIds.has(o.apId) : a.linkIds.has(o.srcId)
      drawRoutes(gStatic, badgeStatic, routes, switchLinks, dctx, onlySettled)
      splitKey = nextStaticKey
      staticRedrawn = true
    } else if (splitKey !== nextStaticKey || routesStale) {
      gStatic.clear()
      clearBadges(badgeStatic)
      drawRoutes(gStatic, badgeStatic, routes, switchLinks, dctx, inStatic)
      splitKey = nextStaticKey
      staticRedrawn = true
    }
    if (staticRedrawn) staticEpoch = routesEpoch
    // gStatic draws as plain vector (no cacheAsTexture). The static/dynamic
    // split already prevents the per-frame re-tessellation that originally made
    // drags janky: gStatic is rebuilt only when its content changes (drag
    // start/end, data, viewport) — NOT per pointermove — and PIXI re-draws an
    // unchanged Graphics from its cached geometry batch in ~1 ms. Vector keeps
    // the lines crisp + full-brightness at any canvas size / zoom (cacheAsTexture
    // baked to a fixed resolution → upsample blur + dim haze, and baked any
    // ancestor dim into the texture — a whole family of bugs now gone).
    staticDim.alpha = wantDim ? DIM_OPACITY : 1
    lastDragAffected = (drag.ap || drag.sw) ? affected : null
    lastDragKey = dragKey

    // Foreground overlay — redrawn every rebuild (cheap: focused + dragged only).
    gDynamic.clear()
    clearBadges(badgeDynamic)
    drawRoutes(gDynamic, badgeDynamic, routes, switchLinks, dctx, inForeground)
    if (perfOn()) probe(staticRedrawn ? 'cable.rebuild(static+dyn)' : 'cable.rebuild(dyn-only)', 0)
  }

  // Timed wrapper — when the perf probe is on, record how long each cablesLayer
  // rebuild takes (the synchronous CPU cost; frame time is sampled separately).
  const rebuild = () => {
    if (!perfOn()) return rebuildImpl()
    const t0 = performance.now()
    rebuildImpl()
    probe('cable.rebuild.total', performance.now() - t0)
  }

  // Invalidate the frozen background so the next rebuild redraws gStatic. The
  // splitKey only tracks selection / drag-target identity; changes that affect
  // the background's GEOMETRY or SCALE (route data, viewport zoom/pan → the `s`
  // line-width factor) leave the key unchanged, so we must null it explicitly
  // or the static layer would render stale.
  const invalidateStatic = () => { splitKey = null }
  // floor / AP / cable data changed → routing may need recompute. But DON'T
  // force a full gStatic rebuild while a single AP/SW drag is in flight: the
  // static/dynamic split already excludes the dragged object, and a mid-drag
  // commit of that same object (apsLayer calls updateAP before clearing the
  // drag overlay on release) only moves the dragged route — the frozen other
  // ~299 in gStatic are untouched. Invalidating here forced a full 299-route
  // rebuild + cache re-bake mid-gesture (~300 ms on software renderers — the
  // residual "放下卡一下"). The drag-end transition rebuilds/append-settles
  // gStatic correctly via the splitKey logic.
  const markDirtyAndRebuild = () => {
    routingDirty = true
    const d = useDragOverlayStore.getState()
    if (!d.ap && !d.sw) invalidateStatic()
    probeEvent('floor/ap/cable')
    rebuild()
  }

  const unsubFloor = useFloorStore.subscribe(markDirtyAndRebuild)
  const unsubAP = useAPStore.subscribe(markDirtyAndRebuild)
  const unsubCable = useCableStore.subscribe(markDirtyAndRebuild)
  // Viewport only rescales line widths / dash (the `s` factor) — route
  // geometry is unchanged, so DON'T mark routingDirty (reuse the routing
  // cache). But the frozen static layer holds scale-baked geometry, so force
  // it to redraw at the new scale.
  const unsubViewport = useViewportStore.subscribe(() => { invalidateStatic(); probeEvent('viewport'); rebuild() })
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
    // A drag of a single AP/SW ENDING (override → null) needs one full
    // recompute so the frozen incremental result is replaced by the canonical
    // route; mark dirty so computeRoutesForDraw doesn't serve the stale cache.
    const apEnded   = lastDragAp && !d.ap
    const swEnded   = lastDragSw && !d.sw
    const trayEnded = (lastDragTray && !d.tray) || (lastDragTrayVtx && !d.trayVertex)
    if (apEnded || swEnded || trayEnded) routingDirty = true
    lastDragAp = d.ap
    lastDragSw = d.sw
    lastDragTray = d.tray
    lastDragTrayVtx = d.trayVertex
    probeEvent('drag')
    rebuild()
  })
  // Selection only changes opacity / highlight (not route geometry) — don't
  // mark routingDirty so the cache is reused (32-E perf A).
  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  const unsubEditor = useEditorStore.subscribe(() => {
    const s = useEditorStore.getState()
    if (s.selectedId === lastSelectedId && s.selectedType === lastSelectedType) return
    lastSelectedId = s.selectedId
    lastSelectedType = s.selectedType
    probeEvent('editor/selection')
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
    clearRoutesCache()  // 32-E shared focus cache — drop on teardown
    clearBadges(badgeStatic)
    clearBadges(badgeDynamic)
    layer.removeChild(staticDim)            // wraps gStatic + badgeStatic
    staticDim.destroy({ children: true })
    layer.removeChild(gDynamic)
    gDynamic.destroy()
    layer.removeChild(badgeDynamic)
    badgeDynamic.destroy({ children: true })
  }
}

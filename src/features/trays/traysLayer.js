import { Container, Graphics } from 'pixi.js'
import { getTraySystem } from '@/store/useCableStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useViewportStore } from '@/store/useViewportStore'
import { getModeCapability } from '@/render/modeCapabilities'

// Cable tray adapter — per-tray Container with magnet halo + channel
// body + custom polyline hitArea. Visuals ported 1:1 from oldSrc
// CableTrayLayer.jsx (17-1 + 19-3 + 23-3f):
//
//   * Body: closed channel polygon with two parallel offset borders,
//     semicircle end-caps on open endpoints, miter joints at junctions
//     that share an exact endpoint xy with another tray.
//   * Border width: selected 2.2 / hover 1.4 / normal 1.1 (× inverseScale).
//   * Centreline: dashed [6, 4] × inverseScale, width 0.9 × inverseScale,
//     opacity 0.7 (0.85 on hover invert), in system color (white on invert).
//   * Body fill: system fill (low-opacity pastel). On hover invert
//     (hovered + not selected) → fill goes to system color and border
//     goes to system fill. Selected border = white.
//   * Magnet halo (capsule shape via thick line): fill + dashed stroke
//     in indigo, magnetDistance world-px radius. Visibility gated by mode
//     (always in DRAW_CABLE_TRAY / PLACE_SWITCH / PLACE_RISER; only on
//     hover or selected in SELECT mode).

const TRAY_WIDTH_SCREEN_PX = 8                       // half-width = 4 * s
const TRAY_SELECTED_BORDER = '#ffffff'
const MAGNET_FILL          = 'rgba(129, 140, 248, 0.12)'
const MAGNET_STROKE        = 'rgba(129, 140, 248, 0.45)'
const HIT_TOLERANCE_PX     = 8                       // screen-px hit tolerance
const DRAG_COMMIT_THRESHOLD_PX = 1

// Build a parallel offset polyline. Each vertex shifted perpendicular
// by `offset` (canvas px); interior vertices use miter join via angle
// bisector. extPrev / extNext supply fake neighbour points for shared
// endpoints (so first/last vertex miters cleanly into the next tray).
function offsetPolyline(points, offset, extPrev = null, extNext = null) {
  if (points.length < 2) return points.map((p) => ({ ...p }))
  const perp = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    return { x: -dy / len, y: dx / len }
  }
  const out = new Array(points.length)
  for (let i = 0; i < points.length; i++) {
    const cur = points[i]
    const prev = i > 0 ? points[i - 1] : extPrev
    const next = i < points.length - 1 ? points[i + 1] : extNext
    let nx, ny
    if (prev && next) {
      const p1 = perp(prev, cur)
      const p2 = perp(cur, next)
      const denom = Math.max(1 + p1.x * p2.x + p1.y * p2.y, 0.05)
      nx = (p1.x + p2.x) / denom
      ny = (p1.y + p2.y) / denom
    } else if (next) {
      const p = perp(cur, next); nx = p.x; ny = p.y
    } else {
      const p = perp(prev, cur); nx = p.x; ny = p.y
    }
    out[i] = { x: cur.x + nx * offset, y: cur.y + ny * offset }
  }
  return out
}

// Build a closed-polygon outline for a tray channel: top border, end
// cap (semicircle when open / miter when shared), bottom border,
// start cap. Returns a flat [x, y, x, y, ...] array for poly().
function buildChannelPolygon(points, halfW, extPrev, extNext) {
  if (points.length < 2) return []
  const up   = offsetPolyline(points,  halfW, extPrev, extNext)
  const down = offsetPolyline(points, -halfW, extPrev, extNext)

  const ARC_N = 12
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const arcBetween = (center, from, to, outward) => {
    const fromA = Math.atan2(from.y - center.y, from.x - center.x)
    const toA   = Math.atan2(to.y - center.y, to.x - center.x)
    const outA  = Math.atan2(outward.y, outward.x)
    const fromN = norm(fromA)
    let toCCW   = norm(toA);  if (toCCW <= fromN) toCCW += 2 * Math.PI
    let outCCW  = norm(outA); if (outCCW <= fromN) outCCW += 2 * Math.PI
    const ccw   = outCCW > fromN && outCCW < toCCW
    const sweep = ccw ? (toCCW - fromN) : -(2 * Math.PI - (toCCW - fromN))
    const out = []
    for (let k = 1; k < ARC_N; k++) {
      const t = k / ARC_N
      const a = fromN + sweep * t
      out.push({ x: center.x + halfW * Math.cos(a), y: center.y + halfW * Math.sin(a) })
    }
    return out
  }

  const unit = (p, q) => {
    const dx = q.x - p.x, dy = q.y - p.y
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len }
  }

  const poly = []
  for (const p of up) poly.push(p)
  if (!extNext) {
    const end = points[points.length - 1]
    const fwd = unit(points[points.length - 2], end)
    poly.push(...arcBetween(end, up[up.length - 1], down[down.length - 1], fwd))
  }
  for (let i = down.length - 1; i >= 0; i--) poly.push(down[i])
  if (!extPrev) {
    const start = points[0]
    const fwd = unit(start, points[1])
    poly.push(...arcBetween(start, down[0], up[0], { x: -fwd.x, y: -fwd.y }))
  }
  const flat = []
  for (const p of poly) flat.push(p.x, p.y)
  return flat
}

// Walk every tray to detect shared-endpoint 2-tray junctions; return a
// {startExt, endExt} pair per tray (the fake neighbour points used by
// offsetPolyline / buildChannelPolygon to miter cleanly).
function computeTrayNeighborExts(trays) {
  const junctions = new Map()
  const unitVec = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len }
  }
  trays.forEach((tray, idx) => {
    const pts = tray.points
    if (!pts || pts.length < 2) return
    const start = pts[0], end = pts[pts.length - 1]
    const sk = `${start.x}|${start.y}`
    const ek = `${end.x}|${end.y}`
    if (!junctions.has(sk)) junctions.set(sk, [])
    if (!junctions.has(ek)) junctions.set(ek, [])
    junctions.get(sk).push({ trayIdx: idx, side: 'start', inwardDir: unitVec(start, pts[1]) })
    junctions.get(ek).push({ trayIdx: idx, side: 'end',   inwardDir: unitVec(end,   pts[pts.length - 2]) })
  })
  const out = new Map()
  trays.forEach((tray, idx) => {
    const pts = tray.points
    if (!pts || pts.length < 2) { out.set(tray.id, { startExt: null, endExt: null }); return }
    const lookup = (key, vertex) => {
      const list = junctions.get(key) ?? []
      if (list.length !== 2) return null
      const other = list.find((e) => e.trayIdx !== idx)
      if (!other) return null
      return { x: vertex.x + other.inwardDir.x, y: vertex.y + other.inwardDir.y }
    }
    out.set(tray.id, {
      startExt: lookup(`${pts[0].x}|${pts[0].y}`, pts[0]),
      endExt:   lookup(`${pts[pts.length - 1].x}|${pts[pts.length - 1].y}`, pts[pts.length - 1]),
    })
  })
  return out
}

function drawPolylineStroke(g, points, opts) {
  if (!points || points.length < 2) return
  g.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
  g.stroke(opts)
}

// Dashed polyline (manual — PIXI v8 stroke() has no native dash).
function drawDashedPolyline(g, points, dashOn, dashOff, opts) {
  if (!points || points.length < 2) return
  let phaseOn = true
  let remain = dashOn
  let cx = points[0].x, cy = points[0].y
  for (let i = 1; i < points.length; i++) {
    const tx = points[i].x, ty = points[i].y
    const len = Math.hypot(tx - cx, ty - cy)
    if (len > 1e-9) {
      const ux = (tx - cx) / len
      const uy = (ty - cy) / len
      let cursor = 0
      while (cursor < len) {
        const step = Math.min(len - cursor, remain)
        const x1 = cx + ux * cursor
        const y1 = cy + uy * cursor
        const x2 = cx + ux * (cursor + step)
        const y2 = cy + uy * (cursor + step)
        if (phaseOn) g.moveTo(x1, y1).lineTo(x2, y2).stroke(opts)
        cursor += step
        remain -= step
        if (remain <= 1e-9) {
          phaseOn = !phaseOn
          remain = phaseOn ? dashOn : dashOff
        }
      }
    }
    cx = tx; cy = ty
  }
}

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-9) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const qx = ax + t * dx
  const qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

function makePolylineHitArea(points, tolerance) {
  return {
    contains(x, y) {
      if (!points || points.length < 2) return false
      for (let i = 1; i < points.length; i++) {
        const d = pointToSegmentDistance(x, y, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y)
        if (d <= tolerance) return true
      }
      return false
    },
  }
}

export function attachTraysLayer({ scene, useFloorStore, useCableStore }) {
  const layer = scene.layers.trays
  layer.eventMode = 'passive'

  const containers = new Map()
  let neighborExts = new Map()

  const ensureContainer = (tray, floorId) => {
    let entry = containers.get(tray.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'grab'
      const haloG = new Graphics()
      const bodyG = new Graphics()
      haloG.eventMode = 'none'
      bodyG.eventMode = 'none'
      c.addChild(haloG)
      c.addChild(bodyG)
      layer.addChild(c)
      entry = { container: c, haloG, bodyG, tray, floorId }
      containers.set(tray.id, entry)
      bindInteractions(entry)
    } else {
      entry.tray = tray
      entry.floorId = floorId
    }
    return entry
  }

  const removeContainer = (id) => {
    const entry = containers.get(id)
    if (!entry) return
    layer.removeChild(entry.container)
    entry.container.destroy({ children: true })
    containers.delete(id)
  }

  // If the user is mid-drag of one of this tray's vertices, substitute the
  // dragged xy into the points array — the canonical store keeps the old
  // position until dragend (handlesLayer commits there).
  const pointsWithVertexOverlay = (tray) => {
    const overlay = useDragOverlayStore.getState().trayVertex
    if (!overlay || overlay.trayId !== tray.id) return tray.points
    return tray.points.map((p, i) =>
      i === overlay.vertexIdx ? { x: overlay.x, y: overlay.y } : p,
    )
  }

  const drawTray = (entry) => {
    const { haloG, bodyG, container, tray } = entry
    const points = pointsWithVertexOverlay(tray)
    const sys = getTraySystem(tray.system)
    const magnetPx = tray.magnetDistance ?? 100
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale

    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    const isSelected = editorState.selectedId === tray.id && editorState.selectedType === 'cable_tray'
    const isHovered  = hoverState.id === tray.id && hoverState.type === 'cable_tray'
    const isInvert   = isHovered && !isSelected

    // Magnet visibility from capability matrix (oldSrc showMagnet.tray):
    //   'all'          → every tray's halo on (DRAW_CABLE_TRAY / PLACE_SWITCH)
    //   'selectedOnly' → only when this tray is selected or hovered (SELECT)
    //   'never'        → hidden (everything else, incl. PLACE_RISER which
    //                    wants riser halos only — not tray)
    const cap = getModeCapability(editorState.editorMode)
    const magnetPolicy = cap.showMagnet?.tray ?? 'never'
    const showMagnet =
      magnetPolicy === 'all' ? true :
      magnetPolicy === 'selectedOnly' ? (isSelected || isHovered) :
      false

    haloG.clear()
    bodyG.clear()

    if (showMagnet) {
      // Solid capsule fill via wide stroke + round caps.
      drawPolylineStroke(haloG, points, {
        width: magnetPx * 2,
        color: MAGNET_FILL,
        alpha: 1,
        cap: 'round',
        join: 'round',
      })
      // Dashed centreline overlay along the same path.
      drawDashedPolyline(haloG, points, 6 * s, 4 * s, {
        width: 1.2 * s,
        color: MAGNET_STROKE,
        alpha: 0.7,
      })
    }

    // Selection white halo — rendered in-layer (Bundle 7) so it sits
    // BELOW devicesSW (z 7b > trays 6). Width 9 (world-px) keeps it
    // chunky enough to register without scaling weirdly across zooms.
    if (isSelected) {
      drawPolylineStroke(haloG, points, {
        width: 9,
        color: TRAY_SELECTED_BORDER,
        alpha: 0.95,
        cap: 'round',
        join: 'round',
      })
    }

    // Channel body — closed polygon with semicircle caps + miter join.
    const halfW = (TRAY_WIDTH_SCREEN_PX * s) / 2
    const ext = neighborExts.get(tray.id) ?? { startExt: null, endExt: null }
    const polyFlat = buildChannelPolygon(points, halfW, ext.startExt, ext.endExt)
    const borderW  = (isSelected ? 2.2 : isHovered ? 1.4 : 1.1) * s

    // Hover invert (oldSrc 23-3f). Normal: body = sys.fill / border = sys.color.
    // Hover invert: body = sys.color / border = sys.fill. Selected border = white.
    const fillCol   = isInvert ? sys.color : sys.fill
    const strokeCol = isSelected ? TRAY_SELECTED_BORDER : (isInvert ? sys.fill : sys.color)
    const centerCol = isInvert ? '#ffffff' : sys.color

    if (polyFlat.length >= 6) {
      bodyG.poly(polyFlat)
        .fill({ color: fillCol, alpha: 1 })
        .stroke({ width: borderW, color: strokeCol, alpha: 1, join: 'miter', miterLimit: 10 })
    }

    // Dashed centreline (separate so dash phase stays straight).
    drawDashedPolyline(bodyG, points, 6 * s, 4 * s, {
      width: 0.9 * s,
      color: centerCol,
      alpha: isInvert ? 0.85 : 0.7,
      cap: 'round',
    })

    container.hitArea = makePolylineHitArea(points, HIT_TOLERANCE_PX / vpScale)
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (typeof window !== 'undefined' && window.__debugRMB === true) {
        console.log('[RMB tray] pointerdown id=', entry.tray.id, 'btn=', e.button)
      }
      if (e.button === 2) {
        e.stopPropagation()
        const { hitContext, mergeCandidate } = computeTrayRmbContext(entry, e)
        useEditorStore.getState().openContextMenu({
          targetType: 'cable_tray',
          targetId: entry.tray.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
          hitContext,
          mergeCandidate,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      const cap = getModeCapability(useEditorStore.getState().editorMode)
      if (!cap.allowSelectClick.cable) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.tray.id, 'cable_tray')
      beginDrag(entry, e)
    })
    container.on('pointerover', () => {
      const cap = getModeCapability(useEditorStore.getState().editorMode)
      if (!cap.allowSelectHover.cable && !cap.allowCommandHover.cable) return
      useHoverStore.getState().setHover(entry.tray.id, 'cable_tray')
    })
    container.on('pointerout', () => useHoverStore.getState().clearHoverIf(entry.tray.id))
  }

  // Ports oldSrc Editor2D.jsx `handleTrayContextMenu` (lines 1380-1443):
  // identify whether the cursor is on a tray segment or near an endpoint,
  // and for endpoint clicks look up a single 2-tray merge candidate
  // (another tray whose endpoint xy exactly matches — graph builder
  // coincidence-merge rule, cable-spec §10 / 12-2d).
  const computeTrayRmbContext = (entry, e) => {
    const vpScale = useViewportStore.getState().scale || 1
    const threshSegPx = 14 / vpScale
    const threshEndpointPx = 18 / vpScale
    const world = scene.world.toLocal(e.global)
    const pts = entry.tray.points
    // Best segment foot.
    let bestSegIdx = -1, bestFoot = null, bestDist = threshSegPx
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const dx = b.x - a.x, dy = b.y - a.y
      const lenSq = dx * dx + dy * dy
      if (lenSq < 1e-6) continue
      const tt = Math.max(0, Math.min(1, ((world.x - a.x) * dx + (world.y - a.y) * dy) / lenSq))
      const fx = a.x + tt * dx, fy = a.y + tt * dy
      const d = Math.hypot(world.x - fx, world.y - fy)
      if (d < bestDist) { bestDist = d; bestSegIdx = i; bestFoot = { x: fx, y: fy } }
    }
    // Endpoint test against this tray only.
    const distStart = Math.hypot(world.x - pts[0].x, world.y - pts[0].y)
    const distEnd   = Math.hypot(world.x - pts[pts.length - 1].x, world.y - pts[pts.length - 1].y)
    const endpointIdx = distStart <= distEnd ? 0 : pts.length - 1
    const endpointDist = Math.min(distStart, distEnd)
    let hitContext
    if (endpointDist <= threshEndpointPx) {
      hitContext = { kind: 'endpoint', endpointIdx }
    } else if (bestSegIdx >= 0) {
      hitContext = { kind: 'segment', segIdx: bestSegIdx, foot: bestFoot }
    } else {
      hitContext = { kind: 'body' }
    }
    // Merge candidate (endpoint hit only). Exact xy match (no epsilon)
    // — matches the graph builder. Ambiguous > 1 → null.
    let mergeCandidate = null
    if (hitContext.kind === 'endpoint') {
      const ep = pts[endpointIdx]
      const allTrays = useCableStore.getState().traysByFloor[entry.floorId] ?? []
      const matches = []
      for (const t of allTrays) {
        if (t.id === entry.tray.id) continue
        const sp = t.points[0]
        const epp = t.points[t.points.length - 1]
        if (sp.x === ep.x && sp.y === ep.y) matches.push({ trayId: t.id, side: 'start' })
        else if (epp.x === ep.x && epp.y === ep.y) matches.push({ trayId: t.id, side: 'end' })
      }
      if (matches.length === 1) mergeCandidate = matches[0]
    }
    return { hitContext, mergeCandidate }
  }

  const beginDrag = (entry, downEvent) => {
    const startWorld = scene.world.toLocal(downEvent.global)
    const stage = scene.app.stage

    const onMove = (e) => {
      const wp = scene.world.toLocal(e.global)
      const dx = wp.x - startWorld.x
      const dy = wp.y - startWorld.y
      useDragOverlayStore.getState().setTray({ id: entry.tray.id, dx, dy })
    }
    const onUp = () => {
      const overlay = useDragOverlayStore.getState().tray
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
      if (overlay && overlay.id === entry.tray.id) {
        const moved = Math.hypot(overlay.dx, overlay.dy)
        if (moved > DRAG_COMMIT_THRESHOLD_PX) {
          const nextPoints = entry.tray.points.map((p) => ({
            x: p.x + overlay.dx,
            y: p.y + overlay.dy,
          }))
          useCableStore.getState().updateTray(entry.floorId, entry.tray.id, {
            points: nextPoints,
          })
        }
      }
      useDragOverlayStore.getState().setTray(null)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  let lastFloorId = undefined
  let lastTrays = undefined

  const recomputeExts = (trays) => {
    neighborExts = computeTrayNeighborExts(trays)
  }

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const trays = useCableStore.getState().traysByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && trays === lastTrays) {
      applyDragOverlay()
      return
    }
    lastFloorId = activeFloorId
    lastTrays = trays
    recomputeExts(trays)
    const next = new Set(trays.map((t) => t.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    for (const tray of trays) {
      const entry = ensureContainer(tray, activeFloorId)
      drawTray(entry)
    }
    applyDragOverlay()
  }

  let lastDragId = null
  let lastVertexDragId = null
  const applyDragOverlay = () => {
    const drag = useDragOverlayStore.getState().tray
    if (lastDragId && (!drag || drag.id !== lastDragId)) {
      const prev = containers.get(lastDragId)
      if (prev) prev.container.position.set(0, 0)
    }
    lastDragId = drag?.id ?? null
    if (drag) {
      const entry = containers.get(drag.id)
      if (entry) entry.container.position.set(drag.dx, drag.dy)
    }

    // Tray vertex drag — redraw the affected tray with the substituted
    // vertex xy taken from the overlay. drawTray reads the overlay inline
    // via pointsWithVertexOverlay so we just need to retrigger it.
    const vDrag = useDragOverlayStore.getState().trayVertex
    const vertexDragId = vDrag?.trayId ?? null
    if (lastVertexDragId && (!vDrag || vDrag.trayId !== lastVertexDragId)) {
      const prev = containers.get(lastVertexDragId)
      if (prev) drawTray(prev)  // overlay just cleared → repaint w/ canonical pts
    }
    lastVertexDragId = vertexDragId
    if (vDrag) {
      const entry = containers.get(vDrag.trayId)
      if (entry) drawTray(entry)
    }
  }

  let lastHoverId = useHoverStore.getState().id
  const onHoverChange = () => {
    const s = useHoverStore.getState()
    if (s.id === lastHoverId) return
    const prevId = lastHoverId
    lastHoverId = s.id
    const prev = prevId ? containers.get(prevId) : null
    const next = s.id ? containers.get(s.id) : null
    if (prev) drawTray(prev)
    if (next && next !== prev) drawTray(next)
  }

  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  let lastEditorMode = useEditorStore.getState().editorMode
  const onEditorChange = () => {
    const s = useEditorStore.getState()
    const modeChanged = s.editorMode !== lastEditorMode
    const selectionChanged = s.selectedId !== lastSelectedId || s.selectedType !== lastSelectedType
    if (!modeChanged && !selectionChanged) return
    const prevId = lastSelectedId
    const prevType = lastSelectedType
    lastSelectedId = s.selectedId
    lastSelectedType = s.selectedType
    lastEditorMode = s.editorMode
    if (modeChanged) {
      for (const entry of containers.values()) drawTray(entry)
      return
    }
    if (prevType === 'cable_tray' && prevId) {
      const e = containers.get(prevId)
      if (e) drawTray(e)
    }
    if (s.selectedType === 'cable_tray' && s.selectedId) {
      const e = containers.get(s.selectedId)
      if (e) drawTray(e)
    }
  }

  // Viewport scale change → redraw every tray so widths / dash sizes
  // / hitArea tolerance follow.
  let lastScale = useViewportStore.getState().scale
  const onViewportChange = () => {
    const s = useViewportStore.getState().scale
    if (s === lastScale) return
    lastScale = s
    for (const entry of containers.values()) drawTray(entry)
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubCable = useCableStore.subscribe(reconcile)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  const unsubViewport = useViewportStore.subscribe(onViewportChange)
  reconcile()

  return () => {
    unsubFloor()
    unsubCable()
    unsubDrag()
    unsubHover()
    unsubEditor()
    unsubViewport()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

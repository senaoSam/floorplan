import { Graphics } from 'pixi.js'
import { EDITOR_MODE } from '@/store/useEditorStore'
import { useViewportStore } from '@/store/useViewportStore'
import { getTraySystem, DEFAULT_TRAY } from '@/store/useCableStore'

// Draws the in-progress draft for DRAW_WALL / DRAW_SCOPE / DRAW_FLOOR_HOLE
// / DRAW_CABLE_TRAY / DRAW_SCALE on scene.layers.overlays. Per-mode visuals
// ported 1:1 from oldSrc:
//
//   DRAW_WALL        → cyan  #00e5ff stroked line + dashed ghost + black
//                      halo + cyan endpoint markers (oldSrc WallLayer
//                      drawStart / snapEndpoint blocks)
//   DRAW_SCOPE       → green #2ed573 (oldSrc ScopeLayer DrawingPreview)
//   DRAW_FLOOR_HOLE  → purple #a855f7 (oldSrc FloorHoleLayer DrawingPreview)
//   DRAW_CABLE_TRAY  → tray system colour + magnet halo + vertex-snap halo
//                      (oldSrc DraftTray + snapHit)
//   DRAW_SCALE       → yellow #f1c40f
//
// Every stroke has a black halo underneath so the draft stays readable
// on both light floor plans and dark backgrounds.

const COLOR_BY_MODE = {
  [EDITOR_MODE.DRAW_WALL]:        '#00e5ff',
  [EDITOR_MODE.DRAW_SCOPE]:       '#2ed573',
  [EDITOR_MODE.DRAW_FLOOR_HOLE]:  '#a855f7',
  [EDITOR_MODE.DRAW_CABLE_TRAY]:  '#818cf8',  // overridden per system below
  [EDITOR_MODE.DRAW_SCALE]:       '#f1c40f',
}
const DEFAULT_COLOR = '#fbbf24'
const HALO_COLOR    = '#000000'
const HALO_ALPHA    = 0.5

const MAGNET_FILL   = 'rgba(129, 140, 248, 0.12)'
const SNAP_GREEN    = '#22c55e'

function drawSegment(g, ax, ay, bx, by, color, width, alpha = 1) {
  g.moveTo(ax, ay).lineTo(bx, by)
    .stroke({ width: width + 2, color: HALO_COLOR, alpha: HALO_ALPHA * alpha })
  g.moveTo(ax, ay).lineTo(bx, by)
    .stroke({ width, color, alpha })
}

function drawDashedSegment(g, ax, ay, bx, by, color, width, dashOn, dashOff, alpha = 1) {
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
        .stroke({ width: width + 1.5, color: HALO_COLOR, alpha: HALO_ALPHA * alpha })
      g.moveTo(x1, y1).lineTo(x2, y2)
        .stroke({ width, color, alpha })
    }
    cursor += step
    remain -= step
    if (remain <= 1e-9) {
      phaseOn = !phaseOn
      remain = phaseOn ? dashOn : dashOff
    }
  }
}

export function attachDraftOverlay({ scene, useDraftStore, useCableStore, useFloorStore }) {
  const layer = scene.layers.overlays
  const g = new Graphics()
  g.eventMode = 'none'
  layer.addChild(g)

  // Find an existing tray vertex (across the active floor) that matches
  // the cursor xy exactly — drives the green snap halo while drawing.
  const findVertexAt = (xy) => {
    if (!useCableStore || !useFloorStore) return null
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return null
    const trays = useCableStore.getState().traysByFloor?.[fid] ?? []
    for (const t of trays) {
      for (const v of (t.points ?? [])) {
        if (v.x === xy.x && v.y === xy.y) return v
      }
    }
    return null
  }

  const redraw = () => {
    g.clear()
    const { mode, points, cursor } = useDraftStore.getState()
    if (!mode || points.length === 0) return

    if (mode === EDITOR_MODE.DRAW_CABLE_TRAY) {
      drawTrayDraft(g, points, cursor, findVertexAt)
      return
    }
    if (mode === EDITOR_MODE.DRAW_WALL) {
      drawWallDraft(g, points, cursor)
      return
    }
    drawPolyDraft(g, mode, points, cursor)
  }

  // Wall: dashed cyan ghost + cyan endpoint marker at the draft start
  // (oldSrc WallLayer.jsx 250-285).
  function drawWallDraft(g, points, cursor) {
    const color = COLOR_BY_MODE[EDITOR_MODE.DRAW_WALL]
    // Start dot.
    const start = points[0]
    g.circle(start.x, start.y, 9).fill({ color: HALO_COLOR, alpha: HALO_ALPHA })
    g.circle(start.x, start.y, 6).fill({ color, alpha: 1 })
    if (cursor) {
      // Dashed ghost line: width 3 cyan + width 6 black halo dash.
      drawDashedSegment(g, start.x, start.y, cursor.x, cursor.y, color, 3, 8, 5, 1)
    }
  }

  // Polygon / polyline draft (scope / floor hole / scale).
  function drawPolyDraft(g, mode, points, cursor) {
    const color = COLOR_BY_MODE[mode] ?? DEFAULT_COLOR
    const isPolygon = mode === EDITOR_MODE.DRAW_SCOPE || mode === EDITOR_MODE.DRAW_FLOOR_HOLE
    // Committed segments — dashed for scope / hole (oldSrc), solid for scale.
    const dashed = isPolygon
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      if (dashed) drawDashedSegment(g, a.x, a.y, b.x, b.y, color, 3, 6, 4, 1)
      else drawSegment(g, a.x, a.y, b.x, b.y, color, 3)
    }
    if (cursor && points.length > 0) {
      const last = points[points.length - 1]
      if (dashed) drawDashedSegment(g, last.x, last.y, cursor.x, cursor.y, color, 3, 6, 4, 0.7)
      else drawSegment(g, last.x, last.y, cursor.x, cursor.y, color, 3, 0.7)
      if (isPolygon && points.length >= 2) {
        drawDashedSegment(g, cursor.x, cursor.y, points[0].x, points[0].y, color, 2, 6, 4, 0.4)
      }
    }
    for (const p of points) {
      g.circle(p.x, p.y, 7).fill({ color: HALO_COLOR, alpha: HALO_ALPHA })
      g.circle(p.x, p.y, 5).fill({ color, alpha: 1 })
    }
    if (isPolygon && points.length >= 3) {
      g.circle(points[0].x, points[0].y, 9)
        .stroke({ width: 2, color, alpha: 1 })
    }
  }

  // Cable tray draft (oldSrc DraftTray).
  function drawTrayDraft(g, points, cursor, findVertexAt) {
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale
    const sys = getTraySystem(DEFAULT_TRAY.system)
    const draftStroke = sys.color
    const magnetPx = DEFAULT_TRAY.magnetDistance ?? 100
    // Magnet halo along committed segments.
    if (points.length >= 2) {
      g.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
      g.stroke({
        width: magnetPx * 2, color: MAGNET_FILL, alpha: 1,
        cap: 'round', join: 'round',
      })
    }
    // Magnet halo along ghost segment.
    if (cursor && points.length >= 1) {
      const last = points[points.length - 1]
      g.moveTo(last.x, last.y).lineTo(cursor.x, cursor.y)
        .stroke({ width: magnetPx * 2, color: MAGNET_FILL, alpha: 0.5, cap: 'round' })
    }
    // Committed segments — solid.
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      g.moveTo(a.x, a.y).lineTo(b.x, b.y)
        .stroke({ width: 2.4 * s, color: draftStroke, alpha: 1, cap: 'round', join: 'round' })
    }
    // Ghost segment — dashed.
    if (cursor && points.length >= 1) {
      const last = points[points.length - 1]
      drawDashedSegment(g, last.x, last.y, cursor.x, cursor.y, draftStroke, 2 * s, 10 * s, 6 * s, 0.65)
    }
    // Vertex dots — white fill + colored stroke (matches oldSrc DraftTray).
    for (const p of points) {
      g.circle(p.x, p.y, 4 * s)
        .fill({ color: '#ffffff', alpha: 1 })
        .stroke({ width: 1.5 * s, color: draftStroke, alpha: 1 })
    }
    // Vertex snap halo — green ring + dot when cursor sits on an existing
    // tray vertex.
    if (cursor) {
      const target = findVertexAt(cursor)
      if (target) {
        g.circle(target.x, target.y, 10 * s)
          .stroke({ width: 2 * s, color: SNAP_GREEN, alpha: 1 })
        g.circle(target.x, target.y, 4 * s)
          .fill({ color: SNAP_GREEN, alpha: 1 })
      }
    }
  }

  const unsubscribe = useDraftStore.subscribe(redraw)
  const unsubViewport = useViewportStore.subscribe(redraw)
  redraw()

  return () => {
    unsubscribe()
    unsubViewport()
    layer.removeChild(g)
    g.destroy()
  }
}

import { Graphics } from 'pixi.js'
import { EDITOR_MODE } from '@/store/useEditorStore'

// Draws the in-progress draft for DRAW_WALL / DRAW_SCOPE / DRAW_FLOOR_HOLE
// / DRAW_CABLE_TRAY / DRAW_SCALE on scene.layers.overlays. Per-mode colour
// follows oldSrc convention so a half-drawn shape is unmistakable:
//
//   DRAW_WALL        → cyan  `#00e5ff`
//   DRAW_SCOPE       → green `#2ed573`
//   DRAW_FLOOR_HOLE  → purple `#a855f7`
//   DRAW_CABLE_TRAY  → cyan  `#22d3ee` (tray system colour proxy)
//   DRAW_SCALE       → yellow `#f1c40f`
//
// Every stroke has a black halo drawn underneath so the draft stays
// readable on both light floor plans and dark backgrounds.

const COLOR_BY_MODE = {
  [EDITOR_MODE.DRAW_WALL]:        '#00e5ff',
  [EDITOR_MODE.DRAW_SCOPE]:       '#2ed573',
  [EDITOR_MODE.DRAW_FLOOR_HOLE]:  '#a855f7',
  [EDITOR_MODE.DRAW_CABLE_TRAY]:  '#22d3ee',
  [EDITOR_MODE.DRAW_SCALE]:       '#f1c40f',
}
const DEFAULT_COLOR = '#fbbf24'
const HALO_COLOR    = '#000000'
const HALO_ALPHA    = 0.5
const VERTEX_RADIUS = 5
const VERTEX_HALO_RADIUS = 7

function drawSegment(g, ax, ay, bx, by, color, width, alpha = 1) {
  g.moveTo(ax, ay).lineTo(bx, by)
    .stroke({ width: width + 2, color: HALO_COLOR, alpha: HALO_ALPHA * alpha })
  g.moveTo(ax, ay).lineTo(bx, by)
    .stroke({ width, color, alpha })
}

export function attachDraftOverlay({ scene, useDraftStore }) {
  const layer = scene.layers.overlays
  const g = new Graphics()
  layer.addChild(g)

  const redraw = () => {
    g.clear()
    const { mode, points, cursor } = useDraftStore.getState()
    if (!mode || points.length === 0) return

    const color = COLOR_BY_MODE[mode] ?? DEFAULT_COLOR
    const isPolygon = mode === EDITOR_MODE.DRAW_SCOPE || mode === EDITOR_MODE.DRAW_FLOOR_HOLE

    // Committed-so-far segments.
    for (let i = 1; i < points.length; i++) {
      drawSegment(g, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, color, 3)
    }

    // Ghost segment from last committed point to cursor.
    if (cursor && points.length > 0) {
      const last = points[points.length - 1]
      drawSegment(g, last.x, last.y, cursor.x, cursor.y, color, 3, 0.7)
      // Closing edge for polygons.
      if (isPolygon && points.length >= 2) {
        drawSegment(g, cursor.x, cursor.y, points[0].x, points[0].y, color, 2, 0.4)
      }
    }

    for (const p of points) {
      g.circle(p.x, p.y, VERTEX_HALO_RADIUS).fill({ color: HALO_COLOR, alpha: HALO_ALPHA })
      g.circle(p.x, p.y, VERTEX_RADIUS).fill({ color, alpha: 1 })
    }
    // First-vertex highlight ring for polygons so the user can see where to
    // close the shape.
    if (isPolygon && points.length >= 3) {
      g.circle(points[0].x, points[0].y, VERTEX_RADIUS + 4)
        .stroke({ width: 2, color, alpha: 1 })
    }
  }

  const unsubscribe = useDraftStore.subscribe(redraw)
  redraw()

  return () => {
    unsubscribe()
    layer.removeChild(g)
    g.destroy()
  }
}

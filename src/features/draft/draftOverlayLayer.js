import { Graphics } from 'pixi.js'
import { EDITOR_MODE } from '@/store/useEditorStore'

// Draws the in-progress draft for DRAW_WALL / DRAW_SCOPE / DRAW_FLOOR_HOLE
// / DRAW_CABLE_TRAY / DRAW_SCALE on scene.layers.overlays. Mode-specific
// styling (open polyline vs closing polygon, dash patterns) so the user
// can tell what they're committing.

const DRAFT_COLOR = '#fbbf24'
const DRAFT_GHOST_ALPHA = 0.6
const VERTEX_RADIUS = 3

export function attachDraftOverlay({ scene, useDraftStore }) {
  const layer = scene.layers.overlays
  const g = new Graphics()
  layer.addChild(g)

  const redraw = () => {
    g.clear()
    const { mode, points, cursor } = useDraftStore.getState()
    if (!mode || points.length === 0) return

    const isPolygon = mode === EDITOR_MODE.DRAW_SCOPE || mode === EDITOR_MODE.DRAW_FLOOR_HOLE
    const isLineMode = mode === EDITOR_MODE.DRAW_WALL || mode === EDITOR_MODE.DRAW_SCALE

    // Committed-so-far segments
    if (points.length >= 2) {
      g.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
      g.stroke({ width: 1.6, color: DRAFT_COLOR, alpha: 1 })
    }

    // Ghost segment from last committed point to cursor.
    if (cursor && points.length > 0) {
      const last = points[points.length - 1]
      g.moveTo(last.x, last.y).lineTo(cursor.x, cursor.y)
      g.stroke({ width: 1.4, color: DRAFT_COLOR, alpha: DRAFT_GHOST_ALPHA })
      // Closing edge for polygons.
      if (isPolygon && points.length >= 2) {
        g.moveTo(cursor.x, cursor.y).lineTo(points[0].x, points[0].y)
        g.stroke({ width: 1, color: DRAFT_COLOR, alpha: DRAFT_GHOST_ALPHA * 0.5 })
      }
    }

    for (const p of points) {
      g.circle(p.x, p.y, VERTEX_RADIUS).fill({ color: DRAFT_COLOR, alpha: 1 })
    }
    // First-vertex highlight for polygons so the user can tell where to
    // close.
    if (isPolygon && points.length >= 3) {
      g.circle(points[0].x, points[0].y, VERTEX_RADIUS + 3)
        .stroke({ width: 1.5, color: DRAFT_COLOR, alpha: 1 })
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

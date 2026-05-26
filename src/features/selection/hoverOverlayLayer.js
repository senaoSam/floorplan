import { Graphics } from 'pixi.js'

// Hover visual — light ring / outline that follows the currently hovered
// object. Only covers the cases where the underlying layer does NOT do
// its own hover invert:
//
//   * AP   → faint white ring around the marker
//   * Wall → thicker white outline along the segment
//
// Switch, tray and scope handle hover IN-LAYER (chassis invert / body
// invert / white shadow stroke) — matching oldSrc's per-layer hover
// concept rather than a centralised hover overlay.

const AP_RING_RADIUS = 14
const WALL_HIGHLIGHT_WIDTH = 7
const HOVER_COLOR = '#ffffff'

export function attachHoverOverlay({
  scene,
  useFloorStore,
  useAPStore,
  useWallStore,
  useEditorStore,
  useHoverStore,
}) {
  const layer = scene.layers.overlays
  const g = new Graphics()
  g.eventMode = 'none' // pure visual — never intercept clicks
  layer.addChild(g)

  const redraw = () => {
    g.clear()
    const { id, type } = useHoverStore.getState()
    if (!id || !type) return
    const { selectedId } = useEditorStore.getState()
    if (id === selectedId) return
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return

    if (type === 'ap') {
      const ap = (useAPStore.getState().apsByFloor[fid] ?? []).find((a) => a.id === id)
      if (!ap) return
      g.circle(ap.x, ap.y, AP_RING_RADIUS)
        .stroke({ width: 2, color: HOVER_COLOR, alpha: 0.55 })
      return
    }
    if (type === 'wall') {
      const wall = (useWallStore.getState().wallsByFloor[fid] ?? []).find((w) => w.id === id)
      if (!wall) return
      g.moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
      g.stroke({
        width: WALL_HIGHLIGHT_WIDTH,
        color: HOVER_COLOR,
        alpha: 0.45,
        cap: 'round',
      })
      return
    }
    // type === 'switch' / 'cable_tray' / 'scope' handled in-layer.
  }

  const unsubHover = useHoverStore.subscribe(redraw)
  const unsubEditor = useEditorStore.subscribe(redraw)
  const unsubFloor = useFloorStore.subscribe(redraw)
  const unsubAP = useAPStore.subscribe(redraw)
  const unsubWall = useWallStore.subscribe(redraw)
  redraw()

  return () => {
    unsubHover()
    unsubEditor()
    unsubFloor()
    unsubAP()
    unsubWall()
    layer.removeChild(g)
    g.destroy()
  }
}

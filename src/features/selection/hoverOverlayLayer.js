import { Graphics } from 'pixi.js'

// Hover visual — faint ring / outline that follows the currently hovered
// object. Skips when the hover target equals the selected target (the
// brighter selection ring already covers that case).

const AP_RING_RADIUS = 14
const SWITCH_CHASSIS_HEIGHT = 14
const SWITCH_CHASSIS_WIDTH_BY_KIND = {
  switch: 26,
  idf:    32,
  mdf:    44,
  router: 30,
}
const TRAY_HIGHLIGHT_WIDTH = 9
const WALL_HIGHLIGHT_WIDTH = 7

const HOVER_COLOR = '#ffffff'
const HOVER_ALPHA = 0.45

export function attachHoverOverlay({
  scene,
  useFloorStore,
  useAPStore,
  useWallStore,
  useCableStore,
  useEditorStore,
  useHoverStore,
}) {
  const layer = scene.layers.overlays
  const g = new Graphics()
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
        .stroke({ width: 2, color: HOVER_COLOR, alpha: HOVER_ALPHA })
      return
    }
    if (type === 'switch') {
      const sw = (useCableStore.getState().switchesByFloor[fid] ?? []).find((s) => s.id === id)
      if (!sw) return
      const kind = sw.kind ?? 'switch'
      const w = SWITCH_CHASSIS_WIDTH_BY_KIND[kind] ?? SWITCH_CHASSIS_WIDTH_BY_KIND.switch
      const h = SWITCH_CHASSIS_HEIGHT
      g.rect(sw.x - w / 2 - 3, sw.y - h / 2 - 3, w + 6, h + 6)
        .stroke({ width: 2, color: HOVER_COLOR, alpha: HOVER_ALPHA })
      return
    }
    if (type === 'cable_tray') {
      const tray = (useCableStore.getState().traysByFloor[fid] ?? []).find((t) => t.id === id)
      if (!tray || !tray.points || tray.points.length < 2) return
      g.moveTo(tray.points[0].x, tray.points[0].y)
      for (let i = 1; i < tray.points.length; i++) {
        g.lineTo(tray.points[i].x, tray.points[i].y)
      }
      g.stroke({
        width: TRAY_HIGHLIGHT_WIDTH,
        color: HOVER_COLOR,
        alpha: HOVER_ALPHA * 0.6,
        cap: 'round',
        join: 'round',
      })
      return
    }
    if (type === 'wall') {
      const wall = (useWallStore.getState().wallsByFloor[fid] ?? []).find((w) => w.id === id)
      if (!wall) return
      g.moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
      g.stroke({
        width: WALL_HIGHLIGHT_WIDTH,
        color: HOVER_COLOR,
        alpha: HOVER_ALPHA * 0.6,
        cap: 'round',
      })
      return
    }
  }

  const unsubHover = useHoverStore.subscribe(redraw)
  const unsubEditor = useEditorStore.subscribe(redraw)
  const unsubFloor = useFloorStore.subscribe(redraw)
  const unsubAP = useAPStore.subscribe(redraw)
  const unsubWall = useWallStore.subscribe(redraw)
  const unsubCable = useCableStore.subscribe(redraw)
  redraw()

  return () => {
    unsubHover()
    unsubEditor()
    unsubFloor()
    unsubAP()
    unsubWall()
    unsubCable()
    layer.removeChild(g)
    g.destroy()
  }
}

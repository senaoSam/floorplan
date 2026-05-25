import { Graphics } from 'pixi.js'

// Selection visual — subscribes to editor selection + all four object
// stores + drag overlay and draws a highlight at the selected object's
// current (possibly drag-override) position. Lives on scene.layers.overlays.

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

const RING_COLOR_INNER = '#fbbf24'
const RING_COLOR_OUTER = '#000000'

export function attachSelectionOverlay({
  scene,
  useFloorStore,
  useAPStore,
  useWallStore,
  useCableStore,
  useEditorStore,
  useDragOverlayStore,
}) {
  const layer = scene.layers.overlays
  const g = new Graphics()
  layer.addChild(g)

  const redraw = () => {
    g.clear()
    const { selectedId, selectedType } = useEditorStore.getState()
    if (!selectedId || !selectedType) return
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return
    const drag = useDragOverlayStore.getState()

    if (selectedType === 'ap') {
      const ap = (useAPStore.getState().apsByFloor[fid] ?? []).find((a) => a.id === selectedId)
      if (!ap) return
      const dx = drag.ap && drag.ap.id === selectedId ? drag.ap.x : ap.x
      const dy = drag.ap && drag.ap.id === selectedId ? drag.ap.y : ap.y
      g.circle(dx, dy, AP_RING_RADIUS + 1).stroke({ width: 4, color: RING_COLOR_OUTER, alpha: 0.55 })
      g.circle(dx, dy, AP_RING_RADIUS).stroke({ width: 2, color: RING_COLOR_INNER, alpha: 1 })
      return
    }

    if (selectedType === 'switch') {
      const sw = (useCableStore.getState().switchesByFloor[fid] ?? []).find((s) => s.id === selectedId)
      if (!sw) return
      const x = drag.sw && drag.sw.id === selectedId ? drag.sw.x : sw.x
      const y = drag.sw && drag.sw.id === selectedId ? drag.sw.y : sw.y
      const kind = sw.kind ?? 'switch'
      const w = SWITCH_CHASSIS_WIDTH_BY_KIND[kind] ?? SWITCH_CHASSIS_WIDTH_BY_KIND.switch
      const h = SWITCH_CHASSIS_HEIGHT
      g.rect(x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8)
        .stroke({ width: 4, color: RING_COLOR_OUTER, alpha: 0.55 })
      g.rect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6)
        .stroke({ width: 2, color: RING_COLOR_INNER, alpha: 1 })
      return
    }

    if (selectedType === 'cable_tray') {
      const tray = (useCableStore.getState().traysByFloor[fid] ?? []).find((t) => t.id === selectedId)
      if (!tray || !tray.points || tray.points.length < 2) return
      const dx = drag.tray && drag.tray.id === selectedId ? drag.tray.dx : 0
      const dy = drag.tray && drag.tray.id === selectedId ? drag.tray.dy : 0
      g.moveTo(tray.points[0].x + dx, tray.points[0].y + dy)
      for (let i = 1; i < tray.points.length; i++) {
        g.lineTo(tray.points[i].x + dx, tray.points[i].y + dy)
      }
      g.stroke({
        width: TRAY_HIGHLIGHT_WIDTH + 4,
        color: RING_COLOR_OUTER,
        alpha: 0.55,
        cap: 'round',
        join: 'round',
      })
      g.moveTo(tray.points[0].x + dx, tray.points[0].y + dy)
      for (let i = 1; i < tray.points.length; i++) {
        g.lineTo(tray.points[i].x + dx, tray.points[i].y + dy)
      }
      g.stroke({
        width: TRAY_HIGHLIGHT_WIDTH,
        color: RING_COLOR_INNER,
        alpha: 0.7,
        cap: 'round',
        join: 'round',
      })
      return
    }

    if (selectedType === 'wall') {
      const wall = (useWallStore.getState().wallsByFloor[fid] ?? []).find((w) => w.id === selectedId)
      if (!wall) return
      g.moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
      g.stroke({
        width: WALL_HIGHLIGHT_WIDTH + 4,
        color: RING_COLOR_OUTER,
        alpha: 0.55,
        cap: 'round',
      })
      g.moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
      g.stroke({
        width: WALL_HIGHLIGHT_WIDTH,
        color: RING_COLOR_INNER,
        alpha: 0.7,
        cap: 'round',
      })
      return
    }
  }

  const unsubEditor = useEditorStore.subscribe(redraw)
  const unsubFloor = useFloorStore.subscribe(redraw)
  const unsubAP = useAPStore.subscribe(redraw)
  const unsubWall = useWallStore.subscribe(redraw)
  const unsubCable = useCableStore.subscribe(redraw)
  const unsubDrag = useDragOverlayStore.subscribe(redraw)
  redraw()

  return () => {
    unsubEditor()
    unsubFloor()
    unsubAP()
    unsubWall()
    unsubCable()
    unsubDrag()
    layer.removeChild(g)
    g.destroy()
  }
}

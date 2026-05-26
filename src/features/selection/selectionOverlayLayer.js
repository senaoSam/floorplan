import { Graphics } from 'pixi.js'

// Selection visual — subscribes to editor selection + all four object
// stores + drag overlay and draws a highlight at the selected object's
// current (possibly drag-override) position. Lives on scene.layers.overlays.
//
// Colours match oldSrc unified convention:
//   AP / Switch / Wall / Scope / Hole  → red `#e74c3c`
//   Tray (border-style)                → white `#ffffff`

const AP_RING_RADIUS = 14
const TRAY_HIGHLIGHT_WIDTH = 9
const WALL_HIGHLIGHT_WIDTH = 7

const SELECT_RED = '#e74c3c'
const TRAY_SELECTED_BORDER = '#ffffff'

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
      g.circle(dx, dy, AP_RING_RADIUS).stroke({ width: 2.5, color: SELECT_RED, alpha: 1 })
      return
    }

    if (selectedType === 'switch') {
      // Switch selection ring is drawn by the chassis itself (red stroke
      // via switchesLayer) — no additional overlay needed.
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
        width: TRAY_HIGHLIGHT_WIDTH,
        color: TRAY_SELECTED_BORDER,
        alpha: 0.95,
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
        width: WALL_HIGHLIGHT_WIDTH,
        color: SELECT_RED,
        alpha: 0.85,
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

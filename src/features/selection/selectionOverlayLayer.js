import { Graphics } from 'pixi.js'

// Selection visual — subscribes to editor selection + AP store + drag
// overlay and draws a ring at the active selected object's current
// (possibly drag-override) position. Lives on scene.layers.overlays.
//
// MVP: only AP selection. Wall / Switch / Tray selection rings land
// when those layers get their own hit-test.

const RING_RADIUS = 14
const RING_COLOR_INNER = '#fbbf24'
const RING_COLOR_OUTER = '#000000'
const RING_WIDTH = 2

export function attachSelectionOverlay({
  scene,
  useFloorStore,
  useAPStore,
  useEditorStore,
  useDragOverlayStore,
}) {
  const layer = scene.layers.overlays
  const g = new Graphics()
  layer.addChild(g)

  const redraw = () => {
    g.clear()
    const { selectedId, selectedType } = useEditorStore.getState()
    if (!selectedId || selectedType !== 'ap') return
    const fid = useFloorStore.getState().activeFloorId
    const ap = (useAPStore.getState().apsByFloor[fid] ?? []).find((a) => a.id === selectedId)
    if (!ap) return
    const drag = useDragOverlayStore.getState().ap
    const x = drag && drag.id === selectedId ? drag.x : ap.x
    const y = drag && drag.id === selectedId ? drag.y : ap.y
    // Outer dark halo for contrast across bright heatmap zones, then the
    // bright inner ring on top.
    g.circle(x, y, RING_RADIUS + 1)
      .stroke({ width: RING_WIDTH + 2, color: RING_COLOR_OUTER, alpha: 0.55 })
    g.circle(x, y, RING_RADIUS)
      .stroke({ width: RING_WIDTH, color: RING_COLOR_INNER, alpha: 1 })
  }

  const unsubEditor = useEditorStore.subscribe(redraw)
  const unsubFloor = useFloorStore.subscribe(redraw)
  const unsubAP = useAPStore.subscribe(redraw)
  const unsubDrag = useDragOverlayStore.subscribe(redraw)
  redraw()

  return () => {
    unsubEditor()
    unsubFloor()
    unsubAP()
    unsubDrag()
    layer.removeChild(g)
    g.destroy()
  }
}

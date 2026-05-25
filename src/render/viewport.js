import { Graphics } from 'pixi.js'

// Wires pointer + wheel events on the PIXI scene to a viewport store, and
// imperatively applies store updates back to the world Container transform.
// Store is the single source of truth; events write through it.
//
// Pan / select / marquee responsibility split:
//   * Pan — middle-button OR space + left-button on stage.
//   * Marquee — left-button on stage background; if drag distance > 4 px
//     becomes a marquee rectangle; on release fires onMarqueeCommit with
//     the world-space rect. If no drag, treated as a background click.
//   * Background click — onBackgroundClick callback. The FloorplanSystem
//     wires this to clearSelected.
//   * Left-button on a child that calls e.stopPropagation() bypasses the
//     stage handler entirely — that's how the AP / SW / Tray / Wall hit
//     containers claim a click without panning or starting a marquee.

const ZOOM_PER_NOTCH = 1.1
const MARQUEE_DRAG_THRESHOLD_PX = 4
const MARQUEE_STROKE = '#fbbf24'
const MARQUEE_FILL = 'rgba(251, 191, 36, 0.10)'

export function bindViewport({
  app,
  canvas,
  scene,
  world,
  store,
  onBackgroundClick,
  onMarqueeCommit,
}) {
  const stage = app.stage
  stage.eventMode = 'static'
  stage.hitArea = app.screen

  // Marquee rectangle Graphics on the overlays world-space layer (scales
  // with viewport — acceptable since the rect is short-lived).
  const marqueeG = new Graphics()
  scene.layers.overlays.addChild(marqueeG)

  let spaceDown = false
  let panActive = false
  let panLastX = 0
  let panLastY = 0

  let pendingDrag = null  // { kind: 'click-or-marquee', startGlobal, startWorld }
  let marqueeActive = false

  const apply = (s) => {
    world.position.set(s.x, s.y)
    world.scale.set(s.scale, s.scale)
  }
  apply(store.getState())
  const unsubscribe = store.subscribe(apply)

  const drawMarquee = (a, b) => {
    marqueeG.clear()
    const x1 = Math.min(a.x, b.x)
    const y1 = Math.min(a.y, b.y)
    const x2 = Math.max(a.x, b.x)
    const y2 = Math.max(a.y, b.y)
    marqueeG.rect(x1, y1, x2 - x1, y2 - y1)
      .fill({ color: MARQUEE_FILL, alpha: 1 })
      .stroke({ width: 1, color: MARQUEE_STROKE, alpha: 0.9 })
  }
  const clearMarqueeGraphics = () => marqueeG.clear()

  const onStageDown = (e) => {
    const isBackground = e.target === stage
    const button = e.button ?? 0
    const isMiddle = button === 1
    const isLeftPan = button === 0 && spaceDown
    if (isMiddle || isLeftPan) {
      panActive = true
      panLastX = e.global.x
      panLastY = e.global.y
      stage.cursor = 'grabbing'
      return
    }
    if (isBackground && button === 0) {
      pendingDrag = {
        startGlobal: { x: e.global.x, y: e.global.y },
        startWorld: { ...world.toLocal(e.global) },
      }
      marqueeActive = false
    }
  }

  const onStageMove = (e) => {
    if (panActive) {
      const dx = e.global.x - panLastX
      const dy = e.global.y - panLastY
      panLastX = e.global.x
      panLastY = e.global.y
      store.getState().panBy(dx, dy)
      return
    }
    if (pendingDrag) {
      const dist = Math.hypot(
        e.global.x - pendingDrag.startGlobal.x,
        e.global.y - pendingDrag.startGlobal.y,
      )
      if (!marqueeActive && dist > MARQUEE_DRAG_THRESHOLD_PX) {
        marqueeActive = true
      }
      if (marqueeActive) {
        const cur = world.toLocal(e.global)
        drawMarquee(pendingDrag.startWorld, cur)
      }
    }
  }

  const onStageUp = (e) => {
    if (panActive) {
      panActive = false
      stage.cursor = spaceDown ? 'grab' : ''
      return
    }
    if (pendingDrag) {
      if (marqueeActive) {
        const end = world.toLocal(e.global)
        const rect = {
          minX: Math.min(pendingDrag.startWorld.x, end.x),
          minY: Math.min(pendingDrag.startWorld.y, end.y),
          maxX: Math.max(pendingDrag.startWorld.x, end.x),
          maxY: Math.max(pendingDrag.startWorld.y, end.y),
        }
        if (typeof onMarqueeCommit === 'function') onMarqueeCommit(rect)
      } else if (typeof onBackgroundClick === 'function') {
        onBackgroundClick()
      }
      pendingDrag = null
      marqueeActive = false
      clearMarqueeGraphics()
    }
  }

  stage.on('pointerdown', onStageDown)
  stage.on('pointermove', onStageMove)
  stage.on('pointerup', onStageUp)
  stage.on('pointerupoutside', onStageUp)

  const onWheel = (e) => {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? ZOOM_PER_NOTCH : 1 / ZOOM_PER_NOTCH
    store.getState().zoomAt(sx, sy, factor)
  }
  canvas.addEventListener('wheel', onWheel, { passive: false })

  const onKeyDown = (e) => {
    if (e.code === 'Space' && !e.repeat) {
      spaceDown = true
      stage.cursor = panActive ? 'grabbing' : 'grab'
    }
  }
  const onKeyUp = (e) => {
    if (e.code === 'Space') {
      spaceDown = false
      stage.cursor = panActive ? 'grabbing' : ''
    }
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  // Reserve right-click for object context menus — suppress the browser
  // native one on the canvas. (Right-click on a layer's hit container
  // routes through PIXI federated events; right-click on background
  // currently just dismisses.)
  const onContextMenu = (e) => e.preventDefault()
  canvas.addEventListener('contextmenu', onContextMenu)

  return () => {
    unsubscribe()
    stage.off('pointerdown', onStageDown)
    stage.off('pointermove', onStageMove)
    stage.off('pointerup', onStageUp)
    stage.off('pointerupoutside', onStageUp)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    scene.layers.overlays.removeChild(marqueeG)
    marqueeG.destroy()
  }
}

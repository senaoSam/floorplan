// Wires pointer + wheel events on the PIXI scene to a viewport store, and
// imperatively applies store updates back to the world Container transform.
// Store is the single source of truth; events write through it.
//
// Pan / select responsibility split:
//   * Pan triggers — middle-button on stage / left-button on stage with
//     space held / middle-button anywhere on canvas.
//   * Left-button on a child that calls e.stopPropagation() bypasses the
//     stage handler entirely — that's how the AP markers (and later wall /
//     switch / tray hit-areas) claim a click without panning.
//   * Left-button on stage background → onBackgroundClick callback. The
//     FloorplanSystem wires this to clearSelected.
//
// Wheel + space keyboard stay on canvas/window because they aren't routed
// through PIXI's federated event system.

const ZOOM_PER_NOTCH = 1.1

export function bindViewport({ app, canvas, world, store, onBackgroundClick }) {
  const stage = app.stage
  stage.eventMode = 'static'
  stage.hitArea = app.screen

  let spaceDown = false
  let panActive = false
  let panLastX = 0
  let panLastY = 0

  const apply = (s) => {
    world.position.set(s.x, s.y)
    world.scale.set(s.scale, s.scale)
  }
  apply(store.getState())
  const unsubscribe = store.subscribe(apply)

  // ── pointer (pan + background click) ─────────────────────────────────
  const onStageDown = (e) => {
    const isBackground = e.target === stage
    const button = e.button ?? 0
    const isMiddle = button === 1
    const isLeftPan = button === 0 && spaceDown
    const wantPan = isMiddle || isLeftPan
    if (wantPan) {
      panActive = true
      panLastX = e.global.x
      panLastY = e.global.y
      stage.cursor = 'grabbing'
      return
    }
    if (isBackground && button === 0 && typeof onBackgroundClick === 'function') {
      onBackgroundClick()
    }
  }

  const onStageMove = (e) => {
    if (!panActive) return
    const dx = e.global.x - panLastX
    const dy = e.global.y - panLastY
    panLastX = e.global.x
    panLastY = e.global.y
    store.getState().panBy(dx, dy)
  }

  const onStageUp = () => {
    if (!panActive) return
    panActive = false
    stage.cursor = spaceDown ? 'grab' : ''
  }

  stage.on('pointerdown', onStageDown)
  stage.on('pointermove', onStageMove)
  stage.on('pointerup', onStageUp)
  stage.on('pointerupoutside', onStageUp)

  // ── wheel zoom (still on canvas — no federated wheel event) ──────────
  const onWheel = (e) => {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? ZOOM_PER_NOTCH : 1 / ZOOM_PER_NOTCH
    store.getState().zoomAt(sx, sy, factor)
  }
  canvas.addEventListener('wheel', onWheel, { passive: false })

  // ── space-to-pan keyboard ────────────────────────────────────────────
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

  // Suppress browser context menu on canvas right-click (right-click is
  // reserved for the object context menu, ported in a later bundle).
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
  }
}

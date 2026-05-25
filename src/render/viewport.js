// Wires pointer + wheel events on the PIXI canvas to a viewport store, and
// imperatively applies store updates back to the world Container transform.
// Store is the single source of truth; events write through it.
//
// Bindings:
//   wheel             → zoomAt(cursor, factor)
//   middle-drag       → pan
//   space + any drag  → pan
//
// Returns a destroy() that detaches every listener.

const ZOOM_PER_NOTCH = 1.1

export function bindViewport({ canvas, world, store }) {
  let spaceDown = false
  let panActive = false
  let panLastX = 0
  let panLastY = 0
  let panPointerId = null

  const apply = (s) => {
    world.position.set(s.x, s.y)
    world.scale.set(s.scale, s.scale)
  }
  apply(store.getState())

  const unsubscribe = store.subscribe(apply)

  const onWheel = (e) => {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? ZOOM_PER_NOTCH : 1 / ZOOM_PER_NOTCH
    store.getState().zoomAt(sx, sy, factor)
  }

  const startPan = (e) => {
    panActive = true
    panLastX = e.clientX
    panLastY = e.clientY
    panPointerId = e.pointerId
    try { canvas.setPointerCapture(e.pointerId) } catch { /* noop */ }
  }

  const stopPan = (e) => {
    if (!panActive) return
    panActive = false
    if (panPointerId != null) {
      try { canvas.releasePointerCapture(panPointerId) } catch { /* noop */ }
      panPointerId = null
    }
  }

  const onPointerDown = (e) => {
    const isMiddle = e.button === 1
    const isSpacePan = spaceDown && (e.button === 0 || e.button === 1)
    if (isMiddle || isSpacePan) {
      e.preventDefault()
      startPan(e)
    }
  }

  const onPointerMove = (e) => {
    if (!panActive) return
    const dx = e.clientX - panLastX
    const dy = e.clientY - panLastY
    panLastX = e.clientX
    panLastY = e.clientY
    store.getState().panBy(dx, dy)
  }

  const onPointerUp = (e) => stopPan(e)
  const onPointerCancel = (e) => stopPan(e)

  const onKeyDown = (e) => {
    if (e.code === 'Space' && !e.repeat) {
      spaceDown = true
      canvas.style.cursor = 'grab'
    }
  }
  const onKeyUp = (e) => {
    if (e.code === 'Space') {
      spaceDown = false
      canvas.style.cursor = ''
    }
  }

  const onContextMenu = (e) => {
    // Middle-button pan is fine, but right-click should not open the browser
    // menu inside the canvas.
    e.preventDefault()
  }

  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  return () => {
    unsubscribe()
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerCancel)
    canvas.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
}

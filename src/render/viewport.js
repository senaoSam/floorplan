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
  onPlaceModeClick,
  isPlaceMode,
  isDrawMode,
  onDrawModeClick,
  onDrawModeMove,
  onDrawModeRightClick,
  onDrawModeDoubleClick,
}) {
  const stage = app.stage
  stage.eventMode = 'static'
  stage.hitArea = app.screen

  // Marquee rectangle Graphics on the overlays world-space layer (scales
  // with viewport — acceptable since the rect is short-lived).
  const marqueeG = new Graphics()
  marqueeG.eventMode = 'none' // pure visual — never intercept clicks
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

  const vlog = (...args) => {
    if (typeof window !== 'undefined' && window.__debugWallSelect) {
      console.log('[stage]', ...args)
    }
  }

  const onStageDown = (e) => {
    const isBackground = e.target === stage
    const button = e.button ?? 0
    if (typeof window !== 'undefined' && window.__debugRMB === true && button === 2) {
      console.log('[RMB stage] pointerdown isBackground=', isBackground, 'target=', e.target?.label ?? e.target?.constructor?.name, 'global=', `${e.global.x.toFixed(1)},${e.global.y.toFixed(1)}`)
    }
    // Clear the trace so we only capture contains() calls between this
    // pointerdown and the matching pointerup.
    if (typeof window !== 'undefined' && window.__debugWallSelect) {
      window.__wallHitTrace = []
    }
    // Only log background clicks — object clicks bubble through the stage
    // too but the per-layer logs (`[wall] pointerdown ...`, etc.) already
    // cover those. Logging both made every successful click double-print.
    if (isBackground) {
      vlog('pointerdown target=', e.target?.label ?? e.target?.constructor?.name, 'isBackground=', isBackground, 'button=', button, 'global=', `${e.global.x.toFixed(1)},${e.global.y.toFixed(1)}`)
    }
    const isMiddle = button === 1
    const isLeftPan = button === 0 && spaceDown
    if (isMiddle || isLeftPan) {
      panActive = true
      panLastX = e.global.x
      panLastY = e.global.y
      stage.cursor = 'grabbing'
      return
    }
    if (button === 0) {
      // Place / Draw modes consume the LMB regardless of whether the
      // cursor was over an object or empty canvas. Object layers' own
      // pointerdown handlers return early in non-SELECT modes WITHOUT
      // stopPropagation, so the event bubbles up to here. Without this
      // change the user couldn't drop an AP or extend a draft point on
      // top of an existing wall / tray / scope etc.
      if (typeof isPlaceMode === 'function' && isPlaceMode()) {
        const wp = world.toLocal(e.global)
        if (typeof onPlaceModeClick === 'function') {
          onPlaceModeClick({ x: wp.x, y: wp.y })
        }
        return
      }
      if (typeof isDrawMode === 'function' && isDrawMode()) {
        const wp = world.toLocal(e.global)
        if (typeof onDrawModeClick === 'function') {
          onDrawModeClick({ x: wp.x, y: wp.y })
        }
        return
      }
      // SELECT mode: background LMB starts a marquee-or-clear gesture.
      // We only ever get here when isBackground is true, because objects
      // in SELECT mode stopPropagation() inside their own handler.
      if (isBackground) {
        pendingDrag = {
          startGlobal: { x: e.global.x, y: e.global.y },
          startWorld: { ...world.toLocal(e.global) },
        }
        marqueeActive = false
      }
    }
    // Right-click on stage background while in a draw mode commits the
    // open polyline / polygon (Enter alt path).
    if (isBackground && button === 2 && typeof isDrawMode === 'function' && isDrawMode()) {
      if (typeof onDrawModeRightClick === 'function') onDrawModeRightClick()
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
    // Draw-mode ghost cursor — feed the world position so the draft
    // overlay can render the trailing edge to the current cursor.
    if (typeof isDrawMode === 'function' && isDrawMode()) {
      const wp = world.toLocal(e.global)
      if (typeof onDrawModeMove === 'function') {
        onDrawModeMove({ x: wp.x, y: wp.y })
      }
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
        // Diagnostic: include click world position so a user reporting
        // "click missed the wall" can confirm whether their cursor was
        // actually on a wall or in the gap.
        const wp = world.toLocal(e.global)
        const scale = store.getState().scale
        vlog('stage pointerup → onBackgroundClick (clearSelected)  world=', `${wp.x.toFixed(1)},${wp.y.toFixed(1)}`, '  scale=', scale.toFixed(3))
        // Auto-run the nearest-wall probe so the user doesn't need to
        // copy-paste coords back into the console. Tells us at a glance
        // whether the click was within tolerance of any wall.
        if (typeof window !== 'undefined' && typeof window.__wallNearestTo === 'function' && window.__debugWallSelect) {
          const probe = window.__wallNearestTo(wp.x, wp.y)
          vlog('  nearest wall=', probe.id, '  worldDist=', probe.d.toFixed(2), '  worldTol=', probe.worldTol.toFixed(2), '  screenDist=', probe.screenDistance.toFixed(2), 'px  withinTol=', probe.withinTolerance)
        }
        // Did PIXI actually call any wall's hitArea.contains() during this
        // pointer cycle? If __wallHitTrace is empty → PIXI's hit-test
        // didn't descend to the walls layer at all → upstream layer (a
        // sibling above walls in z-order) is claiming the click. If
        // entries exist but all `ok:false` → tolerance issue. If an
        // `ok:true` entry exists yet we still landed in stage → PIXI
        // returned the hit but didn't dispatch it (event-mode bug).
        if (typeof window !== 'undefined' && window.__debugWallSelect && window.__wallHitTrace) {
          vlog('  wall hitArea.contains() calls during this pointer cycle:', window.__wallHitTrace.length, 'total —', window.__wallHitTrace.slice(-5))
          window.__wallHitTrace = []
        }
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

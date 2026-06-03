import { Graphics } from 'pixi.js'
import { useFloorStore } from '@/store/useFloorStore'

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
  isMarqueeMode,
  isPanMode,
  isCropMode,
  isAlignMode,
  isClientViewMode,
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
  // CROP_IMAGE drag tracker — set on pointerdown so the matching pointerup
  // can promote a drag-past-threshold gesture into a 2nd-click commit
  // (matches MARQUEE_SELECT's drag-to-select feel; user explicit request
  // for consistency between the two box-select modes). Plain click-click
  // still works: pointerup with no drag leaves the draft alive for the
  // user's next pointerdown to commit at the 2nd point.
  let cropDragDownGlobal = null

  const apply = (s) => {
    world.position.set(s.x, s.y)
    world.scale.set(s.scale, s.scale)
  }
  apply(store.getState())
  const unsubscribe = store.subscribe(apply)

  // Render-on-demand: the marquee rectangle is drawn imperatively (not via a
  // store), so it must explicitly request a repaint. Same for clearing it.
  const requestRender = () => { if (typeof scene.requestRender === 'function') scene.requestRender() }

  const drawMarquee = (a, b) => {
    marqueeG.clear()
    const x1 = Math.min(a.x, b.x)
    const y1 = Math.min(a.y, b.y)
    const x2 = Math.max(a.x, b.x)
    const y2 = Math.max(a.y, b.y)
    marqueeG.rect(x1, y1, x2 - x1, y2 - y1)
      .fill({ color: MARQUEE_FILL, alpha: 1 })
      .stroke({ width: 1, color: MARQUEE_STROKE, alpha: 0.9 })
    requestRender()
  }
  const clearMarqueeGraphics = () => { marqueeG.clear(); requestRender() }

  const vlog = (...args) => {
    if (typeof window !== 'undefined' && window.__debugWallSelect) {
      console.log('[stage]', ...args)
    }
  }

  const onStageDown = (e) => {
    // Treat both the stage AND the floor image sprite as "background"
    // for pan / marquee routing — user explicit ask: dragging from the
    // floor plan area (which is the whole canvas visually) should pan.
    // Without including the floor image sprite, e.target lands on the
    // sprite and isBackground stays false, so pendingDrag never sets up
    // and drag does nothing in SELECT mode.
    const isBackground = e.target === stage || e.target?.label === 'floor-image'
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
    // PAN toolbar mode: left-button drags the canvas (oldSrc parity —
    // ActiveModeBadge hint "拖曳畫布移動視角"). Same path as middle-button
    // pan / space+left pan.
    const isLeftPanMode = button === 0 && typeof isPanMode === 'function' && isPanMode()
    if (isMiddle || isLeftPan || isLeftPanMode) {
      panActive = true
      panLastX = e.global.x
      panLastY = e.global.y
      stage.cursor = 'grabbing'
      return
    }
    if (button === 0) {
      const isPlace = typeof isPlaceMode === 'function' && isPlaceMode()
      const isDraw  = typeof isDrawMode  === 'function' && isDrawMode()
      const isCrop  = typeof isCropMode  === 'function' && isCropMode()

      // CROP_IMAGE keeps its existing flow (Bundle 49 drag-to-select).
      // pointerdown sets pt0, pointerup-with-drag commits pt1.
      if (isDraw && isCrop) {
        const wp = world.toLocal(e.global)
        if (typeof onDrawModeClick === 'function') onDrawModeClick({ x: wp.x, y: wp.y })
        cropDragDownGlobal = { x: e.global.x, y: e.global.y }
        return
      }

      // Place / non-crop draw modes — defer the commit to pointerup so
      // dragging on an empty area pans the canvas instead of dropping an
      // object (user request: "按下去放開 才算放AP；按著拖曳就是拖曳；
      // 拖曳空白處應該也要能移動"). The per-object layers handle their
      // own pointerdown for the "drag existing same-type object" path,
      // stopping propagation before we get here.
      if (isPlace || isDraw) {
        const wp = world.toLocal(e.global)
        const handler = isPlace ? onPlaceModeClick : onDrawModeClick
        pendingDrag = {
          startGlobal: { x: e.global.x, y: e.global.y },
          startWorld: { ...wp },
          mode: 'click-or-pan',
          onClick: typeof handler === 'function' ? handler : null,
        }
        marqueeActive = false
        return
      }

      // Background LMB:
      //   ALIGN_FLOOR     → drag-translate the active floor's
      //                     alignOffsetX/Y (Figma-like direct manipulation
      //                     — sliders still work for precise edits, but
      //                     dragging the canvas now moves *just the active
      //                     floor*, not the whole viewport. Without this,
      //                     dragging in align mode pans world which shifts
      //                     BOTH active and ref floors together — the user
      //                     correctly flagged that as confusing).
      //   MARQUEE_SELECT  → click-or-marquee (oldSrc Editor2D 783-787).
      //   SELECT / other  → click-or-pan: pointerup with no drag clears
      //                     the selection; drag past the threshold
      //                     upgrades the gesture to a pan (matches the
      //                     "拖曳畫布移動視角" affordance the user expects).
      // CLIENT_VIEW owns the whole stage for client placement / drag (handled
      // by clientViewBinder). Skip pan/marquee/align setup so the canvas
      // doesn't pan out from under the client drag.
      const inClientView = typeof isClientViewMode === 'function' && isClientViewMode()
      if (isBackground && !inClientView) {
        const inAlign = typeof isAlignMode === 'function' && isAlignMode()
        const inMarquee = typeof isMarqueeMode === 'function' && isMarqueeMode()
        if (inAlign) {
          const { floors, activeFloorId } = useFloorStore.getState()
          const floor = floors.find((f) => f.id === activeFloorId)
          pendingDrag = {
            startGlobal: { x: e.global.x, y: e.global.y },
            startWorld: { ...world.toLocal(e.global) },
            mode: 'align-translate',
            floorId: activeFloorId,
            startAlignOx: floor?.alignOffsetX ?? 0,
            startAlignOy: floor?.alignOffsetY ?? 0,
          }
        } else {
          pendingDrag = {
            startGlobal: { x: e.global.x, y: e.global.y },
            startWorld: { ...world.toLocal(e.global) },
            mode: inMarquee ? 'marquee' : 'pan',
          }
        }
        marqueeActive = false
      }
    }
    // Right-click while in a draw mode commits the open polyline /
    // polygon (Enter alt path) — matches oldSrc Editor2D handleContextMenu
    // where draft-in-progress always trumps any per-object menu. No
    // isBackground gate: per-layer RMB handlers bail (without
    // stopPropagation) when a draft is active so the event bubbles here
    // regardless of whether the cursor sits over a wall / AP / floor
    // image. With no active draft, commitDraft early-returns.
    if (button === 2 && typeof isDrawMode === 'function' && isDrawMode()) {
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
      if (pendingDrag.mode === 'marquee') {
        if (!marqueeActive && dist > MARQUEE_DRAG_THRESHOLD_PX) {
          marqueeActive = true
        }
        if (marqueeActive) {
          const cur = world.toLocal(e.global)
          drawMarquee(pendingDrag.startWorld, cur)
        }
      } else if ((pendingDrag.mode === 'pan' || pendingDrag.mode === 'click-or-pan') && dist > MARQUEE_DRAG_THRESHOLD_PX) {
        // Upgrade click-or-pan (background or place / draw mode) to an
        // active pan now that the user has dragged past the threshold.
        // Subsequent moves are handled by the panActive branch above on
        // the next tick.
        panActive = true
        panLastX = e.global.x
        panLastY = e.global.y
        stage.cursor = 'grabbing'
        pendingDrag = null
      } else if (pendingDrag.mode === 'align-translate' && dist > MARQUEE_DRAG_THRESHOLD_PX) {
        // ALIGN_FLOOR drag-translate — convert cursor world-delta into
        // active floor's alignOffsetX/Y. Assumes alignRotation = 0 and
        // alignScale = 1 (worldDelta == imageDelta in that case). Users
        // doing rotated/scaled alignment should still fall back to the
        // sliders.
        const cur = world.toLocal(e.global)
        const dx = cur.x - pendingDrag.startWorld.x
        const dy = cur.y - pendingDrag.startWorld.y
        if (pendingDrag.floorId) {
          useFloorStore.getState().setAlignTransform(pendingDrag.floorId, {
            alignOffsetX: pendingDrag.startAlignOx + dx,
            alignOffsetY: pendingDrag.startAlignOy + dy,
          })
        }
      }
    }
  }

  const onStageUp = (e) => {
    if (panActive) {
      panActive = false
      const inPanMode = typeof isPanMode === 'function' && isPanMode()
      stage.cursor = (spaceDown || inPanMode) ? 'grab' : ''
      return
    }
    // CROP_IMAGE drag-to-commit (Q1 — marquee-style). If the cursor
    // travelled past the same threshold marquee uses, fire onDrawModeClick
    // at the release position so the existing 2nd-click commit path runs.
    // A pointerup with no drag falls through silently; the draft stays
    // alive so the user can fall back to the 2-click pattern.
    if (cropDragDownGlobal) {
      const dx = e.global.x - cropDragDownGlobal.x
      const dy = e.global.y - cropDragDownGlobal.y
      const dist = Math.hypot(dx, dy)
      cropDragDownGlobal = null
      if (dist > MARQUEE_DRAG_THRESHOLD_PX && typeof onDrawModeClick === 'function') {
        const wp = world.toLocal(e.global)
        onDrawModeClick({ x: wp.x, y: wp.y })
        return
      }
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
      } else if (pendingDrag.mode === 'align-translate') {
        // Drag-translate writes were applied live on each move; nothing
        // to commit here. Don't fall through to onBackgroundClick — that
        // would clear selection unrelated to the align gesture.
      } else if (pendingDrag.mode === 'click-or-pan' && pendingDrag.onClick) {
        // Place / non-crop draw mode: pointerup without drag fires the
        // deferred click handler at the down position so the new object
        // / draft point lands where the user pressed (not where they
        // released — feels less jittery on imprecise mice).
        pendingDrag.onClick(pendingDrag.startWorld)
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

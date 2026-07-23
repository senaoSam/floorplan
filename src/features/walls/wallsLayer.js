import { Container, Graphics } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useViewportStore } from '@/store/useViewportStore'
import { useDragOverlayStore, isAnyBodyDragging } from '@/store/useDragOverlayStore'
import { useDraftStore } from '@/store/useDraftStore'
import { OPENING_TYPES, getMaterialById } from '@/constants/materials'
import { generateId } from '@/utils/id'
import { isTypingTarget } from '@/utils/isTypingTarget'
import { getModeCapability } from '@/render/modeCapabilities'
import { snapToWallForTray } from '@/features/draft/traySnap'

const DRAG_COMMIT_THRESHOLD_PX = 1

// Walls adapter — per-wall Container with click hit-test + body drag.
// Visual ports oldSrc WallLayer.jsx (23-3f hover invert):
//   * Hover invert beam (only when hovered + not selected): white stroke
//     22 px alpha 0.45 — the wall "lights up" white under the cursor.
//   * Black halo for contrast (alpha 0.4): width 4 normal / 7 selected / 10 hovered
//   * Inner stroke: width 3 normal / 5 selected / 6 hovered.
//     Colour: white on hover, else wall.material.color.
//   * Openings render on top in OPENING_TYPES colour (door brown / window blue).
//     Width 6 normal / 8 hovered / 6 selected.
// Hit area is 14 screen-px wide along the segment so clicks register
// even on thin segments at zoomed-out viewports.
const WALL_HALO_WIDTH_NORMAL   = 4
const WALL_HALO_WIDTH_SELECTED = 4
const WALL_HALO_WIDTH_HOVERED  = 4
const WALL_BODY_WIDTH_NORMAL   = 3
const WALL_BODY_WIDTH_SELECTED = 3
// User update: wall body keeps NORMAL width on hover (oldSrc thickened to
// 6; user wants no width change). Colour does flip to white on hover so
// the body itself reads as the bright marker.
const WALL_BODY_WIDTH_HOVERED  = WALL_BODY_WIDTH_NORMAL
// White hover beam — drawn UNDER the black halo, wider than the halo so
// a thin white ring shows on each side of the black ring. PAD is total
// extra width over the halo (so 1 px each side at PAD=2).
const WALL_HOVER_BEAM_PAD      = 2
const WALL_HOVER_BEAM_COLOR    = '#ffffff'
const WALL_HOVER_BEAM_ALPHA    = 0.9
// User update: selected walls get an outer cyan ring (matches the wall
// draft accent colour) so "this is selected" is unambiguous. Drawn BEFORE
// the black halo so the halo covers the inside, leaving a thin cyan rim.
const WALL_SELECTED_RING_PAD   = 4       // total extra width vs halo (2 px each side)
const WALL_SELECTED_RING_COLOR = '#00e5ff'
const WALL_SELECTED_RING_ALPHA = 0.85
// User update: openings render at the SAME width as the wall body
// (oldSrc had thicker openings to call them out; user wants visual
// consistency). Each state mirrors the matching body width above.
const OPENING_WIDTH_NORMAL     = WALL_BODY_WIDTH_NORMAL
const OPENING_WIDTH_HOVERED    = WALL_BODY_WIDTH_HOVERED
const OPENING_WIDTH_SELECTED   = WALL_BODY_WIDTH_SELECTED
// Hit envelope in SCREEN px (matches oldSrc Konva hitStrokeWidth=14). We
// convert to world px by dividing by viewport.scale on every viewport
// change — otherwise zooming out makes the wall hit area shrink to a few
// screen px and clicks "near" the wall miss → stage receives the click →
// clearSelected fires and the panel closes. That was the root cause of
// the recurring "wall select sometimes fails / panel closes" bug.
const HIT_TOLERANCE_SCREEN_PX = 14

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-9) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const qx = ax + t * dx
  const qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

function makeSegmentHitArea(ax, ay, bx, by, tolerance, wallId) {
  const obj = {
    contains(x, y) {
      const d = pointToSegmentDistance(x, y, ax, ay, bx, by)
      const ok = d <= tolerance
      // Track ANY contains() call so we can confirm PIXI is actually
      // routing the click through this wall during hit-test. Stored on
      // window so the next pointerdown trace can include it.
      if (typeof window !== 'undefined' && window.__debugWallSelect && wallId) {
        if (!window.__wallHitTrace) window.__wallHitTrace = []
        window.__wallHitTrace.push({ wallId, x, y, d: +d.toFixed(2), tol: +tolerance.toFixed(2), ok })
        if (window.__wallHitTrace.length > 200) window.__wallHitTrace.shift()
      }
      return ok
    },
  }
  return obj
}

export function attachWallsLayer({ scene, useFloorStore, useWallStore, onDrawModeClick }) {
  const layer = scene.layers.walls
  layer.eventMode = 'passive'

  const containers = new Map()
  // DRAW_DOOR / DRAW_WINDOW mode state — first click records (wallId, frac),
  // the next click on the SAME wall inserts an opening over [min, max].
  // Click on a different wall resets to that wall. Esc / right-click clear
  // via the shared keyboard / context-menu paths (cleared on mode exit).
  // openingKind is derived from the current editor mode (no per-mode toggle).
  const dw = { wallId: null, startFrac: null }
  const isDoorWindowMode = (mode) =>
    mode === EDITOR_MODE.DRAW_DOOR || mode === EDITOR_MODE.DRAW_WINDOW

  // DRAW_WALL cursor alternation — user-requested. While the cursor sits
  // over a wall in DRAW_WALL mode, the canvas cursor flips between
  // 'grab' and 'crosshair' once per second to signal that both gestures
  // are available (drag wall body vs. click to place a draft point).
  // We track hovered wall ids in a Set so moving between walls without
  // leaving the layer doesn't drop the alternation.
  const hoveredWallIds = new Set()
  let cursorTickInterval = null
  let cursorTickToggle = false

  const updateCursorAlternation = () => {
    const mode = useEditorStore.getState().editorMode
    const shouldTick = mode === EDITOR_MODE.DRAW_WALL && hoveredWallIds.size > 0
    const canvas = scene.app.canvas
    if (shouldTick && !cursorTickInterval) {
      cursorTickToggle = true
      if (canvas) canvas.style.cursor = 'grab'
      cursorTickInterval = setInterval(() => {
        const m = useEditorStore.getState().editorMode
        if (m !== EDITOR_MODE.DRAW_WALL || hoveredWallIds.size === 0) return
        cursorTickToggle = !cursorTickToggle
        if (canvas) canvas.style.cursor = cursorTickToggle ? 'grab' : 'crosshair'
      }, 1000)
    } else if (!shouldTick && cursorTickInterval) {
      clearInterval(cursorTickInterval)
      cursorTickInterval = null
      // Restore the mode cursor — modeAdapter usually owns this but the
      // alternation overwrites canvas.style.cursor directly, so on stop
      // we hand it back to whatever the current mode wants (modeAdapter
      // may have already written it; we re-apply to be safe in case the
      // subscriber order put us after it).
      const cap = getModeCapability(useEditorStore.getState().editorMode)
      if (canvas) canvas.style.cursor = cap.cursor ?? 'default'
    }
  }

  const ensureContainer = (wall, floorId) => {
    let entry = containers.get(wall.id)
    if (!entry) {
      const c = new Container()
      c.label = `wall:${wall.id}`
      c.eventMode = 'static'
      c.cursor = 'move'
      const g = new Graphics()
      // Critical: Graphics participates in hit-test by default and its
      // containsPoint() is based on the actual drawn pixels — for a thin
      // stroke that's only ~3 world px wide, so clicks near the wall but
      // not exactly on the rendered stroke return FALSE on Graphics,
      // and PIXI never falls back to the container's hitArea (parent
      // hitArea is consulted BEFORE descending into children, but the
      // child's negative result still wins because the descent finished
      // without claiming the container). Setting eventMode='none' on the
      // Graphics removes it from hit-test entirely, so the container's
      // 14-screen-px hitArea is the only thing that matters.
      g.eventMode = 'none'
      c.addChild(g)
      layer.addChild(c)
      entry = { container: c, graphics: g, wall, floorId }
      containers.set(wall.id, entry)
      bindInteractions(entry)
    } else {
      entry.wall = wall
      entry.floorId = floorId
    }
    return entry
  }

  const removeContainer = (id) => {
    const entry = containers.get(id)
    if (!entry) return
    layer.removeChild(entry.container)
    entry.container.destroy({ children: true })
    containers.delete(id)
  }

  const drawWall = (entry) => {
    const { graphics, wall } = entry
    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    const isSelected = (editorState.selectedId === wall.id && editorState.selectedType === 'wall')
      || (editorState.selectedItems.length > 1
        && editorState.selectedItems.some((it) => it.id === wall.id && it.type === 'wall'))
    const isHovered  = hoverState.id === wall.id && hoverState.type === 'wall'
    const hoverInvert = isHovered && !isSelected

    const haloWidth = hoverInvert ? WALL_HALO_WIDTH_HOVERED
                                  : isSelected ? WALL_HALO_WIDTH_SELECTED
                                              : WALL_HALO_WIDTH_NORMAL
    const bodyWidth = hoverInvert ? WALL_BODY_WIDTH_HOVERED
                                  : isSelected ? WALL_BODY_WIDTH_SELECTED
                                              : WALL_BODY_WIDTH_NORMAL
    const openingWidth = hoverInvert ? OPENING_WIDTH_HOVERED
                                     : isSelected ? OPENING_WIDTH_SELECTED
                                                  : OPENING_WIDTH_NORMAL

    graphics.clear()

    // (1) Selected outer cyan rim — drawn FIRST so the wider black halo
    // covers the inside, leaving a thin ring around the wall (only visible
    // when selected and not hovered).
    if (isSelected && !hoverInvert) {
      graphics
        .moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
        .stroke({
          width: haloWidth + WALL_SELECTED_RING_PAD,
          color: WALL_SELECTED_RING_COLOR,
          alpha: WALL_SELECTED_RING_ALPHA,
          cap: 'round',
        })
    }

    // (2) Hover white outer aura — drawn UNDER the black halo, wider so a
    // thin white ring shows outside the black. This is the "white outer
    // ring" the user wanted restored from oldSrc.
    if (hoverInvert) {
      graphics
        .moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
        .stroke({
          width: haloWidth + WALL_HOVER_BEAM_PAD,
          color: WALL_HOVER_BEAM_COLOR,
          alpha: WALL_HOVER_BEAM_ALPHA,
          cap: 'round',
        })
    }

    // (3) Black outline halo for contrast.
    graphics
      .moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
      .stroke({ width: haloWidth, color: '#000000', alpha: 0.4, cap: 'round' })

    // (4) Wall body — white on hover (oldSrc parity), else material colour.
    // Width is unchanged on hover per user preference; only the colour
    // flips so the hovered wall reads as "lit".
    graphics
      .moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
      .stroke({
        width: bodyWidth,
        color: hoverInvert ? '#ffffff' : wall.material.color,
        alpha: 1,
        cap: 'round',
      })

    // (4) Openings overlay the wall body in OPENING_TYPES colour
    // (door brown / window blue — independent from the wall material).
    const openings = wall.openings ?? []
    if (openings.length > 0) {
      const dx = wall.endX - wall.startX
      const dy = wall.endY - wall.startY
      for (const op of openings) {
        const sx = wall.startX + dx * op.startFrac
        const sy = wall.startY + dy * op.startFrac
        const ex = wall.startX + dx * op.endFrac
        const ey = wall.startY + dy * op.endFrac
        const ot = OPENING_TYPES[op.type === 'window' ? 'WINDOW' : 'DOOR']
        graphics
          .moveTo(sx, sy).lineTo(ex, ey)
          .stroke({ width: openingWidth, color: ot.color, alpha: 1, cap: 'butt' })
      }
    }

    refreshHitArea(entry)
  }

  // Build a hitArea using current viewport scale so tolerance stays at
  // HIT_TOLERANCE_SCREEN_PX screen pixels regardless of zoom. Only
  // replaces the hitArea object when either geometry or scale changed.
  const refreshHitArea = (entry) => {
    const { container, wall } = entry
    const scale = useViewportStore.getState().scale || 1
    const worldTol = HIT_TOLERANCE_SCREEN_PX / scale
    const lastGeom = entry._hitGeom
    if (!lastGeom ||
        lastGeom.startX !== wall.startX || lastGeom.startY !== wall.startY ||
        lastGeom.endX   !== wall.endX   || lastGeom.endY   !== wall.endY ||
        lastGeom.tol    !== worldTol) {
      container.hitArea = makeSegmentHitArea(
        wall.startX, wall.startY,
        wall.endX, wall.endY,
        worldTol,
        wall.id,
      )
      entry._hitGeom = {
        startX: wall.startX, startY: wall.startY,
        endX:   wall.endX,   endY:   wall.endY,
        tol: worldTol,
      }
    }
  }

  // Toggle in DevTools console: window.__debugWallSelect = true
  // Logs every wall pointer event + selection change so we can pinpoint
  // "click sometimes doesn't select" bugs.
  const dlog = (...args) => {
    if (typeof window !== 'undefined' && window.__debugWallSelect) {
      console.log('[wall]', ...args)
    }
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (typeof window !== 'undefined' && window.__debugRMB === true) {
        console.log('[RMB wall] pointerdown id=', entry.wall.id, 'btn=', e.button)
      }
      dlog('pointerdown wall=', entry.wall.id, 'button=', e.button, 'mode=', useEditorStore.getState().editorMode, 'target===container?', e.target === container)
      if (e.button === 2) {
        // Active draft trumps per-object RMB menu (oldSrc Editor2D
        // handleContextMenu rule). Bail without stopPropagation so the
        // event bubbles to the stage RMB handler, which calls commitDraft.
        const draft = useDraftStore.getState()
        if (draft.mode != null && draft.points.length > 0) return
        // ALIGN_FLOOR: right-drag pans the viewport — let it bubble to stage.
        if (useEditorStore.getState().editorMode === EDITOR_MODE.ALIGN_FLOOR) return
        e.stopPropagation()
        useEditorStore.getState().openContextMenu({
          targetType: 'wall',
          targetId: entry.wall.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      const editor = useEditorStore.getState()
      // DRAW_DOOR / DRAW_WINDOW modes keep their own click semantics (insert
      // opening at click foot on the wall under cursor) — capability says
      // allowSelectClick.struct = true but the layer handles it differently
      // for these two modes.
      if (isDoorWindowMode(editor.editorMode)) {
        e.stopPropagation()
        handleDoorWindowClick(entry, e, editor.editorMode)
        return
      }
      // DRAW_WALL pointerdown on a wall — deferred click-or-drag:
      //   * drag past threshold → translate this wall (body drag)
      //   * click & release in place → fall through to onDrawModeClick at
      //     the down position so the wall body acts as a snap target for
      //     the new draft point (snap-to-wall-foot via snapDraftPoint)
      // User explicitly asked for both gestures to coexist + cursor 1s
      // alternation (grab ↔ crosshair) to signal "two actions possible".
      if (editor.editorMode === EDITOR_MODE.DRAW_WALL) {
        e.stopPropagation()
        beginDrawWallDeferredClickOrDrag(entry, e)
        return
      }
      const cap = getModeCapability(editor.editorMode)
      if (!cap.allowSelectClick.struct) return
      e.stopPropagation()
      // Ctrl/Cmd+click → additive multi-select (oldSrc Editor2D 1771), no drag.
      if (e.ctrlKey || e.metaKey || e.originalEvent?.ctrlKey || e.originalEvent?.metaKey) {
        editor.toggleSelectedItem(entry.wall.id, 'wall')
        return
      }
      dlog('  → setSelected', entry.wall.id)
      editor.setSelected(entry.wall.id, 'wall')
      beginDrag(entry, e)
    })
    container.on('pointerover', () => {
      // Suppress hover while ANY object is body-dragging (oldSrc-like —
      // we don't want every wall the cursor passes over to light up when
      // the user is translating an AP / SW / wall body / tray etc.).
      // Endpoint / vertex drags don't set the body-drag flag, so they
      // intentionally keep hover enabled for the drop-target affordance.
      if (isAnyBodyDragging()) return
      const mode = useEditorStore.getState().editorMode
      const cap = getModeCapability(mode)
      if (mode === EDITOR_MODE.DRAW_WALL) {
        // Layer-level alternation owns canvas cursor — leave container
        // cursor blank so it doesn't fight the interval's writes.
        hoveredWallIds.add(entry.wall.id)
        updateCursorAlternation()
        container.cursor = ''
      } else {
        // Only SELECT shows the grab affordance; other modes fall
        // through to canvas mode cursor.
        const canGrab = mode === EDITOR_MODE.SELECT
        container.cursor = canGrab ? 'grab' : ''
      }
      if (!cap.allowSelectHover.struct && !cap.allowCommandHover.struct) return
      useHoverStore.getState().setHover(entry.wall.id, 'wall')
    })
    container.on('pointerout', () => {
      useHoverStore.getState().clearHoverIf(entry.wall.id)
      if (hoveredWallIds.delete(entry.wall.id)) updateCursorAlternation()
    })
    // DRAW_DOOR / DRAW_WINDOW preview — once the user has placed the first
    // click on THIS wall, drive a live cursorFrac so draftOverlayLayer can
    // paint a coloured band between startFrac and cursorFrac (door brown /
    // window blue, matching the eventual opening colour).
    container.on('pointermove', (e) => {
      const mode = useEditorStore.getState().editorMode
      if (!isDoorWindowMode(mode)) return
      if (dw.wallId !== entry.wall.id) return
      const local = scene.world.toLocal(e.global)
      const frac = projectToWallFrac(entry.wall, local.x, local.y)
      const clamped = Math.max(0, Math.min(1, frac))
      useDraftStore.getState().setDoorWindowDraft({
        wallId: entry.wall.id,
        startFrac: dw.startFrac,
        cursorFrac: clamped,
        kind: mode === EDITOR_MODE.DRAW_WINDOW ? 'window' : 'door',
      })
    })
  }

  // Wall-body drag — translate both endpoints by the same delta. Uses the
  // dragOverlay store so the wall geometry isn't rewritten on every move
  // (cable routing + heatmap recompute happen only on dragend).
  // While body-dragging a wall, check both endpoints against every OTHER
  // wall's endpoint / segment foot. If the closer endpoint lands within
  // snap range, adjust dx/dy so it sticks exactly to the target — and
  // surface the snap kind through draftStore.snapHint so the same cyan
  // ring / orange square halos that the draw flow uses render under the
  // dragged wall's endpoint. User explicit request: "移動牆壁時 如果端
  // 點出現另一個牆壁的端點或牆身 也要有 端點 snap or 方形 snap 提示".
  const computeWallDragSnap = (entry, startWall, dxRaw, dyRaw) => {
    const otherWalls = (useWallStore.getState().wallsByFloor[entry.floorId] ?? [])
      .filter((w) => w.id !== entry.wall.id)
    if (otherWalls.length === 0) {
      return { dx: dxRaw, dy: dyRaw, hint: null }
    }
    const scale = useViewportStore.getState().scale || 1
    const newStart = { x: startWall.startX + dxRaw, y: startWall.startY + dyRaw }
    const newEnd   = { x: startWall.endX   + dxRaw, y: startWall.endY   + dyRaw }
    const sSnap = snapToWallForTray(newStart, otherWalls, scale)
    const eSnap = snapToWallForTray(newEnd,   otherWalls, scale)
    if (!sSnap && !eSnap) {
      return { dx: dxRaw, dy: dyRaw, hint: null }
    }
    // Pick the closer of the two endpoint snaps when both fire.
    let winner = null, anchor = null
    if (sSnap && eSnap) {
      const sD = Math.hypot(newStart.x - sSnap.pos.x, newStart.y - sSnap.pos.y)
      const eD = Math.hypot(newEnd.x   - eSnap.pos.x, newEnd.y   - eSnap.pos.y)
      if (sD <= eD) { winner = sSnap; anchor = { x: startWall.startX, y: startWall.startY } }
      else          { winner = eSnap; anchor = { x: startWall.endX,   y: startWall.endY   } }
    } else if (sSnap) {
      winner = sSnap; anchor = { x: startWall.startX, y: startWall.startY }
    } else {
      winner = eSnap; anchor = { x: startWall.endX,   y: startWall.endY   }
    }
    return {
      dx: winner.pos.x - anchor.x,
      dy: winner.pos.y - anchor.y,
      hint: { kind: winner.kind, pos: winner.pos, ref: winner.wall },
    }
  }

  // DRAW_WALL pointerdown on existing wall: defer the click-vs-drag
  // decision until pointerup so the gesture can resolve into either
  //   * drag past threshold → body-drag the wall (move it)
  //   * release without drag → forward a "place draft point at this
  //     world pos" to draftCtrl.onDrawModeClick (the same path stage
  //     uses for clicks on empty canvas), letting snapDraftPoint snap
  //     onto wall endpoint / segment foot.
  const beginDrawWallDeferredClickOrDrag = (entry, downEvent) => {
    const stage = scene.app.stage
    const startGlobal = { x: downEvent.global.x, y: downEvent.global.y }
    const startWorld = scene.world.toLocal(downEvent.global)
    const startWall = {
      startX: entry.wall.startX, startY: entry.wall.startY,
      endX:   entry.wall.endX,   endY:   entry.wall.endY,
    }
    let dragStarted = false
    let dx = 0, dy = 0

    const onMove = (e) => {
      if (!dragStarted) {
        const dist = Math.hypot(e.global.x - startGlobal.x, e.global.y - startGlobal.y)
        if (dist <= DRAG_COMMIT_THRESHOLD_PX) return
        dragStarted = true
        useDragOverlayStore.getState().setWall({ id: entry.wall.id, dx: 0, dy: 0 })
      }
      const wp = scene.world.toLocal(e.global)
      const dxRaw = wp.x - startWorld.x
      const dyRaw = wp.y - startWorld.y
      const snap = computeWallDragSnap(entry, startWall, dxRaw, dyRaw)
      dx = snap.dx
      dy = snap.dy
      entry.container.position.set(dx, dy)
      useDragOverlayStore.getState().setWall({ id: entry.wall.id, dx, dy })
      useDraftStore.getState().setSnapHint(snap.hint)
    }
    const onUp = () => {
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
      useDraftStore.getState().setSnapHint(null)
      if (dragStarted) {
        entry.container.position.set(0, 0)
        if (Math.hypot(dx, dy) > DRAG_COMMIT_THRESHOLD_PX) {
          useWallStore.getState().updateWall(entry.floorId, entry.wall.id, {
            startX: startWall.startX + dx,
            startY: startWall.startY + dy,
            endX:   startWall.endX   + dx,
            endY:   startWall.endY   + dy,
          })
        }
        useDragOverlayStore.getState().setWall(null)
      } else if (typeof onDrawModeClick === 'function') {
        // No drag → click-to-place: forward to draft controller which
        // applies snapDraftPoint (wall endpoint / segment foot) and
        // begins / extends the draft.
        onDrawModeClick({ x: startWorld.x, y: startWorld.y })
      }
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  const beginDrag = (entry, downEvent) => {
    const startWorld = scene.world.toLocal(downEvent.global)
    const startWall = {
      startX: entry.wall.startX,
      startY: entry.wall.startY,
      endX:   entry.wall.endX,
      endY:   entry.wall.endY,
    }
    const stage = scene.app.stage
    let dx = 0
    let dy = 0
    dlog('  beginDrag wall=', entry.wall.id, 'startWorld=', startWorld)

    const onMove = (e) => {
      const wp = scene.world.toLocal(e.global)
      const dxRaw = wp.x - startWorld.x
      const dyRaw = wp.y - startWorld.y
      // Endpoint-onto-wall snap during body drag (user-requested):
      // hovering an endpoint of the dragged wall onto another wall's
      // endpoint / segment within snap range nudges dx/dy so the
      // endpoint lands exactly on the target, and the matching snap
      // halo (cyan ring / orange square) lights up via draftStore.
      const snap = computeWallDragSnap(entry, startWall, dxRaw, dyRaw)
      dx = snap.dx
      dy = snap.dy
      // Live preview: temporarily shift the wall container so the line
      // moves with the cursor without committing to the store yet.
      entry.container.position.set(dx, dy)
      // Signal "wall body drag in flight" so every layer's pointerover
      // bail (isAnyBodyDragging) suppresses hover during the drag.
      useDragOverlayStore.getState().setWall({ id: entry.wall.id, dx, dy })
      useDraftStore.getState().setSnapHint(snap.hint)
    }
    const onUp = () => {
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
      useDraftStore.getState().setSnapHint(null)
      dlog('  drag onUp wall=', entry.wall.id, 'dx=', dx, 'dy=', dy)
      // Reset transient transform; the store update below will redraw at
      // the new world coords.
      entry.container.position.set(0, 0)
      if (Math.hypot(dx, dy) > DRAG_COMMIT_THRESHOLD_PX) {
        useWallStore.getState().updateWall(entry.floorId, entry.wall.id, {
          startX: startWall.startX + dx,
          startY: startWall.startY + dy,
          endX:   startWall.endX   + dx,
          endY:   startWall.endY   + dy,
        })
      }
      useDragOverlayStore.getState().setWall(null)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  const handleDoorWindowClick = (entry, e, mode) => {
    const { wall } = entry
    const local = scene.world.toLocal(e.global)
    const frac = projectToWallFrac(wall, local.x, local.y)
    if (frac < 0 || frac > 1) return
    if (dw.wallId !== wall.id) {
      dw.wallId = wall.id
      dw.startFrac = frac
      // Seed the live preview at the first click — cursorFrac will be
      // updated on every subsequent pointermove over this wall.
      useDraftStore.getState().setDoorWindowDraft({
        wallId: wall.id,
        startFrac: frac,
        cursorFrac: frac,
        kind: mode === EDITOR_MODE.DRAW_WINDOW ? 'window' : 'door',
      })
      return
    }
    const f1 = Math.min(dw.startFrac, frac)
    const f2 = Math.max(dw.startFrac, frac)
    if (f2 - f1 > 0.01) {
      const existing = wall.openings ?? []
      const overlaps = existing.some((o) => f1 < o.endFrac && f2 > o.startFrac)
      if (!overlaps) {
        const openingKind = mode === EDITOR_MODE.DRAW_WINDOW ? 'window' : 'door'
        const ot = openingKind === 'window' ? OPENING_TYPES.WINDOW : OPENING_TYPES.DOOR
        const defaultMat = getMaterialById(ot.defaultMaterial)
        useWallStore.getState().addOpening(entry.floorId, wall.id, {
          id: generateId('opening'),
          type: openingKind,
          startFrac: f1,
          endFrac: f2,
          material: defaultMat,
          topHeight: 2.1,
          bottomHeight: 0,
        })
      }
    }
    dw.wallId = null
    dw.startFrac = null
    useDraftStore.getState().setDoorWindowDraft(null)
  }

  // Project a point onto the wall's segment, returning the fraction
  // along (start → end). Values outside [0, 1] indicate the point sits
  // off the segment endpoints — caller rejects those.
  const projectToWallFrac = (wall, px, py) => {
    const dx = wall.endX - wall.startX
    const dy = wall.endY - wall.startY
    const len2 = dx * dx + dy * dy
    if (len2 <= 1e-9) return -1
    return ((px - wall.startX) * dx + (py - wall.startY) * dy) / len2
  }

  // Esc clears the half-finished click pair. Mode is now driven entirely by
  // DRAW_DOOR / DRAW_WINDOW selection — no per-mode toggle key.
  const onKeyDown = (e) => {
    if (isTypingTarget(e.target)) return
    if (!isDoorWindowMode(useEditorStore.getState().editorMode)) return
    if (e.key === 'Escape') {
      dw.wallId = null
      dw.startFrac = null
      useDraftStore.getState().setDoorWindowDraft(null)
    }
  }
  window.addEventListener('keydown', onKeyDown)

  let lastEditorMode = useEditorStore.getState().editorMode
  const unsubEditor = useEditorStore.subscribe(() => {
    const mode = useEditorStore.getState().editorMode
    if (mode !== lastEditorMode) {
      lastEditorMode = mode
      // Mode change → re-evaluate cursor alternation (stop when leaving
      // DRAW_WALL so modeAdapter can restore the canvas cursor cleanly).
      updateCursorAlternation()
      if (!isDoorWindowMode(mode)) {
        dw.wallId = null
        dw.startFrac = null
        useDraftStore.getState().setDoorWindowDraft(null)
      }
    }
  })

  let lastFloorId = undefined
  let lastWalls = undefined

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && walls === lastWalls) return
    lastFloorId = activeFloorId
    lastWalls = walls
    const next = new Set(walls.map((w) => w.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    for (const wall of walls) {
      const entry = ensureContainer(wall, activeFloorId)
      drawWall(entry)
    }
  }

  // Bring an entry's container to the top of the layer so it can't be
  // hidden behind a sibling wall when hovered / selected. Re-adding to
  // the layer re-orders it to the last child = topmost.
  const liftToTop = (entry) => {
    if (!entry || !entry.container) return
    if (entry.container.parent === layer) layer.addChild(entry.container)
  }

  // Hover + selection redraws — repaint only the two walls that changed
  // state so the halo + body widths flip without rebuilding all containers.
  // Also lifts the hovered / selected wall to top so other walls can't
  // overlap it.
  let lastHoverId = useHoverStore.getState().id
  const onHoverChange = () => {
    const s = useHoverStore.getState()
    if (s.id === lastHoverId) return
    const prevId = lastHoverId
    lastHoverId = s.id
    const prev = prevId ? containers.get(prevId) : null
    const next = s.id ? containers.get(s.id) : null
    if (prev) drawWall(prev)
    if (next && next !== prev) drawWall(next)
    if (next) liftToTop(next)
  }

  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  let lastSelectedItems = useEditorStore.getState().selectedItems
  const onSelectionChange = () => {
    const s = useEditorStore.getState()
    // Multi-select (marquee / Ctrl+click) only moves selectedItems — redraw
    // all walls so batch highlight paints / clears.
    if (s.selectedItems !== lastSelectedItems) {
      lastSelectedItems = s.selectedItems
      for (const e of containers.values()) drawWall(e)
    }
    if (s.selectedId === lastSelectedId && s.selectedType === lastSelectedType) return
    const prevId = lastSelectedId
    const prevType = lastSelectedType
    lastSelectedId = s.selectedId
    lastSelectedType = s.selectedType
    dlog('selection changed:', prevType, prevId, '→', s.selectedType, s.selectedId)
    if (prevType === 'wall' && prevId) {
      const e = containers.get(prevId)
      if (e) drawWall(e)
    }
    if (s.selectedType === 'wall' && s.selectedId) {
      const e = containers.get(s.selectedId)
      if (e) { drawWall(e); liftToTop(e) }
    }
  }

  // Viewport scale → refresh every wall's hitArea so tolerance stays
  // in screen pixels (otherwise zooming out shrinks the click target
  // and the user starts missing thin walls).
  let lastScale = useViewportStore.getState().scale
  const onViewportChange = () => {
    const s = useViewportStore.getState().scale
    if (s === lastScale) return
    lastScale = s
    for (const entry of containers.values()) refreshHitArea(entry)
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubWall = useWallStore.subscribe(reconcile)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  const unsubSelection = useEditorStore.subscribe(onSelectionChange)
  const unsubViewport = useViewportStore.subscribe(onViewportChange)
  reconcile()

  // Diagnostic helper exposed on window so user can introspect wall hit
  // geometry against the last failing click. Usage from DevTools console
  // after a missed click:
  //   __wallNearestTo(worldX, worldY)
  // Returns the nearest wall id + the world-space distance + whether
  // that distance is within current tolerance.
  if (typeof window !== 'undefined') {
    window.__wallNearestTo = (x, y) => {
      const scale = useViewportStore.getState().scale || 1
      const worldTol = HIT_TOLERANCE_SCREEN_PX / scale
      let best = { id: null, d: Infinity }
      for (const entry of containers.values()) {
        const { wall } = entry
        const d = pointToSegmentDistance(x, y, wall.startX, wall.startY, wall.endX, wall.endY)
        if (d < best.d) best = { id: wall.id, d }
      }
      return { ...best, worldTol, withinTolerance: best.d <= worldTol, screenDistance: best.d * scale }
    }
  }

  return () => {
    unsubFloor()
    unsubWall()
    unsubHover()
    unsubSelection()
    unsubViewport()
    unsubEditor()
    window.removeEventListener('keydown', onKeyDown)
    if (cursorTickInterval) {
      clearInterval(cursorTickInterval)
      cursorTickInterval = null
    }
    hoveredWallIds.clear()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

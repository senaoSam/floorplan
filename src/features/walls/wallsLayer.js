import { Container, Graphics } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useViewportStore } from '@/store/useViewportStore'
import { OPENING_TYPES, getMaterialById } from '@/constants/materials'
import { generateId } from '@/utils/id'

const DRAG_COMMIT_THRESHOLD_PX = 1

// Walls adapter — per-wall Container with click hit-test (no drag yet —
// wall edit needs endpoint handles which arrive with 31-4 / 31-8 spec).
// Openings render on top in their material colour; clicking an opening
// selects the parent wall.

// Wall rendering — dual-stroke ports oldSrc WallLayer.jsx:
//   * Outer black halo for contrast (alpha 0.4) — width 4 normal / 7 selected / 10 hovered
//   * Inner colored stroke from wall.material.color — width 3 normal / 5 selected / 6 hovered
// Hit area is 14 px wide along the segment so clicks register even on
// thin segments at zoomed-out viewports.
const WALL_HALO_WIDTH_NORMAL   = 4
const WALL_HALO_WIDTH_SELECTED = 7
const WALL_HALO_WIDTH_HOVERED  = 10
const WALL_BODY_WIDTH_NORMAL   = 3
const WALL_BODY_WIDTH_SELECTED = 5
const WALL_BODY_WIDTH_HOVERED  = 6
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

function makeSegmentHitArea(ax, ay, bx, by, tolerance) {
  return {
    contains(x, y) {
      return pointToSegmentDistance(x, y, ax, ay, bx, by) <= tolerance
    },
  }
}

export function attachWallsLayer({ scene, useFloorStore, useWallStore }) {
  const layer = scene.layers.walls
  layer.eventMode = 'passive'

  const containers = new Map()
  // DOOR_WINDOW mode state — first click records (wallId, frac), the next
  // click on the SAME wall inserts an opening over [min, max]. Click on a
  // different wall resets to that wall. Esc / right-click clear via the
  // shared keyboard / context-menu paths (cleared on mode exit).
  const dw = { wallId: null, startFrac: null, openingKind: 'door' }

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
    const { graphics, container, wall } = entry
    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    const isSelected = editorState.selectedId === wall.id && editorState.selectedType === 'wall'
    const isHovered  = hoverState.id === wall.id && hoverState.type === 'wall'
    const haloWidth = isSelected ? WALL_HALO_WIDTH_SELECTED : WALL_HALO_WIDTH_NORMAL
    const bodyWidth = isSelected ? WALL_BODY_WIDTH_SELECTED : WALL_BODY_WIDTH_NORMAL
    const bodyColor = wall.material.color

    graphics.clear()

    // (1) Hover glow — wide white beam (22 px @ 0.45 alpha) behind the
    // body so the wall lights up under the cursor (oldSrc 23-3f convention).
    if (isHovered && !isSelected) {
      graphics
        .moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
        .stroke({ width: 22, color: '#ffffff', alpha: 0.45, cap: 'round' })
    }

    // (2) Black outline halo for contrast.
    graphics
      .moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
      .stroke({ width: haloWidth, color: '#000000', alpha: 0.4, cap: 'round' })

    // (3) Colored wall body.
    graphics
      .moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
      .stroke({ width: bodyWidth, color: bodyColor, alpha: 1, cap: 'round' })

    // (3) Openings overlay the wall body in their own material colour.
    const openings = wall.openings ?? []
    if (openings.length > 0) {
      const dx = wall.endX - wall.startX
      const dy = wall.endY - wall.startY
      for (const op of openings) {
        const sx = wall.startX + dx * op.startFrac
        const sy = wall.startY + dy * op.startFrac
        const ex = wall.startX + dx * op.endFrac
        const ey = wall.startY + dy * op.endFrac
        graphics
          .moveTo(sx, sy).lineTo(ex, ey)
          .stroke({ width: bodyWidth, color: op.material.color, alpha: 1, cap: 'butt' })
      }
    }

    // Hit area is kept in screen-space — see applyHitAreas below. drawWall
    // only touches it if the wall's geometry changed (the reference must
    // stay stable across hover / selection redraws or PIXI's event
    // boundary loses the click that's in progress).
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
      dlog('pointerdown wall=', entry.wall.id, 'button=', e.button, 'mode=', useEditorStore.getState().editorMode, 'target===container?', e.target === container)
      if (e.button === 2) {
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
      e.stopPropagation()
      const editor = useEditorStore.getState()
      if (editor.editorMode === EDITOR_MODE.DOOR_WINDOW) {
        handleDoorWindowClick(entry, e)
        return
      }
      // SELECT mode: select the wall and start a potential drag. If the
      // pointer doesn't move > DRAG_COMMIT_THRESHOLD_PX before release we
      // treat the gesture as a click (selection only); otherwise we commit
      // a translation of both endpoints by the same delta.
      dlog('  → setSelected', entry.wall.id)
      editor.setSelected(entry.wall.id, 'wall')
      if (editor.editorMode === EDITOR_MODE.SELECT) {
        beginDrag(entry, e)
      }
    })
    container.on('pointerover', () => useHoverStore.getState().setHover(entry.wall.id, 'wall'))
    container.on('pointerout',  () => useHoverStore.getState().clearHoverIf(entry.wall.id))
  }

  // Wall-body drag — translate both endpoints by the same delta. Uses the
  // dragOverlay store so the wall geometry isn't rewritten on every move
  // (cable routing + heatmap recompute happen only on dragend).
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
      dx = wp.x - startWorld.x
      dy = wp.y - startWorld.y
      // Live preview: temporarily shift the wall container so the line
      // moves with the cursor without committing to the store yet.
      entry.container.position.set(dx, dy)
    }
    const onUp = () => {
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
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
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  const handleDoorWindowClick = (entry, e) => {
    const { wall } = entry
    const local = scene.world.toLocal(e.global)
    const frac = projectToWallFrac(wall, local.x, local.y)
    if (frac < 0 || frac > 1) return
    if (dw.wallId !== wall.id) {
      dw.wallId = wall.id
      dw.startFrac = frac
      return
    }
    const f1 = Math.min(dw.startFrac, frac)
    const f2 = Math.max(dw.startFrac, frac)
    if (f2 - f1 > 0.01) {
      const existing = wall.openings ?? []
      const overlaps = existing.some((o) => f1 < o.endFrac && f2 > o.startFrac)
      if (!overlaps) {
        const ot = dw.openingKind === 'window' ? OPENING_TYPES.WINDOW : OPENING_TYPES.DOOR
        const defaultMat = getMaterialById(ot.defaultMaterial)
        useWallStore.getState().addOpening(entry.floorId, wall.id, {
          id: generateId('opening'),
          type: dw.openingKind,
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

  // Reset DOOR_WINDOW state when the user leaves the mode (Esc, mode pick,
  // selection in another layer). D / W keys still flip the openingKind
  // *while* in the mode — wired in a keydown listener below.
  const onKeyDown = (e) => {
    const tag = e.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (useEditorStore.getState().editorMode !== EDITOR_MODE.DOOR_WINDOW) return
    if (e.key === 'd' || e.key === 'D') dw.openingKind = 'door'
    else if (e.key === 'w' || e.key === 'W') dw.openingKind = 'window'
    else if (e.key === 'Escape') { dw.wallId = null; dw.startFrac = null }
  }
  window.addEventListener('keydown', onKeyDown)

  let lastEditorMode = useEditorStore.getState().editorMode
  const unsubEditor = useEditorStore.subscribe(() => {
    const mode = useEditorStore.getState().editorMode
    if (mode !== lastEditorMode) {
      lastEditorMode = mode
      if (mode !== EDITOR_MODE.DOOR_WINDOW) {
        dw.wallId = null
        dw.startFrac = null
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

  // Hover + selection redraws — repaint only the two walls that changed
  // state so the halo + body widths flip without rebuilding all containers.
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
  }

  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  const onSelectionChange = () => {
    const s = useEditorStore.getState()
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
      if (e) drawWall(e)
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
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

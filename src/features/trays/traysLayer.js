import { Container, Graphics } from 'pixi.js'
import { getTraySystem } from '@/store/useCableStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'

// Cable tray adapter — per-tray Container with magnet halo + channel
// body + custom polyline hitArea. Phase 17-1 channel visual: two
// parallel system-coloured border lines + dashed centreline + half-
// transparent body fill between borders.

const TRAY_CHANNEL_HALF_WIDTH = 3 // world-px from centreline to each border
const TRAY_BORDER_WIDTH = 1.2
const TRAY_CENTER_WIDTH = 0.8
const TRAY_CENTER_DASH = [3, 3]
const MAGNET_FILL = 'rgba(129, 140, 248, 0.12)' // indigo-400 @ 12% (oldSrc)
const TRAY_SELECTED_BORDER = '#ffffff'           // oldSrc TRAY_SELECTED_BORDER
const TRAY_SELECTED_BORDER_WIDTH = 9
const HIT_TOLERANCE_PX = 8
const DRAG_COMMIT_THRESHOLD_PX = 1

function drawPolylineStroke(g, points, opts) {
  if (!points || points.length < 2) return
  g.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
  g.stroke(opts)
}

// Per-segment perpendicular offset so we can draw two parallel border
// polylines and a body fill that follows the tray's bends. Each segment
// is drawn independently (corners not mitred — slight overlap at
// vertices is fine at the chosen widths).
function drawChannel(g, points, halfWidth, sysColor, fillColor) {
  if (!points || points.length < 2) return
  for (let i = 1; i < points.length; i++) {
    const ax = points[i - 1].x
    const ay = points[i - 1].y
    const bx = points[i].x
    const by = points[i].y
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len <= 1e-9) continue
    const nx = -dy / len
    const ny = dx / len
    const ox = nx * halfWidth
    const oy = ny * halfWidth

    // Body fill — quad between the two border lines.
    g.poly([
      ax + ox, ay + oy,
      bx + ox, by + oy,
      bx - ox, by - oy,
      ax - ox, ay - oy,
    ]).fill({ color: fillColor, alpha: 1 })

    // Two parallel borders.
    g.moveTo(ax + ox, ay + oy).lineTo(bx + ox, by + oy)
      .stroke({ width: TRAY_BORDER_WIDTH, color: sysColor, alpha: 1, cap: 'round' })
    g.moveTo(ax - ox, ay - oy).lineTo(bx - ox, by - oy)
      .stroke({ width: TRAY_BORDER_WIDTH, color: sysColor, alpha: 1, cap: 'round' })
  }
}

function drawDashedCenterline(g, points, dashOn, dashOff, width, color) {
  if (!points || points.length < 2) return
  let phaseOn = true
  let remain = dashOn
  let cx = points[0].x
  let cy = points[0].y
  for (let i = 1; i < points.length; i++) {
    const tx = points[i].x
    const ty = points[i].y
    const len = Math.hypot(tx - cx, ty - cy)
    if (len <= 1e-9) continue
    const ux = (tx - cx) / len
    const uy = (ty - cy) / len
    let cursor = 0
    while (cursor < len) {
      const step = Math.min(len - cursor, remain)
      const x1 = cx + ux * cursor
      const y1 = cy + uy * cursor
      const x2 = cx + ux * (cursor + step)
      const y2 = cy + uy * (cursor + step)
      if (phaseOn) {
        g.moveTo(x1, y1).lineTo(x2, y2)
          .stroke({ width, color, alpha: 1 })
      }
      cursor += step
      remain -= step
      if (remain <= 1e-9) {
        phaseOn = !phaseOn
        remain = phaseOn ? dashOn : dashOff
      }
    }
    cx = tx; cy = ty
  }
}


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

// Custom hitArea — accepts any (x, y) within HIT_TOLERANCE_PX of any
// segment of the polyline. PIXI v8 calls .contains(x, y) with the point
// already transformed into the Container's local space.
function makePolylineHitArea(points, tolerance) {
  return {
    contains(x, y) {
      if (!points || points.length < 2) return false
      for (let i = 1; i < points.length; i++) {
        const d = pointToSegmentDistance(x, y, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y)
        if (d <= tolerance) return true
      }
      return false
    },
  }
}

export function attachTraysLayer({ scene, useFloorStore, useCableStore }) {
  const layer = scene.layers.trays
  layer.eventMode = 'passive'

  const containers = new Map()

  const ensureContainer = (tray, floorId) => {
    let entry = containers.get(tray.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'pointer'
      const haloG = new Graphics()
      const bodyG = new Graphics()
      c.addChild(haloG)
      c.addChild(bodyG)
      layer.addChild(c)
      entry = { container: c, haloG, bodyG, tray, floorId }
      containers.set(tray.id, entry)
      bindInteractions(entry)
    } else {
      entry.tray = tray
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

  const drawTray = (entry) => {
    const { haloG, bodyG, container, tray } = entry
    const sys = getTraySystem(tray.system)
    const magnetPx = tray.magnetDistance ?? 100

    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    const isSelected = editorState.selectedId === tray.id && editorState.selectedType === 'cable_tray'
    const isHovered  = hoverState.id === tray.id && hoverState.type === 'cable_tray'
    const isInvert   = isHovered && !isSelected

    haloG.clear()
    bodyG.clear()

    drawPolylineStroke(haloG, tray.points, {
      width: magnetPx * 2,
      color: MAGNET_FILL,
      alpha: 1,
      cap: 'round',
      join: 'round',
    })

    // Selection border — rendered IN-LAYER (Bundle 7) so the white stroke
    // sits BELOW devicesSW (z-index 7b > trays 6 > overlays 8). When this
    // ran on the overlay layer it covered the SW chassis under the tray.
    if (isSelected) {
      drawPolylineStroke(haloG, tray.points, {
        width: TRAY_SELECTED_BORDER_WIDTH,
        color: TRAY_SELECTED_BORDER,
        alpha: 0.95,
        cap: 'round',
        join: 'round',
      })
    }

    // Channel — half-transparent body fill between two parallel borders
    // plus a dashed centreline in the system colour (Phase 17-1).
    //
    // Hover invert (oldSrc 23-3f): hovered + non-selected tray flips
    // the body fill → sys.color, border → sys.fill (lighter), and the
    // centreline goes white so the tray "lights up" without breaking
    // its colour identity.
    const channelColor = isInvert ? sys.fill : sys.color
    const channelFill  = isInvert ? sys.color : sys.fill
    drawChannel(bodyG, tray.points, TRAY_CHANNEL_HALF_WIDTH, channelColor, channelFill)
    const centerCol = isInvert ? '#ffffff' : sys.color
    drawDashedCenterline(bodyG, tray.points, TRAY_CENTER_DASH[0], TRAY_CENTER_DASH[1], TRAY_CENTER_WIDTH, centerCol)

    for (const p of tray.points) {
      bodyG.circle(p.x, p.y, 3).fill({ color: channelColor, alpha: 1 })
    }
    container.hitArea = makePolylineHitArea(tray.points, HIT_TOLERANCE_PX)
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (e.button === 2) {
        e.stopPropagation()
        useEditorStore.getState().openContextMenu({
          targetType: 'cable_tray',
          targetId: entry.tray.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.tray.id, 'cable_tray')
      beginDrag(entry, e)
    })
    container.on('pointerover', () => useHoverStore.getState().setHover(entry.tray.id, 'cable_tray'))
    container.on('pointerout', () => useHoverStore.getState().clearHoverIf(entry.tray.id))
  }

  const beginDrag = (entry, downEvent) => {
    const startWorld = scene.world.toLocal(downEvent.global)
    const stage = scene.app.stage

    const onMove = (e) => {
      const wp = scene.world.toLocal(e.global)
      const dx = wp.x - startWorld.x
      const dy = wp.y - startWorld.y
      useDragOverlayStore.getState().setTray({ id: entry.tray.id, dx, dy })
    }
    const onUp = () => {
      const overlay = useDragOverlayStore.getState().tray
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
      if (overlay && overlay.id === entry.tray.id) {
        const moved = Math.hypot(overlay.dx, overlay.dy)
        if (moved > DRAG_COMMIT_THRESHOLD_PX) {
          const nextPoints = entry.tray.points.map((p) => ({
            x: p.x + overlay.dx,
            y: p.y + overlay.dy,
          }))
          useCableStore.getState().updateTray(entry.floorId, entry.tray.id, {
            points: nextPoints,
          })
        }
      }
      useDragOverlayStore.getState().setTray(null)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  let lastFloorId = undefined
  let lastTrays = undefined

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const trays = useCableStore.getState().traysByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && trays === lastTrays) {
      applyDragOverlay()
      return
    }
    lastFloorId = activeFloorId
    lastTrays = trays
    const next = new Set(trays.map((t) => t.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    for (const tray of trays) {
      const entry = ensureContainer(tray, activeFloorId)
      drawTray(entry)
    }
    applyDragOverlay()
  }

  let lastDragId = null
  const applyDragOverlay = () => {
    const drag = useDragOverlayStore.getState().tray
    // Restore previous tray's container position when drag changes / clears.
    if (lastDragId && (!drag || drag.id !== lastDragId)) {
      const prev = containers.get(lastDragId)
      if (prev) prev.container.position.set(0, 0)
    }
    lastDragId = drag?.id ?? null
    if (drag) {
      const entry = containers.get(drag.id)
      if (entry) entry.container.position.set(drag.dx, drag.dy)
    }
  }

  // Hover invert + selection redraw — redraw only the affected tray(s).
  let lastHoverId = useHoverStore.getState().id
  const onHoverChange = () => {
    const s = useHoverStore.getState()
    if (s.id === lastHoverId) return
    const prevId = lastHoverId
    lastHoverId = s.id
    const prev = prevId ? containers.get(prevId) : null
    const next = s.id ? containers.get(s.id) : null
    if (prev) drawTray(prev)
    if (next && next !== prev) drawTray(next)
  }

  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  const onEditorChange = () => {
    const s = useEditorStore.getState()
    if (s.selectedId === lastSelectedId && s.selectedType === lastSelectedType) return
    const prevId = lastSelectedId
    const prevType = lastSelectedType
    lastSelectedId = s.selectedId
    lastSelectedType = s.selectedType
    if (prevType === 'cable_tray' && prevId) {
      const e = containers.get(prevId)
      if (e) drawTray(e)
    }
    if (s.selectedType === 'cable_tray' && s.selectedId) {
      const e = containers.get(s.selectedId)
      if (e) drawTray(e)
    }
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubCable = useCableStore.subscribe(reconcile)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  reconcile()

  return () => {
    unsubFloor()
    unsubCable()
    unsubDrag()
    unsubHover()
    unsubEditor()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

import { Container, Graphics } from 'pixi.js'
import { getTraySystem } from '@/store/useCableStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'

// Cable tray adapter — per-tray Container with magnet halo + polyline body
// + custom polyline hitArea. Click selects, drag moves the whole polyline
// (vertex edit / channel border style still defer to 31-8).

const TRAY_LINE_WIDTH = 5
const MAGNET_FILL = 'rgba(255, 255, 255, 0.06)'
const HIT_TOLERANCE_PX = 8 // world-space; clicks within this of any segment hit
const DRAG_COMMIT_THRESHOLD_PX = 1

function drawPolylineStroke(g, points, opts) {
  if (!points || points.length < 2) return
  g.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
  g.stroke(opts)
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
    haloG.clear()
    bodyG.clear()
    drawPolylineStroke(haloG, tray.points, {
      width: magnetPx * 2,
      color: MAGNET_FILL,
      alpha: 1,
      cap: 'round',
      join: 'round',
    })
    drawPolylineStroke(bodyG, tray.points, {
      width: TRAY_LINE_WIDTH,
      color: sys.color,
      alpha: 1,
      cap: 'round',
      join: 'round',
    })
    for (const p of tray.points) {
      bodyG.circle(p.x, p.y, 3).fill({ color: sys.color, alpha: 1 })
    }
    container.hitArea = makePolylineHitArea(tray.points, HIT_TOLERANCE_PX)
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.tray.id, 'cable_tray')
      beginDrag(entry, e)
    })
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

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubCable = useCableStore.subscribe(reconcile)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  reconcile()

  return () => {
    unsubFloor()
    unsubCable()
    unsubDrag()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

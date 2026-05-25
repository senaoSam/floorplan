import { Container, Graphics, Circle } from 'pixi.js'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'

// AP markers adapter — Graphics circle per AP, interactive (pointer cursor
// + click selects + drag moves). MVP fidelity: world-space radius (will
// look bigger when zoomed in); no sprite atlas batching yet.

const FREQ_COLOR = {
  2.4: '#f39c12',
  5:   '#4fc3f7',
  6:   '#a855f7',
}

const FALLBACK_COLOR = '#9aa3ad'
const colorForAP = (ap) => FREQ_COLOR[ap.frequency] ?? FALLBACK_COLOR

const AP_RADIUS = 9
const DRAG_COMMIT_THRESHOLD_PX = 1

export function attachAPsLayer({ scene, useFloorStore, useAPStore }) {
  const layer = scene.layers.devicesAP
  layer.eventMode = 'passive'

  // Container per AP keyed by id so we can update positions without
  // rebuilding the whole tree on drag.
  const containers = new Map()

  const ensureContainer = (ap, floorId) => {
    let entry = containers.get(ap.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'pointer'
      c.hitArea = new Circle(0, 0, AP_RADIUS + 4)
      const g = new Graphics()
      c.addChild(g)
      layer.addChild(c)
      entry = { container: c, graphics: g, ap, floorId }
      containers.set(ap.id, entry)
      bindInteractions(entry)
    } else {
      entry.ap = ap
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

  const drawAP = (entry, overrideX, overrideY) => {
    const { graphics, ap } = entry
    const x = overrideX ?? ap.x
    const y = overrideY ?? ap.y
    entry.container.position.set(x, y)
    graphics.clear()
    graphics
      .circle(0, 0, AP_RADIUS)
      .fill({ color: colorForAP(ap), alpha: 0.95 })
      .stroke({ width: 2, color: 0xffffff, alpha: 0.9 })
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.ap.id, 'ap')
      beginDrag(entry, e)
    })
  }

  const beginDrag = (entry, downEvent) => {
    const startWorld = scene.world.toLocal(downEvent.global)
    const startAPX = entry.ap.x
    const startAPY = entry.ap.y
    const stage = scene.app.stage

    const onMove = (e) => {
      const wp = scene.world.toLocal(e.global)
      const nextX = startAPX + (wp.x - startWorld.x)
      const nextY = startAPY + (wp.y - startWorld.y)
      useDragOverlayStore.getState().setAP({ id: entry.ap.id, x: nextX, y: nextY })
    }
    const onUp = () => {
      const overlay = useDragOverlayStore.getState().ap
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
      if (overlay && overlay.id === entry.ap.id) {
        const moved = Math.hypot(overlay.x - startAPX, overlay.y - startAPY)
        if (moved > DRAG_COMMIT_THRESHOLD_PX) {
          useAPStore.getState().updateAP(entry.floorId, entry.ap.id, {
            x: overlay.x,
            y: overlay.y,
          })
        }
      }
      useDragOverlayStore.getState().setAP(null)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  // ── Reconciler from stores ────────────────────────────────────────────
  let lastFloorId = undefined
  let lastAPs = undefined

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const aps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && aps === lastAPs) {
      applyDragOverlay()
      return
    }
    lastFloorId = activeFloorId
    lastAPs = aps

    const next = new Set(aps.map((a) => a.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    for (const ap of aps) {
      const entry = ensureContainer(ap, activeFloorId)
      drawAP(entry)
    }
    applyDragOverlay()
  }

  let lastDragId = null
  const applyDragOverlay = () => {
    const drag = useDragOverlayStore.getState().ap
    // When the dragged AP changes (or drag clears), restore the previous AP
    // to its store-committed position. Without this it would stay frozen at
    // the last overlay coordinates after the user releases.
    if (lastDragId && (!drag || drag.id !== lastDragId)) {
      const prev = containers.get(lastDragId)
      if (prev) drawAP(prev)
    }
    lastDragId = drag?.id ?? null
    if (drag) {
      const entry = containers.get(drag.id)
      if (entry) drawAP(entry, drag.x, drag.y)
    }
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubAP = useAPStore.subscribe(reconcile)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  reconcile()

  return () => {
    unsubFloor()
    unsubAP()
    unsubDrag()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

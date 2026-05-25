import { Container, Graphics, Rectangle } from 'pixi.js'
import { getSwitchKindColor } from '@/store/useCableStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'

// Switch chassis adapter — per-switch interactive Container with click
// select + body drag + drag overlay. MVP fidelity: no port row / label /
// hover halo. Full chassis decoration lands with the 31-7 spec rewrite.

const CHASSIS_HEIGHT = 14
const CHASSIS_WIDTH_BY_KIND = {
  switch: 26,
  idf:    32,
  mdf:    44,
  router: 30,
}
const DRAG_COMMIT_THRESHOLD_PX = 1

export function attachSwitchesLayer({ scene, useFloorStore, useCableStore }) {
  const layer = scene.layers.devicesSW
  layer.eventMode = 'passive'

  const containers = new Map()

  const ensureContainer = (sw, floorId) => {
    let entry = containers.get(sw.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'pointer'
      const g = new Graphics()
      c.addChild(g)
      layer.addChild(c)
      entry = { container: c, graphics: g, sw, floorId }
      containers.set(sw.id, entry)
      bindInteractions(entry)
    } else {
      entry.sw = sw
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

  const drawSwitch = (entry, overrideX, overrideY) => {
    const { graphics, container, sw } = entry
    const x = overrideX ?? sw.x
    const y = overrideY ?? sw.y
    container.position.set(x, y)
    const kind = sw.kind ?? 'switch'
    const w = CHASSIS_WIDTH_BY_KIND[kind] ?? CHASSIS_WIDTH_BY_KIND.switch
    const h = CHASSIS_HEIGHT
    const color = getSwitchKindColor(kind)
    container.hitArea = new Rectangle(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4)
    graphics.clear()
    graphics
      .rect(-w / 2, -h / 2, w, h)
      .fill({ color: 0x1f2937, alpha: 0.95 })
      .stroke({ width: 1.4, color, alpha: 1 })
    graphics.circle(-w / 2 + 3, -h / 2 + 3, 1.5).fill({ color, alpha: 1 })
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (e.button === 2) {
        e.stopPropagation()
        useEditorStore.getState().openContextMenu({
          targetType: 'switch',
          targetId: entry.sw.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.sw.id, 'switch')
      beginDrag(entry, e)
    })
    container.on('pointerover', () => useHoverStore.getState().setHover(entry.sw.id, 'switch'))
    container.on('pointerout', () => useHoverStore.getState().clearHoverIf(entry.sw.id))
  }

  const beginDrag = (entry, downEvent) => {
    const startWorld = scene.world.toLocal(downEvent.global)
    const startSWX = entry.sw.x
    const startSWY = entry.sw.y
    const stage = scene.app.stage

    const onMove = (e) => {
      const wp = scene.world.toLocal(e.global)
      const nextX = startSWX + (wp.x - startWorld.x)
      const nextY = startSWY + (wp.y - startWorld.y)
      useDragOverlayStore.getState().setSwitch({ id: entry.sw.id, x: nextX, y: nextY })
    }
    const onUp = () => {
      const overlay = useDragOverlayStore.getState().sw
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
      if (overlay && overlay.id === entry.sw.id) {
        const moved = Math.hypot(overlay.x - startSWX, overlay.y - startSWY)
        if (moved > DRAG_COMMIT_THRESHOLD_PX) {
          useCableStore.getState().updateSwitch(entry.floorId, entry.sw.id, {
            x: overlay.x,
            y: overlay.y,
          })
        }
      }
      useDragOverlayStore.getState().setSwitch(null)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  let lastFloorId = undefined
  let lastSwitches = undefined

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const switches = useCableStore.getState().switchesByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && switches === lastSwitches) {
      applyDragOverlay()
      return
    }
    lastFloorId = activeFloorId
    lastSwitches = switches
    const next = new Set(switches.map((s) => s.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    for (const sw of switches) {
      const entry = ensureContainer(sw, activeFloorId)
      drawSwitch(entry)
    }
    applyDragOverlay()
  }

  let lastDragId = null
  const applyDragOverlay = () => {
    const drag = useDragOverlayStore.getState().sw
    if (lastDragId && (!drag || drag.id !== lastDragId)) {
      const prev = containers.get(lastDragId)
      if (prev) drawSwitch(prev)
    }
    lastDragId = drag?.id ?? null
    if (drag) {
      const entry = containers.get(drag.id)
      if (entry) drawSwitch(entry, drag.x, drag.y)
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

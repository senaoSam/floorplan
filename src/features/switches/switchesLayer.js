import { Container, Graphics, Rectangle } from 'pixi.js'
import { getSwitchKindColor } from '@/store/useCableStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'

// Switch chassis adapter — per-switch interactive Container. Renders the
// dark chassis with kind-coloured border, an LED corner dot, a row of
// port pips along the bottom edge, and kind-specific decoration on the
// top edge (IDF: one bar; MDF: two bars; Router: a short antenna mast).

const CHASSIS_HEIGHT = 14
const CHASSIS_WIDTH_BY_KIND = {
  switch: 26,
  idf:    32,
  mdf:    44,
  router: 30,
}
const PORT_PIP_RADIUS = 0.85
const MAX_PORT_PIPS = 24
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

    // Per-kind visibility filter from useEditorStore.showSwitchKind.
    const showSwitchKind = useEditorStore.getState().showSwitchKind
    container.visible = !!(showSwitchKind?.[kind] ?? true)
    const w = CHASSIS_WIDTH_BY_KIND[kind] ?? CHASSIS_WIDTH_BY_KIND.switch
    const h = CHASSIS_HEIGHT
    const color = getSwitchKindColor(kind)
    container.hitArea = new Rectangle(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4)

    graphics.clear()

    // Kind-specific decoration above the chassis: IDF=1 bar, MDF=2 bars,
    // Router=a short antenna mast. Switch=nothing.
    if (kind === 'idf') {
      graphics.rect(-w / 2 + 3, -h / 2 - 3, w - 6, 1.5).fill({ color, alpha: 1 })
    } else if (kind === 'mdf') {
      graphics.rect(-w / 2 + 3, -h / 2 - 5, w - 6, 1.5).fill({ color, alpha: 1 })
      graphics.rect(-w / 2 + 3, -h / 2 - 2.5, w - 6, 1.5).fill({ color, alpha: 1 })
    } else if (kind === 'router') {
      graphics.moveTo(0, -h / 2).lineTo(0, -h / 2 - 5)
        .stroke({ width: 1.2, color, alpha: 1 })
      graphics.circle(0, -h / 2 - 5.5, 1.4).fill({ color, alpha: 1 })
    }

    // Chassis body.
    graphics
      .rect(-w / 2, -h / 2, w, h)
      .fill({ color: 0x1f2937, alpha: 0.95 })
      .stroke({ width: 1.4, color, alpha: 1 })

    // Status LED — top-left corner.
    graphics.circle(-w / 2 + 3, -h / 2 + 3, 1.5).fill({ color, alpha: 1 })

    // Port pip row along the bottom edge.
    const portCount = Math.min(sw.portCount ?? 8, MAX_PORT_PIPS)
    if (portCount > 0) {
      const inset = 3.5
      const rowY = h / 2 - 3
      const span = w - inset * 2
      const gap = portCount > 1 ? span / (portCount - 1) : 0
      const startX = -w / 2 + inset
      for (let i = 0; i < portCount; i++) {
        const px = portCount > 1 ? startX + gap * i : 0
        graphics.circle(px, rowY, PORT_PIP_RADIUS).fill({ color: 0xfacc15, alpha: 0.85 })
      }
    }
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

  // Re-draw all when showSwitchKind changes so kind-filter takes effect
  // without restructuring. Guarded by ref equality.
  let lastShowSwitchKind = useEditorStore.getState().showSwitchKind
  const redrawAll = () => {
    const next = useEditorStore.getState().showSwitchKind
    if (next === lastShowSwitchKind) return
    lastShowSwitchKind = next
    for (const entry of containers.values()) drawSwitch(entry)
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubCable = useCableStore.subscribe(reconcile)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  const unsubEditor = useEditorStore.subscribe(redrawAll)
  reconcile()

  return () => {
    unsubFloor()
    unsubCable()
    unsubDrag()
    unsubEditor()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

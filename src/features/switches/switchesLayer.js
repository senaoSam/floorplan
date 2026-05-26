import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js'
import { getSwitchKindColor } from '@/store/useCableStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'
import { getChassisSize, getKindLabel, getPortDotCount } from './switchChassis'

// Switch chassis adapter — per-switch interactive Container. Visual rules
// ported from oldSrc SwitchLayer.jsx (29-6):
//   * chassis size scales with portCount (widthMult) + isCore (+height)
//   * fill #1f2937 dark slate; stroke = kind colour (selected → red)
//   * status LED at top-left in kind colour
//   * port-pip row along the bottom edge in **kind colour** (not yellow)
//   * "SW" / "IDF" / "MDF" / "RTR" kind label centred inside the chassis
//   * decoration above chassis: IDF=1 bar, MDF=2 bars, Router=antenna mast
//   * hover invert: hovered+non-selected → chassis fill kind colour,
//     stroke dark, ports dark, label dark

const PORT_PIP_RADIUS = 1
const SELECT_STROKE = '#e74c3c'
const DRAG_COMMIT_THRESHOLD_PX = 1
const LABEL_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 9,
  fontWeight: '700',
  align: 'center',
})

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
      const label = new Text({ text: '', style: LABEL_STYLE })
      label.anchor.set(0.5, 0.5)
      label.eventMode = 'none'
      c.addChild(g)
      c.addChild(label)
      layer.addChild(c)
      entry = { container: c, graphics: g, label, sw, floorId }
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
    const { graphics, label, container, sw } = entry
    const x = overrideX ?? sw.x
    const y = overrideY ?? sw.y
    container.position.set(x, y)

    // Per-kind visibility filter from useEditorStore.showSwitchKind.
    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    const showSwitchKind = editorState.showSwitchKind
    const { w, h, kind, portCount } = getChassisSize(sw)
    container.visible = !!(showSwitchKind?.[kind] ?? true)
    const color = getSwitchKindColor(kind)
    container.hitArea = new Rectangle(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4)

    const isSelected = editorState.selectedId === sw.id && editorState.selectedType === 'switch'
    const isHovered  = hoverState.id === sw.id && hoverState.type === 'switch'
    const isInvert   = isHovered && !isSelected

    const chassisFill   = isInvert ? color : 0x1f2937
    const strokeCol     = isSelected ? SELECT_STROKE : (isInvert ? 0x1f2937 : color)
    const strokeWidth   = isSelected ? 2.5 : isHovered ? 2 : 1.4
    const portCol       = isInvert ? 0x1f2937 : color
    const labelCol      = isInvert ? '#1f2937' : '#ffffff'

    graphics.clear()

    // Kind-specific decoration above the chassis (oldSrc 29-6).
    if (kind === 'idf') {
      graphics.moveTo(-w / 4, -h / 2 - 3).lineTo(w / 4, -h / 2 - 3)
        .stroke({ width: 1.5, color: portCol, alpha: 1 })
    } else if (kind === 'mdf') {
      graphics.moveTo(-w / 3, -h / 2 - 3).lineTo(w / 3, -h / 2 - 3)
        .stroke({ width: 1.5, color: portCol, alpha: 1 })
      graphics.moveTo(-w / 4, -h / 2 - 6).lineTo(w / 4, -h / 2 - 6)
        .stroke({ width: 1.5, color: portCol, alpha: 1 })
    } else if (kind === 'router') {
      graphics.moveTo(0, -h / 2 - 3).lineTo(0, -h / 2 - 9)
        .stroke({ width: 1.4, color: portCol, alpha: 1 })
      graphics.circle(0, -h / 2 - 10, 1.6).fill({ color: portCol, alpha: 1 })
      graphics.moveTo(-3, -h / 2 - 7).lineTo(-5, -h / 2 - 5)
        .stroke({ width: 1, color: portCol, alpha: 1 })
      graphics.moveTo(3, -h / 2 - 7).lineTo(5, -h / 2 - 5)
        .stroke({ width: 1, color: portCol, alpha: 1 })
    }

    // Chassis body.
    graphics
      .rect(-w / 2, -h / 2, w, h)
      .fill({ color: chassisFill, alpha: 0.95 })
      .stroke({ width: strokeWidth, color: strokeCol, alpha: 1 })

    // Status LED — top-left corner in kind colour.
    graphics.circle(-w / 2 + 3, -h / 2 + 3, 1.5).fill({ color, alpha: 1 })

    // Port-pip row along the bottom edge — dot count proxies real port
    // density (12 → 6 dots, 24 → 8 dots, 48 → 12 dots, ≤8 → 4 dots).
    const dotCount = getPortDotCount(portCount)
    if (dotCount > 0) {
      const inset = 3
      const span = w - inset * 2
      const step = span / dotCount
      const rowY = h / 2 - 3
      for (let i = 0; i < dotCount; i++) {
        const px = -w / 2 + inset + step * (i + 0.5)
        graphics.circle(px, rowY, PORT_PIP_RADIUS).fill({ color: portCol, alpha: 0.9 })
      }
    }

    // Kind label centred inside the chassis.
    label.text = getKindLabel(kind)
    label.style.fill = labelCol
    label.position.set(0, 0)
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

  // Re-draw on showSwitchKind / selection / hover change. Guarded by ref
  // equality so unrelated store mutations don't trigger a full redraw.
  let lastShowSwitchKind = useEditorStore.getState().showSwitchKind
  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  const onEditorChange = () => {
    const s = useEditorStore.getState()
    if (
      s.showSwitchKind === lastShowSwitchKind &&
      s.selectedId === lastSelectedId &&
      s.selectedType === lastSelectedType
    ) return
    lastShowSwitchKind = s.showSwitchKind
    lastSelectedId = s.selectedId
    lastSelectedType = s.selectedType
    for (const entry of containers.values()) drawSwitch(entry)
  }

  let lastHoverId = useHoverStore.getState().id
  const onHoverChange = () => {
    const s = useHoverStore.getState()
    if (s.id === lastHoverId) return
    const prevId = lastHoverId
    lastHoverId = s.id
    const prev = prevId ? containers.get(prevId) : null
    const next = s.id ? containers.get(s.id) : null
    if (prev) drawSwitch(prev)
    if (next && next !== prev) drawSwitch(next)
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubCable = useCableStore.subscribe(reconcile)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  reconcile()

  return () => {
    unsubFloor()
    unsubCable()
    unsubDrag()
    unsubEditor()
    unsubHover()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

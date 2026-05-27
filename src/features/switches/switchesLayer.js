import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js'
import { getSwitchKindColor } from '@/store/useCableStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useViewportStore } from '@/store/useViewportStore'
import { computeSwitchSnaps } from '@/features/cable/switchSnapStatus'
import { computeFocusedDevices, FOCUS_HALO_COLOR, FOCUS_HALO_ALPHA, FOCUS_HALO_WIDTH } from '@/features/focus/focusedDevices'
import { getChassisSize, getKindLabel, getPortDotCount } from './switchChassis'

// Switch chassis adapter — per-switch interactive Container. Visual rules
// ported 1:1 from oldSrc SwitchLayer.jsx (29-6 + 17-2 + 17-4):
//   * chassis size scales with portCount (widthMult) + isCore (+height)
//   * roundRect chassis (cornerRadius 3) — fill #1f2937 dark slate;
//     stroke = kind colour (selected → red, hover invert → dark)
//   * port-pip row (square dots) along the bottom edge in kind colour
//   * PoE badge: thin yellow line at top-left when poeBudget > 0
//   * "SW" / "IDF" / "MDF" / "RTR" kind label across the top of the chassis
//   * decoration above chassis: IDF=1 bar, MDF=2 bars, Router=antenna mast
//   * hover invert: hovered+non-selected → kind-colour chassis + dark stroke
//   * 17-2 focus halo: indigo roundRect ring (cornerRadius 5) around chassis
//   * 17-4 snap status: green top-right dot + dashed cyan foot-drops when
//     within tray magnet; gray dot + red "!" warning otherwise
//   * Name label sits ABOVE the chassis (oldSrc offsetY = h/2 + 14)

const PORT_DOT_SIZE = 2
const SELECT_STROKE = '#e74c3c'
const POE_BADGE_COLOR = '#facc15'
const STATUS_SNAPPED_COLOR = '#22c55e'
const STATUS_LOOSE_COLOR   = '#9ca3af'
const STATUS_WARNING_COLOR = '#ef4444'
const SNAP_FOOT_COLOR      = 'rgba(34, 211, 238, 0.55)'
const DRAG_COMMIT_THRESHOLD_PX = 1
const LABEL_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 9,
  fontWeight: '700',
  align: 'center',
})
const NAME_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  align: 'center',
  dropShadow: {
    color: '#000000',
    blur: 4,
    distance: 0,
    alpha: 0.9,
  },
})
const WARNING_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 7,
  fontWeight: '700',
  align: 'center',
})

export function attachSwitchesLayer({
  scene,
  useFloorStore,
  useCableStore,
  useAPStore,
}) {
  const layer = scene.layers.devicesSW
  layer.eventMode = 'passive'

  const containers = new Map()
  let focusedSwitchIds = new Set()
  let snapBySwitch = new Map()

  const ensureContainer = (sw, floorId) => {
    let entry = containers.get(sw.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'grab'
      const g = new Graphics()
      // Force PIXI to use the container hitArea (not Graphics's
      // per-pixel containsPoint). Same fix as wallsLayer / apsLayer —
      // otherwise clicks near the chassis but not exactly on a rendered
      // pixel fall through to the stage.
      g.eventMode = 'none'
      // Kind label centred horizontally near the top of the chassis
      // (oldSrc: y=-h/2+3*s with width=w, align center).
      const label = new Text({ text: '', style: LABEL_STYLE })
      label.anchor.set(0.5, 0)
      label.eventMode = 'none'
      // Name label sits ABOVE the chassis (oldSrc offsetY = h/2 + 14*s).
      // anchor(0.5, 1) + y = -(h/2 + 14) makes bottom of text sit 14 px
      // above the chassis top.
      const nameLabel = new Text({ text: '', style: NAME_STYLE })
      nameLabel.anchor.set(0.5, 1)
      nameLabel.eventMode = 'none'
      const warning = new Text({ text: '!', style: WARNING_STYLE })
      warning.anchor.set(0.5, 0.5)
      warning.eventMode = 'none'
      warning.visible = false
      c.addChild(g)
      c.addChild(label)
      c.addChild(nameLabel)
      c.addChild(warning)
      layer.addChild(c)
      entry = { container: c, graphics: g, label, nameLabel, warning, sw, floorId }
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
    const { graphics, label, nameLabel, warning, container, sw } = entry
    const x = overrideX ?? sw.x
    const y = overrideY ?? sw.y
    container.position.set(x, y)

    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    const showSwitchKind = editorState.showSwitchKind
    const { w, h, kind, portCount } = getChassisSize(sw)
    container.visible = !!(showSwitchKind?.[kind] ?? true)
    const color = getSwitchKindColor(kind)
    container.hitArea = new Rectangle(-w / 2 - 6, -h / 2 - 10, w + 12, h + 16)

    const isSelected = editorState.selectedId === sw.id && editorState.selectedType === 'switch'
    const isHovered  = hoverState.id === sw.id && hoverState.type === 'switch'
    const isFocused  = focusedSwitchIds.has(sw.id) && !isSelected
    const isInvert   = isHovered && !isSelected

    const chassisFill   = isInvert ? color : 0x1f2937
    const strokeCol     = isSelected ? SELECT_STROKE : (isInvert ? 0x1f2937 : color)
    const strokeWidth   = isSelected ? 2.5 : isHovered ? 2 : 1.5
    const portCol       = isInvert ? 0x1f2937 : color
    const labelCol      = isInvert ? '#1f2937' : '#ffffff'
    const snap = snapBySwitch.get(sw.id) ?? { snapped: false, drops: [] }

    graphics.clear()

    // 17-4 snap foot-drops — dashed lines from chassis to every tray foot
    // within magnet range. Drawn first so the chassis covers the entry point.
    if (snap.drops && snap.drops.length > 0) {
      for (const d of snap.drops) {
        const dx = d.footXy.x - sw.x
        const dy = d.footXy.y - sw.y
        drawDashedLine(graphics, 0, 0, dx, dy, SNAP_FOOT_COLOR, 1.1, 5, 4)
      }
    }

    // 17-2 focus halo — indigo rounded-rect ring behind the chassis.
    // oldSrc cornerRadius = 5 * s.
    if (isFocused) {
      graphics
        .roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 5)
        .stroke({ width: FOCUS_HALO_WIDTH, color: FOCUS_HALO_COLOR, alpha: FOCUS_HALO_ALPHA })
    }

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

    // Chassis body — roundRect, cornerRadius 3 (oldSrc 3*s).
    graphics
      .roundRect(-w / 2, -h / 2, w, h, 3)
      .fill({ color: chassisFill, alpha: 1 })
      .stroke({ width: strokeWidth, color: strokeCol, alpha: 1 })

    // Port-pip row along the bottom edge in kind colour.
    // oldSrc: square dots (Rect 2*s × 2*s) at y=h/2-4*s, step=(w-6*s)/dotCount,
    // x = -w/2 + 3*s + i*step.
    const dotCount = getPortDotCount(portCount)
    if (dotCount > 0) {
      const span = w - 6
      const step = span / dotCount
      const rowY = h / 2 - 4
      for (let i = 0; i < dotCount; i++) {
        const px = -w / 2 + 3 + i * step
        graphics
          .rect(px, rowY, PORT_DOT_SIZE, PORT_DOT_SIZE)
          .fill({ color: portCol, alpha: 1 })
      }
    }

    // PoE badge — yellow line at chassis top-left when poeBudget > 0.
    // oldSrc: from (-w/2+3, -h/2+4) to (-w/2+7, -h/2+4), width 1.5*s.
    if ((sw.poeBudget ?? 0) > 0) {
      graphics
        .moveTo(-w / 2 + 3, -h / 2 + 4)
        .lineTo(-w / 2 + 7, -h / 2 + 4)
        .stroke({ width: 1.5, color: POE_BADGE_COLOR, alpha: 1 })
    }

    // 17-4 snap-status dot — top-right corner.
    // oldSrc: radius 2.8 * s.
    const statusCol = snap.snapped ? STATUS_SNAPPED_COLOR : STATUS_LOOSE_COLOR
    graphics
      .circle(w / 2 - 2, -h / 2 + 2, 2.8)
      .fill({ color: statusCol, alpha: 1 })
      .stroke({ width: 0.8, color: 0x0b0d12, alpha: 1 })

    // 17-4 unconnected warning — red "!" at bottom-right when no snap target.
    // oldSrc: Circle radius 5 * s + white stroke 0.8, Text "!" fontSize 7 * s.
    if (!snap.snapped) {
      graphics
        .circle(w / 2 + 1, h / 2 - 1, 5)
        .fill({ color: STATUS_WARNING_COLOR, alpha: 1 })
        .stroke({ width: 0.8, color: 0xffffff, alpha: 1 })
      warning.visible = true
      warning.position.set(w / 2 + 1, h / 2 - 1)
    } else {
      warning.visible = false
    }

    // Kind label — top of chassis, horizontally centred (oldSrc
    // x=-w/2, y=-h/2+3*s, width=w align center → text top at -h/2+3*s).
    label.text = getKindLabel(kind)
    label.style.fill = labelCol
    label.position.set(0, -h / 2 + 3)

    // Name label sits ABOVE the chassis (oldSrc offsetY = h/2 + 14*s).
    // anchor(0.5, 1) + y = -(h/2 + 14) → text bottom 14 px above chassis top.
    nameLabel.text = sw.name ?? ''
    nameLabel.position.set(0, -(h / 2 + 14))
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (typeof window !== 'undefined' && window.__debugRMB === true) {
        console.log('[RMB switch] pointerdown id=', entry.sw.id, 'btn=', e.button)
      }
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
      // Select + drag only in SELECT mode — see apsLayer for rationale.
      if (useEditorStore.getState().editorMode !== 'select') return
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

  // ── Reconcile + focus / snap recompute ─────────────────────────────────
  let lastFloorId = undefined
  let lastSwitches = undefined
  let lastTrays = undefined

  const recomputeSnap = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const switches = useCableStore.getState().switchesByFloor[activeFloorId] ?? []
    const trays = useCableStore.getState().traysByFloor[activeFloorId] ?? []
    snapBySwitch = computeSwitchSnaps(switches, trays)
  }

  const recomputeFocus = () => {
    const e = useEditorStore.getState()
    const next = computeFocusedDevices({
      selectedId: e.selectedId,
      selectedType: e.selectedType,
      floors: useFloorStore.getState().floors,
      apsByFloor: useAPStore.getState().apsByFloor,
      switchesByFloor: useCableStore.getState().switchesByFloor,
      traysByFloor: useCableStore.getState().traysByFloor,
      risers: useCableStore.getState().risers,
    }).switches
    let changed = next.size !== focusedSwitchIds.size
    if (!changed) {
      for (const id of next) if (!focusedSwitchIds.has(id)) { changed = true; break }
    }
    if (!changed) return false
    focusedSwitchIds = next
    return true
  }

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const switches = useCableStore.getState().switchesByFloor[activeFloorId] ?? []
    const trays = useCableStore.getState().traysByFloor[activeFloorId] ?? []
    const structChanged = activeFloorId !== lastFloorId || switches !== lastSwitches || trays !== lastTrays
    if (!structChanged) {
      applyDragOverlay()
      return
    }
    lastFloorId = activeFloorId
    lastSwitches = switches
    lastTrays = trays
    recomputeSnap()
    recomputeFocus()
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

  // Re-draw on showSwitchKind / selection change.
  let lastShowSwitchKind = useEditorStore.getState().showSwitchKind
  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  const onEditorChange = () => {
    const s = useEditorStore.getState()
    const filterChanged = s.showSwitchKind !== lastShowSwitchKind
    const selectionChanged = s.selectedId !== lastSelectedId || s.selectedType !== lastSelectedType
    if (!filterChanged && !selectionChanged) return
    lastShowSwitchKind = s.showSwitchKind
    lastSelectedId = s.selectedId
    lastSelectedType = s.selectedType
    if (selectionChanged) recomputeFocus()
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

  // Screen-space chassis sizing — same trick as apsLayer. The chassis
  // geometry is defined in world units (e.g. 30 px wide for a 24-port
  // switch); container.scale flips it to constant on-screen size so the
  // chassis doesn't shrink to nothing when zoomed out across a floor plan.
  const applyInverseScale = () => {
    const vp = useViewportStore.getState()
    const inv = 1 / (vp.scale || 1)
    for (const entry of containers.values()) {
      entry.container.scale.set(inv)
    }
  }

  const unsubFloor = useFloorStore.subscribe(() => { reconcile(); applyInverseScale() })
  const unsubCable = useCableStore.subscribe(() => { reconcile(); applyInverseScale() })
  const unsubAP = useAPStore.subscribe(() => {
    // AP changes don't affect chassis geometry but do affect focus set
    // (which APs route through this switch).
    if (recomputeFocus()) {
      for (const entry of containers.values()) drawSwitch(entry)
    }
  })
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  const unsubViewport = useViewportStore.subscribe(applyInverseScale)
  reconcile()
  applyInverseScale()

  return () => {
    unsubFloor()
    unsubCable()
    unsubAP()
    unsubDrag()
    unsubEditor()
    unsubHover()
    unsubViewport()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

function drawDashedLine(g, ax, ay, bx, by, color, width, dashOn, dashOff) {
  const len = Math.hypot(bx - ax, by - ay)
  if (len <= 1e-9) return
  const ux = (bx - ax) / len
  const uy = (by - ay) / len
  let cursor = 0
  let phaseOn = true
  let remain = dashOn
  while (cursor < len) {
    const step = Math.min(len - cursor, remain)
    const x1 = ax + ux * cursor
    const y1 = ay + uy * cursor
    const x2 = ax + ux * (cursor + step)
    const y2 = ay + uy * (cursor + step)
    if (phaseOn) g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width, color, alpha: 1 })
    cursor += step
    remain -= step
    if (remain <= 1e-9) {
      phaseOn = !phaseOn
      remain = phaseOn ? dashOn : dashOff
    }
  }
}

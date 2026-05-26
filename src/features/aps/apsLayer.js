import { Container, Graphics, Circle, Text, TextStyle } from 'pixi.js'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'
import { computeFocusedDevices, FOCUS_HALO_COLOR, FOCUS_HALO_ALPHA, FOCUS_HALO_WIDTH } from '@/features/focus/focusedDevices'

// AP markers adapter — per-AP interactive Container with click select,
// drag, hover, right-click context menu, frequency-colored marker, and
// name label underneath. Per-band visibility (showAPBand) + master
// showAPs handled by the layer's container.visible (master) + per-AP
// container.visible (band filter).
//
// 17-2 focus halo: when a Switch is selected, every AP routing through it
// gets an indigo `#818cf8` ring drawn behind the marker so the wireless-
// side of the connection is visible at a glance.

const FREQ_COLOR = {
  2.4: '#f39c12',
  5:   '#4fc3f7',
  6:   '#a855f7',
}
const FREQ_LABEL = {
  2.4: '2.4G',
  5:   '5G',
  6:   '6G',
}

const FALLBACK_COLOR = '#9aa3ad'
const colorForAP = (ap) => FREQ_COLOR[ap.frequency] ?? FALLBACK_COLOR
const bandLabelForAP = (ap) => FREQ_LABEL[ap.frequency] ?? ''

const AP_RADIUS = 9
const FOCUS_RING_RADIUS = AP_RADIUS + 4
const DIR_INNER_R = AP_RADIUS + 2
const DIR_OUTER_R = AP_RADIUS + 18
const DRAG_COMMIT_THRESHOLD_PX = 1
const NAME_TEXT_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  align: 'center',
  stroke: { color: '#0b0d12', width: 3, join: 'round' },
})
const BAND_TEXT_STYLE = new TextStyle({
  fill: '#0b0d12',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 8,
  fontWeight: '700',
  align: 'center',
})
const INFO_TEXT_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 9,
  align: 'center',
  lineHeight: 11,
  stroke: { color: '#0b0d12', width: 3, join: 'round' },
})
const FREQ_LABEL_LONG = { 2.4: '2.4G', 5: '5G', 6: '6G' }

export function attachAPsLayer({
  scene,
  useFloorStore,
  useAPStore,
  useCableStore,
}) {
  const layer = scene.layers.devicesAP
  layer.eventMode = 'passive'

  // Container per AP keyed by id so we can update positions without
  // rebuilding the whole tree on drag.
  const containers = new Map()
  // Cached focus set — recomputed only when selection / store data changes.
  let focusedAPIds = new Set()

  const ensureContainer = (ap, floorId) => {
    let entry = containers.get(ap.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'pointer'
      c.hitArea = new Circle(0, 0, AP_RADIUS + 4)
      const g = new Graphics()
      const bandText = new Text({ text: '', style: BAND_TEXT_STYLE })
      bandText.anchor.set(0.5)
      bandText.eventMode = 'none'
      const nameText = new Text({ text: '', style: NAME_TEXT_STYLE })
      nameText.anchor.set(0.5, 0)
      nameText.y = AP_RADIUS + 5
      nameText.eventMode = 'none'
      const infoText = new Text({ text: '', style: INFO_TEXT_STYLE })
      infoText.anchor.set(0.5, 0)
      infoText.y = AP_RADIUS + 18
      infoText.eventMode = 'none'
      infoText.visible = false
      c.addChild(g)
      c.addChild(bandText)
      c.addChild(nameText)
      c.addChild(infoText)
      layer.addChild(c)
      entry = { container: c, graphics: g, bandText, nameText, infoText, ap, floorId }
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
    const { graphics, bandText, nameText, infoText, ap } = entry
    const x = overrideX ?? ap.x
    const y = overrideY ?? ap.y
    entry.container.position.set(x, y)

    graphics.clear()

    // 17-2 focus halo — drawn first so the AP marker sits on top of it.
    if (focusedAPIds.has(ap.id)) {
      graphics.circle(0, 0, FOCUS_RING_RADIUS)
        .stroke({ width: FOCUS_HALO_WIDTH, color: FOCUS_HALO_COLOR, alpha: FOCUS_HALO_ALPHA })
    }

    // Directional APs show an annular wedge in their broadcast direction
    // (inner radius DIR_INNER_R, outer DIR_OUTER_R) so the AP marker stays
    // legible inside the wedge. Omni / custom skipped — omni doesn't need a
    // direction hint and custom patterns need a per-pattern preview.
    if (ap.antennaMode === 'directional') {
      const az = ((ap.azimuth ?? 0) - 90) * Math.PI / 180
      const half = ((ap.beamwidth ?? 60) / 2) * Math.PI / 180
      const color = colorForAP(ap)
      const a0 = az - half
      const a1 = az + half
      graphics
        .moveTo(Math.cos(a0) * DIR_INNER_R, Math.sin(a0) * DIR_INNER_R)
        .arc(0, 0, DIR_INNER_R, a0, a1, false)
        .arc(0, 0, DIR_OUTER_R, a1, a0, true)
        .closePath()
        .fill({ color, alpha: 0.18 })
        .stroke({ width: 1, color, alpha: 0.5 })
    }

    // Marker.
    graphics
      .circle(0, 0, AP_RADIUS)
      .fill({ color: colorForAP(ap), alpha: 0.95 })
      .stroke({ width: 2, color: 0xffffff, alpha: 0.9 })

    bandText.text = bandLabelForAP(ap)
    nameText.text = ap.name ?? ''

    // Info pill — frequency band + channel/width + tx power. Visible
    // only when showAPInfo is enabled.
    const editorState = useEditorStore.getState()
    const freqLabel = FREQ_LABEL_LONG[ap.frequency] ?? `${ap.frequency}G`
    infoText.text = `${freqLabel} CH${ap.channel ?? '—'}/${ap.channelWidth ?? 20}\n${ap.txPower ?? '—'} dBm`
    infoText.visible = !!editorState.showAPInfo

    // Per-band visibility filter.
    entry.container.visible = !!(editorState.showAPBand?.[ap.frequency] ?? true)
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (e.button === 2) {
        e.stopPropagation()
        useEditorStore.getState().openContextMenu({
          targetType: 'ap',
          targetId: entry.ap.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.ap.id, 'ap')
      beginDrag(entry, e)
    })
    container.on('pointerover', () => useHoverStore.getState().setHover(entry.ap.id, 'ap'))
    container.on('pointerout', () => useHoverStore.getState().clearHoverIf(entry.ap.id))
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

  // ── Focus tracking (17-2) — recompute focused-AP set on selection /
  // routing-input change. Affected APs get a redraw to add/remove the halo.
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
    }).aps
    // Diff old vs new — redraw only what changed.
    let changed = next.size !== focusedAPIds.size
    if (!changed) {
      for (const id of next) if (!focusedAPIds.has(id)) { changed = true; break }
    }
    if (!changed) return
    const prev = focusedAPIds
    focusedAPIds = next
    for (const id of new Set([...prev, ...next])) {
      const entry = containers.get(id)
      if (entry) drawAP(entry)
    }
  }

  // Re-draw all when showAPBand or showAPInfo changes. Tracked by ref so
  // unrelated editor-store changes (selection / mode / hover) don't pay
  // the full redraw cost on every set.
  let lastShowAPBand = useEditorStore.getState().showAPBand
  let lastShowAPInfo = useEditorStore.getState().showAPInfo
  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  const onEditorChange = () => {
    const s = useEditorStore.getState()
    if (s.showAPBand !== lastShowAPBand || s.showAPInfo !== lastShowAPInfo) {
      lastShowAPBand = s.showAPBand
      lastShowAPInfo = s.showAPInfo
      for (const entry of containers.values()) {
        const drag = useDragOverlayStore.getState().ap
        if (drag && drag.id === entry.ap.id) {
          drawAP(entry, drag.x, drag.y)
        } else {
          drawAP(entry)
        }
      }
    }
    if (s.selectedId !== lastSelectedId || s.selectedType !== lastSelectedType) {
      lastSelectedId = s.selectedId
      lastSelectedType = s.selectedType
      recomputeFocus()
    }
  }

  const unsubFloor = useFloorStore.subscribe(() => { reconcile(); recomputeFocus() })
  const unsubAP = useAPStore.subscribe(() => { reconcile(); recomputeFocus() })
  const unsubCable = useCableStore.subscribe(recomputeFocus)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  reconcile()
  recomputeFocus()

  return () => {
    unsubFloor()
    unsubAP()
    unsubCable()
    unsubDrag()
    unsubEditor()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

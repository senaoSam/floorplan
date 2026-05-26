import { Container, Graphics, Circle, Text, TextStyle } from 'pixi.js'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useViewportStore } from '@/store/useViewportStore'
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

const AP_RADIUS = 10
const FOCUS_RING_RADIUS = AP_RADIUS + 1
const DIR_INNER_R = 17
const DIR_OUTER_R = 36
const SELECT_STROKE = '#e74c3c'
const BODY_STROKE_NORMAL = '#1e3a8a'
const BODY_FILL_NORMAL   = '#ffffff'
const DRAG_COMMIT_THRESHOLD_PX = 1

const NAME_TEXT_STYLE = new TextStyle({
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
const INFO_TEXT_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  align: 'center',
  lineHeight: 14,
})
const FREQ_LABEL_LONG = { 2.4: '2.4G', 5: '5G', 6: '6G' }
const INFO_PILL_W = 90
const INFO_PILL_H = 44
const INFO_PILL_BG = 'rgba(0, 0, 0, 0.75)'

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
      c.cursor = 'grab'
      c.hitArea = new Circle(0, 0, AP_RADIUS + 4)
      const g = new Graphics()
      // Force PIXI to use the container hitArea (not Graphics's
      // per-pixel containsPoint) so clicking the AP body works at any
      // zoom level. See wallsLayer for the full explanation.
      g.eventMode = 'none'
      const nameText = new Text({ text: '', style: NAME_TEXT_STYLE })
      nameText.anchor.set(0.5, 0)
      nameText.y = AP_RADIUS + 4
      nameText.eventMode = 'none'
      const infoBg = new Graphics()
      infoBg.eventMode = 'none'
      infoBg.visible = false
      const infoText = new Text({ text: '', style: INFO_TEXT_STYLE })
      infoText.anchor.set(0.5, 0)
      infoText.y = AP_RADIUS + 22
      infoText.eventMode = 'none'
      infoText.visible = false
      c.addChild(g)
      c.addChild(infoBg)
      c.addChild(nameText)
      c.addChild(infoText)
      layer.addChild(c)
      entry = { container: c, graphics: g, infoBg, nameText, infoText, ap, floorId }
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
    const { graphics, infoBg, nameText, infoText, ap } = entry
    const x = overrideX ?? ap.x
    const y = overrideY ?? ap.y
    entry.container.position.set(x, y)

    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    const isSelected = editorState.selectedId === ap.id && editorState.selectedType === 'ap'
    const isHovered  = hoverState.id === ap.id && hoverState.type === 'ap'
    const isFocused  = focusedAPIds.has(ap.id) && !isSelected
    const isInvert   = isHovered && !isSelected
    const freqColor  = colorForAP(ap)

    graphics.clear()

    // 17-2 focus halo — drawn first so the marker sits on top of it.
    if (isFocused) {
      graphics.circle(0, 0, FOCUS_RING_RADIUS)
        .stroke({ width: FOCUS_HALO_WIDTH, color: FOCUS_HALO_COLOR, alpha: FOCUS_HALO_ALPHA })
    }

    // Directional APs show an annular wedge in their broadcast direction.
    if (ap.antennaMode === 'directional') {
      const az = ((ap.azimuth ?? 0) - 90) * Math.PI / 180
      const half = ((ap.beamwidth ?? 60) / 2) * Math.PI / 180
      const a0 = az - half
      const a1 = az + half
      const fanAlpha = isSelected ? 0.35 : (isHovered ? 0.28 : 0.18)
      graphics
        .moveTo(Math.cos(a0) * DIR_INNER_R, Math.sin(a0) * DIR_INNER_R)
        .arc(0, 0, DIR_INNER_R, a0, a1, false)
        .arc(0, 0, DIR_OUTER_R, a1, a0, true)
        .closePath()
        .fill({ color: freqColor, alpha: fanAlpha })
      if (isSelected) {
        // Dashed outer rim for selection emphasis (rough approximation —
        // PIXI v8 Graphics has no native dash, so we use a thin solid
        // ring instead; the colour is still freq-specific so it reads
        // as "this AP's beam".)
        graphics
          .arc(0, 0, DIR_OUTER_R, a0, a1, false)
          .stroke({ width: 1, color: freqColor, alpha: 0.9 })
      }
    }

    // Orientation axis line for directional / custom.
    if (ap.antennaMode === 'directional' || ap.antennaMode === 'custom') {
      const axRad = ((ap.azimuth ?? 0) - 90) * Math.PI / 180
      const axLen = 32
      graphics
        .moveTo(0, 0)
        .lineTo(Math.cos(axRad) * axLen, Math.sin(axRad) * axLen)
        .stroke({
          width: isSelected ? 2 : 1.2,
          color: isSelected ? SELECT_STROKE : freqColor,
          alpha: 0.85,
        })
    }

    // Marker body — oldSrc convention: white fill / dark-blue stroke;
    // hovered + non-selected inverts to dark fill / white stroke;
    // selected → red stroke.
    const bodyFill   = isInvert ? BODY_STROKE_NORMAL : BODY_FILL_NORMAL
    const bodyStroke = isSelected ? SELECT_STROKE : (isInvert ? BODY_FILL_NORMAL : BODY_STROKE_NORMAL)
    const bodyWidth  = isSelected ? 3 : (isHovered ? 2.5 : 2)
    graphics
      .circle(0, 0, AP_RADIUS)
      .fill({ color: bodyFill, alpha: 1 })
      .stroke({ width: bodyWidth, color: bodyStroke, alpha: 1 })

    nameText.text = ap.name ?? ''

    // Info pill — dark rounded rect bg + 3-line text including name +
    // freq/channel/width + tx power. Visible only when showAPInfo is on.
    const freqLabel = FREQ_LABEL_LONG[ap.frequency] ?? `${ap.frequency}G`
    infoText.text = `${ap.name ?? ''}\n${freqLabel} CH${ap.channel ?? '—'}/${ap.channelWidth ?? 20}\n${ap.txPower ?? '—'} dBm`
    const showInfo = !!editorState.showAPInfo
    infoText.visible = showInfo
    infoBg.clear()
    if (showInfo) {
      infoBg
        .roundRect(-INFO_PILL_W / 2, AP_RADIUS + 20, INFO_PILL_W, INFO_PILL_H, 4)
        .fill({ color: INFO_PILL_BG, alpha: 1 })
      infoBg.visible = true
    } else {
      infoBg.visible = false
    }

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
      const prevId = lastSelectedId
      const prevType = lastSelectedType
      lastSelectedId = s.selectedId
      lastSelectedType = s.selectedType
      // Redraw previously-selected and newly-selected AP markers so the
      // red stroke + fan-selected emphasis paints / clears correctly.
      if (prevType === 'ap' && prevId) {
        const e = containers.get(prevId)
        if (e) drawAP(e)
      }
      if (s.selectedType === 'ap' && s.selectedId) {
        const e = containers.get(s.selectedId)
        if (e) drawAP(e)
      }
      recomputeFocus()
    }
  }

  // Hover invert (oldSrc Phase 23-3f): hovered + non-selected AP swaps the
  // body fill / stroke (dark fill, white stroke). Tracked separately so we
  // only redraw the two affected markers.
  let lastHoverId = useHoverStore.getState().id
  const onHoverChange = () => {
    const s = useHoverStore.getState()
    if (s.id === lastHoverId) return
    const prevId = lastHoverId
    lastHoverId = s.id
    const prev = prevId ? containers.get(prevId) : null
    const next = s.id ? containers.get(s.id) : null
    if (prev) drawAP(prev)
    if (next && next !== prev) drawAP(next)
  }

  // Screen-space marker sizing (oldSrc convention): container.scale =
  // 1 / viewport.scale so the AP body + name label + info pill render at
  // a constant on-screen size regardless of zoom. Position remains world.
  const applyInverseScale = () => {
    const vp = useViewportStore.getState()
    const inv = 1 / (vp.scale || 1)
    for (const entry of containers.values()) {
      entry.container.scale.set(inv)
    }
  }

  const unsubFloor = useFloorStore.subscribe(() => { reconcile(); recomputeFocus(); applyInverseScale() })
  const unsubAP = useAPStore.subscribe(() => { reconcile(); recomputeFocus(); applyInverseScale() })
  const unsubCable = useCableStore.subscribe(recomputeFocus)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  const unsubViewport = useViewportStore.subscribe(applyInverseScale)
  reconcile()
  recomputeFocus()
  applyInverseScale()

  return () => {
    unsubFloor()
    unsubAP()
    unsubCable()
    unsubDrag()
    unsubEditor()
    unsubHover()
    unsubViewport()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}

import { Container, Graphics, Circle, Text, TextStyle } from 'pixi.js'
import { useDragOverlayStore, isAnyBodyDragging } from '@/store/useDragOverlayStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useDraftStore } from '@/store/useDraftStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useViewportStore } from '@/store/useViewportStore'
import { computeFocusedDevices, FOCUS_HALO_COLOR, FOCUS_HALO_ALPHA, FOCUS_HALO_WIDTH } from '@/features/focus/focusedDevices'
import { perfOn, probe, probeEvent } from '@/features/cable/perfProbe'
import { getPatternById, DEFAULT_PATTERN_ID } from '@/constants/antennaPatterns'
import { getModeCapability } from '@/render/modeCapabilities'

// AP markers adapter — per-AP interactive Container with click select,
// drag, hover, right-click context menu, frequency-colored marker, and
// name label above. Visual constants ported 1:1 from
// oldSrc/features/editor/layers/APLayer.jsx — see audit doc.

// Mirrors oldSrc FREQ_COLOR / FREQ_LABEL.
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

// All sizes in canvas-px @ scale=1. Container is scaled 1/viewport.scale
// so visuals stay at constant screen-px size.
const AP_RADIUS       = 10   // body radius (oldSrc 10*s)
const HIT_RADIUS      = 14   // hit circle (oldSrc 14*s)
const FOCUS_RADIUS    = 15   // focus halo (oldSrc 15*s)
const DIR_INNER_R     = 17
const DIR_OUTER_R     = 36
const DIR_RING_INNER  = 35   // selected ring inner (oldSrc 35*s)
const PATTERN_OUTER_R = 34   // custom pattern outer radius (oldSrc 34*s)
const PATTERN_MIN_DB  = -30  // oldSrc patternPolygonPoints default
const AXIS_LEN        = 32

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
// oldSrc Text fontSize 11, fill #fff, align center, lineHeight 1.3 → 14.3.
const INFO_TEXT_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  align: 'center',
  lineHeight: 14.3,
})
// User-requested: show frequency label INSIDE the AP body circle ("2.4" /
// "5" / "6") so the band is identifiable at a glance, not only via the
// info pill below. fill colour is set per-state in drawAP so the text
// stays readable against hover-invert and selected states.
const FREQ_INSIDE_LABEL = { 2.4: '2.4', 5: '5', 6: '6' }
const FREQ_INSIDE_BASE_STYLE = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 9,
  fontWeight: '700',
  align: 'center',
}
const FREQ_LABEL_LONG = { 2.4: '2.4G', 5: '5G', 6: '6G' }
// oldSrc Rect width:80 height:44 cornerRadius:4, Group offsetX:40 y:19.
const INFO_PILL_W = 80
const INFO_PILL_H = 44
const INFO_PILL_BG = 'rgba(0, 0, 0, 0.75)'
const INFO_PILL_Y = 19       // group y (oldSrc 19*s)
const INFO_TEXT_Y = INFO_PILL_Y + 4

// Convert a polar pattern (36 dB samples) to polygon points around origin,
// matching oldSrc patternPolygonPoints(pattern, outerR, axisRad, -30).
function patternPolygonPoints(pattern, outerR, axisRad, minDb = PATTERN_MIN_DB) {
  const samples = pattern.samples
  const n = samples.length
  const pts = []
  for (let i = 0; i < n; i++) {
    const db = Math.max(samples[i], minDb)
    const r = ((db - minDb) / -minDb) * outerR
    const ang = axisRad + i * (2 * Math.PI / n)
    pts.push(r * Math.cos(ang), r * Math.sin(ang))
  }
  return pts
}

// Manual dashed arc stroke — PIXI v8 Graphics has no native dash option,
// so we walk the arc by arclength and lay alternating on/off segments.
function strokeDashedArc(g, cx, cy, radius, startAngle, endAngle, dashOn, dashOff, opts) {
  const totalAngle = endAngle - startAngle
  const totalLen   = Math.abs(totalAngle) * radius
  if (totalLen <= 1e-6) return
  const dir = Math.sign(totalAngle) || 1
  let cursor = 0
  let phaseOn = true
  let remain = dashOn
  while (cursor < totalLen) {
    const step = Math.min(totalLen - cursor, remain)
    if (phaseOn) {
      const a0 = startAngle + dir * (cursor / radius)
      const a1 = startAngle + dir * ((cursor + step) / radius)
      g.moveTo(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius)
       .arc(cx, cy, radius, a0, a1, dir < 0)
       .stroke(opts)
    }
    cursor += step
    remain -= step
    if (remain <= 1e-9) {
      phaseOn = !phaseOn
      remain = phaseOn ? dashOn : dashOff
    }
  }
}

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
      c.hitArea = new Circle(0, 0, HIT_RADIUS)
      const g = new Graphics()
      // Force PIXI to use the container hitArea (not Graphics's
      // per-pixel containsPoint) so clicking the AP body works at any
      // zoom level. See wallsLayer for the full explanation.
      g.eventMode = 'none'
      // oldSrc nameLabel: offsetX:22, offsetY:25, width:44, align:center →
      // text top is 25 px ABOVE origin, centered horizontally.
      const nameText = new Text({ text: '', style: NAME_TEXT_STYLE })
      nameText.anchor.set(0.5, 1)
      nameText.y = -14
      nameText.eventMode = 'none'
      const infoBg = new Graphics()
      infoBg.eventMode = 'none'
      infoBg.visible = false
      const infoText = new Text({ text: '', style: INFO_TEXT_STYLE })
      infoText.anchor.set(0.5, 0)
      infoText.y = INFO_TEXT_Y
      infoText.eventMode = 'none'
      infoText.visible = false
      // Frequency label inside the body circle (omni-only — directional /
      // custom APs already show an orientation arrow there).
      const freqInsideText = new Text({
        text: '',
        style: new TextStyle({ ...FREQ_INSIDE_BASE_STYLE, fill: BODY_STROKE_NORMAL }),
      })
      freqInsideText.anchor.set(0.5, 0.5)
      freqInsideText.eventMode = 'none'
      c.addChild(g)
      c.addChild(infoBg)
      c.addChild(freqInsideText)
      c.addChild(nameText)
      c.addChild(infoText)
      layer.addChild(c)
      entry = { container: c, graphics: g, infoBg, nameText, infoText, freqInsideText, ap, floorId }
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

    // oldSrc azimuth convention: 0° points +x (east), increases clockwise
    // (axisRad = azimuth * π/180). No -90 offset.
    const azimuthDeg = ((ap.azimuth ?? 0) % 360 + 360) % 360
    const beamwidth  = Math.max(10, Math.min(180, ap.beamwidth ?? 60))
    const axisRad    = azimuthDeg * Math.PI / 180
    const isDirectional = ap.antennaMode === 'directional'
    const isCustom      = ap.antennaMode === 'custom'
    const isOriented    = isDirectional || isCustom

    graphics.clear()

    // 17-2 focus halo (drawn first so the marker sits on top).
    if (isFocused) {
      graphics.circle(0, 0, FOCUS_RADIUS)
        .stroke({ width: FOCUS_HALO_WIDTH, color: FOCUS_HALO_COLOR, alpha: FOCUS_HALO_ALPHA })
    }

    // Directional fan (Konva.Arc — annular wedge).
    if (isDirectional) {
      const halfBw = (beamwidth / 2) * Math.PI / 180
      const a0 = axisRad - halfBw
      const a1 = axisRad + halfBw
      const fanAlpha = isSelected ? 0.35 : (isHovered ? 0.28 : 0.18)
      graphics
        .moveTo(Math.cos(a0) * DIR_INNER_R, Math.sin(a0) * DIR_INNER_R)
        .arc(0, 0, DIR_INNER_R, a0, a1, false)
        .arc(0, 0, DIR_OUTER_R, a1, a0, true)
        .closePath()
        .fill({ color: freqColor, alpha: fanAlpha })
      // Directional selected ring — dashed [3,3] ring at radius ~35.5.
      if (isSelected) {
        strokeDashedArc(
          graphics, 0, 0, (DIR_RING_INNER + DIR_OUTER_R) / 2,
          a0, a1, 3, 3,
          { width: 1, color: freqColor, alpha: 1 },
        )
      }
    }

    // Custom pattern polygon (closed line, freq color fill + stroke).
    if (isCustom) {
      const pattern = getPatternById(ap.patternId ?? DEFAULT_PATTERN_ID)
      const pts = patternPolygonPoints(pattern, PATTERN_OUTER_R, axisRad)
      if (pts.length >= 6) {
        const polyAlpha = isSelected ? 0.35 : (isHovered ? 0.28 : 0.2)
        graphics.poly(pts)
          .fill({ color: freqColor, alpha: polyAlpha })
          .stroke({ width: isSelected ? 1.2 : 0.8, color: freqColor, alpha: 1 })
      }
    }

    // Orientation axis line — selected→red else freq color.
    if (isOriented) {
      graphics
        .moveTo(0, 0)
        .lineTo(Math.cos(axisRad) * AXIS_LEN, Math.sin(axisRad) * AXIS_LEN)
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

    // Frequency label inside the body — omni only (directional / custom
    // already use the centre for their orientation arrow). User-requested
    // addition beyond oldSrc parity. Text colour follows stroke colour so
    // it stays readable against the white / inverted / selected body.
    const showFreqInside = !isOriented
    entry.freqInsideText.visible = showFreqInside
    if (showFreqInside) {
      const label = FREQ_INSIDE_LABEL[ap.frequency] ?? ''
      if (entry.freqInsideText.text !== label) entry.freqInsideText.text = label
      const desiredFill = bodyStroke
      if (entry.freqInsideText.style.fill !== desiredFill) {
        entry.freqInsideText.style = new TextStyle({ ...FREQ_INSIDE_BASE_STYLE, fill: desiredFill })
      }
    }

    // Orientation arrow (bar + tip) — for directional / custom only.
    // oldSrc: Group{rotation: azimuth}, bar [-4,0]-[4,0] stroke 1.5,
    // tip [7,0]-[3,-3]-[3,3] closed filled. Rotated manually here.
    if (isOriented) {
      const iconCol = isInvert ? '#ffffff' : '#1e3a8a'
      const c = Math.cos(axisRad)
      const s = Math.sin(axisRad)
      const rot = (px, py) => [px * c - py * s, px * s + py * c]
      // Bar
      const [bx0, by0] = rot(-4, 0)
      const [bx1, by1] = rot( 4, 0)
      graphics
        .moveTo(bx0, by0).lineTo(bx1, by1)
        .stroke({ width: 1.5, color: iconCol, alpha: 1, cap: 'round' })
      // Tip
      const [tx0, ty0] = rot(7,  0)
      const [tx1, ty1] = rot(3, -3)
      const [tx2, ty2] = rot(3,  3)
      graphics
        .poly([tx0, ty0, tx1, ty1, tx2, ty2])
        .fill({ color: iconCol, alpha: 1 })
    }

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
        .roundRect(-INFO_PILL_W / 2, INFO_PILL_Y, INFO_PILL_W, INFO_PILL_H, 4)
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
      if (typeof window !== 'undefined' && window.__debugRMB === true) {
        console.log('[RMB ap] pointerdown id=', entry.ap.id, 'btn=', e.button, 'orig=', e.originalEvent?.button)
      }
      if (e.button === 2) {
        const draft = useDraftStore.getState()
        if (draft.mode != null && draft.points.length > 0) return
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
      // Select + drag are gated by allowSelectClick from the capability
      // matrix (oldSrc modeCapabilities). In draw / place modes the
      // user clicking an existing object should fall through to the
      // stage handler (add draft point / drop a new device).
      // User-requested: drag own type in own place mode. PLACE_AP +
      // pointerdown on existing AP → drag that AP, not place a new one.
      // (viewport's place-click now fires on pointerup-no-drag, so the
      // place flow only kicks in when the user clicks empty.)
      const editorMode = useEditorStore.getState().editorMode
      const cap = getModeCapability(editorMode)
      const isOwnMode = editorMode === EDITOR_MODE.PLACE_AP
      if (!cap.allowSelectClick.wireless && !isOwnMode) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.ap.id, 'ap')
      beginDrag(entry, e)
    })
    // Hover invert is gated by allowSelectHover OR allowCommandHover
    // (oldSrc allowAnyHover). Non-SELECT modes still want a faint
    // affordance so the user knows what right-click would target.
    container.on('pointerover', () => {
      if (isAnyBodyDragging()) return
      const mode = useEditorStore.getState().editorMode
      const cap = getModeCapability(mode)
      // Cursor rule: ONLY SELECT mode or own PLACE mode shows the grab
      // affordance. DRAW modes always fall through to the canvas mode
      // cursor (crosshair) — clicking in draw modes places a draft
      // point, never grabs an existing object.
      const canGrab = mode === EDITOR_MODE.SELECT || mode === EDITOR_MODE.PLACE_AP
      container.cursor = canGrab ? 'grab' : ''
      if (!cap.allowSelectHover.wireless && !cap.allowCommandHover.wireless) return
      useHoverStore.getState().setHover(entry.ap.id, 'ap')
    })
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
  // Per-AP object identity from the last reconcile. updateAP replaces only the
  // mutated AP's object (Zustand immutable update), so comparing identity lets
  // us redraw ONLY changed/new APs instead of all 300. Dragging one AP and
  // dropping it used to repaint every marker (~99 ms at 300 AP on software
  // renderers — a chunk of the "放下卡一下"); now it repaints just that one.
  let lastApById = new Map()

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const aps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && aps === lastAPs) {
      applyDragOverlay()
      return
    }
    const floorChanged = activeFloorId !== lastFloorId
    lastFloorId = activeFloorId
    lastAPs = aps

    const next = new Set(aps.map((a) => a.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    const nextApById = new Map()
    for (const ap of aps) {
      const entry = ensureContainer(ap, activeFloorId)
      // Redraw only when this AP is new, its data object changed, or the floor
      // switched (containers are recreated then). Unchanged APs keep their
      // already-drawn marker — the whole point of the per-AP identity diff.
      if (floorChanged || lastApById.get(ap.id) !== ap) drawAP(entry)
      nextApById.set(ap.id, ap)
    }
    lastApById = nextApById
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
        if (e) { drawAP(e); liftToTop(e) }
      }
      recomputeFocus()
    }
  }

  // Bring an entry's container to the front of the layer so it can't be
  // hidden behind an overlapping AP when hovered / selected.
  const liftToTop = (entry) => {
    if (!entry || !entry.container) return
    if (entry.container.parent === layer) layer.addChild(entry.container)
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
    if (next) liftToTop(next)
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

  // 32-E perf probe — time each store-event's apsLayer work so the console
  // report attributes real per-interaction cost (zero overhead when probe off).
  const timed = (name, fn) => () => {
    if (!perfOn()) return fn()
    probeEvent(`aps:${name}`)
    const t0 = performance.now()
    fn()
    probe(`aps.${name}`, performance.now() - t0)
  }
  const unsubFloor = useFloorStore.subscribe(timed('floor', () => { reconcile(); recomputeFocus(); applyInverseScale() }))
  const unsubAP = useAPStore.subscribe(timed('ap', () => { reconcile(); recomputeFocus(); applyInverseScale() }))
  const unsubCable = useCableStore.subscribe(timed('cable', recomputeFocus))
  const unsubDrag = useDragOverlayStore.subscribe(timed('drag', applyDragOverlay))
  const unsubEditor = useEditorStore.subscribe(timed('editor', onEditorChange))
  const unsubHover = useHoverStore.subscribe(timed('hover', onHoverChange))
  const unsubViewport = useViewportStore.subscribe(timed('viewport', applyInverseScale))
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

// 26-2 P3a — APLayer rewritten to manage AP markers via imperative Konva.
//
// Why: at 150 AP each marker is ~10 Konva sub-nodes. react-konva's
// commitWork pass walks the React fiber tree and calls setAttrs on every
// matching Konva node — at ~1500 nodes / commit this dominated commit time
// (1.6–5.8 s per click / addAP / slider step per the DevTools trace).
//
// Strategy: keep the outer wrapping <Group> in react-konva (so `dimmed`
// still wires through React), but inside that group manage child Konva
// nodes imperatively. apsByFloor + every prop dep is reflected onto the
// Konva tree via diff-and-patch — same visuals, no react-konva reconciler.
//
// All four interactions (click / hover / drag / right-click context menu)
// are re-bound using Konva's own event API. Callbacks read through a ref
// so identity changes in the caller don't require rebinding listeners.

import React, { useEffect, useRef } from 'react'
import { Group } from 'react-konva'
import Konva from 'konva'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'
import { getPatternById, DEFAULT_PATTERN_ID } from '@/constants/antennaPatterns'
import { useFocusedDevices } from '@/features/editor/useFocusedDevices'

// 17-2: indigo halo wrapped around devices related to the current selection.
const FOCUS_HALO = '#818cf8'

const FREQ_COLOR = { 2.4: '#f39c12', 5: '#4fc3f7', 6: '#a855f7' }
const FREQ_LABEL = { 2.4: '2.4G',    5: '5G',     6: '6G' }

const wrapAzimuth   = (v) => (((v % 360) + 360) % 360)
const clampBeamwidth = (v) => Math.max(10, Math.min(180, v))

function patternPolygonPoints(pattern, outerR, azimuthRad, minDb = -30) {
  const samples = pattern.samples
  const n = samples.length
  const pts = []
  for (let i = 0; i < n; i++) {
    const db = Math.max(samples[i], minDb)
    const r = ((db - minDb) / -minDb) * outerR
    const ang = azimuthRad + i * (2 * Math.PI / n)
    pts.push(r * Math.cos(ang), r * Math.sin(ang))
  }
  return pts
}

// Derived visual state for one AP given its data + the layer-wide flags.
function deriveVisual(ap, st) {
  const isSelected = st.isSelected
  const isHovered  = st.isHovered
  const color      = FREQ_COLOR[ap.frequency] ?? '#4fc3f7'
  const s          = st.inverseScale
  const isDirectional = ap.antennaMode === 'directional'
  const isCustom      = ap.antennaMode === 'custom'
  const isOriented    = isDirectional || isCustom
  const azimuth       = wrapAzimuth(ap.azimuth ?? 0)
  const beamwidth     = clampBeamwidth(ap.beamwidth ?? 60)
  const arcStart      = azimuth - beamwidth / 2
  const axisRad       = azimuth * Math.PI / 180
  return { isSelected, isHovered, color, s, isDirectional, isCustom, isOriented, azimuth, beamwidth, arcStart, axisRad }
}

// Build a fresh Konva.Group containing every sub-shape required by this AP.
// All listener bindings live on the outer Group; sub-nodes have listening=false.
// Sub-nodes are stored on `group._nodes` for fast lookup during diff updates.
function buildApGroup(ap, st, callbacksRef) {
  const v = deriveVisual(ap, st)
  const g = new Konva.Group({ x: ap.x, y: ap.y, draggable: st.isDraggable })
  // Sub-node registry — flat so updateApGroup can mutate without rebuild.
  const nodes = {}

  // (1) Hit circle — only listener target
  nodes.hit = new Konva.Circle({ radius: 14 * v.s, fill: 'transparent' })
  g.add(nodes.hit)

  // (2) Focus halo (17-2). Present only when isFocused; toggled by visible().
  nodes.focusHalo = new Konva.Circle({
    radius: 15 * v.s, stroke: FOCUS_HALO, strokeWidth: 3 * v.s, opacity: 0.85,
    listening: false, visible: st.isFocused,
  })
  g.add(nodes.focusHalo)

  // (3) Directional fan (Arc) + selected ring (Arc with dash). Visibility toggled.
  nodes.directionalFan = new Konva.Arc({
    innerRadius: 17 * v.s, outerRadius: 36 * v.s, angle: v.beamwidth, rotation: v.arcStart,
    fill: v.color, opacity: v.isSelected ? 0.35 : (v.isHovered ? 0.28 : 0.18),
    listening: false, visible: v.isDirectional,
  })
  g.add(nodes.directionalFan)
  nodes.directionalSelectedRing = new Konva.Arc({
    innerRadius: 35 * v.s, outerRadius: 36 * v.s, angle: v.beamwidth, rotation: v.arcStart,
    stroke: v.color, strokeWidth: 1 * v.s, dash: [3 * v.s, 3 * v.s],
    listening: false, visible: v.isDirectional && v.isSelected,
  })
  g.add(nodes.directionalSelectedRing)

  // (4) Custom pattern polygon
  let customPts = null
  if (v.isCustom) {
    const pattern = getPatternById(ap.patternId ?? DEFAULT_PATTERN_ID)
    customPts = patternPolygonPoints(pattern, 34 * v.s, v.axisRad)
  }
  nodes.customPoly = new Konva.Line({
    points: customPts ?? [], closed: true, fill: v.color,
    opacity: v.isSelected ? 0.35 : (v.isHovered ? 0.28 : 0.2),
    stroke: v.color, strokeWidth: (v.isSelected ? 1.2 : 0.8) * v.s,
    listening: false, visible: v.isCustom && !!customPts,
  })
  g.add(nodes.customPoly)

  // (5) Orientation axis line (directional / custom)
  const axisLen = 32 * v.s
  nodes.axisLine = new Konva.Line({
    points: [0, 0, Math.cos(v.axisRad) * axisLen, Math.sin(v.axisRad) * axisLen],
    stroke: v.isSelected ? '#e74c3c' : v.color,
    strokeWidth: (v.isSelected ? 2 : 1.2) * v.s,
    opacity: 0.85, listening: false, visible: v.isOriented,
  })
  g.add(nodes.axisLine)

  // (6) Main body circle
  nodes.body = new Konva.Circle({
    radius: 10 * v.s,
    fill:   (v.isHovered && !v.isSelected) ? '#1e3a8a' : '#ffffff',
    stroke: v.isSelected ? '#e74c3c' : (v.isHovered && !v.isSelected) ? '#ffffff' : '#1e3a8a',
    strokeWidth: (v.isSelected ? 3 : v.isHovered ? 2.5 : 2) * v.s,
    listening: false,
  })
  g.add(nodes.body)

  // (7) Orientation arrow group — only for directional / custom
  const iconCol = (v.isHovered && !v.isSelected) ? '#ffffff' : '#1e3a8a'
  nodes.arrowGroup = new Konva.Group({ rotation: v.azimuth, listening: false, visible: v.isOriented })
  nodes.arrowBar = new Konva.Line({
    points: [-4 * v.s, 0, 4 * v.s, 0], stroke: iconCol, strokeWidth: 1.5 * v.s, lineCap: 'round',
  })
  nodes.arrowTip = new Konva.Line({
    points: [7 * v.s, 0, 3 * v.s, -3 * v.s, 3 * v.s, 3 * v.s], closed: true, fill: iconCol,
  })
  nodes.arrowGroup.add(nodes.arrowBar)
  nodes.arrowGroup.add(nodes.arrowTip)
  g.add(nodes.arrowGroup)

  // (8) Name label
  nodes.nameLabel = new Konva.Text({
    text: ap.name, fontSize: 11 * v.s, fill: '#fff', align: 'center',
    offsetX: 22 * v.s, offsetY: 25 * v.s, width: 44 * v.s,
    shadowColor: '#000', shadowBlur: 4, shadowOpacity: 0.9, shadowOffsetX: 0, shadowOffsetY: 0,
    listening: false,
  })
  g.add(nodes.nameLabel)

  // (9) AP info pill (showAPInfo). Stays mounted; visibility toggled.
  nodes.infoGroup = new Konva.Group({ y: 19 * v.s, offsetX: 40 * v.s, listening: false, visible: !!st.showAPInfo })
  nodes.infoRect = new Konva.Rect({
    width: 80 * v.s, height: 44 * v.s, fill: 'rgba(0,0,0,0.75)', cornerRadius: 4 * v.s,
  })
  nodes.infoText = new Konva.Text({
    text: `${ap.name}\n${FREQ_LABEL[ap.frequency] || ap.frequency + 'G'} CH${ap.channel}/${ap.channelWidth ?? 20}\n${ap.txPower} dBm`,
    fontSize: 11 * v.s, fill: '#fff', x: 0, y: 4 * v.s, width: 80 * v.s, align: 'center', lineHeight: 1.3,
  })
  nodes.infoGroup.add(nodes.infoRect)
  nodes.infoGroup.add(nodes.infoText)
  g.add(nodes.infoGroup)

  g._nodes = nodes
  g._ap = ap

  // Bind events. Callbacks dereference through callbacksRef so they always
  // see the latest closure even if the parent component re-renders.
  g.on('mouseenter', () => {
    const cb = callbacksRef.current
    if (g._st.isDraggable) cb.setHoverCursor?.('grab')
    if (g._st.allowAnyHover) cb.onHoverEnter(g._ap.id)
  })
  g.on('mouseleave', () => {
    const cb = callbacksRef.current
    cb.setHoverCursor?.(null)
    cb.onHoverLeave()
  })
  g.on('click', (e) => {
    if (e.evt.button !== 0) return
    if (!g._st.allowClick) return
    e.cancelBubble = true
    callbacksRef.current.onClick?.(g._ap.id, e)
  })
  g.on('contextmenu', (e) => {
    if (!g._st.allowContextMenu) return
    e.evt.preventDefault?.()
    e.cancelBubble = true
    callbacksRef.current.onContextMenu?.(g._ap.id, e)
  })
  g.on('dragstart', (e) => {
    e.cancelBubble = true
    callbacksRef.current.onClick?.(g._ap.id, e)
  })
  g.on('dragmove', (e) => {
    e.cancelBubble = true
    callbacksRef.current.onDragMove?.(g._ap.id, e.target.x(), e.target.y())
  })
  g.on('dragend', (e) => {
    e.cancelBubble = true
    callbacksRef.current.onMoved(g._ap.id, e.target.x(), e.target.y())
  })

  return g
}

// Apply (prevAp, prevSt) → (nextAp, nextSt) diff to an existing group's nodes.
// Touches Konva nodes only where the relevant input changed. Caller must
// trigger layer.batchDraw() after a batch of updates.
function updateApGroup(g, nextAp, nextSt) {
  const prevAp = g._ap
  const prevSt = g._st
  const v = deriveVisual(nextAp, nextSt)
  const n = g._nodes
  const sChanged = prevSt.inverseScale !== nextSt.inverseScale

  // Position
  if (prevAp.x !== nextAp.x || prevAp.y !== nextAp.y) g.position({ x: nextAp.x, y: nextAp.y })

  // Draggable
  if (prevSt.isDraggable !== nextSt.isDraggable) g.draggable(nextSt.isDraggable)

  // Hit
  if (sChanged) n.hit.radius(14 * v.s)

  // Focus halo
  if (prevSt.isFocused !== nextSt.isFocused) n.focusHalo.visible(nextSt.isFocused)
  if (sChanged && nextSt.isFocused) {
    n.focusHalo.radius(15 * v.s)
    n.focusHalo.strokeWidth(3 * v.s)
  }

  // Directional / custom / oriented flag recomputations
  const prevDir    = prevAp.antennaMode === 'directional'
  const prevCustom = prevAp.antennaMode === 'custom'
  const prevOri    = prevDir || prevCustom
  const dirChanged    = prevDir !== v.isDirectional
  const customChanged = prevCustom !== v.isCustom
  const oriChanged    = prevOri !== v.isOriented
  const azBwChanged   = prevAp.azimuth !== nextAp.azimuth || prevAp.beamwidth !== nextAp.beamwidth
  const selChanged    = prevSt.isSelected !== nextSt.isSelected
  const hoverChanged  = prevSt.isHovered !== nextSt.isHovered
  const freqChanged   = prevAp.frequency !== nextAp.frequency
  const patternChanged = prevAp.patternId !== nextAp.patternId

  // Directional fan
  if (dirChanged || sChanged || azBwChanged || freqChanged || selChanged || hoverChanged) {
    if (v.isDirectional) {
      n.directionalFan.visible(true)
      n.directionalFan.innerRadius(17 * v.s)
      n.directionalFan.outerRadius(36 * v.s)
      n.directionalFan.angle(v.beamwidth)
      n.directionalFan.rotation(v.arcStart)
      n.directionalFan.fill(v.color)
      n.directionalFan.opacity(v.isSelected ? 0.35 : (v.isHovered ? 0.28 : 0.18))
    } else {
      n.directionalFan.visible(false)
    }
  }
  // Directional selected ring
  if (dirChanged || selChanged || sChanged || azBwChanged || freqChanged) {
    if (v.isDirectional && v.isSelected) {
      n.directionalSelectedRing.visible(true)
      n.directionalSelectedRing.innerRadius(35 * v.s)
      n.directionalSelectedRing.outerRadius(36 * v.s)
      n.directionalSelectedRing.angle(v.beamwidth)
      n.directionalSelectedRing.rotation(v.arcStart)
      n.directionalSelectedRing.stroke(v.color)
      n.directionalSelectedRing.strokeWidth(1 * v.s)
      n.directionalSelectedRing.dash([3 * v.s, 3 * v.s])
    } else {
      n.directionalSelectedRing.visible(false)
    }
  }

  // Custom pattern polygon — recompute points only when needed
  if (customChanged || sChanged || patternChanged || azBwChanged || freqChanged || selChanged || hoverChanged) {
    if (v.isCustom) {
      const pattern = getPatternById(nextAp.patternId ?? DEFAULT_PATTERN_ID)
      const customPts = patternPolygonPoints(pattern, 34 * v.s, v.axisRad)
      n.customPoly.visible(true)
      n.customPoly.points(customPts)
      n.customPoly.fill(v.color)
      n.customPoly.opacity(v.isSelected ? 0.35 : (v.isHovered ? 0.28 : 0.2))
      n.customPoly.stroke(v.color)
      n.customPoly.strokeWidth((v.isSelected ? 1.2 : 0.8) * v.s)
    } else {
      n.customPoly.visible(false)
    }
  }

  // Axis line
  if (oriChanged || sChanged || azBwChanged || selChanged || freqChanged) {
    if (v.isOriented) {
      const axisLen = 32 * v.s
      n.axisLine.visible(true)
      n.axisLine.points([0, 0, Math.cos(v.axisRad) * axisLen, Math.sin(v.axisRad) * axisLen])
      n.axisLine.stroke(v.isSelected ? '#e74c3c' : v.color)
      n.axisLine.strokeWidth((v.isSelected ? 2 : 1.2) * v.s)
    } else {
      n.axisLine.visible(false)
    }
  }

  // Main body
  if (sChanged || selChanged || hoverChanged) {
    n.body.radius(10 * v.s)
    n.body.fill((v.isHovered && !v.isSelected) ? '#1e3a8a' : '#ffffff')
    n.body.stroke(v.isSelected ? '#e74c3c' : (v.isHovered && !v.isSelected) ? '#ffffff' : '#1e3a8a')
    n.body.strokeWidth((v.isSelected ? 3 : v.isHovered ? 2.5 : 2) * v.s)
  }

  // Arrow group — visibility + rotation + recolor
  if (oriChanged || azBwChanged) n.arrowGroup.rotation(v.azimuth)
  if (oriChanged) n.arrowGroup.visible(v.isOriented)
  if (sChanged || selChanged || hoverChanged) {
    const iconCol = (v.isHovered && !v.isSelected) ? '#ffffff' : '#1e3a8a'
    n.arrowBar.points([-4 * v.s, 0, 4 * v.s, 0])
    n.arrowBar.stroke(iconCol)
    n.arrowBar.strokeWidth(1.5 * v.s)
    n.arrowTip.points([7 * v.s, 0, 3 * v.s, -3 * v.s, 3 * v.s, 3 * v.s])
    n.arrowTip.fill(iconCol)
  }

  // Name label
  if (prevAp.name !== nextAp.name) n.nameLabel.text(nextAp.name)
  if (sChanged) {
    n.nameLabel.fontSize(11 * v.s)
    n.nameLabel.offsetX(22 * v.s)
    n.nameLabel.offsetY(25 * v.s)
    n.nameLabel.width(44 * v.s)
  }

  // Info pill visibility + content
  if (prevSt.showAPInfo !== nextSt.showAPInfo) n.infoGroup.visible(!!nextSt.showAPInfo)
  if (sChanged) {
    n.infoGroup.y(19 * v.s)
    n.infoGroup.offsetX(40 * v.s)
    n.infoRect.width(80 * v.s)
    n.infoRect.height(44 * v.s)
    n.infoRect.cornerRadius(4 * v.s)
    n.infoText.fontSize(11 * v.s)
    n.infoText.y(4 * v.s)
    n.infoText.width(80 * v.s)
  }
  const infoFieldsChanged =
    prevAp.name !== nextAp.name
    || prevAp.frequency !== nextAp.frequency
    || prevAp.channel !== nextAp.channel
    || prevAp.channelWidth !== nextAp.channelWidth
    || prevAp.txPower !== nextAp.txPower
  if (infoFieldsChanged && nextSt.showAPInfo) {
    n.infoText.text(`${nextAp.name}\n${FREQ_LABEL[nextAp.frequency] || nextAp.frequency + 'G'} CH${nextAp.channel}/${nextAp.channelWidth ?? 20}\n${nextAp.txPower} dBm`)
  }

  // Latch new snapshot
  g._ap = nextAp
  g._st = nextSt
}

function APLayer({ floorId, selectedAPId, selectedItems = [], onAPClick, onAPContextMenu, onAPDragMove, onAPDragEnd, isDrawingActive, viewportScale, setHoverCursor, dimmed, capability }) {
  // React-side subscriptions are limited to **layer-wide flags** (capability,
  // selection, focused devices, showAPInfo, showAPBand, inverseScale, dimmed).
  // The aps array is read imperatively from useAPStore.getState() inside
  // useEffect and via a subscribe() listener — never as a React render input.
  const showAPInfo = useEditorStore((s) => s.showAPInfo)
  const showAPBand = useEditorStore((s) => s.showAPBand)
  const focused    = useFocusedDevices()
  const updateAP   = useAPStore((s) => s.updateAP)

  const allowDrag        = !!capability?.allowDragExisting?.wireless
  const allowClick       = !!capability?.allowSelectClick?.wireless
  const allowHover       = !!capability?.allowSelectHover?.wireless
  const allowCmdHover    = !!capability?.allowCommandHover?.wireless
  const allowAnyHover    = allowHover || allowCmdHover
  const allowContextMenu = !!capability?.allowContextMenu

  const batchSelectedIds = (selectedItems.length > 1
    ? new Set(selectedItems.filter((it) => it.type === 'ap').map((it) => it.id))
    : null)

  const inverseScale = 1 / viewportScale

  // Refs for the Konva-side managed state.
  const outerGroupRef = useRef(null)         // the react-konva Group node
  const nodesByIdRef  = useRef(new Map())    // apId -> Konva.Group
  const hoveredIdRef  = useRef(null)         // imperative hover state

  // Callbacks are passed as inline lambdas from Editor2D → identity changes
  // every render. Stash latest into a ref so listener closures always see
  // the current callbacks without rebinding.
  const callbacksRef = useRef({})
  callbacksRef.current = {
    onClick: onAPClick,
    onContextMenu: onAPContextMenu,
    onDragMove: onAPDragMove,
    onMoved: (id, x, y) => { updateAP(floorId, id, { x, y }); onAPDragEnd?.() },
    setHoverCursor,
    onHoverEnter: (id) => {
      hoveredIdRef.current = id
      applyHoverVisuals()
    },
    onHoverLeave: () => {
      hoveredIdRef.current = null
      applyHoverVisuals()
    },
  }

  // Snapshot of per-AP layer-wide flags. Used both during initial group build
  // and whenever any flag changes (we re-walk every group with new flags).
  const buildState = (ap) => ({
    isSelected: ap.id === selectedAPId || (batchSelectedIds?.has(ap.id) ?? false),
    isHovered:  ap.id === hoveredIdRef.current,
    isFocused:  focused.aps.has(ap.id),
    isDraggable: allowDrag,
    allowHover, allowCmdHover, allowAnyHover, allowClick, allowContextMenu,
    showAPInfo, inverseScale,
  })

  // Apply only-hover-changed update path. Walks both old + new hovered groups,
  // updates them in place. Cheaper than rebuilding state for all 150 groups.
  const applyHoverVisuals = () => {
    const parent = outerGroupRef.current
    if (!parent) return
    // Mark both prev and current hovered groups for visual refresh.
    // Re-derive state for each via buildState (which reads hoveredIdRef.current).
    for (const [id, g] of nodesByIdRef.current) {
      const ap = g._ap
      const nextSt = buildState(ap)
      if (nextSt.isHovered !== g._st.isHovered) {
        updateApGroup(g, ap, nextSt)
      }
    }
    parent.getLayer?.()?.batchDraw()
  }

  // Full sync from current store state → Konva node tree.
  // Adds groups for new APs, removes groups for vanished APs, applies prop
  // patches via updateApGroup for surviving APs.
  const syncFromStore = () => {
    const parent = outerGroupRef.current
    if (!parent) return
    const allAps = useAPStore.getState().apsByFloor[floorId] ?? []
    // Band filter
    const visibleAps = allAps.filter((ap) => showAPBand[ap.frequency] !== false)
    const visibleIds = new Set(visibleAps.map((ap) => ap.id))
    // Remove gone
    for (const [id, g] of nodesByIdRef.current) {
      if (!visibleIds.has(id)) {
        g.destroy()
        nodesByIdRef.current.delete(id)
      }
    }
    // Add / update
    for (const ap of visibleAps) {
      const nextSt = buildState(ap)
      let g = nodesByIdRef.current.get(ap.id)
      if (!g) {
        g = buildApGroup(ap, nextSt, callbacksRef)
        g._st = nextSt
        nodesByIdRef.current.set(ap.id, g)
        parent.add(g)
      } else {
        updateApGroup(g, ap, nextSt)
      }
    }
    parent.getLayer?.()?.batchDraw()
  }

  // Subscribe to the AP store imperatively. selector returns the per-floor
  // array; equality fn skips when reference is identical (zustand default).
  useEffect(() => {
    syncFromStore()
    const unsub = useAPStore.subscribe((state, prev) => {
      const cur = state.apsByFloor[floorId]
      const old = prev?.apsByFloor?.[floorId]
      if (cur === old) return
      syncFromStore()
    })
    return () => {
      unsub()
      for (const g of nodesByIdRef.current.values()) g.destroy()
      nodesByIdRef.current.clear()
    }
    // syncFromStore captures latest closures via refs and props at call time;
    // we want re-sync when floorId changes (destroy + rebuild for new floor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorId])

  // Whenever layer-wide flags change, re-sync (touches every group's state).
  // This is cheap compared to a full React commit because we only mutate
  // changed attrs imperatively.
  useEffect(() => {
    syncFromStore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedAPId, selectedItems, showAPInfo, showAPBand, focused,
    allowDrag, allowClick, allowHover, allowCmdHover, allowAnyHover, allowContextMenu,
    inverseScale,
  ])

  return <Group ref={outerGroupRef} opacity={dimmed ? 0.2 : 1} />
}

export default APLayer

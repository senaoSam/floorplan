import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useViewportStore } from '@/store/useViewportStore'
import { computeTripwireCounts, computeZoneStats } from './analyticsStats'

// Tripwires (counting lines) + rectangular analysis zones for Camera mode
// (Phase 34-5 ②③). Lives in the `cameras` scene layer, so camerasLayer's
// mode gate hides everything outside CAMERA mode automatically.
//
// Both objects are drawn with TWO CLICKS (armed via the TimelineBar buttons —
// useCameraStore.drawTool): first click anchors (draftPoint), a ghost follows
// the pointer, second click commits. FloorplanSystem routes the place-mode
// clicks here-ish (commitDrawClick) so an armed tool never drops a camera.
//
// Stats refresh with the same analysis window as the occupancy heatmap
// (useTrackingStore.occupancyFromSec/ToSec).

const TRIPWIRE_COLOR = '#f472b6'
const ZONE_COLOR = '#fbbf24'
const SELECT_STROKE = '#e74c3c'
const HIT_TOL_SCREEN_PX = 9

// White core + dark outline so the labels survive both white plans and dark
// canvas (same adaptive treatment as camerasLayer's NAME_TEXT_STYLE).
const LABEL_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  fontWeight: '600',
  align: 'center',
  stroke: { color: '#0f172a', width: 3, join: 'round' },
  dropShadow: { color: '#000000', blur: 4, distance: 0, alpha: 0.6 },
})

const secLabel = (sec) => sec >= 90 ? `${(sec / 60).toFixed(1)}m` : `${Math.round(sec)}s`

export function attachAnalyticsLayer({
  scene,
  useFloorStore,
  useCameraStore,
  useTrackingStore,
}) {
  const layer = scene.layers.cameras
  const root = new Container()
  root.eventMode = 'passive'
  layer.addChild(root)
  const draftG = new Graphics()
  draftG.eventMode = 'none'
  root.addChild(draftG)

  const isCameraMode = () => useEditorStore.getState().editorMode === EDITOR_MODE.CAMERA
  const vpScale = () => useViewportStore.getState().scale || 1

  const containers = new Map()   // id → { container, graphics, label, obj, kind }

  const ensure = (obj, kind) => {
    let entry = containers.get(obj.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'pointer'
      const g = new Graphics()
      g.eventMode = 'none'
      const label = new Text({ text: '', style: LABEL_STYLE })
      label.anchor.set(0.5, 1)
      label.eventMode = 'none'
      // two per-direction count tags (tripwire only; zones leave them empty)
      const cntA = new Text({ text: '', style: LABEL_STYLE })
      cntA.anchor.set(0.5, 0.5)
      cntA.eventMode = 'none'
      const cntB = new Text({ text: '', style: LABEL_STYLE })
      cntB.anchor.set(0.5, 0.5)
      cntB.eventMode = 'none'
      c.addChild(g)
      c.addChild(label)
      c.addChild(cntA)
      c.addChild(cntB)
      root.addChild(c)
      entry = { container: c, graphics: g, label, cntA, cntB, obj, kind }
      containers.set(obj.id, entry)
      c.cursor = 'grab'
      c.on('pointerdown', (e) => {
        if (!isCameraMode()) return
        if ((e.button ?? 0) !== 0) return
        if (useCameraStore.getState().drawTool) return   // drawing → click falls through
        e.stopPropagation()
        useEditorStore.getState().setSelected(entry.obj.id, entry.kind === 'tripwire' ? 'tripwire' : 'camera_zone')
        // Tripwire endpoints drag individually (wall-style); anything else
        // moves the whole object.
        if (entry.kind === 'tripwire') {
          const wp = scene.world.toLocal(e.global)
          const tol = (HIT_TOL_SCREEN_PX + 3) / vpScale()
          if (Math.hypot(wp.x - entry.obj.x1, wp.y - entry.obj.y1) <= tol) return beginDrag(entry, e, 'p1')
          if (Math.hypot(wp.x - entry.obj.x2, wp.y - entry.obj.y2) <= tol) return beginDrag(entry, e, 'p2')
        }
        beginDrag(entry, e, 'move')
      })
    } else {
      entry.obj = obj
    }
    return entry
  }

  const remove = (id) => {
    const entry = containers.get(id)
    if (!entry) return
    root.removeChild(entry.container)
    entry.container.destroy({ children: true })
    containers.delete(id)
  }

  // Drag — rAF-coalesced live store writes (same pattern as camerasLayer).
  // mode: 'move' translates the whole object; 'p1'/'p2' move one tripwire
  // endpoint (wall-style reshaping).
  const beginDrag = (entry, downEvent, mode) => {
    const stage = scene.app.stage
    const startWorld = scene.world.toLocal(downEvent.global)
    const fid = useFloorStore.getState().activeFloorId
    const start = { ...entry.obj }
    let pending = null
    let rafId = 0
    const flush = () => {
      rafId = 0
      if (!pending) return
      const patch = pending
      pending = null
      if (entry.kind === 'tripwire') useCameraStore.getState().updateTripwire(fid, entry.obj.id, patch)
      else useCameraStore.getState().updateZone(fid, entry.obj.id, patch)
    }
    const onMove = (e) => {
      const wp = scene.world.toLocal(e.global)
      const dx = wp.x - startWorld.x
      const dy = wp.y - startWorld.y
      if (entry.kind === 'tripwire') {
        if (mode === 'p1') pending = { x1: start.x1 + dx, y1: start.y1 + dy }
        else if (mode === 'p2') pending = { x2: start.x2 + dx, y2: start.y2 + dy }
        else pending = { x1: start.x1 + dx, y1: start.y1 + dy, x2: start.x2 + dx, y2: start.y2 + dy }
      } else {
        pending = { x: start.x + dx, y: start.y + dy }
      }
      if (rafId === 0) rafId = requestAnimationFrame(flush)
    }
    const onUp = () => {
      if (rafId !== 0) { cancelAnimationFrame(rafId); rafId = 0 }
      flush()
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  const drawTripwire = (entry, counts) => {
    const { graphics: g, label, obj } = entry
    const s = 1 / vpScale()
    const editor = useEditorStore.getState()
    const isSelected = editor.selectedId === obj.id && editor.selectedType === 'tripwire'
    g.clear()
    const color = isSelected ? SELECT_STROKE : TRIPWIRE_COLOR
    // ghost-line double stroke for visibility on light & dark floors
    g.moveTo(obj.x1, obj.y1).lineTo(obj.x2, obj.y2)
      .stroke({ width: 5 * s, color: '#000000', alpha: 0.5 })
    g.moveTo(obj.x1, obj.y1).lineTo(obj.x2, obj.y2)
      .stroke({ width: 2.5 * s, color, alpha: 1 })
    // endpoints — selected: big white drag handles (wall-style); idle: ticks
    for (const [px, py] of [[obj.x1, obj.y1], [obj.x2, obj.y2]]) {
      if (isSelected) {
        g.circle(px, py, 5.5 * s).fill({ color: '#ffffff', alpha: 1 }).stroke({ width: 2 * s, color, alpha: 1 })
      } else {
        g.circle(px, py, 3.5 * s).fill({ color, alpha: 1 }).stroke({ width: 1 * s, color: '#000', alpha: 0.4 })
      }
    }
    // Direction arrows at the midpoint, one per side of the line. Sign
    // convention (verified): a crossing with crossSign > 0 ("forward") moves
    // along -n, so the -n arrow carries counts.forward.
    const mx = (obj.x1 + obj.x2) / 2
    const my = (obj.y1 + obj.y2) / 2
    const ex = obj.x2 - obj.x1
    const ey = obj.y2 - obj.y1
    const elen = Math.hypot(ex, ey) || 1
    const nx = ey / elen
    const ny = -ex / elen
    const arrow = (dir) => {
      const ax = mx + nx * dir * 7 * s
      const ay = my + ny * dir * 7 * s
      const tx = mx + nx * dir * 19 * s
      const ty = my + ny * dir * 19 * s
      g.moveTo(ax, ay).lineTo(tx, ty).stroke({ width: 2 * s, color, alpha: 0.95, cap: 'round' })
      const hw = 5 * s
      g.poly([
        tx + nx * dir * hw, ty + ny * dir * hw,
        tx - ny * hw * 0.7, ty + nx * hw * 0.7,
        tx + ny * hw * 0.7, ty - nx * hw * 0.7,
      ]).fill({ color, alpha: 0.95 })
    }
    arrow(-1)
    arrow(1)
    entry.cntA.text = String(counts.forward)
    entry.cntA.scale.set(s)
    entry.cntA.position.set(mx - nx * 32 * s, my - ny * 32 * s)
    entry.cntB.text = String(counts.backward)
    entry.cntB.scale.set(s)
    entry.cntB.position.set(mx + nx * 32 * s, my + ny * 32 * s)
    label.text = obj.name
    label.scale.set(s)
    // name sits above the line's first endpoint so it doesn't fight the arrows
    label.position.set(obj.x1, obj.y1 - 10 * s)

    // pointer hit: distance-to-segment (slightly larger near the endpoints so
    // the drag handles are easy to grab), in world px scaled by zoom
    entry.container.hitArea = {
      contains: (x, y) => {
        const tol = HIT_TOL_SCREEN_PX / vpScale()
        const endTol = (HIT_TOL_SCREEN_PX + 3) / vpScale()
        if (Math.hypot(x - obj.x1, y - obj.y1) <= endTol) return true
        if (Math.hypot(x - obj.x2, y - obj.y2) <= endTol) return true
        const dx = obj.x2 - obj.x1, dy = obj.y2 - obj.y1
        const len2 = dx * dx + dy * dy
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - obj.x1) * dx + (y - obj.y1) * dy) / len2)) : 0
        return Math.hypot(x - (obj.x1 + dx * t), y - (obj.y1 + dy * t)) <= tol
      },
    }
  }

  const drawZone = (entry, stats) => {
    const { graphics: g, label, obj } = entry
    const s = 1 / vpScale()
    const editor = useEditorStore.getState()
    const isSelected = editor.selectedId === obj.id && editor.selectedType === 'camera_zone'
    g.clear()
    const color = isSelected ? SELECT_STROKE : ZONE_COLOR
    const x = Math.min(obj.x, obj.x + obj.w)
    const y = Math.min(obj.y, obj.y + obj.h)
    const w = Math.abs(obj.w)
    const h = Math.abs(obj.h)
    g.rect(x, y, w, h).fill({ color: ZONE_COLOR, alpha: isSelected ? 0.14 : 0.08 })
    g.rect(x, y, w, h).stroke({ width: 4 * s, color: '#000000', alpha: 0.35 })
    g.rect(x, y, w, h).stroke({ width: 2 * s, color, alpha: 0.95 })
    const peak = stats.peakHour != null ? `峰 ${stats.peakHour}時` : '無人'
    label.text = `${obj.name}  進 ${stats.entries} 次 · 均停 ${secLabel(stats.avgDwellSec)} · ${peak}`
    label.scale.set(s)
    label.position.set(x + w / 2, y - 6 * s)
    entry.cntA.text = ''
    entry.cntB.text = ''

    // whole-area hit (user ask: clicking anywhere inside selects the zone).
    // Trade-off: cameras can't be dropped INSIDE an existing zone — place the
    // camera first or move the zone aside.
    entry.container.hitArea = {
      contains: (px, py) => {
        const tol = HIT_TOL_SCREEN_PX / vpScale()
        return px >= x - tol && px <= x + w + tol && py >= y - tol && py <= y + h + tol
      },
    }
  }

  // ── Stats (cached on inputs, recompute DEBOUNCED) ────────────────────────
  // Dragging a zone writes the store every rAF; integrating the whole day per
  // frame would jank the drag. Stale numbers ride along during the gesture
  // and refresh ~180ms after it settles.
  const STATS_DEBOUNCE_MS = 180
  let statsKey = null
  let statsTimer = null
  let tripwireCounts = new Map()
  let zoneStats = new Map()
  const refreshStats = () => {
    const fid = useFloorStore.getState().activeFloorId
    const cs = useCameraStore.getState()
    const tr = useTrackingStore.getState()
    const tracks = tr.tracksByFloor[fid] ?? []
    const tws = cs.tripwiresByFloor[fid] ?? []
    const zs = cs.zonesByFloor[fid] ?? []
    const key = [fid, tracks, tws, zs, tr.occupancyFromSec, tr.occupancyToSec]
    if (statsKey && key.every((v, i) => v === statsKey[i])) return
    statsKey = key
    if (statsTimer) clearTimeout(statsTimer)
    statsTimer = setTimeout(() => {
      statsTimer = null
      tripwireCounts = new Map(tws.map((t) => [t.id, computeTripwireCounts(t, tracks, tr.occupancyFromSec, tr.occupancyToSec)]))
      zoneStats = new Map(zs.map((z) => [z.id, computeZoneStats(z, tracks, tr.occupancyFromSec, tr.occupancyToSec)]))
      redraw()                     // repaint labels with the fresh numbers
      scene.requestRender()
    }, STATS_DEBOUNCE_MS)
  }

  const EMPTY_COUNTS = { forward: 0, backward: 0 }
  const EMPTY_STATS = { entries: 0, avgDwellSec: 0, peakHour: null }

  const redraw = () => {
    if (!isCameraMode()) return   // layer itself is hidden; skip the work
    const fid = useFloorStore.getState().activeFloorId
    const cs = useCameraStore.getState()
    const tws = cs.tripwiresByFloor[fid] ?? []
    const zs = cs.zonesByFloor[fid] ?? []
    refreshStats()
    const alive = new Set()
    for (const t of tws) {
      alive.add(t.id)
      drawTripwire(ensure(t, 'tripwire'), tripwireCounts.get(t.id) ?? EMPTY_COUNTS)
    }
    for (const z of zs) {
      alive.add(z.id)
      drawZone(ensure(z, 'zone'), zoneStats.get(z.id) ?? EMPTY_STATS)
    }
    for (const id of Array.from(containers.keys())) {
      if (!alive.has(id)) remove(id)
    }
  }

  // ── Draft ghost (two-click draw) ─────────────────────────────────────────
  let ghostEnd = null
  const drawDraft = () => {
    draftG.clear()
    const cs = useCameraStore.getState()
    if (!isCameraMode() || !cs.drawTool || !cs.draftPoint || !ghostEnd) return
    const s = 1 / vpScale()
    const a = cs.draftPoint
    const b = ghostEnd
    if (cs.drawTool === 'tripwire') {
      draftG.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4 * s, color: '#000000', alpha: 0.5 })
      draftG.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2 * s, color: TRIPWIRE_COLOR, alpha: 0.9 })
    } else {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
      draftG.rect(x, y, w, h).stroke({ width: 4 * s, color: '#000000', alpha: 0.5 })
      draftG.rect(x, y, w, h).stroke({ width: 2 * s, color: ZONE_COLOR, alpha: 0.9 })
    }
  }
  const onStageMove = (e) => {
    const cs = useCameraStore.getState()
    if (!isCameraMode() || !cs.drawTool || !cs.draftPoint) return
    ghostEnd = scene.world.toLocal(e.global)
    drawDraft()
    scene.requestRender()
  }
  scene.app.stage.on('pointermove', onStageMove)

  // Right-click cancels an armed/in-progress draw — matches the wall/scope
  // drawing convention (右鍵或 Esc 取消). Native contextmenu listener because
  // PIXI v8's federated events don't emit pointerdown for the right button.
  const canvasEl = scene.app.canvas
  const onContextMenu = (e) => {
    if (!isCameraMode()) return
    const cs = useCameraStore.getState()
    if (!cs.drawTool) return
    e.preventDefault()
    cs.setDrawTool(null)   // clears draftPoint too
    ghostEnd = null
    drawDraft()
    scene.requestRender()
  }
  canvasEl.addEventListener('contextmenu', onContextMenu)

  // Commit path called from FloorplanSystem's CAMERA place-click routing.
  const commitDrawClick = ({ x, y }) => {
    const cs = useCameraStore.getState()
    const fid = useFloorStore.getState().activeFloorId
    if (!cs.drawTool || !fid) return false
    if (!cs.draftPoint) {
      cs.setDraftPoint({ x, y })
      return true
    }
    const a = cs.draftPoint
    if (cs.drawTool === 'tripwire') {
      if (Math.hypot(x - a.x, y - a.y) > 2) {
        cs.addTripwire(fid, { id: `tw-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, name: cs.nextTripwireName(), x1: a.x, y1: a.y, x2: x, y2: y })
      }
    } else if (cs.drawTool === 'zone') {
      const w = x - a.x, h = y - a.y
      if (Math.abs(w) > 4 && Math.abs(h) > 4) {
        cs.addZone(fid, { id: `zn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, name: cs.nextZoneName(), x: a.x, y: a.y, w, h })
      }
    }
    cs.setDrawTool(null)   // also clears draftPoint
    ghostEnd = null
    drawDraft()
    return true
  }

  const unsubCamera = useCameraStore.subscribe(() => { redraw(); drawDraft() })
  const unsubTracking = useTrackingStore.subscribe(redraw)
  const unsubFloor = useFloorStore.subscribe(redraw)
  const unsubEditor = useEditorStore.subscribe(redraw)
  const unsubViewport = useViewportStore.subscribe(redraw)
  redraw()

  return {
    commitDrawClick,
    detach: () => {
      if (statsTimer) clearTimeout(statsTimer)
      canvasEl.removeEventListener('contextmenu', onContextMenu)
      scene.app.stage.off('pointermove', onStageMove)
      unsubCamera()
      unsubTracking()
      unsubFloor()
      unsubEditor()
      unsubViewport()
      for (const id of Array.from(containers.keys())) remove(id)
      root.destroy({ children: true })
    },
  }
}

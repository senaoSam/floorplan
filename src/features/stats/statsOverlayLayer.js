import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { useViewportStore } from '@/store/useViewportStore'
import { EDITOR_MODE } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useStatsTimeStore } from '@/store/useStatsTimeStore'
import { getSnapshot } from './statsSource'

// On-canvas AP load indicators for STATS mode (Phase 43): each online AP shows
// a client-count BADGE (number in a status-coloured pill) — mirroring how real
// NMS floor plans (Meraki / Aruba Central) surface per-AP load. Deliberately
// NOT a translucent halo/circle: in RF-planning tools a circle round an AP
// reads as its coverage RANGE, so a load "glow" would be misread as signal
// reach. A number pill can't be confused with coverage. A dashboard row hover
// writes useHoverStore and the matching AP pulses a ring (panel↔canvas link).
//
// Load status thresholds (client count): green <15, amber 15–24, red ≥25 —
// aligned with statsSource's util = clientCount/25 baseline.
//
// Snapshot is expensive (RF association sweep), so we cache it and only recompute
// when the plan inputs change — viewport pans/zooms and hover changes just
// redraw from the cached counts.

// Status colours for the load pill (not band colours — load is the message).
const LOAD_GREEN = 0x10b981
const LOAD_AMBER = 0xf59e0b
const LOAD_RED   = 0xef4444
const OFFLINE_GREY = 0x6b7280   // offline AP badge + marker dimming

function loadColor(count) {
  if (count >= 25) return LOAD_RED
  if (count >= 15) return LOAD_AMBER
  return LOAD_GREEN
}

const BADGE_TEXT_STYLE = new TextStyle({
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  fontWeight: '700',
  fill: 0xffffff,
})

export function attachStatsOverlayLayer({
  scene,
  useFloorStore,
  useAPStore,
  useWallStore,
  useScopeStore,
  useCableStore,
  useEditorStore,
}) {
  const layer = scene.layers.overlays
  const root = new Container()
  root.eventMode = 'none'
  layer.addChild(root)
  const g = new Graphics()          // pill backgrounds + hover ring
  g.eventMode = 'none'
  root.addChild(g)
  const labelRoot = new Container() // client-count numbers (sit above the pills)
  labelRoot.eventMode = 'none'
  root.addChild(labelRoot)

  // Reusable Text pool keyed by apId — building Text every frame is costly, so
  // we update in place and hide the leftovers.
  const textPool = new Map()   // apId → Text
  const getText = (apId) => {
    let t = textPool.get(apId)
    if (!t) {
      t = new Text({ text: '', style: BADGE_TEXT_STYLE })
      t.anchor.set(0.5)
      t.eventMode = 'none'
      labelRoot.addChild(t)
      textPool.set(apId, t)
    }
    return t
  }

  let cache = null            // { snapById: Map<apId,{count,band,online}>, floorId }

  const buildCache = () => {
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) { cache = null; return }
    // Displayed moment comes from the shared timeline store (scrubber /
    // playback). Fall back to now if the dashboard hasn't seeded it yet.
    const ts = useStatsTimeStore.getState().playheadTs ?? Date.now()
    const building = {
      floors: useFloorStore.getState().floors,
      apsByFloor: useAPStore.getState().apsByFloor,
      wallsByFloor: useWallStore.getState().wallsByFloor,
      scopesByFloor: useScopeStore.getState().scopesByFloor,
      switchesByFloor: useCableStore.getState().switchesByFloor,
      traysByFloor: useCableStore.getState().traysByFloor,
      risers: useCableStore.getState().risers,
    }
    const snap = getSnapshot(building, fid, { ts })
    const snapById = new Map()
    if (snap) {
      for (const a of snap.ap.perAp) {
        snapById.set(a.apId, { count: a.clientCount, band: a.band, online: a.status === 'online' })
      }
    }
    cache = { snapById, floorId: fid }
  }

  const apPosById = (id) => {
    const fid = useFloorStore.getState().activeFloorId
    const aps = useAPStore.getState().apsByFloor[fid] ?? []
    return aps.find((a) => a.id === id) ?? null
  }

  const redraw = () => {
    g.clear()
    const seen = new Set()
    if (useEditorStore.getState().editorMode !== EDITOR_MODE.STATS || !cache) {
      for (const t of textPool.values()) t.visible = false
      return
    }
    const fid = useFloorStore.getState().activeFloorId
    const aps = useAPStore.getState().apsByFloor[fid] ?? []
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale   // keep badges a constant on-screen size across zoom
    const hover = useHoverStore.getState()

    // Client-count pill per online AP, offset just above the AP marker so it
    // doesn't cover it. Pill width grows with digit count; height fixed.
    const PILL_H = 18
    const PILL_DY = 22   // canvas px above the AP centre (before zoom scale)
    for (const ap of aps) {
      const rec = cache.snapById.get(ap.id)
      const t = getText(ap.id)
      if (!rec) { t.visible = false; continue }
      seen.add(ap.id)

      const offline = !rec.online
      // Offline AP: grey "離線" pill + a grey ring round the AP marker so the
      // dead unit is obvious on the plan (not just missing a number).
      const label = offline ? '離線' : String(rec.count)
      const color = offline ? OFFLINE_GREY : loadColor(rec.count)
      const pillW = offline ? 34 : Math.max(20, 12 + label.length * 8)
      const cx = ap.x
      const cy = ap.y - PILL_DY * s
      const halfW = (pillW / 2) * s
      const halfH = (PILL_H / 2) * s
      // pill background (status colour) + subtle dark outline for contrast on
      // any floor image.
      g.roundRect(cx - halfW, cy - halfH, pillW * s, PILL_H * s, 5 * s)
        .fill({ color, alpha: 0.95 })
      g.roundRect(cx - halfW, cy - halfH, pillW * s, PILL_H * s, 5 * s)
        .stroke({ width: 1 * s, color: 0x0b1220, alpha: 0.5 })
      // Mark the offline AP body too — a grey ring so it reads as "this unit is
      // down", distinct from an online AP that simply has 0 clients.
      if (offline) {
        g.circle(ap.x, ap.y, 15 * s).stroke({ width: 2.5 * s, color: OFFLINE_GREY, alpha: 0.9 })
      }
      // label
      t.visible = true
      t.text = label
      t.position.set(cx, cy)
      t.scale.set(s)
    }

    // Hide pool entries for APs not drawn this frame (offline / removed).
    for (const [apId, t] of textPool) if (!seen.has(apId)) t.visible = false

    // Hover pulse ring on the AP whose dashboard row is hovered — a ring reads
    // as "this one", distinct from the pill.
    if (hover.type === 'ap' && hover.id) {
      const ap = apPosById(hover.id)
      if (ap) {
        g.circle(ap.x, ap.y, 22 * s).stroke({ width: 3 * s, color: 0xffffff, alpha: 0.9 })
        g.circle(ap.x, ap.y, 22 * s).stroke({ width: 1.5 * s, color: 0x4fc3f7, alpha: 1 })
      }
    }
  }

  // Recompute the snapshot cache then redraw. Used for plan-input + playhead
  // changes (a different ts → different client counts → different glow).
  const recomputeAndRedraw = () => {
    if (useEditorStore.getState().editorMode === EDITOR_MODE.STATS) buildCache()
    redraw()
  }

  // Editor-mode change: entering STATS builds a snapshot at the current
  // playhead, leaving drops the cache.
  const onEditor = () => {
    if (useEditorStore.getState().editorMode === EDITOR_MODE.STATS) buildCache()
    else cache = null
    redraw()
  }

  const unsubEditor = useEditorStore.subscribe(onEditor)
  const unsubFloor = useFloorStore.subscribe(recomputeAndRedraw)
  const unsubAP = useAPStore.subscribe(recomputeAndRedraw)
  const unsubSwitch = useCableStore.subscribe(recomputeAndRedraw)
  // Timeline (scrubber / playback) moves the displayed moment → recompute.
  const unsubTime = useStatsTimeStore.subscribe(recomputeAndRedraw)
  // Viewport + hover only redraw (no recompute) — cheap.
  const unsubViewport = useViewportStore.subscribe(redraw)
  const unsubHover = useHoverStore.subscribe(redraw)
  redraw()

  return () => {
    unsubEditor()
    unsubFloor()
    unsubAP()
    unsubSwitch()
    unsubTime()
    unsubViewport()
    unsubHover()
    textPool.clear()
    layer.removeChild(root)
    root.destroy({ children: true })
  }
}

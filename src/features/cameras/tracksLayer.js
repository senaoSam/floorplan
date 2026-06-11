import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useViewportStore } from '@/store/useViewportStore'
import { sampleTrackAt, trackSpeedAt, trackHeadingAt } from './mockTracks'
import { buildBlockingSegments, computeFovPolygon } from './fovPolygon'
import { FALLBACK_PX_PER_M } from './camerasLayer'

// Live tracking icons for Camera mode (Phase 34-2). Renders "the world at
// clockSec": every track active at the current playback clock becomes a
// moving dot with a fading trail. CAMERA mode only (root hidden elsewhere).
//
// Detection semantics — the part that makes camera placement matter: a target
// is "detected" only while it sits inside at least one camera's wall-clipped
// FOV polygon. Detected targets render solid (person amber / car blue);
// undetected ones are faint grey ghosts (hidden entirely when the
// showUndetected toggle is off).
//
// Everything is painted into ONE world-space Graphics per tick (positions
// change every frame anyway, per-icon containers would buy nothing); hover
// uses a stage pointermove probe against the active-icon list instead of
// per-icon hit areas.

const PERSON_COLOR = '#f59e0b'
const CAR_COLOR = '#3b82f6'
// Ghosts must stay readable on a white floor plan — mid-slate with a dark
// outline (a white ring like the detected icons would vanish there).
const UNDETECTED_COLOR = '#64748b'
const UNDETECTED_ALPHA = 0.6
const TRAIL_SEC = 12
const HOVER_TOL_SCREEN_PX = 14

// White core + dark outline — legible on white plans and dark canvas alike.
const LABEL_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  fontWeight: '600',
  stroke: { color: '#0f172a', width: 3, join: 'round' },
  dropShadow: { color: '#000000', blur: 4, distance: 0, alpha: 0.6 },
})

const TYPE_LABEL = { person: '人', car: '車' }

export function attachTracksLayer({
  scene,
  useFloorStore,
  useWallStore,
  useCameraStore,
  useTrackingStore,
}) {
  const root = new Container()
  root.eventMode = 'none'
  root.visible = false
  scene.layers.overlays.addChild(root)
  const g = new Graphics()
  g.eventMode = 'none'
  root.addChild(g)
  const label = new Text({ text: '', style: LABEL_STYLE })
  label.eventMode = 'none'
  label.visible = false
  root.addChild(label)

  const isCameraMode = () => useEditorStore.getState().editorMode === EDITOR_MODE.CAMERA

  const activeFloor = () => {
    const { floors, activeFloorId } = useFloorStore.getState()
    return floors.find((f) => f.id === activeFloorId) ?? null
  }

  // ── FOV polygon cache (cameras × walls × scale signature) ───────────────
  let fovCacheKey = ''
  let fovPolys = []   // [{ cameraId, name, poly }]
  const fovPolygons = () => {
    const fid = useFloorStore.getState().activeFloorId
    const floor = activeFloor()
    const cameras = useCameraStore.getState().camerasByFloor[fid] ?? []
    const walls = useWallStore.getState().wallsByFloor[fid] ?? []
    const scale = floor?.scale ?? FALLBACK_PX_PER_M
    const key = `${fid}::${scale}`
    const sameRefs = fovPolys._cams === cameras && fovPolys._walls === walls && fovCacheKey === key
    if (sameRefs) return fovPolys
    fovCacheKey = key
    const segs = buildBlockingSegments(walls)
    const next = []
    for (const cam of cameras) {
      const poly = computeFovPolygon({
        cx: cam.x, cy: cam.y,
        azimuthDeg: cam.azimuth ?? 0,
        fovDeg: cam.fovDeg ?? 90,
        rangePx: Math.max(1, (cam.rangeM ?? 12) * scale),
        segments: segs,
      })
      if (poly) next.push({ cameraId: cam.id, name: cam.name, poly })
    }
    next._cams = cameras
    next._walls = walls
    fovPolys = next
    return fovPolys
  }

  // Rounded-rect polygon (centred at cx,cy, +x toward `cos/sin` heading) —
  // PIXI Graphics can't rotate primitives in one shared Graphics, so the car
  // body/cabin are emitted as pre-rotated polygons.
  const roundedRectPoly = (cx, cy, halfL, halfW, r, cos, sin, xOff = 0) => {
    const pts = []
    const corners = [
      [halfL - r, halfW - r, 0],            // front-right
      [-halfL + r, halfW - r, Math.PI / 2], // rear-right
      [-halfL + r, -halfW + r, Math.PI],    // rear-left
      [halfL - r, -halfW + r, -Math.PI / 2],// front-left
    ]
    for (const [px, py, a0] of corners) {
      for (let k = 0; k <= 2; k++) {
        const a = a0 + (k / 2) * (Math.PI / 2)
        const lx = px + Math.cos(a) * r + xOff
        const ly = py + Math.sin(a) * r
        pts.push(cx + lx * cos - ly * sin, cy + lx * sin + ly * cos)
      }
    }
    return pts
  }

  // Top-down car, nose pointing along `heading`: body + darker cabin set
  // toward the rear (long hood = front) + windshield bar + two headlights.
  const drawCar = (g, x, y, heading, s, color, alpha, ring) => {
    const cos = Math.cos(heading)
    const sin = Math.sin(heading)
    const L = 15 * s    // half length  (~30px screen)
    const W = 6.5 * s   // half width
    const body = roundedRectPoly(x, y, L, W, 3 * s, cos, sin)
    g.poly(body).fill({ color, alpha }).stroke({ width: 1.5 * s, color: ring, alpha })
    // cabin (rear-biased so the hood reads as the front)
    const cabin = roundedRectPoly(x, y, L * 0.42, W * 0.74, 2 * s, cos, sin, -L * 0.18)
    g.poly(cabin).fill({ color: '#0f172a', alpha: alpha * 0.85 })
    // windshield — light bar just ahead of the cabin
    const wsX = L * 0.32
    const ws = roundedRectPoly(x, y, L * 0.06, W * 0.66, 1 * s, cos, sin, wsX)
    g.poly(ws).fill({ color: '#bae6fd', alpha: alpha * 0.9 })
    // headlights at the front corners
    for (const sideY of [-W * 0.55, W * 0.55]) {
      const hx = x + (L * 0.9) * cos - sideY * sin
      const hy = y + (L * 0.9) * sin + sideY * cos
      g.circle(hx, hy, 1.4 * s).fill({ color: '#fef9c3', alpha })
    }
  }

  const pointInPoly = (x, y, pts) => {
    const n = pts.length / 2
    let inside = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i * 2], yi = pts[i * 2 + 1]
      const xj = pts[j * 2], yj = pts[j * 2 + 1]
      if (((yi > y) !== (yj > y)) &&
          (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside
    }
    return inside
  }

  const detectedBy = (x, y) => {
    for (const f of fovPolygons()) {
      if (pointInPoly(x, y, f.poly)) return f
    }
    return null
  }

  // Active icons from the last redraw — the hover probe searches this list.
  let activeIcons = []   // [{ track, x, y, detected }]

  const redraw = () => {
    g.clear()
    activeIcons = []
    if (!isCameraMode()) { root.visible = false; label.visible = false; return }
    root.visible = true
    const fid = useFloorStore.getState().activeFloorId
    const tr = useTrackingStore.getState()
    const tracks = tr.tracksByFloor[fid] ?? []
    if (tracks.length === 0) { label.visible = false; return }
    const t = tr.clockSec
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale
    const r = 6 * s          // icon radius — constant screen size
    const showGhosts = tr.showUndetected

    for (const track of tracks) {
      if (t < track.t0 || t > track.t1) continue
      const pos = sampleTrackAt(track, t)
      if (!pos) continue
      const det = detectedBy(pos.x, pos.y)
      if (!det && !showGhosts) continue
      activeIcons.push({ track, x: pos.x, y: pos.y, detected: det })

      const color = det ? (track.type === 'car' ? CAR_COLOR : PERSON_COLOR) : UNDETECTED_COLOR
      const alpha = det ? 1 : UNDETECTED_ALPHA

      // Trail — the last TRAIL_SEC of path, faded.
      const tTrail = Math.max(track.t0, t - TRAIL_SEC)
      const pts = [pos]
      // walk waypoints backwards inside the window
      for (let i = track.samples.length - 1; i >= 0; i--) {
        const sm = track.samples[i]
        if (sm.t >= t) continue
        if (sm.t < tTrail) break
        pts.push(sm)
      }
      const start = sampleTrackAt(track, tTrail)
      if (start) pts.push(start)
      for (let i = 0; i + 1 < pts.length; i++) {
        const f = 1 - i / Math.max(1, pts.length - 1)   // fade out along the tail
        g.moveTo(pts[i].x, pts[i].y).lineTo(pts[i + 1].x, pts[i + 1].y)
          .stroke({ width: 2 * s, color, alpha: alpha * 0.5 * f })
      }

      // Icon — person = dot, car = top-down car shape facing its heading.
      // Detected icons ring white (they sit on the tinted FOV); ghosts ring
      // dark so they don't melt into the white floor plan.
      const ring = det ? '#ffffff' : '#1e293b'
      if (track.type === 'car') {
        drawCar(g, pos.x, pos.y, trackHeadingAt(track, t), s, color, alpha, ring)
      } else {
        g.circle(pos.x, pos.y, r)
          .fill({ color, alpha })
          .stroke({ width: 1.5 * s, color: ring, alpha })
      }
    }

    updateHoverLabel()
  }

  // ── Hover probe — nearest active icon within tolerance ──────────────────
  let hoverWorld = null
  const updateHoverLabel = () => {
    if (!hoverWorld || activeIcons.length === 0) { label.visible = false; return }
    const vpScale = useViewportStore.getState().scale || 1
    const tol = HOVER_TOL_SCREEN_PX / vpScale
    let best = null, bestD = tol
    for (const icon of activeIcons) {
      const d = Math.hypot(icon.x - hoverWorld.x, icon.y - hoverWorld.y)
      if (d <= bestD) { bestD = d; best = icon }
    }
    if (!best) { label.visible = false; return }
    const floor = activeFloor()
    const pxPerM = floor?.scale ?? FALLBACK_PX_PER_M
    const speedM = trackSpeedAt(best.track, useTrackingStore.getState().clockSec) / pxPerM
    const who = TYPE_LABEL[best.track.type] ?? best.track.type
    const detTxt = best.detected ? `📹 ${best.detected.name}` : '未偵測'
    label.text = `${who} ${best.track.id.slice(-3)} · ${speedM.toFixed(1)} m/s · ${detTxt}`
    const s = 1 / vpScale
    label.scale.set(s)
    label.position.set(best.x + 10 * s, best.y - 22 * s)
    label.visible = true
  }

  const onStageMove = (e) => {
    if (!isCameraMode()) return
    hoverWorld = scene.world.toLocal(e.global)
    updateHoverLabel()
    scene.requestRender()
  }
  scene.app.stage.on('pointermove', onStageMove)

  const unsubTracking = useTrackingStore.subscribe(redraw)
  const unsubEditor = useEditorStore.subscribe(redraw)
  const unsubFloor = useFloorStore.subscribe(redraw)
  const unsubCamera = useCameraStore.subscribe(redraw)
  const unsubWall = useWallStore.subscribe(redraw)
  const unsubViewport = useViewportStore.subscribe(redraw)
  redraw()

  return () => {
    scene.app.stage.off('pointermove', onStageMove)
    unsubTracking()
    unsubEditor()
    unsubFloor()
    unsubCamera()
    unsubWall()
    unsubViewport()
    scene.layers.overlays.removeChild(root)
    root.destroy({ children: true })
  }
}

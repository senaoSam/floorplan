import { Container, Graphics } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useViewportStore } from '@/store/useViewportStore'
import { useFloorStore } from '@/store/useFloorStore'
import { getGapMarker, clearGapMarker, subscribeGapMarker, GAP_MARKER_LIFETIME_MS } from './gapMarkerBus'

// Biggest-blind-spot marker layer. When a coverage panel flashes a marker
// (gapMarkerBus), this draws a pulsing amber ring at that image-px point,
// fading out over LIFETIME_MS so it's clearly a transient "look here" cue.
// Self-stopping rAF — no animation when no marker is active.
//
// Lives in the `overlays` world layer (same layer the live-tracking icons use,
// which is known to render reliably) so it sits above the FOV cones + blind
// shading and isn't touched by other layers' redraws.

const RING_COLOR = 0xf59e0b
const LIFETIME_MS = GAP_MARKER_LIFETIME_MS
const BASE_R = 30          // base ring radius in screen px (inverse-scaled)

// The view is never moved to the gap, so when the gap sits outside the canvas
// the ring would flash where nobody can see it. Then an arrow pinned just
// inside the canvas edge points toward it instead (screen px).
const EDGE_INSET = 40      // arrow tip distance from the canvas edge
const ARROW_LEN = 30
const ARROW_HALF_W = 12
// Dart notch depth (share of ARROW_LEN): a plain triangle reads as "▲" when it
// points diagonally; the notched tail makes the direction unambiguous.
const ARROW_NOTCH = 0.4

export function attachGapMarkerLayer({ scene }) {
  const root = new Container()
  root.eventMode = 'none'
  root.visible = false
  scene.layers.overlays.addChild(root)
  const g = new Graphics()
  g.eventMode = 'none'
  root.addChild(g)

  const isCameraMode = () => useEditorStore.getState().editorMode === EDITOR_MODE.CAMERA
  // A camera blind spot means nothing on the Wi-Fi heatmap and vice versa:
  // draw a marker only in the mode family its panel lives in.
  const isMarkerMode = (m) => (m.source === 'heatmap') !== isCameraMode()
  // 53-G6 (23t/P4#8): the marker's (x, y) is image-px on the floor that flashed
  // it. Draw only on that floor — otherwise the amber ring appeared on another
  // floor at coordinates that mean nothing there, pointing at a blind spot that
  // doesn't exist. Reading the guard here (rather than clearing on switch) means
  // the marker survives a there-and-back switch within its lifetime, which is
  // the friendlier behaviour.
  const isMarkerFloor = (m) =>
    !m.floorId || m.floorId === useFloorStore.getState().activeFloorId

  let raf = 0
  const draw = () => {
    const m = getGapMarker()
    if (!m || !isMarkerMode(m) || !isMarkerFloor(m)) { root.visible = false; g.clear(); raf = 0; scene.requestRender(); return }
    const age = performance.now() - m.bornMs
    if (age >= LIFETIME_MS) { clearGapMarker(); root.visible = false; g.clear(); raf = 0; scene.requestRender(); return }

    root.visible = true
    const fade = 1 - age / LIFETIME_MS
    const inv = 1 / (useViewportStore.getState().scale || 1)
    const pulse = 0.5 + 0.5 * Math.sin((age / 1000) * 2 * Math.PI * 1.6)

    g.clear()

    // Off-screen gap → edge arrow instead of the ring. The gap's screen
    // position goes through the layer's own transform, not just the viewport:
    // in ALIGN_FLOOR contentWrap adds the floor's align transform on top.
    const W = scene.app.screen.width
    const H = scene.app.screen.height
    const { x: sx, y: sy } = root.toGlobal({ x: m.x, y: m.y })
    if (W > EDGE_INSET * 2 && H > EDGE_INSET * 2
      && (sx < 0 || sx > W || sy < 0 || sy > H)) {
      drawEdgeArrow(sx, sy, W, H, inv, pulse, fade)
      scene.requestRender()
      raf = requestAnimationFrame(draw)
      return
    }
    // Filled halo + two concentric pulsing rings + a white centre dot, so the
    // gap reads unmistakably over the green tint / blind shading.
    const r1 = BASE_R * inv * (0.8 + pulse * 0.5)
    const r2 = BASE_R * inv * (1.5 + pulse * 0.85)
    g.circle(m.x, m.y, r2).fill({ color: RING_COLOR, alpha: 0.16 * fade })
    g.circle(m.x, m.y, r1).stroke({ width: 4 * inv, color: RING_COLOR, alpha: 0.95 * fade })
    g.circle(m.x, m.y, r2).stroke({ width: 2.5 * inv, color: RING_COLOR, alpha: 0.55 * fade })
    g.circle(m.x, m.y, 5 * inv).fill({ color: 0xffffff, alpha: fade })
    g.circle(m.x, m.y, 5 * inv).stroke({ width: 1.5 * inv, color: RING_COLOR, alpha: fade })

    scene.requestRender()
    raf = requestAnimationFrame(draw)
  }
  const kick = () => { if (raf === 0) raf = requestAnimationFrame(draw) }

  // Arrow pinned to the inset canvas rectangle on the ray from the canvas
  // centre to the gap, pointing at the gap. Built in screen px, then mapped
  // back to world coords (g lives in the world-transformed overlays layer).
  function drawEdgeArrow(sx, sy, W, H, inv, pulse, fade) {
    const cx = W / 2
    const cy = H / 2
    const dx = sx - cx
    const dy = sy - cy
    const halfW = W / 2 - EDGE_INSET
    const halfH = H / 2 - EDGE_INSET
    const t = Math.min(
      dx !== 0 ? halfW / Math.abs(dx) : Infinity,
      dy !== 0 ? halfH / Math.abs(dy) : Infinity,
    )
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const tipX = cx + dx * t
    const tipY = cy + dy * t
    const toWorld = (px, py) => {
      const p = root.toLocal({ x: px, y: py })
      return [p.x, p.y]
    }
    // Nudge the arrow along its direction with the pulse so it reads as
    // "over there", not as a static badge.
    const nudge = pulse * 6
    const tx = tipX + ux * nudge
    const ty = tipY + uy * nudge
    const bx = tx - ux * ARROW_LEN
    const by = ty - uy * ARROW_LEN
    const [wx, wy] = toWorld(tx, ty)
    const [lx, ly] = toWorld(bx - uy * ARROW_HALF_W, by + ux * ARROW_HALF_W)
    const [rx, ry] = toWorld(bx + uy * ARROW_HALF_W, by - ux * ARROW_HALF_W)
    const [nx, ny] = toWorld(bx + ux * ARROW_LEN * ARROW_NOTCH, by + uy * ARROW_LEN * ARROW_NOTCH)
    const [hx, hy] = toWorld(bx + ux * ARROW_LEN * 0.5, by + uy * ARROW_LEN * 0.5)
    const dart = [wx, wy, lx, ly, nx, ny, rx, ry]

    g.circle(hx, hy, (BASE_R * 0.9 + pulse * 6) * inv).fill({ color: RING_COLOR, alpha: 0.18 * fade })
    g.poly(dart).fill({ color: RING_COLOR, alpha: 0.95 * fade })
    g.poly(dart).stroke({ width: 2 * inv, color: 0xffffff, alpha: fade })
  }

  const unsub = subscribeGapMarker(kick)
  // The loop stops while the marker doesn't apply here; restart it when the
  // floor or mode changes back within the marker's lifetime.
  const unsubEditor = useEditorStore.subscribe(kick)
  const unsubFloor = useFloorStore.subscribe(kick)

  return () => {
    unsub()
    unsubEditor()
    unsubFloor()
    if (raf !== 0) cancelAnimationFrame(raf)
    scene.layers.overlays.removeChild(root)
    root.destroy({ children: true })
  }
}

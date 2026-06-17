import { Container, Graphics } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useViewportStore } from '@/store/useViewportStore'
import { getGapMarker, clearGapMarker, subscribeGapMarker } from './gapMarkerBus'

// Biggest-blind-spot marker layer. When the coverage panel flashes a marker
// (gapMarkerBus), this draws a pulsing amber ring at that image-px point,
// fading out over LIFETIME_MS so it's clearly a transient "look here" cue.
// Self-stopping rAF — no animation when no marker is active.
//
// Lives in the `overlays` world layer (same layer the live-tracking icons use,
// which is known to render reliably) so it sits above the FOV cones + blind
// shading and isn't touched by other layers' redraws.

const RING_COLOR = 0xf59e0b
const LIFETIME_MS = 4500
const BASE_R = 30          // base ring radius in screen px (inverse-scaled)

export function attachGapMarkerLayer({ scene }) {
  const root = new Container()
  root.eventMode = 'none'
  root.visible = false
  scene.layers.overlays.addChild(root)
  const g = new Graphics()
  g.eventMode = 'none'
  root.addChild(g)

  const isCameraMode = () => useEditorStore.getState().editorMode === EDITOR_MODE.CAMERA

  let raf = 0
  const draw = () => {
    const m = getGapMarker()
    if (!m || !isCameraMode()) { root.visible = false; g.clear(); raf = 0; scene.requestRender(); return }
    const age = performance.now() - m.bornMs
    if (age >= LIFETIME_MS) { clearGapMarker(); root.visible = false; g.clear(); raf = 0; scene.requestRender(); return }

    root.visible = true
    const fade = 1 - age / LIFETIME_MS
    const inv = 1 / (useViewportStore.getState().scale || 1)
    const pulse = 0.5 + 0.5 * Math.sin((age / 1000) * 2 * Math.PI * 1.6)

    g.clear()
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

  const unsub = subscribeGapMarker(kick)

  return () => {
    unsub()
    if (raf !== 0) cancelAnimationFrame(raf)
    scene.layers.overlays.removeChild(root)
    root.destroy({ children: true })
  }
}

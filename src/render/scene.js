import { Application, Container } from 'pixi.js'

// Per spec §3.3 — 13 named layer containers under a single `world` Container
// that owns the viewport transform. Background is the PIXI Application
// `background` clear color (screen-space, no Container needed).
//
// Layer order (back to front, world-space):
//   1  floorImage    — floor PNG / JPG / multi-floor stack
//   2  heatmap       — raw WebGL2 canvas wrapped in PIXI.Sprite
//   3  walls         — PIXI.Mesh + custom line shader
//   4  scopes        — Graphics for Scope / FloorHole / RefWall / RefVector
//   5  cables        — PIXI.Mesh + dashed line shader (eventMode='none')
//   6  trays         — Container + Graphics + vertex handles
//   7a devicesAP     — Sprite atlas batch
//   7b devicesSW     — Container per switch (chassis + ports + label)
//   7c devicesRiser  — Sprite per riser
//   8  overlays      — visual feedback (snap halo / draft / badge / marquee)
//   9  handles       — interactive (tray vertex, scale endpoints, transformer)
//  10  labels        — SDF / MSDF text
const LAYER_KEYS = [
  'floorImage',
  'heatmap',
  'walls',
  'scopes',
  'cables',
  'trays',
  'devicesAP',
  'devicesSW',
  'devicesRiser',
  'overlays',
  'handles',
  'labels',
]

export async function initScene({ container, background = '#1e1e2e' }) {
  const app = new Application()
  // Renderer preference defaults to WebGPU (auto-falls back to WebGL2 when the
  // browser lacks WebGPU). Dev override: append ?renderer=webgl to force WebGL2
  // so we can reproduce no-hardware-WebGPU / software-render environments.
  let preference = 'webgpu'
  try {
    const r = new URLSearchParams(window.location.search).get('renderer')
    if (r === 'webgl' || r === 'webgl2') preference = 'webgl'
    if (r === 'webgpu') preference = 'webgpu'
  } catch { /* no-op */ }
  await app.init({
    resizeTo: container,
    background,
    antialias: true,
    preference,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  })
  container.appendChild(app.canvas)
  app.canvas.style.display = 'block'

  const world = new Container()
  world.label = 'world'
  app.stage.addChild(world)

  // refOverlay sits BELOW all per-active-floor content so that ALIGN_FLOOR
  // mode's tinted reference floors paint underneath the active floor (the
  // active floor is the "anchor" the user is aligning to). It receives
  // only the viewport transform (via world) — each ref floor's per-floor
  // alignTransform is applied to a sub-Container inside refOverlay by
  // attachRefOverlayLayer. Outside ALIGN_FLOOR mode this Container is
  // empty / hidden.
  const refOverlay = new Container()
  refOverlay.label = 'refOverlay'
  refOverlay.visible = false
  world.addChild(refOverlay)

  // contentWrap is the parent of every per-active-floor layer. Outside
  // ALIGN_FLOOR mode it's the identity (so the layers render at their
  // natural world position); in ALIGN_FLOOR mode bindAlignTransform sets
  // its position/pivot/rotation/scale to the active floor's align
  // transform so the active floor's preview moves alongside the
  // reference floors as the user adjusts the panel sliders.
  const contentWrap = new Container()
  contentWrap.label = 'contentWrap'
  world.addChild(contentWrap)

  const layers = {}
  for (const key of LAYER_KEYS) {
    const c = new Container()
    c.label = key
    layers[key] = c
    contentWrap.addChild(c)
  }

  // Cables are pure visual — disable hit-test entirely.
  layers.cables.eventMode = 'none'

  // ── Render-on-demand ────────────────────────────────────────────────────
  // PIXI's default ticker re-renders the whole scene 60×/s even when nothing
  // changed. On hardware GPUs that's free, but on SOFTWARE renderers
  // (chrome://gpu "hardware acceleration unavailable" — incognito, VMs, remote
  // desktops, old machines) every frame re-rasterises the full scene (72k+
  // cable instructions, AP markers, heatmap) on the CPU → idle/hover/drag all
  // jank. We can't assume users have hardware accel, so we drive rendering
  // ourselves: render only when something actually changed.
  //
  // requestRender() schedules a render on the next animation frame; many calls
  // in one tick coalesce into a single render. A small frame "budget" keeps
  // rendering for a few extra frames after the last request so layers that
  // settle slightly late in the same gesture (async heatmap texture upload,
  // a follow-up store write) aren't missed — the belt-and-suspenders the
  // safety-net design calls for. Idle cost drops from 60 renders/s to 0.
  app.ticker.stop()
  let rafId = 0
  let renderBudget = 0
  const RENDER_BUDGET_FRAMES = 2  // render this many frames per requestRender
  const frame = () => {
    app.renderer.render(app.stage)
    renderBudget -= 1
    if (renderBudget > 0) {
      rafId = requestAnimationFrame(frame)
    } else {
      rafId = 0
    }
  }
  const requestRender = () => {
    renderBudget = RENDER_BUDGET_FRAMES
    if (!rafId) rafId = requestAnimationFrame(frame)
  }
  // Canvas resize (window / panel layout change) needs a repaint — the ticker
  // is stopped so PIXI won't repaint on its own resize.
  app.renderer.on('resize', requestRender)
  // First paint.
  app.renderer.render(app.stage)

  return {
    app,
    world,
    refOverlay,
    contentWrap,
    layers,
    requestRender,
    destroy() {
      if (rafId) cancelAnimationFrame(rafId)
      app.destroy(true, { children: true, texture: false })
    },
  }
}

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
  await app.init({
    resizeTo: container,
    background,
    antialias: true,
    preference: 'webgpu',
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

  return {
    app,
    world,
    refOverlay,
    contentWrap,
    layers,
    destroy() {
      app.destroy(true, { children: true, texture: false })
    },
  }
}

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

export async function initScene({ container, background = '#0f1419' }) {
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

  const layers = {}
  for (const key of LAYER_KEYS) {
    const c = new Container()
    c.label = key
    layers[key] = c
    world.addChild(c)
  }

  // Cables are pure visual — disable hit-test entirely.
  layers.cables.eventMode = 'none'

  return {
    app,
    world,
    layers,
    destroy() {
      app.destroy(true, { children: true, texture: false })
    },
  }
}

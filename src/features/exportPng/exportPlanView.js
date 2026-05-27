import { Rectangle } from 'pixi.js'

// PIXI v8 port of oldSrc/features/editor/exportPlanView.js — Phase 25
// Bundle 22.
//
// Strategy:
//   1. Snapshot the world container's current transform (pan + zoom +
//      per-layer state).
//   2. Reset world to identity (so the image sits at world (0, 0, W, H)).
//   3. Use renderer.extract.canvas({ target: world, frame, resolution })
//      to bake a PNG covering exactly the floor image rect.
//   4. Restore world transform so the user's pan/zoom is unchanged.
//
// PIXI v8's extract works on any DisplayObject and respects current
// `visible` / `alpha` flags — same "whatever the user toggled in
// LayerToggle survives" behaviour as the Konva path.

const MAX_PNG_LONG_EDGE = 8000

export function capturePlanPng({ app, world, imageWidth, imageHeight, pixelRatio = 2 }) {
  if (!app || !world || !imageWidth || !imageHeight) return null

  const longEdge = Math.max(imageWidth, imageHeight)
  const safeRatio = Math.min(pixelRatio, MAX_PNG_LONG_EDGE / longEdge)

  // Snapshot world transform.
  const prevX = world.position.x
  const prevY = world.position.y
  const prevSX = world.scale.x
  const prevSY = world.scale.y

  try {
    // Reset world to identity so (0, 0, W, H) world == (0, 0, W, H) canvas.
    world.position.set(0, 0)
    world.scale.set(1, 1)

    const canvas = app.renderer.extract.canvas({
      target: world,
      frame: new Rectangle(0, 0, imageWidth, imageHeight),
      resolution: safeRatio,
      antialias: true,
    })
    if (!canvas) return null
    return canvas.toDataURL('image/png')
  } finally {
    world.position.set(prevX, prevY)
    world.scale.set(prevSX, prevSY)
  }
}

// Trigger a browser download of a data URL. Returns true if the download
// fired (false on SSR / missing DOM).
export function triggerImageDownload(dataUrl, filename = 'plan.png') {
  if (typeof document === 'undefined') return false
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  return true
}

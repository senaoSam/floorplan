import { Graphics } from 'pixi.js'

// Bundle 9+ — every object type now paints its own hover visual in
// its own layer (body invert for AP / Switch / Tray / Scope, white
// beam stroke for Wall). The centralised hoverOverlay was doubling
// up: it drew a world-space ring on top of the in-layer paint, and
// because the overlay graphics is NOT screen-space-scaled the ring
// ballooned at higher zooms. Kept the module + Graphics stub so
// callers don't break, but no drawing happens here anymore.

export function attachHoverOverlay({ scene }) {
  const layer = scene.layers.overlays
  const g = new Graphics()
  g.eventMode = 'none'
  layer.addChild(g)
  return () => {
    layer.removeChild(g)
    g.destroy()
  }
}

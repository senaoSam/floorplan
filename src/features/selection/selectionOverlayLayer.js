import { Graphics } from 'pixi.js'

// Centralised selection-visual layer. Bundle 7 onward, every object type
// paints its own selection emphasis in its own layer:
//
//   AP     → red body stroke (apsLayer)
//   Switch → red chassis stroke (switchesLayer)
//   Wall   → thicker halo + body stroke (wallsLayer)
//   Tray   → white border channel (traysLayer)
//   Scope  → red 5-px stroke (scopesLayer)
//
// In-layer is the right architecture because tray's white selection border
// would otherwise sit on the overlays layer (z-index 8), which is ABOVE
// devicesSW (7b) — that hides the SW chassis under the highlight when a
// tray is selected.
//
// This module is kept as a stub so callers / subscriptions don't break,
// but it intentionally paints nothing.

export function attachSelectionOverlay({ scene }) {
  const layer = scene.layers.overlays
  const g = new Graphics()
  g.eventMode = 'none' // pure visual — never intercept clicks
  layer.addChild(g)
  return () => {
    layer.removeChild(g)
    g.destroy()
  }
}

// 22-3 PNG plan view export.
//
// Bake the current Konva canvas (background image + heatmap if on +
// vector layers as visible per LayerToggle) into a PNG file the user can
// drop into a report or slide deck.
//
// Strategy:
//   1. Snapshot the stage's current viewport (pan + zoom)
//   2. Reset the stage transform so the floor's image fills (0, 0, W, H)
//      in canvas coords — i.e. the export covers the WHOLE plan, not just
//      the area the user happens to be looking at
//   3. Capture via stage.toDataURL({ pixelRatio: 2 }) — Konva walks every
//      layer it owns, so heatmap + vector layers come along for free.
//      Whatever the user has toggled in LayerToggle survives because the
//      layers' `visible` flags don't change.
//   4. Restore the snapshot so the user's view is exactly where they
//      left it.
//
// Caveats:
//   - HTML overlays (LayerToggle / 設備規劃 / mode badge / sidebars) do
//     NOT get included — Konva can only render its own canvas. This is
//     the intended behaviour (the export is a "plan figure", not a
//     screenshot).
//   - There's one paint where the stage is re-rendered at fit-to-content
//     before we restore — usually invisible (sub-frame), but on slow
//     machines you may see a flash. Acceptable trade-off.

// Browser canvas dimension cap. Per spec each side is limited to 32 767
// device pixels in most browsers, but the **memory** limit in Safari /
// iOS lands first around the 8 192 × 8 192 mark. Clamp the long edge
// here so very large floors don't trip silent renderer failures.
const MAX_PNG_LONG_EDGE = 8000

// Capture a stage as a PNG data URL at the desired pixelRatio. Caller
// passes the Konva stage instance + the floor's image dims (in canvas
// units) so we know what rectangle to bake.
//
// Returns a data URL (`data:image/png;base64,...`) on success, or null
// if the stage isn't available / floor has no imageWidth.
export function capturePlanPng({ stage, imageWidth, imageHeight, pixelRatio = 2 }) {
  if (!stage || !imageWidth || !imageHeight) return null

  // Clamp pixelRatio so the resulting bitmap stays under the long-edge cap.
  const longEdge = Math.max(imageWidth, imageHeight)
  const safeRatio = Math.min(pixelRatio, MAX_PNG_LONG_EDGE / longEdge)

  // ── 1. Snapshot current viewport ─────────────────────────────────────
  // We touch the stage's transform + size directly. The React-Konva tree
  // re-syncs from React state on the next render, which happens
  // automatically when this function returns (it doesn't call setState,
  // so React doesn't actually re-render — the visible state stays in
  // sync with the user's pre-export viewport).
  //
  // Wait — that's only true if we restore stage props before returning.
  // We do.
  const prevX      = stage.x()
  const prevY      = stage.y()
  const prevScaleX = stage.scaleX()
  const prevScaleY = stage.scaleY()
  const prevW      = stage.width()
  const prevH      = stage.height()

  try {
    // ── 2. Reset stage to image-bounded transform ─────────────────────
    stage.scale({ x: 1, y: 1 })
    stage.position({ x: 0, y: 0 })
    stage.size({ width: imageWidth, height: imageHeight })

    // ── 3. Capture ────────────────────────────────────────────────────
    // toDataURL forces a synchronous redraw of every layer at the
    // requested pixelRatio. No need to call draw() ourselves.
    const dataUrl = stage.toDataURL({
      mimeType: 'image/png',
      pixelRatio: safeRatio,
      x: 0,
      y: 0,
      width: imageWidth,
      height: imageHeight,
    })
    return dataUrl
  } finally {
    // ── 4. Restore — runs even if toDataURL threw ────────────────────
    stage.size({ width: prevW, height: prevH })
    stage.scale({ x: prevScaleX, y: prevScaleY })
    stage.position({ x: prevX, y: prevY })
    stage.batchDraw()
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

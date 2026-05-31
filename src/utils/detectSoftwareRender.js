// 任務 4 (a): detect whether WebGL2 is backed by a software rasteriser
// (SwiftShader / "Software" / llvmpipe) rather than a real GPU. On a software
// renderer the heatmap's per-AP shader passes run on a single CPU core and are
// ~tens of ms each, so the large-scene reflection/diffraction downgrade
// (任務 4b) must kick in at a much lower wall×AP threshold than on real GPU
// hardware. HW GPUs keep full quality far longer.
//
// Reads UNMASKED_RENDERER_WEBGL via WEBGL_debug_renderer_info. The string
// format varies across browsers/drivers, so we match case-insensitively
// against the known software-renderer markers. If the extension is missing or
// anything throws, we fail OPEN (return false = "assume hardware") — a wrong
// "software" verdict would needlessly degrade quality on a capable machine,
// whereas a missed "software" verdict just means the user hits the same
// large-scene cost they already had before this feature.
//
// Cached after the first call: the renderer can't change within a page load.
let cached = null

const SOFTWARE_MARKERS = [
  'swiftshader',
  'software',
  'llvmpipe',
  'microsoft basic render',  // Windows fallback adapter
]

export function detectSoftwareRender() {
  if (cached !== null) return cached
  cached = false
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) { cached = false; return cached }
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) { cached = false; return cached }
    const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toLowerCase()
    cached = SOFTWARE_MARKERS.some((m) => renderer.includes(m))
    // Free the probe context promptly (some browsers cap live WebGL contexts).
    const lose = gl.getExtension('WEBGL_lose_context')
    if (lose) lose.loseContext()
  } catch (_) {
    cached = false
  }
  return cached
}

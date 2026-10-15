// Gap-marker bus — a tiny module-level channel so a coverage panel (React)
// can ping the canvas (PIXI) to flash a "biggest blind spot here" marker at a
// given image-px point. The marker layer subscribes and animates a pulsing
// ring that fades out after a few seconds, so clicking "locate biggest gap"
// reads as "the gap is HERE" — the view itself is left where the user put it.
//
// Two panels flash it: the camera CoveragePanel ('camera') and the Wi-Fi
// DevicePlanningPanel ('heatmap'). The source is part of the payload so a
// marker only draws in the mode that flashed it.

let marker = null   // { x, y, bornMs, floorId, source, blindMask } in image-px, or null
const listeners = new Set()

// How long a flash lives. The bus expires the marker itself: the ring layer's
// rAF loop stops while the marker doesn't apply (other floor / other mode), so
// leaving it to the loop let a marker — and the blind shade riding on it —
// outlive its flash and reappear on coming back.
export const GAP_MARKER_LIFETIME_MS = 4500
let expireTimer = 0

// Flash the marker at (x,y). bornMs is a wall-clock timestamp the caller passes
// (the panel stamps performance.now()); the layer uses it to fade over time.
//
// 53-G6 (23t/P4#8): floorId is part of the payload because (x, y) is image-px
// on ONE floor. The marker outlives a floor switch by design (it fades on a
// timer, not on navigation), so without the stamp the amber ring flashed on
// floor B at floor A's coordinates — pointing at a blind spot that isn't there.
// Self-describing payload rather than a cleanup call: the layer compares, so a
// stale marker simply doesn't draw.
//
// blindMask (heatmap only, planQuality's shape) lets the blind-shade layer
// briefly darken the whole blind area alongside the ring, as the camera panel
// does by toggling its blind-spot overlay. It lives and dies with the marker.
export function flashGapMarker(x, y, bornMs, floorId = null, source = 'camera', blindMask = null) {
  const m = { x, y, bornMs, floorId, source, blindMask }
  marker = m
  clearTimeout(expireTimer)
  expireTimer = setTimeout(() => { if (marker === m) clearGapMarker() }, GAP_MARKER_LIFETIME_MS)
  for (const fn of listeners) fn()
}

export function getGapMarker() {
  return marker
}

export function clearGapMarker() {
  if (!marker) return
  marker = null
  for (const fn of listeners) fn()
}

export function subscribeGapMarker(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

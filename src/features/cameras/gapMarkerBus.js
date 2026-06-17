// Gap-marker bus — a tiny module-level channel so the coverage panel (React)
// can ping the canvas (PIXI) to flash a "biggest blind spot here" marker at a
// given image-px point. The marker layer subscribes and animates a pulsing
// ring that fades out after a few seconds, so clicking "locate biggest gap"
// reads as "the gap is HERE", not just an unexplained pan.

let marker = null   // { x, y, bornMs } in image-px, or null
const listeners = new Set()

// Flash the marker at (x,y). bornMs is a wall-clock timestamp the caller passes
// (the panel stamps performance.now()); the layer uses it to fade over time.
export function flashGapMarker(x, y, bornMs) {
  marker = { x, y, bornMs }
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

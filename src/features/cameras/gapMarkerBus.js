// Gap-marker bus — a tiny module-level channel so the coverage panel (React)
// can ping the canvas (PIXI) to flash a "biggest blind spot here" marker at a
// given image-px point. The marker layer subscribes and animates a pulsing
// ring that fades out after a few seconds, so clicking "locate biggest gap"
// reads as "the gap is HERE", not just an unexplained pan.

let marker = null   // { x, y, bornMs, floorId } in image-px, or null
const listeners = new Set()

// Flash the marker at (x,y). bornMs is a wall-clock timestamp the caller passes
// (the panel stamps performance.now()); the layer uses it to fade over time.
//
// 53-G6 (23t/P4#8): floorId is part of the payload because (x, y) is image-px
// on ONE floor. The marker outlives a floor switch by design (it fades on a
// timer, not on navigation), so without the stamp the amber ring flashed on
// floor B at floor A's coordinates — pointing at a blind spot that isn't there.
// Self-describing payload rather than a cleanup call: the layer compares, so a
// stale marker simply doesn't draw.
export function flashGapMarker(x, y, bornMs, floorId = null) {
  marker = { x, y, bornMs, floorId }
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

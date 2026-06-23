// Detection bus (Verkada parity — FOV pulse). A tiny module-level channel that
// carries "which cameras are currently detecting a target" from the tracks
// layer (which already computes detection every frame) to the cameras layer
// (which draws the FOV cones), WITHOUT routing high-frequency per-frame data
// through a Zustand store (that would fire every store subscriber each frame).
//
// tracksLayer writes the live set every redraw; camerasLayer subscribes to get
// nudged to repaint its cones with a pulsing alpha. The pulse phase itself is
// derived from the playback clock, so no extra rAF is introduced.

const detectingIds = new Set()
const listeners = new Set()

// Replace the set of camera ids that currently see ≥1 target. Notifies the
// cameras layer only when the membership actually changed — a camera gaining
// or losing a target — so a still frame doesn't trigger needless repaints.
export function setDetectingCameras(ids) {
  let changed = ids.size !== detectingIds.size
  if (!changed) {
    for (const id of ids) {
      if (!detectingIds.has(id)) { changed = true; break }
    }
  }
  if (!changed) return
  detectingIds.clear()
  for (const id of ids) detectingIds.add(id)
  for (const fn of listeners) fn()
}

export function isCameraDetecting(id) {
  return detectingIds.has(id)
}

export function anyDetecting() {
  return detectingIds.size > 0
}

export function subscribeDetection(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Clear on teardown so a stale set can't leak across mode/floor switches.
export function resetDetection() {
  if (detectingIds.size === 0) return
  detectingIds.clear()
  for (const fn of listeners) fn()
}

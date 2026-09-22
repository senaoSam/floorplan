// Shared flag between the in-scene floor tabs and CameraRig.
//
// OrbitControls binds its own pointerdown to the canvas element, so it fires
// before — and independently of — r3f's synthetic pointer events. That means a
// click on a 3D control cannot be kept away from it by stopPropagation: the
// controls' `start` event fires anyway, CameraRig reads it as "the user is
// taking the camera", and cancels the floor-change lift the click just asked
// for. The lift then stops at whatever height it had reached.
//
// A tab marks its pointerdown here; CameraRig checks the mark in the same
// gesture and leaves the tween alone. Scoped to one gesture by the timestamp,
// so a stale mark can never suppress a real camera grab.
const CLAIM_WINDOW_MS = 400

let claimedAt = 0

// Called by a 3D control when its own pointerdown starts a click it owns.
export function claimPointerForUi() {
  claimedAt = performance.now()
}

// Called by CameraRig when OrbitControls reports the user grabbing the camera.
// True means "this gesture belongs to a control, don't treat it as a grab".
export function pointerClaimedByUi() {
  return performance.now() - claimedAt < CLAIM_WINDOW_MS
}

// Tiny pub-sub bridging the 2D heatmap adapter's painted canvas to other
// consumers (currently HeatmapPlane3D). The adapter publishes a frame record
// after every paintCanvas — the canvas pixels are already composited
// (colormap + blur + contours), so consumers only re-upload it as a texture;
// no propagation math runs on their side. Publish null when there is no
// heatmap to show (disabled / no APs / adapter torn down).
//
// Frame shape (all px values in image-pixel space, see heatmapAdapter ctx):
//   {
//     canvas,           // heatmapGL's canvas — padded region, composited
//     padLpx, padTpx,   // left/top padding, image px
//     fullW, fullH,     // padded total size, image px
//     imgW, imgH,       // floor image size, image px
//     floorId,          // floor the frame was computed for
//   }
// A NEW object is published per paint so subscribers can use reference
// equality (React setState) to detect repaints of the same canvas.

let current = null
const subscribers = new Set()

export function publishHeatmapFrame(frame) {
  current = frame
  for (const fn of subscribers) fn(current)
}

export function getHeatmapFrame() {
  return current
}

// Returns an unsubscribe function (usable directly as a React effect cleanup).
export function subscribeHeatmapFrame(fn) {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

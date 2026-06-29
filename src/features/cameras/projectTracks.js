import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii } from './fovPolygon'

// Stage-2 calibration glue: bind each (floor-space, wall-aware) mock track to
// the camera that sees it, so a manual calibration can later re-project it.
//
// Why this shape (see verkada-notes §L3/§L5 + the stage-2 plan): tracks are
// generated in floor px with the existing wall-avoiding model (frame space has
// no walls, so generating there would walk through them). Calibration is a
// MANUAL step (like Verkada) — there is no auto default. So:
//   • generation only assigns each track a `cameraId` (the first camera whose
//     FOV contains its start). `samples` stays in floor px → an uncalibrated
//     camera's tracks display exactly as generated (demo is never empty).
//   • the FIRST manual calibration of a camera freezes `frameSamples` =
//     H⁻¹·samples (the track in that camera's frame). samples = H·frameSamples
//     then equals the original floor path — first calibration doesn't move it.
//   • a LATER recalibration to H' gives samples = H'·frameSamples ≠ original —
//     the tracks shift, which is the visible point of calibration.

const pointInPoly = (x, y, pts) => {
  const n = pts.length / 2
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1]
    const xj = pts[j * 2], yj = pts[j * 2 + 1]
    if (((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside
  }
  return inside
}

// FOV polygons for every camera (calibration not required — binding is purely
// "whose cone covers this point").
function buildCameraFovs(cameras, walls, scale) {
  const segs = buildBlockingSegments(walls)
  const out = []
  for (const cam of cameras) {
    const { minRangePx, rangePx } = cameraCoverageRadii(cam, scale)
    const poly = computeFovPolygon({
      cx: cam.x, cy: cam.y,
      azimuthDeg: cam.azimuth ?? 0,
      fovDeg: cam.fovDeg ?? 90,
      rangePx, minRangePx,
      segments: segs,
    })
    if (poly) out.push({ cameraId: cam.id, poly })
  }
  return out
}

// Assign each track the first camera whose FOV contains its start point
// (returns a new array). `samples` is left untouched — still the generated
// floor path. Tracks outside every FOV keep cameraId undefined (ghosts).
export function bindTracksToCameras(tracks, cameras, walls, scale) {
  const fovs = buildCameraFovs(cameras, walls, scale)
  if (fovs.length === 0) return tracks
  return tracks.map((trk) => {
    const s0 = trk.samples[0]
    const cam = fovs.find((f) => pointInPoly(s0.x, s0.y, f.poly))
    return cam ? { ...trk, cameraId: cam.cameraId } : trk
  })
}

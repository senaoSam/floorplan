import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii } from './fovPolygon'
import { deviceStatus, DEVICE_STATUS } from './deviceStatus'

// Coverage statistics for Camera mode (planning aid). Rasterises every online
// camera's wall-clipped FOV polygon into an offscreen coverage count buffer,
// then reports what fraction of the floor is seen, blind, or redundantly
// covered. The denominator is the whole floor-image area — the same region the
// blind-spot overlay shades — so the numbers match what's drawn on screen.
//
// Per pixel we accumulate how many cameras can see it (overlap count), which
// gives both the simple covered/blind split and the redundancy figure
// (≥2 cameras = a camera can fail without creating a blind spot there).

const MAX_CANVAS_PX = 900   // sampling resolution cap — plenty for a percentage

// Returns null when there's nothing to measure, else:
//   { coveredPct, blindPct, redundantPct, cameraCount, onlineCount,
//     coveredAreaM2, blindAreaM2, avgOverlap }
export function computeCoverageStats({ cameras, walls, floor }) {
  if (!floor?.imageWidth || !floor?.imageHeight) return null
  const W = floor.imageWidth
  const H = floor.imageHeight
  const scale = floor.scale ?? 40   // px per metre (FALLBACK_PX_PER_M)

  const online = (cameras ?? []).filter((c) => deviceStatus(c) !== DEVICE_STATUS.OFFLINE)
  const segs = buildBlockingSegments(walls)

  const k = Math.min(1, MAX_CANVAS_PX / Math.max(W, H))
  const cw = Math.max(1, Math.round(W * k))
  const ch = Math.max(1, Math.round(H * k))
  const total = cw * ch

  // Per-camera: rasterise its polygon alone on a scratch canvas, then read back
  // and add into the integer overlap-count buffer. (Compositing all at once
  // can't distinguish overlap depth; one pass per camera can.)
  const counts = new Uint8Array(total)
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  for (const cam of online) {
    const { minRangePx, rangePx } = cameraCoverageRadii(cam, scale)
    const poly = computeFovPolygon({
      cx: cam.x, cy: cam.y,
      azimuthDeg: cam.azimuth ?? 0,
      fovDeg: cam.fovDeg ?? 90,
      rangePx, minRangePx,
      segments: segs,
    })
    if (!poly || poly.length < 6) continue
    ctx.clearRect(0, 0, cw, ch)
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.moveTo(poly[0] * k, poly[1] * k)
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i] * k, poly[i + 1] * k)
    ctx.closePath()
    ctx.fill()
    const data = ctx.getImageData(0, 0, cw, ch).data
    for (let p = 0, px = 0; p < data.length; p += 4, px++) {
      if (data[p + 3] > 40) counts[px] += 1   // alpha hit → one more camera sees it
    }
  }

  let covered = 0
  let redundant = 0
  let overlapSum = 0
  for (let i = 0; i < total; i++) {
    const c = counts[i]
    if (c > 0) { covered += 1; overlapSum += c }
    if (c >= 2) redundant += 1
  }

  // Area per sampled pixel in m²: each sample covers (1/k px)² of image space.
  const pxPerSample = 1 / k
  const m2PerSample = (pxPerSample / scale) * (pxPerSample / scale)

  return {
    cameraCount: (cameras ?? []).length,
    onlineCount: online.length,
    coveredPct: (covered / total) * 100,
    blindPct: ((total - covered) / total) * 100,
    redundantPct: (redundant / total) * 100,
    coveredAreaM2: covered * m2PerSample,
    blindAreaM2: (total - covered) * m2PerSample,
    avgOverlap: covered > 0 ? overlapSum / covered : 0,
  }
}

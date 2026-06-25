import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii } from './fovPolygon'
import { deviceStatus, DEVICE_STATUS } from './deviceStatus'

// Shared FOV → per-pixel coverage-count rasteriser. Both the coverage-stats
// report and the overlap overlay need the same thing: take every online
// camera's wall-clipped FOV polygon, rasterise each one alone on a scratch
// canvas, and accumulate how many cameras can see each pixel into an integer
// count buffer. (One pass per camera — compositing all at once can't tell
// overlap depth.) The two callers diverge only afterwards: one tallies
// percentages, the other colourises the buffer.

const ALPHA_HIT = 40   // scratch-canvas alpha above this = the pixel is inside the polygon

// Returns { counts: Uint8Array, cw, ch, k, total } sampled at resolution
// capped by maxCanvasPx, or null when there's nothing to rasterise.
export function rasterizeCoverageCounts({ cameras, walls, floor, maxCanvasPx }) {
  if (!floor?.imageWidth || !floor?.imageHeight) return null
  const W = floor.imageWidth
  const H = floor.imageHeight
  const scale = floor.scale ?? 40   // px per metre (FALLBACK_PX_PER_M)

  const online = (cameras ?? []).filter((c) => deviceStatus(c) !== DEVICE_STATUS.OFFLINE)
  const segs = buildBlockingSegments(walls)

  const k = Math.min(1, maxCanvasPx / Math.max(W, H))
  const cw = Math.max(1, Math.round(W * k))
  const ch = Math.max(1, Math.round(H * k))
  const total = cw * ch
  const counts = new Uint8Array(total)

  const scratch = document.createElement('canvas')
  scratch.width = cw
  scratch.height = ch
  const ctx = scratch.getContext('2d', { willReadFrequently: true })

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
      if (data[p + 3] > ALPHA_HIT && counts[px] < 255) counts[px] += 1
    }
  }

  return { counts, cw, ch, k, total }
}

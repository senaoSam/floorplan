import { rasterizeCoverageCounts } from './fovRasterize'
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
  const raster = rasterizeCoverageCounts({ cameras, walls, floor, maxCanvasPx: MAX_CANVAS_PX })
  if (!raster) return null
  const { counts, cw, ch, k, total } = raster
  const scale = floor.scale ?? 40   // px per metre (FALLBACK_PX_PER_M)
  const online = (cameras ?? []).filter((c) => deviceStatus(c) !== DEVICE_STATUS.OFFLINE)

  let covered = 0
  let redundant = 0
  let overlapSum = 0
  for (let i = 0; i < total; i++) {
    const c = counts[i]
    if (c > 0) { covered += 1; overlapSum += c }
    if (c >= 2) redundant += 1
  }

  // Find the coarse grid cell with the most blind (0-camera) pixels — the
  // "biggest gap" the user should consider covering. Returned in image-px so
  // the panel can recentre the viewport there. Cheap second pass over counts.
  const GRID = 8   // 8×8 coarse cells over the sampled buffer
  const cellW = Math.ceil(cw / GRID)
  const cellH = Math.ceil(ch / GRID)
  const blindPerCell = new Int32Array(GRID * GRID)
  for (let y = 0; y < ch; y++) {
    const gy = Math.min(GRID - 1, Math.floor(y / cellH))
    for (let x = 0; x < cw; x++) {
      if (counts[y * cw + x] === 0) {
        const gx = Math.min(GRID - 1, Math.floor(x / cellW))
        blindPerCell[gy * GRID + gx] += 1
      }
    }
  }
  let worstCell = -1
  let worstBlind = 0
  for (let i = 0; i < blindPerCell.length; i++) {
    if (blindPerCell[i] > worstBlind) { worstBlind = blindPerCell[i]; worstCell = i }
  }
  let biggestGap = null
  if (worstCell >= 0 && worstBlind > 0) {
    const gx = worstCell % GRID
    const gy = Math.floor(worstCell / GRID)
    // cell centre, sampled-px → image-px
    biggestGap = {
      x: ((gx + 0.5) * cellW) / k,
      y: ((gy + 0.5) * cellH) / k,
    }
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
    biggestGap,   // {x,y} image-px of the densest blind cell, or null
  }
}

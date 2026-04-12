// Web Worker：RSSI Heatmap 計算
// 在背景執行緒執行 FSPL + Ray-casting 牆體衰減，不阻塞主線程

const FREQ_MHZ = { 2.4: 2437, 5: 5500, 6: 6000 }

const COLOR_STOPS = [
  { rssi: -45,  r: 0,   g: 230, b: 118, a: 200 },
  { rssi: -60,  r: 100, g: 220, b: 30,  a: 185 },
  { rssi: -70,  r: 255, g: 200, b: 0,   a: 170 },
  { rssi: -80,  r: 255, g: 80,  b: 0,   a: 150 },
  { rssi: -90,  r: 210, g: 0,   b: 0,   a: 120 },
  { rssi: -100, r: 120, g: 0,   b: 0,   a: 60  },
]

function rssiToRGBA(rssi) {
  if (rssi >= COLOR_STOPS[0].rssi) {
    const s = COLOR_STOPS[0]
    return [s.r, s.g, s.b, s.a]
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1]
  if (rssi <= last.rssi) return null

  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const s1 = COLOR_STOPS[i]
    const s2 = COLOR_STOPS[i + 1]
    if (rssi >= s2.rssi) {
      const t = (rssi - s1.rssi) / (s2.rssi - s1.rssi)
      return [
        Math.round(s1.r + (s2.r - s1.r) * t),
        Math.round(s1.g + (s2.g - s1.g) * t),
        Math.round(s1.b + (s2.b - s1.b) * t),
        Math.round(s1.a + (s2.a - s1.a) * t),
      ]
    }
  }
  return null
}

// ── 線段相交判斷 ─────────────────────────────────────────
// 用叉積（cross product）判斷兩線段是否相交
function cross(ox, oy, ax, ay, bx, by) {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox)
}

function segmentsIntersect(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
  const d1 = cross(p3x, p3y, p4x, p4y, p1x, p1y)
  const d2 = cross(p3x, p3y, p4x, p4y, p2x, p2y)
  const d3 = cross(p1x, p1y, p2x, p2y, p3x, p3y)
  const d4 = cross(p1x, p1y, p2x, p2y, p4x, p4y)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true

  return false
}

// ── 計算從像素點到 AP 之間穿越的牆體總衰減 (dB) ─────────
function calcWallLoss(cx, cy, apX, apY, walls) {
  let totalLoss = 0
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]
    if (segmentsIntersect(cx, cy, apX, apY, w.startX, w.startY, w.endX, w.endY)) {
      totalLoss += w.dbLoss
    }
  }
  return totalLoss
}

// ── 主計算入口 ────────────────────────────────────────────
self.onmessage = (e) => {
  const { aps, walls, viewport, floorScale, width, height, step } = e.data
  const { x: vpX, y: vpY, scale: vpS } = viewport

  const offW = Math.ceil(width  / step)
  const offH = Math.ceil(height / step)
  const buffer = new Uint8ClampedArray(offW * offH * 4)

  for (let iy = 0; iy < offH; iy++) {
    const cy = (iy * step - vpY) / vpS   // canvas y

    for (let ix = 0; ix < offW; ix++) {
      const cx = (ix * step - vpX) / vpS  // canvas x

      let maxRSSI = -Infinity

      for (let ai = 0; ai < aps.length; ai++) {
        const ap = aps[ai]
        const dx = cx - ap.x
        const dy = cy - ap.y
        const distPx = Math.sqrt(dx * dx + dy * dy)

        let rssi
        if (distPx < 0.5) {
          rssi = ap.txPower
        } else {
          const distM   = distPx / floorScale
          const freqMHz = FREQ_MHZ[ap.frequency] ?? 5500
          const fspl    = 20 * Math.log10(distM) + 20 * Math.log10(freqMHz) + 32.44
          const wallLoss = walls.length > 0 ? calcWallLoss(cx, cy, ap.x, ap.y, walls) : 0
          rssi = ap.txPower - fspl - wallLoss
        }

        if (rssi > maxRSSI) maxRSSI = rssi
      }

      const color = rssiToRGBA(maxRSSI)
      if (!color) continue

      const idx = (iy * offW + ix) * 4
      buffer[idx]     = color[0]
      buffer[idx + 1] = color[1]
      buffer[idx + 2] = color[2]
      buffer[idx + 3] = color[3]
    }
  }

  // 轉移 ArrayBuffer（zero-copy），避免複製開銷
  self.postMessage(
    { buffer: buffer.buffer, offW, offH, canvasW: width, canvasH: height },
    [buffer.buffer]
  )
}

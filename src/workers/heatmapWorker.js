/**
 * Heatmap Web Worker
 * 在背景執行 RSSI 計算，避免阻塞主執行緒
 */

const FSPL_CONST = 20 // Free Space Path Loss 常數

/**
 * 自由空間路徑損耗 (dB)
 * FSPL = 20*log10(d) + 20*log10(f) + 20*log10(4π/c)
 * 簡化版：FSPL(dB) ≈ 20*log10(d_m) + 20*log10(f_MHz) - 27.55
 */
function calcFSPL(distanceM, frequencyGHz) {
  if (distanceM <= 0) return 0
  const freqMHz = frequencyGHz * 1000
  return 20 * Math.log10(distanceM) + 20 * Math.log10(freqMHz) - 27.55
}

/**
 * 計算兩線段是否相交（Ray-casting 牆體阻擋判斷）
 */
function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
  if (denom === 0) return false
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

/**
 * 計算 AP 到某格點的 RSSI (dBm)
 */
function calcRSSI({ ap, px, py, walls, pxPerMeter }) {
  const dx = (px - ap.x) / pxPerMeter
  const dy = (py - ap.y) / pxPerMeter
  const dz = ap.z  // AP 安裝高度視為與地面的距離差
  const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz)

  let attenuation = calcFSPL(dist3D, ap.frequency)

  // 累加穿牆衰減
  for (const wall of walls) {
    const intersects = segmentsIntersect(
      ap.x, ap.y, px, py,
      wall.startX, wall.startY, wall.endX, wall.endY
    )
    if (intersects) {
      attenuation += wall.material.dbLoss
    }
  }

  return ap.txPower - attenuation
}

self.onmessage = ({ data }) => {
  const { aps, walls, canvasWidth, canvasHeight, gridSize, pxPerMeter } = data
  const cols = Math.ceil(canvasWidth / gridSize)
  const rows = Math.ceil(canvasHeight / gridSize)

  // 每個格點取所有 AP 中最強的 RSSI
  const result = new Float32Array(cols * rows)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = col * gridSize + gridSize / 2
      const py = row * gridSize + gridSize / 2
      let best = -Infinity

      for (const ap of aps) {
        const rssi = calcRSSI({ ap, px, py, walls, pxPerMeter })
        if (rssi > best) best = rssi
      }

      result[row * cols + col] = best
    }
  }

  self.postMessage({ result, cols, rows, gridSize })
}

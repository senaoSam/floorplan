import { getAPModelById } from '@/constants/apModels'

// Frequency in MHz for each band, used in FSPL.
const FREQ_MHZ = { 2.4: 2437, 5: 5500, 6: 6000 }

// Minimum allowable TX power — below this, the radio is effectively off.
const MIN_TX_POWER = 5

// Target cell-edge RSSI at the nearest neighbour AP.
// -67 dBm is Cisco's recommended voice-grade threshold; two overlapping APs
// both hitting -67 at their shared edge gives seamless roaming without
// excessive co-channel interference.
export const DEFAULT_TARGET_RSSI = -67

// Log-distance path loss (same formula as HeatmapWebGL):
//   PL(dB) = 10·n·log10(d) + 20·log10(f_MHz) − 27.55
function pathLoss(distanceMeters, freqGHz, n) {
  const d = Math.max(distanceMeters, 0.1)
  const fMhz = FREQ_MHZ[freqGHz] ?? 5500
  return 10 * n * Math.log10(d) + 20 * Math.log10(fMhz) - 27.55
}

// For each AP, find the nearest same-band neighbour and derive the minimum
// TX power that still delivers targetRSSI at that neighbour's location.
// Isolated APs (no same-band neighbour) default to their model's max power.
//
// Parameters:
//   aps           — array of AP objects (id, x, y, frequency, modelId, …)
//   scalePxPerM   — floor.scale in px/m (required; caller must check)
//   pathLossN     — environment path-loss exponent (useEditorStore.pathLossExponent)
//   targetRSSI    — cell-edge target in dBm (default -67)
//
// Returns: Map<apId, { txPower }>
export function greedyPowerAssign(aps, scalePxPerM, pathLossN, targetRSSI = DEFAULT_TARGET_RSSI) {
  const result = new Map()
  if (!scalePxPerM || scalePxPerM <= 0) return result

  for (const ap of aps) {
    const model = getAPModelById(ap.modelId)
    const band = ap.frequency
    const maxTx = model.maxTxPower?.[band] ?? 23
    const gain  = model.antennaGain?.[band] ?? 0

    // Nearest same-band neighbour (canvas-px Euclidean distance).
    let nearestPx = Infinity
    for (const other of aps) {
      if (other.id === ap.id) continue
      if (other.frequency !== band) continue
      const d = Math.hypot(ap.x - other.x, ap.y - other.y)
      if (d < nearestPx) nearestPx = d
    }

    let txPower
    if (!isFinite(nearestPx)) {
      // No neighbour → use full power.
      txPower = maxTx
    } else {
      const distM = nearestPx / scalePxPerM
      const pl = pathLoss(distM, band, pathLossN)
      // RSSI = P_tx + G_ant − PL   →   P_tx = RSSI − G_ant + PL
      txPower = targetRSSI - gain + pl
    }

    txPower = Math.max(MIN_TX_POWER, Math.min(maxTx, Math.round(txPower)))
    result.set(ap.id, { txPower })
  }

  return result
}

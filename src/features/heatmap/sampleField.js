// Sample RSSI / SINR / SNR / CCI on a coarse grid — adapter over the per-AP
// propagation module. Out-of-scope grid cells get NaN so the GL shader's NaN
// check renders them transparent.

import { rssiFromAp, aggregateApContributions } from './propagation'

// CCI floor for visualisation. When no co-channel interferer exists, cciDbm is
// -Infinity (see aggregateApContributions). We clamp to this for the sampled
// array so the colormap / blur stay numerically well-behaved.
const CCI_MIN_DBM = -120

export function sampleField(scenario, gridStepM = 0.5, opts = {}) {
  const { w, h } = scenario.size
  const nx = Math.ceil(w / gridStepM) + 1
  const ny = Math.ceil(h / gridStepM) + 1
  const rssi = new Float32Array(nx * ny)
  const sinr = new Float32Array(nx * ny)
  const snr  = new Float32Array(nx * ny)
  const cci  = new Float32Array(nx * ny)

  const mask = scenario.scopeMaskFn ?? (() => true)

  // Cross-floor context: propagation reads `floorBoundaries` from opts, and
  // `rx.zM` per sample. When scenario has no boundaries we're in single-floor
  // planar mode and propagation ignores both.
  const boundaries = scenario.floorBoundaries ?? null
  const rxZM = scenario.rxElevationM ?? 0
  const propOpts = { ...opts, floorBoundaries: boundaries }

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * gridStepM
      const y = j * gridStepM
      const idx = j * nx + i
      if (!mask(x, y)) {
        rssi[idx] = NaN
        sinr[idx] = NaN
        snr[idx]  = NaN
        cci[idx]  = NaN
        continue
      }
      const rx = { x, y, zM: rxZM }
      const perAp = []
      for (const ap of scenario.aps) {
        const { rssiDbm } = rssiFromAp(ap, rx, scenario.walls, scenario.corners, propOpts)
        perAp.push(rssiDbm)
      }
      if (perAp.length === 0) {
        rssi[idx] = -120
        sinr[idx] = -50
        snr[idx]  = -50
        cci[idx]  = CCI_MIN_DBM
        continue
      }
      const agg = aggregateApContributions(perAp, scenario.aps)
      rssi[idx] = agg.rssiDbm
      sinr[idx] = agg.sinrDb
      snr[idx]  = agg.snrDb
      cci[idx]  = isFinite(agg.cciDbm) ? agg.cciDbm : CCI_MIN_DBM
    }
  }
  return { rssi, sinr, snr, cci, nx, ny, gridStepM }
}

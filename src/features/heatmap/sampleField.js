// Sample RSSI on a coarse grid — adapter over the per-AP propagation module.
//
// Differs from heatmap_sample/src/render/heatmap.js in two ways:
//   1) Calls our per-AP rssiFromAp (so each AP uses its own frequency)
//   2) Honours scope mask — out-of-scope grid cells get NaN so the GL shader's
//      NaN check renders them transparent.

import { rssiFromAp, aggregateApContributions } from './propagation'

export function sampleField(scenario, gridStepM = 0.5, opts = {}) {
  const { w, h } = scenario.size
  const nx = Math.ceil(w / gridStepM) + 1
  const ny = Math.ceil(h / gridStepM) + 1
  const rssi = new Float32Array(nx * ny)
  const sinr = new Float32Array(nx * ny)

  const mask = scenario.scopeMaskFn ?? (() => true)

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * gridStepM
      const y = j * gridStepM
      if (!mask(x, y)) {
        rssi[j * nx + i] = NaN
        sinr[j * nx + i] = NaN
        continue
      }
      const rx = { x, y }
      const perAp = []
      for (const ap of scenario.aps) {
        const { rssiDbm } = rssiFromAp(ap, rx, scenario.walls, scenario.corners, opts)
        perAp.push(rssiDbm)
      }
      if (perAp.length === 0) {
        rssi[j * nx + i] = -120
        sinr[j * nx + i] = -50
        continue
      }
      const agg = aggregateApContributions(perAp, scenario.aps)
      rssi[j * nx + i] = agg.rssiDbm
      sinr[j * nx + i] = agg.sinrDb
    }
  }
  return { rssi, sinr, nx, ny, gridStepM }
}

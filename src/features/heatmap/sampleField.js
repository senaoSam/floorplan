// Sample RSSI / SINR / SNR / CCI on a coarse grid — adapter over the per-AP
// propagation module. Out-of-scope grid cells get NaN so the GL shader's NaN
// check renders them transparent.
//
// `opts.padding` (meters, default 0 on each side) extends the sampled grid
// outside the scenario rectangle. Without padding, when an AP sits close to a
// plan edge the iso-contours that should bend out into "free space" instead
// get clamped to the last grid texel and form straight-edge artefacts. Padding
// gives the contours room to breathe; the plan view crops the visible heatmap
// back to [0, w] × [0, h] so the user only sees the original area but with
// physically-correct edge behaviour. The scope mask is bypassed inside the
// padding region for the same reason.

import { rssiFromAp, aggregateApContributions } from './propagation'

// CCI floor for visualisation. When no co-channel interferer exists, cciDbm is
// -Infinity (see aggregateApContributions). We clamp to this for the sampled
// array so the colormap / blur stay numerically well-behaved.
const CCI_MIN_DBM = -120

export function sampleField(scenario, gridStepM = 0.5, opts = {}) {
  const { w, h } = scenario.size
  const pad = opts.padding ?? { left: 0, right: 0, top: 0, bottom: 0 }
  const padL = pad.left   ?? 0
  const padR = pad.right  ?? 0
  const padT = pad.top    ?? 0
  const padB = pad.bottom ?? 0
  const totalW = w + padL + padR
  const totalH = h + padT + padB
  const originX = -padL
  const originY = -padT
  const nx = Math.ceil(totalW / gridStepM) + 1
  const ny = Math.ceil(totalH / gridStepM) + 1
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
      const x = originX + i * gridStepM
      const y = originY + j * gridStepM
      const idx = j * nx + i
      // Scope mask only constrains samples inside the original plan rect;
      // padded samples are always evaluated so contours have room to bend.
      const insidePlan = (x >= 0 && x <= w && y >= 0 && y <= h)
      if (insidePlan && !mask(x, y)) {
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
  return { rssi, sinr, snr, cci, nx, ny, gridStepM, originX, originY }
}

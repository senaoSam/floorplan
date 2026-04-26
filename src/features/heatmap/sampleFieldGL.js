// GPU-backed sampler. Mirrors `sampleField.js`'s output shape exactly so the
// host (HeatmapLayer / diff harness) is unchanged.
//
// Two execution paths:
//
//   1. Aggregated (HM-F5g) — single fragment shader pass loops every AP per
//      fragment, distance-culls APs whose free-space-only RSSI is below the
//      usable floor, and writes (rssi, sinr, snr, cci) into a single RGBA32F
//      target. Output is read back once. Eligible iff:
//        - opts.maxReflOrder is 0 (no image-source reflections)
//        - opts.enableDiffraction is false (no knife-edge diffraction)
//        - no AP has antennaMode === 'custom'
//        - no out-of-scope mask (scopes still applied host-side post-render)
//      This path solves the N_AP host dispatch overhead that dominated 1000+
//      AP scenes (per-AP path is O(N_AP) GL submits + N_AP readPixels).
//
//   2. Per-AP fallback (HM-F5a..F5d) — original behaviour. Each AP renders
//      its own R32F grid, then `aggregateApContributions` folds them into the
//      4 fields on the CPU. Used when refl/diff is on or any custom AP is
//      present — the per-fragment NMAX coherent-sum + N_AP loop would explode
//      register pressure on the GPU, and custom-pattern APs need JS-side
//      lobe sampling that hasn't been ported to GLSL.

import { rssiFromAp, aggregateApContributions } from './propagation'
import { createPropagationGL } from './propagationGL'
import {
  AP_ANT_GAIN_DBI, RX_ANT_GAIN_DBI, NOISE_FLOOR_DBM,
} from './rfConstants.js'

const CCI_MIN_DBM = -120
// Free-space-only RSSI floor used to cull faraway APs in the aggregated path.
// Matches the JS engine's "no signal" sentinel; an AP whose best possible RSSI
// at this fragment is below the floor cannot contribute to either signal or
// CCI, so skipping it is exact.
const CULL_FLOOR_DBM = -120

let glInstance = null
function getGL() {
  if (!glInstance) glInstance = createPropagationGL()
  return glInstance
}

// Decide whether the aggregated single-pass path is safe for this scenario.
function canUseAggregated(scenario, opts) {
  if (opts?.maxReflOrder && opts.maxReflOrder > 0) return false
  if (opts?.enableDiffraction) return false
  for (const ap of scenario.aps) {
    if (ap.antennaMode === 'custom') return false
  }
  return true
}

export function sampleFieldGL(scenario, gridStepM = 0.5, opts = {}) {
  const gl = getGL()
  const { w, h } = scenario.size
  // Optional padding extends the sampled grid outside the scenario rectangle
  // so iso-contours don't get clamped at the plan edges (the bilinear sampler
  // in heatmapGL uses CLAMP_TO_EDGE, which otherwise turns out-of-grid contour
  // arcs into straight rectangle edges). Caller crops the heatmap canvas back
  // to the plan view; padded samples only matter for what bleeds in from
  // outside through bilinear filtering.
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
  const mask = scenario.scopeMaskFn ?? (() => true)
  const rxZM = scenario.rxElevationM ?? 0

  const boundaries = scenario.floorBoundaries ?? []
  gl.uploadWalls(scenario.walls)
  gl.uploadCorners(scenario.corners ?? [])
  const slabMeta = gl.uploadSlabs(boundaries)

  if (canUseAggregated(scenario, opts)) {
    // ---- HM-F5g aggregated path ----
    // Decorate APs with the constant gains the shader expects, then upload
    // once for the single dispatch.
    const apsForGL = scenario.aps.map((ap) => ({
      ...ap,
      _antGainDbi: AP_ANT_GAIN_DBI,
    }))
    gl.uploadAps(apsForGL)
    const out = gl.renderField(scenario, gridStepM, { x: originX, y: originY }, rxZM, slabMeta, {
      _rxGainDbi: RX_ANT_GAIN_DBI,
      noiseDbm: NOISE_FLOOR_DBM,
      cullFloorDbm: CULL_FLOOR_DBM,
      gridSize: { nx, ny },
    })

    // Apply scope mask host-side (cheaper than encoding it into the shader,
    // and the dominant cost is the per-fragment AP loop anyway). Mask only
    // applies inside the original plan rect; padded samples bypass it so
    // contours bending into the margin survive the crop.
    const { rssi, sinr, snr, cci } = out
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i
        const x = originX + i * gridStepM
        const y = originY + j * gridStepM
        const insidePlan = (x >= 0 && x <= w && y >= 0 && y <= h)
        if (insidePlan && !mask(x, y)) {
          rssi[idx] = NaN; sinr[idx] = NaN; snr[idx] = NaN; cci[idx] = NaN
          continue
        }
        // Empty-AP sentinel: shader writes -120/-50/-50/-120; preserve floors.
        if (cci[idx] < CCI_MIN_DBM) cci[idx] = CCI_MIN_DBM
      }
    }
    return { rssi, sinr, snr, cci, nx, ny, gridStepM, originX, originY }
  }

  // ---- per-AP fallback (refl on, diff on, or custom AP present) ----
  const perApGrids = []
  for (let k = 0; k < scenario.aps.length; k++) {
    const ap = scenario.aps[k]
    const apForGL = {
      ...ap,
      _antGainDbi: AP_ANT_GAIN_DBI,
      _rxGainDbi: RX_ANT_GAIN_DBI,
    }
    const { rssi: shaderGrid } = gl.renderAp(
      apForGL, scenario, gridStepM, { x: originX, y: originY }, rxZM, slabMeta,
      { ...opts, gridSize: { nx, ny } },
    )

    if (ap.antennaMode === 'custom') {
      // Custom-pattern AP fallback to JS for the antenna lobe — opts are
      // forwarded verbatim so refl/diff/freqN stay in sync with the shader's
      // own gating.
      const corrected = new Float32Array(shaderGrid.length)
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = j * nx + i
          const x = originX + i * gridStepM
          const y = originY + j * gridStepM
          const rx = { x, y, zM: rxZM }
          const { rssiDbm } = rssiFromAp(ap, rx, scenario.walls, scenario.corners, {
            ...opts,
            floorBoundaries: boundaries,
          })
          corrected[idx] = rssiDbm
        }
      }
      perApGrids.push(corrected)
    } else {
      perApGrids.push(shaderGrid)
    }
  }

  const rssi = new Float32Array(nx * ny)
  const sinr = new Float32Array(nx * ny)
  const snr  = new Float32Array(nx * ny)
  const cci  = new Float32Array(nx * ny)

  const perApScratch = new Array(scenario.aps.length)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i
      const x = originX + i * gridStepM
      const y = originY + j * gridStepM
      const insidePlan = (x >= 0 && x <= w && y >= 0 && y <= h)
      if (insidePlan && !mask(x, y)) {
        rssi[idx] = NaN; sinr[idx] = NaN; snr[idx] = NaN; cci[idx] = NaN
        continue
      }
      if (scenario.aps.length === 0) {
        rssi[idx] = -120; sinr[idx] = -50; snr[idx] = -50; cci[idx] = CCI_MIN_DBM
        continue
      }
      for (let k = 0; k < scenario.aps.length; k++) {
        perApScratch[k] = perApGrids[k][idx]
      }
      const agg = aggregateApContributions(perApScratch, scenario.aps, NOISE_FLOOR_DBM)
      rssi[idx] = agg.rssiDbm
      sinr[idx] = agg.sinrDb
      snr[idx]  = agg.snrDb
      cci[idx]  = isFinite(agg.cciDbm) ? agg.cciDbm : CCI_MIN_DBM
    }
  }

  return { rssi, sinr, snr, cci, nx, ny, gridStepM, originX, originY }
}

export function disposeGL() {
  if (glInstance) {
    glInstance.dispose()
    glInstance = null
  }
}

// Bench / debug: switch the shader between brute-force (per-wall loop) and
// grid traversal at runtime. Useful for measuring the F5b speedup on a fixed
// scenario without rebuilding textures.
export function setUseGrid(v) {
  if (glInstance) glInstance.setUseGrid(v)
}

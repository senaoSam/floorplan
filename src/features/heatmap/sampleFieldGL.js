// GPU-backed sampler. Mirrors `sampleField.js`'s output shape exactly so the
// host (HeatmapLayer / diff harness) is unchanged. Each AP gets its own
// per-cell RSSI grid via a fragment-shader pass; the per-AP grids are folded
// into rssi/sinr/snr/cci on the CPU using the existing `aggregateApContributions`.
//
// Stage gate: HM-F5a — Friis + walls + slab + openings only. Reflections,
// diffraction and multi-frequency coherent averaging are out of scope here
// (lands in F5c/F5d). Custom-pattern APs are rendered as omni in shader and
// have their per-cell contribution overwritten by a CPU-side rssiFromAp call
// so the antenna lobe is still respected.

import { rssiFromAp, aggregateApContributions } from './propagation'
import { createPropagationGL } from './propagationGL'
import {
  AP_ANT_GAIN_DBI, RX_ANT_GAIN_DBI, NOISE_FLOOR_DBM,
} from '@/heatmap_sample/physics/constants.js'

const CCI_MIN_DBM = -120

// Lazy-init the GL context on first call. Throws if WebGL2 isn't available
// — caller should fall back to the CPU sampler.
let glInstance = null
function getGL() {
  if (!glInstance) glInstance = createPropagationGL()
  return glInstance
}

export function sampleFieldGL(scenario, gridStepM = 0.5, opts = {}) {
  const gl = getGL()
  const { w, h } = scenario.size
  const nx = Math.ceil(w / gridStepM) + 1
  const ny = Math.ceil(h / gridStepM) + 1
  const mask = scenario.scopeMaskFn ?? (() => true)
  const rxZM = scenario.rxElevationM ?? 0

  // Build slab record list expanded across (boundary × bypass-hole) pairs —
  // see uploadSlabs comment in propagationGL for why the duplication is safe.
  const boundaries = scenario.floorBoundaries ?? []
  gl.uploadWalls(scenario.walls)
  const slabMeta = gl.uploadSlabs(boundaries)

  // Render every AP. Custom-pattern APs need full JS for now; we still run
  // the shader for them (output is "omni-equivalent") but overwrite from JS
  // afterwards so the lobe is correct. This keeps the codepath uniform until
  // F5d adds a sampled-pattern texture.
  const perApGrids = []
  for (let k = 0; k < scenario.aps.length; k++) {
    const ap = scenario.aps[k]
    const apForGL = {
      ...ap,
      _antGainDbi: AP_ANT_GAIN_DBI,
      _rxGainDbi: RX_ANT_GAIN_DBI,
    }
    const { rssi: shaderGrid } = gl.renderAp(apForGL, scenario, gridStepM, { x: 0, y: 0 }, rxZM, slabMeta)

    if (ap.antennaMode === 'custom') {
      const corrected = new Float32Array(shaderGrid.length)
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = j * nx + i
          const x = i * gridStepM
          const y = j * gridStepM
          const rx = { x, y, zM: rxZM }
          const { rssiDbm } = rssiFromAp(ap, rx, scenario.walls, scenario.corners, {
            ...opts,
            floorBoundaries: boundaries,
            maxReflOrder: 0,        // F5a doesn't do reflections
            enableDiffraction: false,
          })
          corrected[idx] = rssiDbm
        }
      }
      perApGrids.push(corrected)
    } else {
      perApGrids.push(shaderGrid)
    }
  }

  // ---- aggregate per-cell ----
  const rssi = new Float32Array(nx * ny)
  const sinr = new Float32Array(nx * ny)
  const snr  = new Float32Array(nx * ny)
  const cci  = new Float32Array(nx * ny)

  const perApScratch = new Array(scenario.aps.length)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i
      const x = i * gridStepM
      const y = j * gridStepM
      if (!mask(x, y)) {
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

  return { rssi, sinr, snr, cci, nx, ny, gridStepM }
}

// Test/cleanup hook — primarily for the diff harness in headless mode where
// the GL context shouldn't be cached across server restarts.
export function disposeGL() {
  if (glInstance) {
    glInstance.dispose()
    glInstance = null
  }
}

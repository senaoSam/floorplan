// In-browser benchmark — compares JS engine vs Shader engine (with and
// without the F5b uniform-grid acceleration) across synthetic scenarios of
// varying scale. Use to confirm that F5b actually wins at the scale the
// user cares about (≥ ~100 walls).
//
// Synthetic scenarios are generated deterministically with a seeded RNG so
// every run is reproducible. All engines see identical inputs.

import React, { useState } from 'react'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleField }   from '@/features/heatmap/sampleField'
import { sampleFieldGL, disposeGL, setUseGrid } from '@/features/heatmap/sampleFieldGL'
import { MATERIALS, DEFAULT_FLOOR_SLAB_DB, DEFAULT_FLOOR_SLAB_MATERIAL_ID } from '@/constants/materials'
import './HeatmapDiffPage.sass'

// Small linear-congruential PRNG so we don't pull in a library and the
// scenario stays bit-identical across runs of the same seed.
function makeRng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

// Generate a synthetic floor with `nWalls` random axis-mixed segments and
// `nAps` APs uniformly distributed. Walls' material is sampled from MATERIALS
// in proportion to its dbLoss so the ray loss distribution roughly matches
// real floors. Floor size scales with sqrt(nWalls) so wall density stays
// realistic (~1 wall per 5-10 m²).
function buildSyntheticScenario({ nWalls, nAps, seed }) {
  const rng = makeRng(seed)
  const sideM = Math.max(20, Math.sqrt(nWalls / 0.15))   // m, expand with N
  const sidePx = 600
  const scale = sidePx / sideM    // px/m

  const matList = Object.values(MATERIALS)
  const walls = []
  for (let i = 0; i < nWalls; i++) {
    // Mostly-axis-aligned segments mimic real floor plans better than full
    // random; bias 80% to axis-aligned, 20% diagonal.
    const x = rng() * sideM
    const y = rng() * sideM
    const len = 2 + rng() * 6
    let ex, ey
    if (rng() < 0.8) {
      const horiz = rng() < 0.5
      ex = horiz ? x + len : x
      ey = horiz ? y : y + len
    } else {
      const ang = rng() * Math.PI * 2
      ex = x + Math.cos(ang) * len
      ey = y + Math.sin(ang) * len
    }
    const m = matList[Math.floor(rng() * matList.length)]
    walls.push({
      id: `w${i}`,
      startX: x * scale, startY: y * scale,
      endX:   ex * scale, endY:   ey * scale,
      material: m,
      bottomHeight: 0, topHeight: 3,
    })
  }

  const aps = []
  for (let i = 0; i < nAps; i++) {
    aps.push({
      id: `ap${i}`,
      name: `AP-${i + 1}`,
      x: rng() * sideM * scale,
      y: rng() * sideM * scale,
      z: 2.7,
      frequency: 5, channel: 36, channelWidth: 40,
      txPower: 20,
      antennaMode: 'omni',
      mountType: 'ceiling',
    })
  }

  const floor = {
    id: 'bench-floor',
    name: 'Bench',
    imageWidth: sidePx,
    imageHeight: sidePx,
    scale,
    rotation: 0,
    floorHeight: 3,
    floorSlabMaterialId: DEFAULT_FLOOR_SLAB_MATERIAL_ID,
    floorSlabAttenuationDb: DEFAULT_FLOOR_SLAB_DB,
  }

  // Single floor — no cross-floor data.
  const scenario = buildScenario(floor, walls, aps, [], null)
  return { scenario, sideM, scale, walls, aps }
}

const FRIIS_OPTS = { maxReflOrder: 0, enableDiffraction: false }
const FULL_OPTS  = { maxReflOrder: 1, enableDiffraction: true }
const GRID_STEP_M = 0.5

// Run one engine N times and return per-run + aggregate timings (ms). The
// first run primes shader compilation / JIT; we report median of the rest.
async function timeRuns(fn, runs = 5) {
  const samples = []
  for (let i = 0; i < runs; i++) {
    // Yield to the event loop between runs so the browser doesn't batch the
    // GPU dispatches into a single frame and skew the readback timing.
    await new Promise((r) => setTimeout(r, 0))
    const t0 = performance.now()
    fn()
    const dt = performance.now() - t0
    samples.push(dt)
  }
  const sorted = samples.slice().sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  return { samples, median, min: sorted[0], max: sorted[sorted.length - 1] }
}

const SCALES = [
  { nAps: 5,   nWalls: 20  },
  { nAps: 20,  nWalls: 20  },
  { nAps: 20,  nWalls: 100 },
  { nAps: 50,  nWalls: 100 },
  { nAps: 50,  nWalls: 500 },
  { nAps: 100, nWalls: 500 },
  { nAps: 100, nWalls: 2000 },
]

export default function HeatmapBenchPage() {
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState([])
  const [opts, setOpts] = useState('friis')

  const benchOpts = opts === 'friis' ? FRIIS_OPTS : FULL_OPTS

  async function runBench() {
    setRunning(true)
    setRows([])
    const out = []
    // Throw away any cached GL context so wall textures are sized for the
    // first scenario we benchmark (avoids residual texture sizes from a
    // previous run skewing the first sample).
    disposeGL()

    for (const scale of SCALES) {
      const { scenario } = buildSyntheticScenario({ ...scale, seed: 0xC0FFEE })

      // Warm-up: prime JIT + shader compile + texture upload.
      sampleField(scenario, GRID_STEP_M, benchOpts)
      try { sampleFieldGL(scenario, GRID_STEP_M, benchOpts) } catch (_) {}

      // JS — full physics or friis only, per dropdown.
      const jsT = await timeRuns(() => sampleField(scenario, GRID_STEP_M, benchOpts))

      // Shader with grid (F5b).
      setUseGrid(true)
      let shaderGridT = null, shaderGridErr = null
      try {
        shaderGridT = await timeRuns(() => sampleFieldGL(scenario, GRID_STEP_M, benchOpts))
      } catch (e) { shaderGridErr = e.message }

      // Shader without grid (F5a brute force) — apples-to-apples vs JS-friis
      // to isolate the grid speedup from the GPU vs CPU effect.
      setUseGrid(false)
      let shaderBruteT = null, shaderBruteErr = null
      try {
        shaderBruteT = await timeRuns(() => sampleFieldGL(scenario, GRID_STEP_M, benchOpts))
      } catch (e) { shaderBruteErr = e.message }
      // Restore default for downstream consumers.
      setUseGrid(true)

      out.push({
        ...scale,
        jsT,
        shaderGridT, shaderGridErr,
        shaderBruteT, shaderBruteErr,
      })
      setRows([...out])
    }
    setRunning(false)
  }

  const fmt = (v) => v == null ? '—' : v.toFixed(1)

  return (
    <div className="heatmap-diff-page">
      <header>
        <h1>Heatmap bench <small>#/heatmap-bench</small></h1>
        <p>
          Synthetic-scenario benchmark for HM-F5a/b. Times JS engine (CPU) vs Shader engine
          (GPU brute force vs F5b uniform grid) across (#AP × #walls) scales. Median of 5 runs
          shown; warm-up run discarded. Grid-step <code>{GRID_STEP_M}</code> m, all engines
          sample the same fixed scenario per row.
        </p>
        <div className="stage-row">
          <button className={opts === 'friis' ? 'active' : ''} onClick={() => setOpts('friis')}>
            JS opts: friis (no refl/diff)
          </button>
          <button className={opts === 'full' ? 'active' : ''} onClick={() => setOpts('full')}>
            JS opts: full physics
          </button>
          <button onClick={runBench} disabled={running}>
            {running ? 'Running…' : 'Run bench'}
          </button>
        </div>
        <p style={{ marginTop: 8, color: '#888' }}>
          Note: shader engine is HM-F5a (no reflections / diffraction / multi-frequency). Picking
          "full physics" here only changes JS — it lets you see how big the JS workload is when
          all physics terms are on. Apples-to-apples comparison uses "friis" + Shader/grid.
        </p>
      </header>

      <section className="panel">
        <table className="stats" style={{ minWidth: 700 }}>
          <thead>
            <tr>
              <th>#AP</th><th>#walls</th>
              <th>JS (ms)</th>
              <th>Shader brute (ms)</th>
              <th>Shader+grid (ms)</th>
              <th>brute/JS</th>
              <th>grid/brute</th>
              <th>grid speedup vs JS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const js = r.jsT.median
              const sb = r.shaderBruteT?.median
              const sg = r.shaderGridT?.median
              const ratio = (a, b) => (a == null || b == null ? '—' : `${(a / b).toFixed(2)}×`)
              return (
                <tr key={`${r.nAps}-${r.nWalls}`}>
                  <td>{r.nAps}</td>
                  <td>{r.nWalls}</td>
                  <td>{fmt(js)}</td>
                  <td>{fmt(sb)}</td>
                  <td>{fmt(sg)}</td>
                  <td>{ratio(sb, js)}</td>
                  <td>{ratio(sg, sb)}</td>
                  <td>{ratio(js, sg)}</td>
                </tr>
              )
            })}
            {running && rows.length < SCALES.length && (
              <tr><td colSpan={8} style={{ textAlign: 'left', color: '#aaa' }}>
                running {rows.length + 1}/{SCALES.length}…
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

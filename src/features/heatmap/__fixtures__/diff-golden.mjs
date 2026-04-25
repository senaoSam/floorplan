// Diff harness for the heatmap golden fixtures (HM-T2).
//
// Run via:
//   pnpm heatmap:diff                        diff every fixture, JS engine
//   pnpm heatmap:diff basic                  one fixture
//   pnpm heatmap:diff basic --html           also write diff-report.html
//   pnpm heatmap:diff basic --engine shader  diff shader engine vs golden (F5a+)
//   pnpm heatmap:diff --ci                   non-zero exit if any threshold breached
//
// For each fixture and each channel (rssi / sinr / snr / cci), it computes:
//   - cell counts that breach 0.5 / 1.0 / 3.0 dB
//   - max / mean / p95 abs error
//   - NaN mismatches (one side NaN, other finite)
//   - top-N worst cells with (i, j, x_m, y_m, golden, current)
//
// CI mode fails when ANY channel exceeds its threshold (default ±1 dB).
// Override per-channel thresholds via env, e.g. HEATMAP_DIFF_THRESHOLD_RSSI=3.

import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot  = resolve(__dirname, '../../../..')
const fixturesRoot = __dirname

// ---- args ----

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))
const engineArg = (args.find((a) => a.startsWith('--engine='))?.split('=')[1])
              ?? (flags.has('--engine') ? args[args.indexOf('--engine') + 1] : null)
              ?? 'js'
const wantHtml = flags.has('--html')
const ciMode  = flags.has('--ci')
const requested = positional[0]

const CHANNELS = ['rssi', 'sinr', 'snr', 'cci']
const DEFAULT_THRESHOLD_DB = 1.0
const thresholdFor = (ch) => {
  const env = process.env[`HEATMAP_DIFF_THRESHOLD_${ch.toUpperCase()}`]
  return env ? Number(env) : DEFAULT_THRESHOLD_DB
}

// ---- helpers ----

function listFixtures() {
  return readdirSync(fixturesRoot)
    .filter((name) => {
      const p = resolve(fixturesRoot, name)
      try { return statSync(p).isDirectory() } catch { return false }
    })
    .filter((name) => {
      try { statSync(resolve(fixturesRoot, name, 'scenario.js')); return true }
      catch { return false }
    })
}

function base64ToF32(b64) {
  const buf = Buffer.from(b64, 'base64')
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

function assembleCrossFloor(scenarioMod, floorElevations) {
  const { floors, apsByFloor, floorHolesByFloor, wallsByFloor, meta } = scenarioMod
  const activeFloorId = meta.activeFloorId
  const floorIndexById = new Map(floors.map((f, i) => [f.id, i]))

  const floorStack = floors.map((f) => ({
    id: f.id,
    elevationM: floorElevations[f.id] ?? 0,
    slabDb: f.floorSlabAttenuationDb ?? 0,
    scale: f.scale,
    holes: (floorHolesByFloor[f.id] ?? []).map((h) => ({
      points: h.points,
      fromIdx: floorIndexById.get(h.bottomFloorId ?? f.id) ?? floorIndexById.get(f.id),
      toIdx:   floorIndexById.get(h.topFloorId    ?? f.id) ?? floorIndexById.get(f.id),
    })),
  }))

  const apsAcrossFloors = []
  for (const f of floors) {
    const floorAPs = apsByFloor[f.id] ?? []
    const floorElev = floorElevations[f.id] ?? 0
    for (const ap of floorAPs) {
      apsAcrossFloors.push({
        ...ap,
        posPx: { x: ap.x, y: ap.y },
        elevationM: floorElev,
        floorScale: f.scale,
      })
    }
  }

  const otherFloorWalls = []
  for (const f of floors) {
    if (f.id === activeFloorId) continue
    const fws = wallsByFloor[f.id] ?? []
    if (fws.length === 0) continue
    otherFloorWalls.push({
      elevationM: floorElevations[f.id] ?? 0,
      scale: f.scale,
      walls: fws,
    })
  }

  return {
    activeElevationM: floorElevations[activeFloorId] ?? 0,
    rxHeightM: scenarioMod.engineOpts.rxHeightM ?? 1.0,
    floorStack,
    apsByFloor: apsAcrossFloors,
    otherFloorWalls,
  }
}

// Per-channel diff between golden and current arrays.
function diffChannel(golden, current, nx, ny, gridStepM, topN = 10) {
  if (golden.length !== current.length) {
    throw new Error(`length mismatch: golden=${golden.length} current=${current.length}`)
  }
  const errs = []
  let nanMismatch = 0
  let bothNaN = 0
  let bothFinite = 0
  let count05 = 0, count10 = 0, count30 = 0
  let maxAbs = 0
  let sumAbs = 0
  const heap = []  // worst cells (capped)

  const pushWorst = (entry) => {
    heap.push(entry)
    heap.sort((a, b) => b.absErr - a.absErr)
    if (heap.length > topN) heap.length = topN
  }

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i
      const g = golden[idx]
      const c = current[idx]
      const gNaN = Number.isNaN(g)
      const cNaN = Number.isNaN(c)
      if (gNaN && cNaN) { bothNaN++; continue }
      if (gNaN || cNaN) {
        nanMismatch++
        pushWorst({ i, j, xM: i * gridStepM, yM: j * gridStepM, golden: g, current: c, absErr: Infinity })
        continue
      }
      bothFinite++
      const e = Math.abs(g - c)
      errs.push(e)
      sumAbs += e
      if (e > maxAbs) maxAbs = e
      if (e > 0.5) count05++
      if (e > 1.0) count10++
      if (e > 3.0) count30++
      if (e > 0) pushWorst({ i, j, xM: i * gridStepM, yM: j * gridStepM, golden: g, current: c, absErr: e })
    }
  }

  errs.sort((a, b) => a - b)
  const p95 = errs.length ? errs[Math.floor(errs.length * 0.95)] : 0
  const mean = bothFinite ? sumAbs / bothFinite : 0

  return {
    bothFinite, bothNaN, nanMismatch,
    maxAbs, meanAbs: mean, p95Abs: p95,
    count05, count10, count30,
    worst: heap,
  }
}

// ---- HTML report ----

// Simple viridis-like sampler.
function viridis(t) {
  t = Math.max(0, Math.min(1, t))
  const stops = [
    [0.000, [ 68,  1, 84]],
    [0.250, [ 59, 82,139]],
    [0.500, [ 33,144,141]],
    [0.750, [ 94,201, 98]],
    [1.000, [253,231, 37]],
  ]
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1]
      const [t1, c1] = stops[i]
      const u = (t - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * u),
        Math.round(c0[1] + (c1[1] - c0[1]) * u),
        Math.round(c0[2] + (c1[2] - c0[2]) * u),
      ]
    }
  }
  return [253, 231, 37]
}

// Diff colormap: 0 → black, 0..thr → green, thr..3*thr → yellow, >3*thr → red.
function diffColor(absErr, thr) {
  if (!isFinite(absErr)) return [255, 0, 255]    // magenta = NaN mismatch
  if (absErr === 0) return [12, 12, 12]
  const t = absErr / thr
  if (t <= 1) {
    const u = Math.min(1, t)
    return [Math.round(40 + 80 * u), Math.round(180 + 40 * u), Math.round(60 + 40 * u)]
  }
  if (t <= 3) {
    const u = (t - 1) / 2
    return [Math.round(180 + 75 * u), Math.round(180 - 80 * u), 40]
  }
  return [220, 40, 40]
}

function fieldToPng(arr, nx, ny, valueRange) {
  const [vmin, vmax] = valueRange
  const span = Math.max(1e-9, vmax - vmin)
  const px = new Uint8ClampedArray(nx * ny * 4)
  for (let i = 0; i < nx * ny; i++) {
    const v = arr[i]
    if (Number.isNaN(v)) {
      px[i * 4] = 0; px[i * 4 + 1] = 0; px[i * 4 + 2] = 0; px[i * 4 + 3] = 0
    } else {
      const t = (v - vmin) / span
      const [r, g, b] = viridis(t)
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255
    }
  }
  return px
}

function diffToPng(golden, current, nx, ny, thr) {
  const px = new Uint8ClampedArray(nx * ny * 4)
  for (let i = 0; i < nx * ny; i++) {
    const g = golden[i], c = current[i]
    if (Number.isNaN(g) && Number.isNaN(c)) {
      px[i * 4] = 0; px[i * 4 + 1] = 0; px[i * 4 + 2] = 0; px[i * 4 + 3] = 0
      continue
    }
    if (Number.isNaN(g) || Number.isNaN(c)) {
      px[i * 4] = 255; px[i * 4 + 1] = 0; px[i * 4 + 2] = 255; px[i * 4 + 3] = 255
      continue
    }
    const e = Math.abs(g - c)
    const [r, gg, b] = diffColor(e, thr)
    px[i * 4] = r; px[i * 4 + 1] = gg; px[i * 4 + 2] = b; px[i * 4 + 3] = 255
  }
  return px
}

// Embed pixels as data: URL via raw <canvas>-style ImageData written into an
// inline base64 PPM-style PNG would need real PNG encoding. Simpler: emit a
// tiny <canvas> per panel and putImageData from a base64-packed Uint8 payload.
function pixelsToBase64(px) {
  return Buffer.from(px.buffer, px.byteOffset, px.byteLength).toString('base64')
}

function htmlReport(diffs, fixtureName, engineName, fields) {
  const { nx, ny, gridStepM } = fields
  const cellSize = Math.max(2, Math.min(8, Math.floor(640 / Math.max(nx, ny))))
  const w = nx * cellSize
  const h = ny * cellSize

  const panels = []
  for (const ch of CHANNELS) {
    const goldenArr = fields.golden[ch]
    const currentArr = fields.current[ch]
    let vmin = Infinity, vmax = -Infinity
    for (let i = 0; i < goldenArr.length; i++) {
      const a = goldenArr[i], b = currentArr[i]
      if (!Number.isNaN(a)) { if (a < vmin) vmin = a; if (a > vmax) vmax = a }
      if (!Number.isNaN(b)) { if (b < vmin) vmin = b; if (b > vmax) vmax = b }
    }
    const vr = vmin === Infinity ? [-100, -30] : [vmin, vmax]

    const goldenPx  = fieldToPng(goldenArr, nx, ny, vr)
    const currentPx = fieldToPng(currentArr, nx, ny, vr)
    const diffPx    = diffToPng(goldenArr, currentArr, nx, ny, thresholdFor(ch))

    const d = diffs[ch]
    const verdict = d.maxAbs <= thresholdFor(ch) && d.nanMismatch === 0 ? 'PASS' : 'FAIL'

    panels.push(`
      <section class="panel">
        <header>
          <h2>${ch.toUpperCase()} <span class="verdict ${verdict.toLowerCase()}">${verdict}</span></h2>
          <p class="stats">
            max=${d.maxAbs.toFixed(3)} dB · mean=${d.meanAbs.toFixed(3)} dB · p95=${d.p95Abs.toFixed(3)} dB ·
            >0.5dB=${d.count05} · >1dB=${d.count10} · >3dB=${d.count30} ·
            nanMismatch=${d.nanMismatch} · range=[${vr[0].toFixed(1)}, ${vr[1].toFixed(1)}]
          </p>
        </header>
        <div class="grid">
          <figure><figcaption>golden</figcaption><canvas data-px="${pixelsToBase64(goldenPx)}" width="${nx}" height="${ny}" style="width:${w}px;height:${h}px"></canvas></figure>
          <figure><figcaption>current (${engineName})</figcaption><canvas data-px="${pixelsToBase64(currentPx)}" width="${nx}" height="${ny}" style="width:${w}px;height:${h}px"></canvas></figure>
          <figure><figcaption>|diff| · thr=${thresholdFor(ch)} dB</figcaption><canvas data-px="${pixelsToBase64(diffPx)}" width="${nx}" height="${ny}" style="width:${w}px;height:${h}px"></canvas></figure>
        </div>
      </section>
    `)
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Heatmap diff · ${fixtureName} · ${engineName}</title>
<style>
  body { background:#111; color:#eee; font:13px/1.4 ui-monospace, Menlo, Consolas, monospace; margin:24px; }
  h1 { font-size:18px; margin:0 0 4px; }
  .meta { color:#888; margin-bottom:24px; }
  section.panel { background:#1a1a1a; border-radius:8px; padding:16px; margin-bottom:20px; }
  header h2 { margin:0 0 4px; font-size:14px; display:flex; align-items:center; gap:10px; }
  .verdict { font-size:11px; padding:2px 8px; border-radius:10px; }
  .verdict.pass { background:#1f5c2a; color:#9be8a3; }
  .verdict.fail { background:#5c1f1f; color:#f1a3a3; }
  .stats { color:#aaa; margin:0 0 12px; font-size:12px; }
  .grid { display:grid; grid-template-columns: repeat(3, max-content); gap:18px; }
  figure { margin:0; }
  figcaption { color:#888; font-size:11px; margin-bottom:4px; }
  canvas { image-rendering:pixelated; background:#222; border:1px solid #333; }
</style>
</head>
<body>
<h1>Heatmap diff · ${fixtureName}</h1>
<p class="meta">engine = <strong>${engineName}</strong> · grid ${nx}×${ny} · gridStep ${gridStepM} m · diff thresholds: rssi/sinr/snr/cci = ${CHANNELS.map(thresholdFor).join('/')} dB · diff color: green ≤ thr, yellow thr–3·thr, red &gt; 3·thr, magenta = NaN mismatch</p>
${panels.join('\n')}
<script>
  for (const c of document.querySelectorAll('canvas[data-px]')) {
    const bin = atob(c.dataset.px)
    const u8  = new Uint8ClampedArray(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const ctx = c.getContext('2d')
    ctx.putImageData(new ImageData(u8, c.width, c.height), 0, 0)
  }
</script>
</body>
</html>`
}

// ---- engine adapters ----

async function loadEngineJS(server) {
  const { buildScenario } = await server.ssrLoadModule('@/features/heatmap/buildScenario.js')
  const { sampleField }   = await server.ssrLoadModule('@/features/heatmap/sampleField.js')
  return { buildScenario, sampleField, name: 'js' }
}

async function loadEngineShader(server) {
  // Placeholder for HM-F5a: when the shader engine lands, expose
  // `sampleFieldShader(scenario, gridStepM, opts)` from a sibling module and
  // wire it here. Until then we hard-fail so anyone running --engine=shader
  // by accident gets a clear message rather than silent JS-engine results.
  throw new Error('shader engine not implemented yet (pending HM-F5a)')
}

async function loadEngine(server, name) {
  if (name === 'js') return loadEngineJS(server)
  if (name === 'shader') return loadEngineShader(server)
  throw new Error(`unknown engine "${name}"`)
}

// ---- main ----

async function diffOne(name, server, engine) {
  const fixtureDir = resolve(fixturesRoot, name)
  const scenarioPath = resolve(fixtureDir, 'scenario.js')
  const fieldRaw = JSON.parse(readFileSync(resolve(fixtureDir, 'field.json'), 'utf8'))
  const metaRaw  = JSON.parse(readFileSync(resolve(fixtureDir, 'meta.json'), 'utf8'))

  const scenarioMod = await server.ssrLoadModule(scenarioPath)
  const { computeFloorElevations } = await server.ssrLoadModule('@/features/viewer3d/floorStacking.js')

  const { floors, wallsByFloor, apsByFloor, scopesByFloor, engineOpts, meta } = scenarioMod
  const activeFloorId = meta.activeFloorId
  const elevations = computeFloorElevations(floors)
  const activeFloor = floors.find((f) => f.id === activeFloorId)

  const crossFloor = assembleCrossFloor(scenarioMod, elevations)
  const scenario = engine.buildScenario(
    activeFloor,
    wallsByFloor[activeFloorId] ?? [],
    apsByFloor[activeFloorId] ?? [],
    scopesByFloor[activeFloorId] ?? [],
    crossFloor,
  )

  const current = engine.sampleField(scenario, engineOpts.gridStepM, {
    maxReflOrder:     engineOpts.maxReflOrder,
    enableDiffraction: engineOpts.enableDiffraction,
  })

  if (current.nx !== fieldRaw.nx || current.ny !== fieldRaw.ny) {
    throw new Error(`grid size mismatch: golden ${fieldRaw.nx}×${fieldRaw.ny} vs current ${current.nx}×${current.ny}`)
  }

  const golden = {
    rssi: base64ToF32(fieldRaw.rssi),
    sinr: base64ToF32(fieldRaw.sinr),
    snr:  base64ToF32(fieldRaw.snr),
    cci:  base64ToF32(fieldRaw.cci),
  }

  const diffs = {}
  for (const ch of CHANNELS) {
    diffs[ch] = diffChannel(golden[ch], current[ch], current.nx, current.ny, current.gridStepM)
  }

  return {
    name, fixtureMeta: metaRaw, diffs,
    fields: {
      nx: current.nx, ny: current.ny, gridStepM: current.gridStepM,
      golden, current,
    },
  }
}

// ---- run ----

const fixtures = requested ? [requested] : listFixtures()
if (fixtures.length === 0) {
  console.error('[heatmap:diff] no fixtures found')
  process.exit(1)
}

const server = await createServer({
  configFile: resolve(repoRoot, 'vite.config.js'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

let anyFail = false
try {
  const engine = await loadEngine(server, engineArg)
  for (const name of fixtures) {
    const t0 = Date.now()
    const result = await diffOne(name, server, engine)
    const dt = Date.now() - t0

    console.log(`\n=== ${name} (engine=${engine.name}, ${dt} ms) ===`)
    console.log(`golden generated ${result.fixtureMeta.generatedAt}, fingerprint ${result.fixtureMeta.engineFingerprint}, commit ${result.fixtureMeta.gitCommit.slice(0, 7)}`)

    for (const ch of CHANNELS) {
      const d = result.diffs[ch]
      const thr = thresholdFor(ch)
      const pass = d.maxAbs <= thr && d.nanMismatch === 0
      if (!pass) anyFail = true
      const tag = pass ? 'PASS' : 'FAIL'
      console.log(
        `  [${tag}] ${ch.padEnd(4)} max=${d.maxAbs.toFixed(3)} mean=${d.meanAbs.toFixed(3)} p95=${d.p95Abs.toFixed(3)} dB ` +
        `>0.5=${d.count05} >1=${d.count10} >3=${d.count30} nanMis=${d.nanMismatch} (thr=${thr} dB)`
      )
      if (!pass && d.worst.length) {
        console.log('    worst cells:')
        for (const w of d.worst.slice(0, 5)) {
          const errStr = isFinite(w.absErr) ? w.absErr.toFixed(3) : 'NaN-mismatch'
          console.log(`      (i=${w.i}, j=${w.j}, xM=${w.xM.toFixed(2)}, yM=${w.yM.toFixed(2)}) golden=${w.golden} current=${w.current} |Δ|=${errStr}`)
        }
      }
    }

    if (wantHtml) {
      const html = htmlReport(result.diffs, name, engine.name, result.fields)
      const out = resolve(fixturesRoot, name, `diff-report.html`)
      writeFileSync(out, html)
      console.log(`  → wrote ${out}`)
    }
  }
} finally {
  await server.close()
}

if (ciMode && anyFail) {
  console.error('\n[heatmap:diff] CI mode: at least one channel breached its threshold')
  process.exit(1)
}

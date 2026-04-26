// Generator for the heatmap golden fixtures (HM-T1).
//
// Run via:
//   pnpm heatmap:golden            (regenerates every fixture under __fixtures__/)
//   pnpm heatmap:golden basic      (regenerates a single fixture by name)
//
// For each fixture directory it:
//   1. ssrLoadModule's `<fixture>/scenario.js` (so `@` aliases work)
//   2. Builds the scenario the same way HeatmapLayer.jsx does (cross-floor +
//      live-drag-less variant) and runs `sampleField` with the fixture's opts
//   3. Writes `field.json` (rssi/sinr/snr/cci as base64 Float32Array + meta)
//      and `meta.json` (commit hash, timestamp, opts, engine fingerprint)
//
// We use a one-off Vite dev server in middleware mode purely for module
// resolution. No HTTP server is opened.

import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot  = resolve(__dirname, '../../../..')
const fixturesRoot = __dirname

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

// Float32Array → base64 (little-endian, raw bytes). Matches `Buffer.from(buf).toString('base64')`.
function f32ToBase64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  return Buffer.from(u8).toString('base64')
}

// Stable hash of the engine source, so a Diff harness can warn if the engine
// drifted without a fixture refresh. Hashes the propagation+sampleField+
// buildScenario+frequency files at fixture-generation time.
function engineFingerprint() {
  const files = [
    'src/features/heatmap/propagation.js',
    'src/features/heatmap/sampleField.js',
    'src/features/heatmap/buildScenario.js',
    'src/features/heatmap/frequency.js',
    'src/features/heatmap/rfConstants.js',
    'src/features/heatmap/geometry.js',
  ]
  const h = createHash('sha256')
  for (const f of files) {
    h.update(f)
    h.update(readFileSync(resolve(repoRoot, f)))
  }
  return h.digest('hex').slice(0, 16)
}

function gitCommit() {
  try { return execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim() }
  catch { return 'unknown' }
}

function gitDirty() {
  try {
    const out = execSync('git status --porcelain', { cwd: repoRoot }).toString().trim()
    return out.length > 0
  } catch { return false }
}

// Stats for diffing-friendly summary printed to stdout.
function arrayStats(arr) {
  let min = Infinity, max = -Infinity, sum = 0, finite = 0, nan = 0
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (Number.isNaN(v)) { nan++; continue }
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    finite++
  }
  return {
    finite,
    nan,
    min: finite ? +min.toFixed(3) : null,
    max: finite ? +max.toFixed(3) : null,
    mean: finite ? +(sum / finite).toFixed(3) : null,
  }
}

// Mirror HeatmapLayer.jsx's scenario assembly without any drag overlays.
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

async function buildOne(name, server) {
  const fixtureDir = resolve(fixturesRoot, name)
  const scenarioPath = resolve(fixtureDir, 'scenario.js')

  const scenarioMod = await server.ssrLoadModule(scenarioPath)
  const { buildScenario }     = await server.ssrLoadModule('@/features/heatmap/buildScenario.js')
  const { sampleField }       = await server.ssrLoadModule('@/features/heatmap/sampleField.js')
  const { computeFloorElevations } = await server.ssrLoadModule('@/features/viewer3d/floorStacking.js')

  const { floors, wallsByFloor, apsByFloor, scopesByFloor, engineOpts, meta } = scenarioMod
  const activeFloorId = meta.activeFloorId
  const elevations = computeFloorElevations(floors)

  const activeFloor = floors.find((f) => f.id === activeFloorId)
  if (!activeFloor) throw new Error(`activeFloorId "${activeFloorId}" not found in floors`)

  const crossFloor = assembleCrossFloor(scenarioMod, elevations)
  const scenario = buildScenario(
    activeFloor,
    wallsByFloor[activeFloorId] ?? [],
    apsByFloor[activeFloorId] ?? [],
    scopesByFloor[activeFloorId] ?? [],
    crossFloor,
  )

  // Two golden baselines per fixture:
  //   - field-full.json:  reflections + diffraction on. Target for F5c onward.
  //   - field-friis.json: reflections + diffraction off (Friis + walls + slab).
  //                       Target for F5a/F5b — they intentionally omit those
  //                       physics terms, so diffing against full-physics would
  //                       always blow past 3 dB regardless of correctness.
  // `field.json` stays as an alias of field-full.json for back-compat with
  // existing harness consumers (T2 CLI, current diff page).
  const fieldFull = sampleField(scenario, engineOpts.gridStepM, {
    maxReflOrder:     engineOpts.maxReflOrder,
    enableDiffraction: engineOpts.enableDiffraction,
  })
  const fieldFriis = sampleField(scenario, engineOpts.gridStepM, {
    maxReflOrder:     0,
    enableDiffraction: false,
  })

  const serialise = (field) => ({
    nx: field.nx,
    ny: field.ny,
    gridStepM: field.gridStepM,
    rssi: f32ToBase64(field.rssi),
    sinr: f32ToBase64(field.sinr),
    snr:  f32ToBase64(field.snr),
    cci:  f32ToBase64(field.cci),
  })
  const stats = (field) => ({
    rssi: arrayStats(field.rssi),
    sinr: arrayStats(field.sinr),
    snr:  arrayStats(field.snr),
    cci:  arrayStats(field.cci),
  })

  const fullOut  = serialise(fieldFull)
  const friisOut = serialise(fieldFriis)

  const metaOut = {
    fixtureId: meta.fixtureId,
    description: meta.description,
    activeFloorId,
    engineOpts,
    engineFingerprint: engineFingerprint(),
    gitCommit: gitCommit(),
    gitDirty: gitDirty(),
    generatedAt: new Date().toISOString(),
    grid: { nx: fieldFull.nx, ny: fieldFull.ny, gridStepM: fieldFull.gridStepM },
    baselines: {
      full: {
        opts: { maxReflOrder: engineOpts.maxReflOrder, enableDiffraction: engineOpts.enableDiffraction },
        appliesTo: ['F5c', 'F5d', 'F5e', 'F5f'],
        stats: stats(fieldFull),
      },
      friis: {
        opts: { maxReflOrder: 0, enableDiffraction: false },
        appliesTo: ['F5a', 'F5b'],
        stats: stats(fieldFriis),
      },
    },
  }

  writeFileSync(resolve(fixtureDir, 'field-full.json'),  JSON.stringify(fullOut))
  writeFileSync(resolve(fixtureDir, 'field-friis.json'), JSON.stringify(friisOut))
  // back-compat alias — `field.json` mirrors field-full.json so older readers
  // that haven't been updated still see the canonical full-physics baseline.
  writeFileSync(resolve(fixtureDir, 'field.json'), JSON.stringify(fullOut))
  writeFileSync(resolve(fixtureDir, 'meta.json'), JSON.stringify(metaOut, null, 2))

  return {
    name,
    fullBytes:  JSON.stringify(fullOut).length,
    friisBytes: JSON.stringify(friisOut).length,
    stats: { full: metaOut.baselines.full.stats, friis: metaOut.baselines.friis.stats },
    grid: metaOut.grid,
  }
}

// ---- main ----

const requested = process.argv[2]
const fixtures = requested ? [requested] : listFixtures()
if (fixtures.length === 0) {
  console.error('[heatmap:golden] no fixtures found')
  process.exit(1)
}

const server = await createServer({
  configFile: resolve(repoRoot, 'vite.config.js'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  for (const name of fixtures) {
    const t0 = Date.now()
    const result = await buildOne(name, server)
    const dt = Date.now() - t0
    console.log(`[heatmap:golden] ${name}: ${result.grid.nx}×${result.grid.ny} grid · full ${(result.fullBytes / 1024).toFixed(1)} KB · friis ${(result.friisBytes / 1024).toFixed(1)} KB · ${dt} ms`)
    for (const baseline of ['full', 'friis']) {
      console.log(`  [${baseline}]`)
      for (const k of ['rssi', 'sinr', 'snr', 'cci']) {
        const s = result.stats[baseline][k]
        console.log(`    ${k.padEnd(4)} min=${s.min} max=${s.max} mean=${s.mean} finite=${s.finite} nan=${s.nan}`)
      }
    }
  }
} finally {
  await server.close()
}

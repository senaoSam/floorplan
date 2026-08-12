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
import { fitGridStep } from './sampleField'
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
  // Drop a cached instance whose context died (e.g. Windows TDR after a heavy
  // brute-force pass on a large scenario). Without this, subsequent runs would
  // keep dispatching against a dead context and silently return zeroed grids.
  if (glInstance && glInstance.gl.isContextLost()) {
    try { glInstance.dispose() } catch (_) {}
    glInstance = null
  }
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
  // Any synchronous compute invalidates in-flight async computes (see
  // syncEpoch below): the solo-drag path bakes a 1-AP LOS/geo set, which
  // EVICTS every other AP's cache textures (deleteTexture) — an async job
  // paused between batches would otherwise resume and bind the deleted
  // textures (GL INVALID_OPERATION + garbage grids in the output cache).
  syncEpoch++
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
  // 52-A2: same cell ceiling as the JS path, so a very large site coarsens
  // instead of allocating an unbounded grid.
  gridStepM = fitGridStep(totalW, totalH, gridStepM)
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
    // Decorate APs with the gains the shader expects, then upload once for
    // the single dispatch. 47-10: per-AP model gain from buildScenario;
    // AP_ANT_GAIN_DBI only when the model doesn't list the band.
    const apsForGL = scenario.aps.map((ap) => ({
      ...ap,
      _antGainDbi: ap.antGainDbi ?? AP_ANT_GAIN_DBI,
    }))
    gl.uploadAps(apsForGL)
    const out = gl.renderField(scenario, gridStepM, { x: originX, y: originY }, rxZM, slabMeta, {
      _rxGainDbi: RX_ANT_GAIN_DBI,
      noiseDbm: NOISE_FLOOR_DBM,
      cullFloorDbm: opts.cullFloorDbm ?? CULL_FLOOR_DBM,
      rssiOnly: !!opts.rssiOnly,
      gridSize: { nx, ny },
    })

    // Scopes are a vector clip on the PIXI sprite (heatmapAdapter.rebuildMask),
    // NOT applied here — the whole plan rect is sampled cleanly so bicubic/blur
    // has no NaN holes to erode/smear. Only clamp the empty-AP CCI sentinel.
    const { rssi, sinr, snr, cci } = out
    for (let idx = 0; idx < cci.length; idx++) {
      if (cci[idx] < CCI_MIN_DBM) cci[idx] = CCI_MIN_DBM
    }
    return { rssi, sinr, snr, cci, nx, ny, gridStepM, originX, originY }
  }

  // ---- per-AP fallback (refl on, diff on, or custom AP present) ----
  // HM-F5j: bake one LOS R8 grid per AP up front. Each subsequent renderAp
  // pass uses its AP's LOS texture to short-circuit the direct-path wall
  // scan + diffraction at fragments where the AP→rx ray hits zero walls
  // (mode A: refl loop still runs to preserve JS parity). The cache inside
  // propagationGL keeps textures alive across frames so an AP that didn't
  // move only pays for the bake when walls change.
  // Skip when the caller opts out (debug: `losEnabled: false`); custom-
  // pattern APs go through the JS RSSI override below so the LOS short-
  // circuit on those APs would be wasted work — but the bake is cheap and
  // the cache key is per-AP, so we still bake them.
  const losEnabled = opts.losEnabled !== false
  const losMap = losEnabled
    ? gl.bakeLos(
        scenario.aps.map((ap, i) => ({ ap, key: ap.id ?? `_idx_${i}` })),
        gridStepM, { x: originX, y: originY }, rxZM, nx, ny,
        scenario.walls.length,
      )
    : null

  // HM-F5k: bake AP→corner geometry + AP→wall mirror textures once per AP.
  // The savings only land in the refl/diff loops, so we still bake for
  // custom-pattern APs (cheap, JS path replaces the shader output anyway —
  // the bake's wasted work is dominated by the JS RSSI compute that
  // follows). opts.apGeoEnabled lets callers turn this off (debug parity
  // check vs unbaked path).
  const apGeoEnabled = opts.apGeoEnabled !== false
  const apGeoMap = apGeoEnabled
    ? gl.bakeApGeo(scenario.aps.map((ap, i) => ({ ap, key: ap.id ?? `_idx_${i}` })))
    : null

  // 任務 2 (C): per-AP output-grid cache. The cache container + invalidation
  // live in propagationGL (in lockstep with losCache/apGeoCache via
  // wallsVersion); here we build the hash from every input that affects this
  // AP's grid and consult it before paying for renderAp / the custom JS loop.
  // Opt out with opts.gridCacheEnabled === false (parity-check path).
  const gridCacheOn =
    opts.gridCacheEnabled !== false &&
    typeof gl.getCachedGrid === 'function' &&
    typeof gl.setCachedGrid === 'function'
  // Geometry/grid/opts signature shared by all APs this frame. wallsVersion
  // covers walls (and bumps on wall edits); corners + boundaries are folded in
  // explicitly because corner/slab edits clear the cache but don't bump
  // wallsVersion. Everything that changes a grid value without changing the AP
  // record itself must appear here, or a cache hit could serve a stale grid.
  const geomSig = gridCacheOn
    ? [
        gl.getWallsVersion(),
        scenario.corners?.length ?? 0,
        boundaries.length,
        // boundary elevations + slab dB (count alone is insufficient: same
        // count, different elevation/attenuation changes the cross-floor leg).
        boundaries.map((b) => `${b.elevationM ?? b.yM ?? 0}:${b.slabDb ?? b.slabAttenuationDb ?? 0}`).join(','),
        rxZM, gridStepM, nx, ny, originX, originY,
        opts.maxReflOrder ?? 0,
        opts.enableDiffraction ? 1 : 0,
        opts.freqOverrideN ?? 0,
        opts.cullFloorDbm ?? '',
        opts.losFastMode ? 1 : 0,
      ].join('|')
    : null

  let cacheHits = 0, cacheMisses = 0

  const perApGrids = []
  for (let k = 0; k < scenario.aps.length; k++) {
    const ap = scenario.aps[k]
    const apForGL = {
      ...ap,
      _antGainDbi: ap.antGainDbi ?? AP_ANT_GAIN_DBI,
      _rxGainDbi: RX_ANT_GAIN_DBI,
    }
    const apKey = ap.id ?? `_idx_${k}`

    // Per-AP hash: every AP field the shader (uploadAps t0-t3) or the custom
    // JS lobe (patternId/azimuth/beamwidth) reads, plus the gains baked in
    // apForGL, plus the shared geomSig. _idx_<k> keys also fold in k so two
    // id-less APs at different list positions never collide.
    let hash = null
    if (gridCacheOn) {
      const apSig = [
        ap.id ?? `idx${k}`,
        ap.pos?.x ?? ap.x, ap.pos?.y ?? ap.y, ap.zM ?? 0,
        ap.txDbm, ap.centerMHz ?? '', ap.channelWidth ?? '',
        ap.antennaMode ?? 'omni', ap.azimuthDeg ?? 0, ap.beamwidthDeg ?? 0,
        ap.tiltDeg ?? 0, ap.patternId ?? '',
        // 47-10: effective per-AP gain — must be the resolved value, or a
        // model change (different gain) would serve a stale cached grid.
        ap.antGainDbi ?? AP_ANT_GAIN_DBI, RX_ANT_GAIN_DBI,
      ].join('|')
      hash = apSig + '#' + geomSig
      const cached = gl.getCachedGrid(apKey, hash)
      if (cached) {
        cacheHits++
        perApGrids.push(cached.grid)
        continue
      }
    }
    cacheMisses++

    const losEntry = losMap?.get(apKey)
    const apGeoEntry = apGeoMap?.get(apKey)
    const { rssi: shaderGrid } = gl.renderAp(
      apForGL, scenario, gridStepM, { x: originX, y: originY }, rxZM, slabMeta,
      {
        ...opts,
        gridSize: { nx, ny },
        losTex: losEntry?.tex,
        losFastMode: opts.losFastMode === true,
        apGeoEntry,
      },
    )

    let grid
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
      grid = corrected
    } else {
      grid = shaderGrid
    }
    if (gridCacheOn) gl.setCachedGrid(apKey, hash, grid, nx, ny)
    perApGrids.push(grid)
  }

  // Debug hook: surface cache effectiveness without changing the field output.
  if (opts.__gridCacheStats) opts.__gridCacheStats({ hits: cacheHits, misses: cacheMisses, total: scenario.aps.length })

  const rssi = new Float32Array(nx * ny)
  const sinr = new Float32Array(nx * ny)
  const snr  = new Float32Array(nx * ny)
  const cci  = new Float32Array(nx * ny)

  // Scopes clip on the PIXI sprite, not here (see the aggregated path above).
  const perApScratch = new Array(scenario.aps.length)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i
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

// ---- Phase 41-5/41-6: async variant ----
// Same output shape and physics as sampleFieldGL, but the main thread never
// stalls on the GPU: readbacks go through PBO + fence (awaited off the hot
// path) and the host-side CPU loops yield to the event loop every ~5 ms so
// rAF-driven work (the heatmap transition animation) keeps painting.
//
// opts.isStale — optional callback polled after every await; when it returns
// true the compute aborts and resolves null (the caller's generation moved
// on, so finishing the work would only waste time and PBOs).
//
// Duplication note: the grid/mask/aggregate logic intentionally mirrors the
// sync path above rather than sharing one parameterised body — the sync path
// is the byte-identical-verified baseline (Phase 25) and stays untouched.

const CHUNK_BUDGET_MS = 5
const yieldMacro = () => new Promise((r) => setTimeout(r, 0))

// Serialise all async computes through one queue. Two consumers share the
// propagationGL instance (2D adapter + 3D plane) and the banded/batched
// paths hold GL state across awaits — interleaving two async computes would
// clobber programs/uniforms mid-flight. Serialising also avoids queueing two
// redundant heavyweight GPU passes at once.
let asyncQueueTail = Promise.resolve()
// Bumped by every SYNC sampleFieldGL call. The sync path shares the GL
// instance and its caches with async jobs but can't be queued behind the
// mutex — instead, any sync activity marks every in-flight async compute
// stale (they re-check at each await and abort). This is what makes the
// solo-drag path's aggressive cache eviction safe.
let syncEpoch = 0

export function sampleFieldGLAsync(scenario, gridStepM = 0.5, opts = {}) {
  const run = asyncQueueTail.then(() => sampleFieldGLAsyncInner(scenario, gridStepM, opts))
  asyncQueueTail = run.catch(() => {})
  return run
}

async function sampleFieldGLAsyncInner(scenario, gridStepM = 0.5, opts = {}) {
  const gl = getGL()
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
  // 52-A2: cell ceiling, as in the sync path above.
  gridStepM = fitGridStep(totalW, totalH, gridStepM)
  const nx = Math.ceil(totalW / gridStepM) + 1
  const ny = Math.ceil(totalH / gridStepM) + 1
  const mask = scenario.scopeMaskFn ?? (() => true)
  const rxZM = scenario.rxElevationM ?? 0
  const callerStale = opts.isStale ?? (() => false)
  const epoch0 = syncEpoch
  const isStale = () => callerStale() || syncEpoch !== epoch0

  const boundaries = scenario.floorBoundaries ?? []
  gl.uploadWalls(scenario.walls)
  gl.uploadCorners(scenario.corners ?? [])
  const slabMeta = gl.uploadSlabs(boundaries)

  if (canUseAggregated(scenario, opts)) {
    const apsForGL = scenario.aps.map((ap) => ({
      ...ap,
      _antGainDbi: ap.antGainDbi ?? AP_ANT_GAIN_DBI,
    }))
    gl.uploadAps(apsForGL)
    const out = await gl.renderFieldAsync(scenario, gridStepM, { x: originX, y: originY }, rxZM, slabMeta, {
      _rxGainDbi: RX_ANT_GAIN_DBI,
      noiseDbm: NOISE_FLOOR_DBM,
      cullFloorDbm: opts.cullFloorDbm ?? CULL_FLOOR_DBM,
      rssiOnly: !!opts.rssiOnly,
      gridSize: { nx, ny },
      isStale,
    })
    if (out === null || isStale()) return null

    // Scopes clip on the PIXI sprite, not here (see the sync path above).
    const { rssi, sinr, snr, cci } = out
    for (let idx = 0; idx < cci.length; idx++) {
      if (cci[idx] < CCI_MIN_DBM) cci[idx] = CCI_MIN_DBM
    }
    return { rssi, sinr, snr, cci, nx, ny, gridStepM, originX, originY }
  }

  // ---- per-AP fallback (refl on, diff on, or custom AP present) ----
  const losEnabled = opts.losEnabled !== false
  const losMap = losEnabled
    ? gl.bakeLos(
        scenario.aps.map((ap, i) => ({ ap, key: ap.id ?? `_idx_${i}` })),
        gridStepM, { x: originX, y: originY }, rxZM, nx, ny,
        scenario.walls.length,
      )
    : null
  const apGeoEnabled = opts.apGeoEnabled !== false
  const apGeoMap = apGeoEnabled
    ? gl.bakeApGeo(scenario.aps.map((ap, i) => ({ ap, key: ap.id ?? `_idx_${i}` })))
    : null

  const gridCacheOn =
    opts.gridCacheEnabled !== false &&
    typeof gl.getCachedGrid === 'function' &&
    typeof gl.setCachedGrid === 'function'
  const geomSig = gridCacheOn
    ? [
        gl.getWallsVersion(),
        scenario.corners?.length ?? 0,
        boundaries.length,
        boundaries.map((b) => `${b.elevationM ?? b.yM ?? 0}:${b.slabDb ?? b.slabAttenuationDb ?? 0}`).join(','),
        rxZM, gridStepM, nx, ny, originX, originY,
        opts.maxReflOrder ?? 0,
        opts.enableDiffraction ? 1 : 0,
        opts.freqOverrideN ?? 0,
        opts.cullFloorDbm ?? '',
        opts.losFastMode ? 1 : 0,
      ].join('|')
    : null

  // Submit cache-miss APs in small batches. Submitting ALL APs before the
  // first fence looks tempting (one wait covers everything) but backfires on
  // big scenes: hundreds of heavy refl/diff draws fill the driver's command
  // buffer and the GL calls themselves start BLOCKING (backpressure) — a
  // 300-AP scene measured as ONE 13 s main-thread task. Fencing every
  // SUBMIT_BATCH draws bounds the in-flight GPU work (and PBO count), so the
  // submit loop always yields quickly and animation frames interleave.
  // 4 (not 8): a refl+diff draw on a big scene can run hundreds of ms of GPU
  // time, and ANY GL call from ANY context (PIXI included) blocks while the
  // queue is deep — the batch size is the worst-case UI stall knob.
  const SUBMIT_BATCH = 4
  const perApGrids = new Array(scenario.aps.length)
  const pending = [] // { k, apKey, hash, handle }

  const flushPending = async () => {
    if (pending.length === 0) return true
    const batch = pending.splice(0, pending.length)
    const grids = await gl.resolveApReads(batch.map((p) => p.handle))
    if (isStale()) return false
    for (let p = 0; p < batch.length; p++) {
      const { k, apKey, hash } = batch[p]
      const ap = scenario.aps[k]
      let grid = grids[p]
      if (ap.antennaMode === 'custom') {
        // Custom-pattern AP: replace the shader grid with the JS lobe,
        // chunked so the row loop never owns the thread for > ~5 ms.
        grid = await customApGridChunked(ap, scenario, boundaries, opts, nx, ny, originX, originY, gridStepM, rxZM, isStale)
        if (grid === null) return false
      }
      if (gridCacheOn) gl.setCachedGrid(apKey, hash, grid, nx, ny)
      perApGrids[k] = grid
    }
    return true
  }

  for (let k = 0; k < scenario.aps.length; k++) {
    const ap = scenario.aps[k]
    const apForGL = {
      ...ap,
      _antGainDbi: ap.antGainDbi ?? AP_ANT_GAIN_DBI,
      _rxGainDbi: RX_ANT_GAIN_DBI,
    }
    const apKey = ap.id ?? `_idx_${k}`

    let hash = null
    if (gridCacheOn) {
      const apSig = [
        ap.id ?? `idx${k}`,
        ap.pos?.x ?? ap.x, ap.pos?.y ?? ap.y, ap.zM ?? 0,
        ap.txDbm, ap.centerMHz ?? '', ap.channelWidth ?? '',
        ap.antennaMode ?? 'omni', ap.azimuthDeg ?? 0, ap.beamwidthDeg ?? 0,
        ap.tiltDeg ?? 0, ap.patternId ?? '',
        // 47-10: effective per-AP gain — must be the resolved value, or a
        // model change (different gain) would serve a stale cached grid.
        ap.antGainDbi ?? AP_ANT_GAIN_DBI, RX_ANT_GAIN_DBI,
      ].join('|')
      hash = apSig + '#' + geomSig
      const cached = gl.getCachedGrid(apKey, hash)
      if (cached) {
        perApGrids[k] = cached.grid
        continue
      }
    }

    const losEntry = losMap?.get(apKey)
    const apGeoEntry = apGeoMap?.get(apKey)
    const handle = gl.renderApSubmit(
      apForGL, scenario, gridStepM, { x: originX, y: originY }, rxZM, slabMeta,
      {
        ...opts,
        gridSize: { nx, ny },
        losTex: losEntry?.tex,
        losFastMode: opts.losFastMode === true,
        apGeoEntry,
      },
    )
    pending.push({ k, apKey, hash, handle })
    if (pending.length >= SUBMIT_BATCH) {
      if (isStale()) {
        gl.discardApReads(pending.map((p) => p.handle))
        return null
      }
      if (!(await flushPending())) return null
    }
  }

  if (isStale()) {
    gl.discardApReads(pending.map((p) => p.handle))
    return null
  }
  if (!(await flushPending())) return null

  return aggregateChunked(perApGrids, scenario, nx, ny, originX, originY, gridStepM, w, h, mask, isStale)
}

async function customApGridChunked(ap, scenario, boundaries, opts, nx, ny, originX, originY, gridStepM, rxZM, isStale) {
  const corrected = new Float32Array(nx * ny)
  let sliceStart = performance.now()
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
    if (j < ny - 1 && performance.now() - sliceStart > CHUNK_BUDGET_MS) {
      await yieldMacro()
      if (isStale()) return null
      sliceStart = performance.now()
    }
  }
  return corrected
}

// Phase 41-6: the O(grid × N_AP) fold, sliced by rows on a ~5 ms budget with
// a macrotask yield between slices so animation frames interleave.
async function aggregateChunked(perApGrids, scenario, nx, ny, originX, originY, gridStepM, w, h, mask, isStale) {
  const rssi = new Float32Array(nx * ny)
  const sinr = new Float32Array(nx * ny)
  const snr  = new Float32Array(nx * ny)
  const cci  = new Float32Array(nx * ny)
  // Scopes clip on the PIXI sprite, not here (see sampleFieldGL sync path).
  const perApScratch = new Array(scenario.aps.length)
  let sliceStart = performance.now()
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i
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
    if (j < ny - 1 && performance.now() - sliceStart > CHUNK_BUDGET_MS) {
      await yieldMacro()
      if (isStale()) return null
      sliceStart = performance.now()
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

// Warm up shader programs so the user's first real heatmap render doesn't pay
// ~450ms / AP for GLSL compile + program link + first-draw pipeline init.
// Triggered once when Editor2D mounts (idle callback). Subsequent calls are
// no-ops. Runs both paths (aggregated + per-AP refl/diff) on a 1×1 m dummy
// scenario so every program the real render might dispatch is already cached.
let __warmedUp = false
export function warmupGL() {
  if (__warmedUp) return
  __warmedUp = true
  const dummyAp = {
    id: '__warmup_ap__',
    pos: { x: 0.5, y: 0.5 },
    zM: 1, txDbm: 20, frequency: 5, channelWidth: 20, antennaMode: 'omni',
  }
  const dummyScenario = {
    size: { w: 1, h: 1 },
    walls: [], corners: [], aps: [dummyAp],
    floorBoundaries: [], rxElevationM: 0,
  }
  try {
    sampleFieldGL(dummyScenario, 1.0, { maxReflOrder: 0, enableDiffraction: false })
    sampleFieldGL(dummyScenario, 1.0, { maxReflOrder: 1, enableDiffraction: true })
  } catch (e) {
    console.warn('[Heatmap] warmup failed:', e.message)
  }
}

// Bench / debug: switch the shader between brute-force (per-wall loop) and
// grid traversal at runtime. Useful for measuring the F5b speedup on a fixed
// scenario without rebuilding textures.
export function setUseGrid(v) {
  if (glInstance) glInstance.setUseGrid(v)
}

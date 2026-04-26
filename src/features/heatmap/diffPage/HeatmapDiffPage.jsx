// In-browser diff harness — HM-T2's visual counterpart and the de-facto
// validation rig for HM-F5a (since headless WebGL2 isn't available in Node).
//
// At #/heatmap-diff this page:
//   1. Loads each fixture's golden field.json via Vite's static import
//   2. Imports the fixture's scenario.js, builds the same scenario as the
//      runtime would, runs both engines (CPU + Shader)
//   3. Renders a 3-panel grid per channel (golden / JS / Shader) with a
//      diff column flagging cells over the active threshold
//   4. Reports stats (max/mean/p95 abs error, breach counts) and the per-
//      stage gate verdict from __fixtures__/README.md
//
// The page is purely additive — no impact on the main editor's UX.

import React, { useEffect, useMemo, useState } from 'react'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleField }   from '@/features/heatmap/sampleField'
import { sampleFieldGL } from '@/features/heatmap/sampleFieldGL'
import { __debug as propDebug } from '@/features/heatmap/propagation'
import { evaluateFresnelGL } from '@/features/heatmap/fresnelGLDebug'
import { MATERIAL_LIST } from '@/constants/materials'
import { computeFloorElevations } from '@/features/viewer3d/floorStacking'
import './HeatmapDiffPage.sass'

// Eagerly import every basic-style fixture's scenario + golden field at build
// time. Vite's import.meta.glob handles the dynamic discovery so adding a new
// fixture under __fixtures__/<name>/ "just works".
//
// Each fixture has two baselines:
//   - field-friis.json: reflections+diffraction OFF — F5a/F5b's target
//   - field-full.json:  full physics — F5c/F5d/F5e/F5f's target
const scenarioMods = import.meta.glob('../__fixtures__/*/scenario.js',     { eager: true })
const fullMods     = import.meta.glob('../__fixtures__/*/field-full.json', { eager: true, import: 'default' })
const friisMods    = import.meta.glob('../__fixtures__/*/field-friis.json',{ eager: true, import: 'default' })
const metaMods     = import.meta.glob('../__fixtures__/*/meta.json',       { eager: true, import: 'default' })

// Convert "../__fixtures__/basic/scenario.js" → "basic".
function fixtureNameFromPath(p) {
  const m = p.match(/__fixtures__\/([^/]+)\//)
  return m ? m[1] : p
}

function base64ToFloat32(b64) {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4)
}

// Mirror HeatmapLayer's cross-floor assembly without live drag overlays.
function assembleCrossFloor(scenarioMod) {
  const { floors, apsByFloor, floorHolesByFloor, wallsByFloor, meta } = scenarioMod
  const elevations = computeFloorElevations(floors)
  const activeFloorId = meta.activeFloorId
  const floorIndexById = new Map(floors.map((f, i) => [f.id, i]))

  const floorStack = floors.map((f) => ({
    id: f.id,
    elevationM: elevations[f.id] ?? 0,
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
    const floorElev = elevations[f.id] ?? 0
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
      elevationM: elevations[f.id] ?? 0,
      scale: f.scale,
      walls: fws,
    })
  }

  return {
    activeElevationM: elevations[activeFloorId] ?? 0,
    rxHeightM: scenarioMod.engineOpts.rxHeightM ?? 1.0,
    floorStack,
    apsByFloor: apsAcrossFloors,
    otherFloorWalls,
  }
}

const CHANNELS = ['rssi', 'sinr', 'snr', 'cci']

// Same colormap logic the diff harness HTML report uses, kept simple.
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

function diffColor(absErr, thr) {
  if (!isFinite(absErr)) return [255, 0, 255]
  if (absErr === 0)      return [10, 60, 30]
  const t = absErr / thr
  if (t <= 1) return [Math.round(40 + 80 * t), Math.round(180 + 40 * t), Math.round(60 + 40 * t)]
  if (t <= 3) {
    const u = (t - 1) / 2
    return [Math.round(180 + 75 * u), Math.round(180 - 80 * u), 40]
  }
  return [220, 40, 40]
}

function FieldCanvas({ data, nx, ny, valueRange, cellSize = 5 }) {
  const ref = React.useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    cv.width = nx
    cv.height = ny
    const ctx = cv.getContext('2d')
    const img = ctx.createImageData(nx, ny)
    const [vmin, vmax] = valueRange
    const span = Math.max(1e-9, vmax - vmin)
    for (let i = 0; i < nx * ny; i++) {
      const v = data[i]
      if (Number.isNaN(v)) {
        img.data[i * 4    ] = 0
        img.data[i * 4 + 1] = 0
        img.data[i * 4 + 2] = 0
        img.data[i * 4 + 3] = 0
      } else {
        const t = (v - vmin) / span
        const [r, g, b] = viridis(t)
        img.data[i * 4    ] = r
        img.data[i * 4 + 1] = g
        img.data[i * 4 + 2] = b
        img.data[i * 4 + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [data, nx, ny, valueRange])
  return <canvas ref={ref} style={{ width: nx * cellSize, height: ny * cellSize, imageRendering: 'pixelated' }} />
}

function DiffCanvas({ a, b, nx, ny, thr, cellSize = 5 }) {
  const ref = React.useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    cv.width = nx
    cv.height = ny
    const ctx = cv.getContext('2d')
    const img = ctx.createImageData(nx, ny)
    for (let i = 0; i < nx * ny; i++) {
      const av = a[i], bv = b[i]
      if (Number.isNaN(av) && Number.isNaN(bv)) {
        img.data[i * 4 + 3] = 0
        continue
      }
      if (Number.isNaN(av) || Number.isNaN(bv)) {
        img.data[i * 4    ] = 255
        img.data[i * 4 + 1] = 0
        img.data[i * 4 + 2] = 255
        img.data[i * 4 + 3] = 255
        continue
      }
      const e = Math.abs(av - bv)
      const [r, g, c] = diffColor(e, thr)
      img.data[i * 4    ] = r
      img.data[i * 4 + 1] = g
      img.data[i * 4 + 2] = c
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [a, b, nx, ny, thr])
  return <canvas ref={ref} style={{ width: nx * cellSize, height: ny * cellSize, imageRendering: 'pixelated' }} />
}

function diffStats(a, b) {
  let bothFinite = 0
  let bothNaN = 0
  let nanMis = 0
  let maxAbs = 0
  let sumAbs = 0
  let count05 = 0, count10 = 0, count30 = 0
  const errs = []
  for (let i = 0; i < a.length; i++) {
    const av = a[i], bv = b[i]
    const an = Number.isNaN(av), bn = Number.isNaN(bv)
    if (an && bn) { bothNaN++; continue }
    if (an || bn) { nanMis++; continue }
    bothFinite++
    const e = Math.abs(av - bv)
    errs.push(e)
    sumAbs += e
    if (e > maxAbs) maxAbs = e
    if (e > 0.5) count05++
    if (e > 1)   count10++
    if (e > 3)   count30++
  }
  errs.sort((x, y) => x - y)
  const p95 = errs.length ? errs[Math.floor(errs.length * 0.95)] : 0
  return {
    bothFinite, bothNaN, nanMis,
    maxAbs, meanAbs: bothFinite ? sumAbs / bothFinite : 0, p95Abs: p95,
    count05, count10, count30,
  }
}

function valueRangeFor(arrays) {
  let lo = Infinity, hi = -Infinity
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]
      if (Number.isNaN(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!isFinite(lo) || !isFinite(hi)) return [-100, -30]
  return [lo, hi]
}

function FixturePanel({ name, scenarioMod, fullRaw, friisRaw, metaRaw, threshold, baseline, optsOverride }) {
  const [computed, setComputed] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const { floors, wallsByFloor, apsByFloor, scopesByFloor, engineOpts, meta } = scenarioMod
        const activeFloor = floors.find((f) => f.id === meta.activeFloorId)
        const crossFloor = assembleCrossFloor(scenarioMod)
        const scenario = buildScenario(
          activeFloor,
          wallsByFloor[meta.activeFloorId] ?? [],
          apsByFloor[meta.activeFloorId] ?? [],
          scopesByFloor[meta.activeFloorId] ?? [],
          crossFloor,
        )
        // Diff against the baseline the active stage targets:
        //   - friis baseline → JS runs with maxReflOrder=0, diffraction=off
        //     (matches what generated field-friis.json) so a "JS vs golden"
        //     diff is effectively a numerical-precision check.
        //   - full baseline → JS runs with full physics, matching field-full.json.
        // The shader path runs the same opts; at F5a/b it ignores reflections/
        // diffraction internally regardless, so for friis baselines the result
        // converges with both JS and golden.
        // optsOverride (HM-F5c+d porting) lets the user pin refl/diff/freqN
        // independent of the stage's baseline — matters because intermediate
        // sub-steps (refl-only, refl+diff single-freq) diff JS-vs-Shader, not
        // vs golden. Override null → use baseline-derived opts as before.
        const baseOpts = baseline === 'friis'
          ? { maxReflOrder: 0, enableDiffraction: false }
          : { maxReflOrder: engineOpts.maxReflOrder, enableDiffraction: engineOpts.enableDiffraction }
        const opts = optsOverride
          ? {
              maxReflOrder: optsOverride.refl ? 1 : 0,
              enableDiffraction: !!optsOverride.diff,
              freqOverrideN: optsOverride.freqN,
            }
          : baseOpts
        const tJs = performance.now()
        const fieldJs = sampleField(scenario, engineOpts.gridStepM, opts)
        const dtJs = performance.now() - tJs

        const tShader = performance.now()
        let fieldShader = null
        let shaderErr = null
        try {
          fieldShader = sampleFieldGL(scenario, engineOpts.gridStepM, opts)
        } catch (e) {
          shaderErr = e.message
        }
        const dtShader = performance.now() - tShader

        if (cancelled) return
        setComputed({ fieldJs, fieldShader, dtJs, dtShader, shaderErr, scenario })
      } catch (e) {
        if (!cancelled) setError(e.message ?? String(e))
      }
    }
    run()
    return () => { cancelled = true }
  }, [scenarioMod, baseline, optsOverride])

  if (error) return <section className="panel"><h3>{name}</h3><p className="error">{error}</p></section>
  if (!computed) return <section className="panel"><h3>{name}</h3><p>Computing…</p></section>

  const { fieldJs, fieldShader, dtJs, dtShader, shaderErr } = computed
  const { nx, ny } = fieldJs

  // Pick which baseline to diff against — F5a/b → friis; F5c+ → full.
  const goldenRaw = baseline === 'friis' ? friisRaw : fullRaw
  const golden = {
    rssi: base64ToFloat32(goldenRaw.rssi),
    sinr: base64ToFloat32(goldenRaw.sinr),
    snr:  base64ToFloat32(goldenRaw.snr),
    cci:  base64ToFloat32(goldenRaw.cci),
  }

  const optsLabel = optsOverride
    ? `override refl=${optsOverride.refl ? 'on' : 'off'} diff=${optsOverride.diff ? 'on' : 'off'} freqN=${optsOverride.freqN ?? 'auto'}`
    : 'baseline opts'
  return (
    <section className="panel">
      <header>
        <h3>{name}</h3>
        <p className="meta">
          grid {nx}×{ny} · gridStep {fieldJs.gridStepM} m · baseline <strong>{baseline}</strong> · {optsLabel} · golden fingerprint {metaRaw.engineFingerprint} ·
          JS {dtJs.toFixed(0)} ms · Shader {fieldShader ? `${dtShader.toFixed(0)} ms` : `failed (${shaderErr})`}
        </p>
      </header>
      {CHANNELS.map((ch) => {
        const arrs = [golden[ch], fieldJs[ch]]
        if (fieldShader) arrs.push(fieldShader[ch])
        const vr = valueRangeFor(arrs)

        const jsVsGolden = diffStats(golden[ch], fieldJs[ch])
        const shVsGolden = fieldShader ? diffStats(golden[ch], fieldShader[ch]) : null
        const shVsJs     = fieldShader ? diffStats(fieldJs[ch], fieldShader[ch]) : null

        const verdict = (s) => s && s.maxAbs <= threshold && s.nanMis === 0 ? 'PASS' : 'FAIL'

        return (
          <div className="channel" key={ch}>
            <h4>
              {ch.toUpperCase()}
              {' '}
              <span className={`verdict ${verdict(jsVsGolden).toLowerCase()}`}>JS {verdict(jsVsGolden)}</span>
              {fieldShader && (
                <span className={`verdict ${verdict(shVsGolden).toLowerCase()}`}>Shader {verdict(shVsGolden)}</span>
              )}
            </h4>
            <div className="grid">
              <figure>
                <figcaption>golden</figcaption>
                <FieldCanvas data={golden[ch]} nx={nx} ny={ny} valueRange={vr} />
              </figure>
              <figure>
                <figcaption>JS · max={jsVsGolden.maxAbs.toFixed(3)} dB</figcaption>
                <FieldCanvas data={fieldJs[ch]} nx={nx} ny={ny} valueRange={vr} />
              </figure>
              {fieldShader && (
                <figure>
                  <figcaption>Shader · max={shVsGolden.maxAbs.toFixed(3)} dB</figcaption>
                  <FieldCanvas data={fieldShader[ch]} nx={nx} ny={ny} valueRange={vr} />
                </figure>
              )}
              {fieldShader && (
                <figure>
                  <figcaption>|Shader − JS| · thr={threshold} dB</figcaption>
                  <DiffCanvas a={fieldJs[ch]} b={fieldShader[ch]} nx={nx} ny={ny} thr={threshold} />
                </figure>
              )}
            </div>
            <table className="stats">
              <thead><tr><th>diff</th><th>max</th><th>mean</th><th>p95</th><th>&gt;0.5</th><th>&gt;1</th><th>&gt;3</th><th>nanMis</th></tr></thead>
              <tbody>
                <tr><td>JS vs golden</td>
                  <td>{jsVsGolden.maxAbs.toFixed(3)}</td>
                  <td>{jsVsGolden.meanAbs.toFixed(3)}</td>
                  <td>{jsVsGolden.p95Abs.toFixed(3)}</td>
                  <td>{jsVsGolden.count05}</td>
                  <td>{jsVsGolden.count10}</td>
                  <td>{jsVsGolden.count30}</td>
                  <td>{jsVsGolden.nanMis}</td>
                </tr>
                {shVsGolden && (
                  <tr><td>Shader vs golden</td>
                    <td>{shVsGolden.maxAbs.toFixed(3)}</td>
                    <td>{shVsGolden.meanAbs.toFixed(3)}</td>
                    <td>{shVsGolden.p95Abs.toFixed(3)}</td>
                    <td>{shVsGolden.count05}</td>
                    <td>{shVsGolden.count10}</td>
                    <td>{shVsGolden.count30}</td>
                    <td>{shVsGolden.nanMis}</td>
                  </tr>
                )}
                {shVsJs && (
                  <tr><td>Shader vs JS</td>
                    <td>{shVsJs.maxAbs.toFixed(3)}</td>
                    <td>{shVsJs.meanAbs.toFixed(3)}</td>
                    <td>{shVsJs.p95Abs.toFixed(3)}</td>
                    <td>{shVsJs.count05}</td>
                    <td>{shVsJs.count10}</td>
                    <td>{shVsJs.count30}</td>
                    <td>{shVsJs.nanMis}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )
      })}
    </section>
  )
}

// Per-stage gate config: which baseline this stage targets, and what the
// max-abs-error threshold is. Mirrors __fixtures__/README.md.
const STAGE_GATES = {
  'F5a': { baseline: 'friis', threshold: 1.0 },
  'F5b': { baseline: 'friis', threshold: 1.0 },
  'F5c': { baseline: 'full',  threshold: 1.5 },
  'F5d': { baseline: 'full',  threshold: 1.0 },
}

// HM-F5c+d porting step 1: pure-function GLSL parity check.
// Sweeps a small grid of (material × cosI × freqMhz) and diffs JS vs GLSL
// fresnelGamma / materialEpsC outputs. Threshold 1e-4 — these are pure
// arithmetic functions, fp32 noise alone shouldn't approach that.
const FRESNEL_PARITY_THRESHOLD = 1e-4
const FRESNEL_FREQS_MHZ = [2400, 5500, 6000]
const FRESNEL_COSI = [0.1, 0.3, 0.6, 0.95]

function runFresnelParity() {
  const cases = []
  let worstAbs = 0
  let worstLabel = ''
  let pass = 0
  let fail = 0
  for (const mat of MATERIAL_LIST) {
    const isMetal = !!mat.itu?.metal
    const itu = isMetal ? null : mat.itu
    for (const freqMhz of FRESNEL_FREQS_MHZ) {
      for (const cosI of FRESNEL_COSI) {
        const epsC = propDebug.materialEpsC(mat.itu, freqMhz)
        const jsG  = propDebug.fresnelGamma(cosI, epsC)
        const glG  = evaluateFresnelGL({ cosI, freqMhz, itu, isMetal })
        const dPerpRe = Math.abs(jsG.perp.re - glG.perp.re)
        const dPerpIm = Math.abs(jsG.perp.im - glG.perp.im)
        const dParaRe = Math.abs(jsG.para.re - glG.para.re)
        const dParaIm = Math.abs(jsG.para.im - glG.para.im)
        const maxAbs = Math.max(dPerpRe, dPerpIm, dParaRe, dParaIm)
        const ok = maxAbs <= FRESNEL_PARITY_THRESHOLD
        if (ok) pass++; else fail++
        if (maxAbs > worstAbs) {
          worstAbs = maxAbs
          worstLabel = `${mat.id} f=${freqMhz} cosI=${cosI}`
        }
        cases.push({
          mat: mat.id, freqMhz, cosI,
          js: jsG, gl: glG, maxAbs, ok,
        })
      }
    }
  }
  return { cases, pass, fail, worstAbs, worstLabel }
}

function FresnelParityPanel() {
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const run = () => {
    try { setResult(runFresnelParity()); setError(null) }
    catch (e) { setError(e.message ?? String(e)); setResult(null) }
  }
  return (
    <section className="panel">
      <header>
        <h3>Step 1 — fresnelGamma / materialEpsC GLSL parity</h3>
        <p className="meta">
          Threshold {FRESNEL_PARITY_THRESHOLD} (max abs error across perp.re, perp.im, para.re, para.im).
          Cases: {MATERIAL_LIST.length} mats × {FRESNEL_FREQS_MHZ.length} freqs × {FRESNEL_COSI.length} cosI =&nbsp;
          {MATERIAL_LIST.length * FRESNEL_FREQS_MHZ.length * FRESNEL_COSI.length}.
        </p>
        <button type="button" onClick={run}>Run parity check</button>
      </header>
      {error && <p className="error">{error}</p>}
      {result && (
        <>
          <p className="meta">
            <span className={`verdict ${result.fail === 0 ? 'pass' : 'fail'}`}>
              {result.fail === 0 ? 'PASS' : 'FAIL'}
            </span>
            {' '}pass {result.pass} · fail {result.fail} · worst {result.worstAbs.toExponential(2)} ({result.worstLabel})
          </p>
          <table className="stats">
            <thead>
              <tr>
                <th>material</th><th>freq MHz</th><th>cosI</th>
                <th>JS Γ⊥</th><th>GL Γ⊥</th>
                <th>JS Γ∥</th><th>GL Γ∥</th>
                <th>maxAbs</th><th>ok</th>
              </tr>
            </thead>
            <tbody>
              {result.cases.map((c, i) => (
                <tr key={i}>
                  <td>{c.mat}</td>
                  <td>{c.freqMhz}</td>
                  <td>{c.cosI}</td>
                  <td>{c.js.perp.re.toFixed(5)}{c.js.perp.im >= 0 ? '+' : ''}{c.js.perp.im.toFixed(5)}j</td>
                  <td>{c.gl.perp.re.toFixed(5)}{c.gl.perp.im >= 0 ? '+' : ''}{c.gl.perp.im.toFixed(5)}j</td>
                  <td>{c.js.para.re.toFixed(5)}{c.js.para.im >= 0 ? '+' : ''}{c.js.para.im.toFixed(5)}j</td>
                  <td>{c.gl.para.re.toFixed(5)}{c.gl.para.im >= 0 ? '+' : ''}{c.gl.para.im.toFixed(5)}j</td>
                  <td>{c.maxAbs.toExponential(2)}</td>
                  <td>{c.ok ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

// HM-F5c+d porting sub-steps. Each pins specific opts (refl/diff/freqN) so
// JS and shader run the same physics subset; verdict is read off the
// "Shader vs JS" stats row, not vs golden. Threshold 1 dB for all sub-steps.
const SUBSTEP_OVERRIDES = {
  'sub2-refl-only':  { refl: true,  diff: false, freqN: 1 },
  'sub3-refl+diff':  { refl: true,  diff: true,  freqN: 1 },
}

export default function HeatmapDiffPage() {
  const [stage, setStage] = useState('F5a')
  const [substep, setSubstep] = useState('none')
  const gate = STAGE_GATES[stage] ?? STAGE_GATES['F5a']
  const optsOverride = substep !== 'none' ? SUBSTEP_OVERRIDES[substep] : null

  const fixtures = useMemo(() => {
    const result = []
    for (const [path, mod] of Object.entries(scenarioMods)) {
      const name = fixtureNameFromPath(path)
      const fullPath  = path.replace(/scenario\.js$/, 'field-full.json')
      const friisPath = path.replace(/scenario\.js$/, 'field-friis.json')
      const metaPath  = path.replace(/scenario\.js$/, 'meta.json')
      const fullRaw   = fullMods[fullPath]
      const friisRaw  = friisMods[friisPath]
      const metaRaw   = metaMods[metaPath]
      if (!fullRaw || !friisRaw || !metaRaw) continue
      result.push({ name, scenarioMod: mod, fullRaw, friisRaw, metaRaw })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  return (
    <div className="heatmap-diff-page">
      <header>
        <h1>Heatmap diff harness <small>#/heatmap-diff</small></h1>
        <p>
          Runs each fixture's golden snapshot vs. live JS engine vs. live Shader engine. Each
          F5 stage has its own baseline (Friis-only for F5a/b, full physics for F5c+) and
          dB threshold. Pick a stage to switch the gate.
        </p>
        <div className="stage-row">
          {Object.keys(STAGE_GATES).map((s) => {
            const g = STAGE_GATES[s]
            return (
              <button
                key={s}
                type="button"
                className={s === stage ? 'active' : ''}
                onClick={() => setStage(s)}
              >
                {s} · {g.baseline} · ≤{g.threshold} dB
              </button>
            )
          })}
        </div>
        <div className="stage-row">
          <span style={{ alignSelf: 'center', marginRight: 8, opacity: 0.7 }}>F5c+d sub-step:</span>
          <button
            type="button"
            className={substep === 'none' ? 'active' : ''}
            onClick={() => setSubstep('none')}
          >
            none (use baseline opts)
          </button>
          {Object.keys(SUBSTEP_OVERRIDES).map((s) => {
            const o = SUBSTEP_OVERRIDES[s]
            return (
              <button
                key={s}
                type="button"
                className={s === substep ? 'active' : ''}
                onClick={() => setSubstep(s)}
              >
                {s} · refl={o.refl ? 'on' : 'off'} diff={o.diff ? 'on' : 'off'} N={o.freqN}
              </button>
            )
          })}
        </div>
        {optsOverride && (
          <p style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
            Sub-step active. Verdict = <strong>"Shader vs JS"</strong> stats row · threshold 1 dB. "vs golden" rows will likely fail (golden uses different opts), that's expected.
          </p>
        )}
      </header>
      <FresnelParityPanel />
      {fixtures.length === 0 && <p>No fixtures found.</p>}
      {fixtures.map((f) => (
        <FixturePanel key={f.name} {...f} threshold={gate.threshold} baseline={gate.baseline} optsOverride={optsOverride} />
      ))}
    </div>
  )
}

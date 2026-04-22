// Per-AP propagation adapter over heatmap_sample's physics.
//
// heatmap_sample/src/physics/propagation.js hardcodes 5190 MHz (5 GHz Ch36@40).
// We need per-AP frequency so that a 2.4 GHz or 6 GHz AP computes with its own
// wavelength. We re-implement the same model here but parameterised by AP.
//
// Differences vs. sample:
//   - FREQ_MHZ / WAVELENGTH / K_WAVENUM are computed per AP from ap.centerMHz
//   - SINR aggregation only counts interferers that share spectrum (same band +
//     overlapping frequency range)
// All other math (ITU-R P.1238 + Friis blend, image-source reflection, UTD
// knife-edge diffraction, secant-law oblique wall loss) is identical.

import {
  AP_ANT_GAIN_DBI, RX_ANT_GAIN_DBI, NOISE_FLOOR_DBM,
} from '@/heatmap_sample/physics/constants.js'
import {
  sub, dot, len, dist, norm, segSegIntersect,
  pointSegDistance, mirrorPoint, segmentNormal,
} from '@/heatmap_sample/physics/geometry.js'
import { apsShareSpectrum } from './frequency'

const C = 299792458
const dbToLin = (db) => Math.pow(10, db / 10)
const linToDb = (lin) => 10 * Math.log10(Math.max(lin, 1e-30))

// Free-space (Friis) path loss, parameterised by frequency.
// Indoor attenuation comes from explicit per-wall dbLoss accumulated along the
// ray; we do NOT layer an ITU-R P.1238 site-general term on top, because that
// model already averages in wall losses — stacking them would double-count.
function pathLossDb(d, freqMhz) {
  const dEff = Math.max(d, 0.5)
  return 20 * Math.log10(dEff) + 20 * Math.log10(freqMhz) - 27.55
}

function wallLossOblique(wall, rayDir) {
  const n = segmentNormal(wall.a, wall.b)
  const cosI = Math.abs(dot(norm(rayDir), n))
  const sec = 1 / Math.max(cosI, 0.2)
  return wall.lossDb * Math.min(sec, 3.5)
}

function accumulateWallLoss(a, b, walls) {
  const rayDir = sub(b, a)
  let totalLoss = 0
  let hits = 0
  for (const w of walls) {
    const hit = segSegIntersect(a, b, w.a, w.b)
    if (hit) { totalLoss += wallLossOblique(w, rayDir); hits += 1 }
  }
  return { totalLoss, hits }
}

function knifeEdgeLossDb(v) {
  if (v <= -1) return 0
  if (v <= 0)  return 20 * Math.log10(0.5 - 0.62 * v)
  if (v <= 1)  return 20 * Math.log10(0.5 * Math.exp(-0.95 * v))
  if (v <= 2.4) return 20 * Math.log10(0.4 - Math.sqrt(0.1184 - Math.pow(0.38 - 0.1 * v, 2)))
  return 20 * Math.log10(0.225 / v)
}

function cornerDiffractionDb(tx, rx, corner, wavelengthM) {
  const d1 = dist(tx, corner)
  const d2 = dist(corner, rx)
  const d  = dist(tx, rx)
  const seg = pointSegDistance(corner, tx, rx)
  const h = seg.d
  if (seg.t <= 0 || seg.t >= 1) return Infinity
  const v = h * Math.sqrt((2 / wavelengthM) * ((d1 + d2) / (d1 * d2)))
  return knifeEdgeLossDb(v)
}

function pathPhasor(txPowerDbm, totalLossDb, distanceM, kWavenum, extraPhaseRad = 0) {
  const rxPowerDb = txPowerDbm + AP_ANT_GAIN_DBI + RX_ANT_GAIN_DBI - totalLossDb
  const amp = Math.sqrt(dbToLin(rxPowerDb))
  const phase = kWavenum * distanceM + extraPhaseRad
  return { re: amp * Math.cos(phase), im: amp * Math.sin(phase) }
}

// Received power at rx from one AP. ap must carry centerMHz (see buildScenario).
export function rssiFromAp(ap, rx, walls, corners, opts = {}) {
  const maxReflOrder = opts.maxReflOrder ?? 1
  const enableDiffraction = opts.enableDiffraction ?? true

  const freqMhz = ap.centerMHz || 5190
  const wavelength = C / (freqMhz * 1e6)
  const kWave = (2 * Math.PI) / wavelength

  let Re = 0, Im = 0
  let pathsUsed = 0

  // Direct
  const dDir = Math.max(dist(ap.pos, rx), 0.25)
  const wallScan = accumulateWallLoss(ap.pos, rx, walls)
  const plDir = pathLossDb(dDir, freqMhz) + wallScan.totalLoss
  const phDir = pathPhasor(ap.txDbm, plDir, dDir, kWave)
  Re += phDir.re; Im += phDir.im; pathsUsed++

  // 1st-order image-source reflections
  if (maxReflOrder >= 1) {
    for (const w of walls) {
      const apImage = mirrorPoint(ap.pos, w.a, w.b)
      const hit = segSegIntersect(apImage, rx, w.a, w.b)
      if (!hit) continue
      const reflPt = hit.point
      const inDir = norm(sub(reflPt, ap.pos))
      const n = segmentNormal(w.a, w.b)
      const cosI = Math.abs(dot(inDir, n))
      if (cosI < 0.05) continue
      const gammaMag = w.reflectionMag * (0.5 + 0.5 * cosI)
      const rough = Math.exp(-2 * Math.pow(kWave * w.roughnessM * cosI, 2))
      const rFactor = gammaMag * rough
      if (rFactor < 0.02) continue

      const wallsExcl = walls.filter((x) => x !== w)
      const leg1 = accumulateWallLoss(ap.pos, reflPt, wallsExcl)
      const leg2 = accumulateWallLoss(reflPt, rx, wallsExcl)
      const dTot = dist(ap.pos, reflPt) + dist(reflPt, rx)

      const reflLossDb = -20 * Math.log10(Math.max(rFactor, 1e-3))
      const plRef = pathLossDb(dTot, freqMhz) + leg1.totalLoss + leg2.totalLoss + reflLossDb
      const ph = pathPhasor(ap.txDbm, plRef, dTot, kWave, Math.PI)
      Re += ph.re; Im += ph.im; pathsUsed++
    }
  }

  // UTD knife-edge diffraction around corners (only when direct is blocked)
  if (enableDiffraction && wallScan.hits > 0) {
    for (const c of corners) {
      const s1 = accumulateWallLoss(ap.pos, c, walls)
      const s2 = accumulateWallLoss(c, rx, walls)
      if (s1.hits > 1 || s2.hits > 1) continue
      const diff = cornerDiffractionDb(ap.pos, rx, c, wavelength)
      if (!isFinite(diff) || diff > 40) continue
      const d1 = dist(ap.pos, c)
      const d2 = dist(c, rx)
      const dTot = d1 + d2
      const plDiff = pathLossDb(dTot, freqMhz) + s1.totalLoss + s2.totalLoss + diff
      const ph = pathPhasor(ap.txDbm, plDiff, dTot, kWave)
      Re += ph.re; Im += ph.im; pathsUsed++
    }
  }

  const powerLin = Re * Re + Im * Im
  const rssiDbm = linToDb(powerLin)
  return { rssiDbm, pathsUsed }
}

// SINR-aware aggregation: strongest AP is the signal; other APs contribute to
// interference only if they share spectrum with the signal AP.
// Returns { rssiDbm, sinrDb, bestApIndex }.
export function aggregateApContributions(perApDbm, apList, noiseDbm = NOISE_FLOOR_DBM) {
  if (!perApDbm.length) return { rssiDbm: -120, sinrDb: -50, bestApIndex: -1 }

  // Best (strongest) AP = "serving" AP.
  let bestIdx = 0
  for (let i = 1; i < perApDbm.length; i++) {
    if (perApDbm[i] > perApDbm[bestIdx]) bestIdx = i
  }
  const signalDb = perApDbm[bestIdx]
  const signalAp = apList[bestIdx]

  let interfLin = dbToLin(noiseDbm)
  for (let i = 0; i < perApDbm.length; i++) {
    if (i === bestIdx) continue
    if (!apsShareSpectrum(signalAp, apList[i])) continue
    interfLin += dbToLin(perApDbm[i])
  }
  const sinrDb = signalDb - linToDb(interfLin)
  return { rssiDbm: signalDb, sinrDb, bestApIndex: bestIdx }
}

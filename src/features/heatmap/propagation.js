// Per-AP propagation adapter over heatmap_sample's physics.
//
// heatmap_sample/src/physics/propagation.js hardcodes 5190 MHz (5 GHz Ch36@40).
// We need per-AP frequency so that a 2.4 GHz or 6 GHz AP computes with its own
// wavelength. We re-implement the same model here but parameterised by AP.
//
// Differences vs. sample:
//   - Per-AP centre frequency (derived from ap.centerMHz) drives wavelength,
//     path loss and phasor wavenumber.
//   - Path loss uses pure Friis; wall losses are applied explicitly per ray
//     (no ITU-R P.1238 blend - that model would double-count wall loss).
//   - Multipath sum is evaluated at N frequency samples across the AP's
//     channel bandwidth (not just the centre), then power-averaged. Each path
//     carries a complex gain a_n,p and delay tau_n so the channel response
//     H_p(f) = sum_n a_n,p * exp(-j*2*pi*f*tau_n) can be sampled cleanly.
//   - Polarization is modelled as two orthogonal scalar channels (perp, para).
//     Reflections use the full complex Fresnel coefficient per polarization
//     (ITU-R P.2040-3 material params). Direct/diffraction paths are
//     polarization-neutral (a_perp = a_para). The two channels are combined
//     in the power domain: P(f) = |H_perp(f)|^2 + |H_para(f)|^2, with the
//     1/sqrt(2) tx excitation absorbed into each path's complex gain.
//   - SINR aggregation only counts interferers that share spectrum (same
//     band + overlapping frequency range).

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
// model already averages in wall losses - stacking them would double-count.
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

// Complex arithmetic helpers (objects with {re, im}).
const cmul = (a, b) => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})
const cdiv = (a, b) => {
  const den = b.re * b.re + b.im * b.im
  return {
    re: (a.re * b.re + a.im * b.im) / den,
    im: (a.im * b.re - a.re * b.im) / den,
  }
}
// Principal square root of a complex number. Returns the root with non-negative
// real part (consistent with passive-medium Fresnel branch choice).
function csqrt(z) {
  const r = Math.sqrt(z.re * z.re + z.im * z.im)
  const re = Math.sqrt(Math.max((r + z.re) / 2, 0))
  const imMag = Math.sqrt(Math.max((r - z.re) / 2, 0))
  return { re, im: z.im >= 0 ? imMag : -imMag }
}

// Complex relative permittivity from ITU-R P.2040-3 material coefficients.
//   eta'   = a * f_GHz^b
//   sigma  = c * f_GHz^d   (S/m)
//   eps_c  = eta' - j * sigma / (2*pi*f*eps_0)
const EPS0 = 8.854187817e-12
function materialEpsC(itu, freqMhz) {
  if (!itu || itu.metal) return { metal: true }
  const fGhz = freqMhz / 1000
  const etaPrime = itu.a * Math.pow(fGhz, itu.b ?? 0)
  const sigma    = itu.c * Math.pow(fGhz, itu.d ?? 0)
  return {
    re: etaPrime,
    im: -sigma / (2 * Math.PI * freqMhz * 1e6 * EPS0),
  }
}

// Fresnel reflection coefficients for TE (perpendicular) and TM (parallel)
// polarizations, for a plane wave incident from free space onto a medium with
// complex relative permittivity epsC. Metal special-cased as Gamma = -1.
//   root      = sqrt(eps_c - sin^2(theta))
//   Gamma_perp = (cos(theta) - root) / (cos(theta) + root)
//   Gamma_para = (eps_c*cos(theta) - root) / (eps_c*cos(theta) + root)
function fresnelGamma(cosI, epsC) {
  const MINUS_ONE = { re: -1, im: 0 }
  if (epsC.metal) return { perp: MINUS_ONE, para: MINUS_ONE }
  const sinI2 = 1 - cosI * cosI
  const root = csqrt({ re: epsC.re - sinI2, im: epsC.im })
  const cI = { re: cosI, im: 0 }
  const perp = cdiv(
    { re: cI.re - root.re, im: -root.im },
    { re: cI.re + root.re, im:  root.im },
  )
  const ecCos = cmul(epsC, cI)
  const para = cdiv(
    { re: ecCos.re - root.re, im: ecCos.im - root.im },
    { re: ecCos.re + root.re, im: ecCos.im + root.im },
  )
  return { perp, para }
}

// Build a polarization-neutral path (direct / diffraction).
// a_perp = a_para = (1/sqrt(2)) * sqrt(P_rx). Real-valued scalar; phase comes
// from tau_n when H(f) is evaluated. The 1/sqrt(2) encodes equal-power
// excitation of two orthogonal polarization basis channels.
function makeScalarPath(txPowerDbm, totalLossDb, distanceM) {
  const rxPowerDb = txPowerDbm + AP_ANT_GAIN_DBI + RX_ANT_GAIN_DBI - totalLossDb
  const amp = Math.sqrt(dbToLin(rxPowerDb)) / Math.SQRT2
  const a = { re: amp, im: 0 }
  return { perp: a, para: a, tau: distanceM / C }
}

// Build a reflected path: same 1/sqrt(2) excitation, but each polarization
// picks up its own complex Fresnel coefficient plus the shared roughness
// attenuation factor.
function makeReflectedPath(txPowerDbm, pathLossDb, distanceM, gammaPerp, gammaPara, roughness) {
  const rxPowerDb = txPowerDbm + AP_ANT_GAIN_DBI + RX_ANT_GAIN_DBI - pathLossDb
  const amp = Math.sqrt(dbToLin(rxPowerDb)) / Math.SQRT2
  const base = { re: amp * roughness, im: 0 }
  return {
    perp: cmul(base, gammaPerp),
    para: cmul(base, gammaPara),
    tau: distanceM / C,
  }
}

// Pick frequency sample count for the channel-wide coherent sum.
// df <= 4 MHz keeps aliasing safe up to ~125 ns delay spread (typical indoor
// upper bound). Minimum 5 points so even 20 MHz channels get useful averaging.
function chooseFreqSamples(bwMhz) {
  return Math.max(5, Math.ceil(bwMhz / 4))
}

// Received power at rx from one AP. ap must carry centerMHz (see buildScenario).
export function rssiFromAp(ap, rx, walls, corners, opts = {}) {
  const maxReflOrder = opts.maxReflOrder ?? 1
  const enableDiffraction = opts.enableDiffraction ?? true

  const freqMhz = ap.centerMHz || 5190
  const wavelength = C / (freqMhz * 1e6)
  const kWave = (2 * Math.PI) / wavelength

  const paths = []

  // Direct
  const dDir = Math.max(dist(ap.pos, rx), 0.25)
  const wallScan = accumulateWallLoss(ap.pos, rx, walls)
  const plDir = pathLossDb(dDir, freqMhz) + wallScan.totalLoss
  paths.push(makeScalarPath(ap.txDbm, plDir, dDir))

  // 1st-order image-source reflections with per-polarization Fresnel.
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

      const epsC = materialEpsC(w.itu, freqMhz)
      const { perp: gPerp, para: gPara } = fresnelGamma(cosI, epsC)
      const rough = Math.exp(-2 * Math.pow(kWave * w.roughnessM * cosI, 2))

      // Skip reflections whose combined magnitude is negligible on both pols.
      const magPerp = Math.sqrt(gPerp.re * gPerp.re + gPerp.im * gPerp.im)
      const magPara = Math.sqrt(gPara.re * gPara.re + gPara.im * gPara.im)
      if (Math.max(magPerp, magPara) * rough < 0.02) continue

      const wallsExcl = walls.filter((x) => x !== w)
      const leg1 = accumulateWallLoss(ap.pos, reflPt, wallsExcl)
      const leg2 = accumulateWallLoss(reflPt, rx, wallsExcl)
      const dTot = dist(ap.pos, reflPt) + dist(reflPt, rx)

      const plRef = pathLossDb(dTot, freqMhz) + leg1.totalLoss + leg2.totalLoss
      paths.push(makeReflectedPath(ap.txDbm, plRef, dTot, gPerp, gPara, rough))
    }
  }

  // Knife-edge diffraction around corners (only when direct is blocked).
  // Treated as polarization-neutral (scalar approximation).
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
      paths.push(makeScalarPath(ap.txDbm, plDiff, dTot))
    }
  }

  // Evaluate two polarization channels H_perp(f), H_para(f) at N frequency
  // samples across the channel bandwidth, then power-sum:
  //   P(f) = |H_perp(f)|^2 + |H_para(f)|^2
  // The 1/sqrt(2) excitation factor lives in each path's complex gain, so
  // the two-channel sum reconstructs total RX power (no extra /2 needed).
  const bwMhz = ap.channelWidth || 20
  const bwHz = bwMhz * 1e6 * 0.9          // drop 5% guard on each edge
  const centerHz = freqMhz * 1e6
  const N = chooseFreqSamples(bwMhz)
  const startHz = centerHz - bwHz / 2
  const stepHz = N > 1 ? bwHz / (N - 1) : 0

  let powerSum = 0
  for (let i = 0; i < N; i++) {
    const f = startHz + i * stepHz
    const twoPiF = 2 * Math.PI * f
    let HpRe = 0, HpIm = 0      // H_perp
    let HqRe = 0, HqIm = 0      // H_para
    for (const p of paths) {
      const ph = -twoPiF * p.tau
      const cs = Math.cos(ph), sn = Math.sin(ph)
      HpRe += p.perp.re * cs - p.perp.im * sn
      HpIm += p.perp.re * sn + p.perp.im * cs
      HqRe += p.para.re * cs - p.para.im * sn
      HqIm += p.para.re * sn + p.para.im * cs
    }
    powerSum += HpRe * HpRe + HpIm * HpIm + HqRe * HqRe + HqIm * HqIm
  }
  const rssiDbm = linToDb(powerSum / N)
  return { rssiDbm, pathsUsed: paths.length }
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

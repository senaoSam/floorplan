// Per-AP propagation engine. This is the JS reference engine — the source of
// truth that the WebGL shader path (sampleFieldGL / propagationGL) is meant to
// match.
//
// Model:
//   - Per-AP centre frequency (derived from ap.centerMHz) drives wavelength,
//     path loss and phasor wavenumber.
//   - Path loss uses pure Friis; wall losses are applied explicitly per ray
//     (no ITU-R P.1238 blend — that model would double-count wall loss).
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
  AP_ANT_GAIN_DBI, RX_ANT_GAIN_DBI, NOISE_FLOOR_DBM, indoorLossPerMeter,
} from './rfConstants.js'
import {
  sub, dot, len, dist, norm, segSegIntersect,
  pointSegDistance, mirrorPoint, segmentNormal,
} from './geometry.js'
import { apsShareSpectrum } from './frequency'
import { widthNoiseDelta } from '@/constants/channelWidths'
import { getPatternById, sampleGain, sampleGainV, sectorTaperDb, patternBackFloorDb, DIRECTIONAL_BACK_DB } from '@/constants/antennaPatterns'

const C = 299792458
const dbToLin = (db) => Math.pow(10, db / 10)
const linToDb = (lin) => 10 * Math.log10(Math.max(lin, 1e-30))

// Free-space (Friis) path loss + a small indoor distance-loss term. Explicit
// per-wall dbLoss is still accumulated separately along the ray; the indoor
// term models the diffuse environmental attenuation pure Friis omits (Friis ≈
// log-distance n=2, too optimistic indoors), lifting the effective exponent
// toward ~2.5. Negligible near the AP, grows with distance. We do NOT add an
// ITU-R P.1238 site-general term on top — that would double-count wall losses.
function pathLossDb(d, freqMhz) {
  const dEff = Math.max(d, 0.5)
  return 20 * Math.log10(dEff) + 20 * Math.log10(freqMhz) - 27.55
    + indoorLossPerMeter(freqMhz) * dEff
}

// 57-18: oblique-incidence terms for a dielectric layer of relative
// permittivity epsR hit at cos(theta_i) = cosI. The wave refracts towards the
// normal inside the layer, so the absorbing path grows with sec(theta_t),
// not sec(theta_i) -- concrete at 75 deg is ~1.10x, not 3.5x. What does grow
// at grazing angles is interface (Fresnel) reflection: the extra two-interface
// transmission loss relative to normal incidence (TE/TM averaged; the normal
// value is already inside the material's dB). Returns { secT, extraDb }.
// Mirrored by obliqueTerms() in both shaders in propagationGL.js.
const OBLIQUE_COS_MIN = 0.05
function obliqueTerms(cosI, epsR) {
  const ci = Math.max(cosI, OBLIQUE_COS_MIN)
  const n = Math.sqrt(Math.max(epsR, 1))
  const si = Math.sqrt(Math.max(0, 1 - ci * ci))
  const st = si / n
  const ct = Math.sqrt(Math.max(1e-6, 1 - st * st))
  let rs = (ci - n * ct) / (ci + n * ct); rs *= rs
  let rp = (ct - n * ci) / (ct + n * ci); rp *= rp
  const tIn = 1 - 0.5 * (rs + rp)
  let r0 = (1 - n) / (1 + n); r0 *= r0
  return { secT: 1 / ct, extraDb: -20 * Math.log10(tIn / (1 - r0)) }
}

// HM-F8: per-AP centre frequency drives wall loss. lossDb is the 2.4 GHz
// anchor (existing material constant), lossB is the ITU-R P.2040-3 frequency
// exponent. fOver24 = fGhz / 2.4, computed once per AP by rssiFromAp and
// threaded through the wall-loss path. Final per-crossing dB is
//   lossDb * fOver24 ** lossB * sec(theta_t) + Fresnel extra   (57-18)
// with epsR from the material's ITU-R P.2040 parameters. Metal / Low-E (and
// anything without ITU data) are reflection-dominated, not path-length
// absorbers, so they keep their normal-incidence loss at every angle.
// lossB === 0 (e.g. metal) bypasses the pow() so the existing wideband-flat
// behaviour is preserved.
function wallLossOblique(wall, rayDir, fOver24) {
  const fAdj = wall.lossB ? Math.pow(fOver24, wall.lossB) : 1
  const base = wall.lossDb * fAdj
  const itu = wall.itu
  if (!itu || itu.metal) return base
  const n = segmentNormal(wall.a, wall.b)
  const cosI = Math.abs(dot(norm(rayDir), n))
  const epsR = itu.a * Math.pow(fOver24 * 2.4, itu.b ?? 0)
  const { secT, extraDb } = obliqueTerms(cosI, epsR)
  return base * secT + extraDb
}

// When aZM/bZM are supplied, each wall hit's Z is interpolated along the ray
// at the hit's parametric t; hits whose Z falls outside [w.zLoM, w.zHiM] are
// skipped. This makes half-height partitions transparent to rays that pass
// over the top between an AP and a low receiver. Rays with unknown Z (legacy
// planar mode with no elevation data) bypass the filter and count every hit.
// `skip` (optional) excludes one wall by identity — the reflecting wall
// (57-11: replaces a per-reflection walls.filter copy; same walls, same order).
// `exclPt` (optional, 57-19) ignores crossings that land on that point -- a
// diffraction leg ends / starts at a corner, and the walls meeting there
// would otherwise count as obstructions of their own edge.
const CORNER_EPS_M = 1e-3
function accumulateWallLoss(a, b, walls, aZM, bZM, fOver24, skip = null, exclPt = null) {
  const rayDir = sub(b, a)
  const haveZ = aZM != null && bZM != null
  let totalLoss = 0
  let hits = 0
  for (const w of walls) {
    if (w === skip) continue
    const hit = segSegIntersect(a, b, w.a, w.b)
    if (!hit) continue
    if (exclPt && Math.abs(hit.point.x - exclPt.x) < CORNER_EPS_M && Math.abs(hit.point.y - exclPt.y) < CORNER_EPS_M) continue
    if (haveZ && w.zLoM != null && w.zHiM != null) {
      const zAt = aZM + (bZM - aZM) * hit.t
      if (zAt < w.zLoM || zAt > w.zHiM) continue
    }
    totalLoss += wallLossOblique(w, rayDir, fOver24)
    hits += 1
  }
  return { totalLoss, hits }
}

// 57-19: can a wave bend around this corner from the AP side to the rx side?
// The solid segments meeting at the corner split the directions around it
// into sectors; the bend needs one of the two arcs between dir(AP) and
// dir(rx) to be free of them. A free wall end always passes; an L corner
// passes only on its outside, never through the inside of the L; a T or a
// straight wall's mid-joint never passes. Mirrors cornerOpen() in the shader.
const TWO_PI = 2 * Math.PI
function ccwAngle(from, to) {
  const d = (to - from) % TWO_PI
  return d < 0 ? d + TWO_PI : d
}
function cornerOpen(c, apPos, rx) {
  if (!c.dirs) return false
  if (c.dirs.length === 0) return true
  const aAp = Math.atan2(apPos.y - c.y, apPos.x - c.x)
  const aRx = Math.atan2(rx.y - c.y, rx.x - c.x)
  const span = ccwAngle(aAp, aRx)
  let blockedA = false, blockedB = false
  for (const d of c.dirs) {
    const o = ccwAngle(aAp, d)
    if (o > 0 && o < span) blockedA = true
    else if (o > span) blockedB = true
  }
  return !blockedA || !blockedB
}

function knifeEdgeLossDb(v) {
  // ITU-R P.526 gives the diffraction *gain* Gd(v) (a non-positive dB value:
  // the field is attenuated relative to free space). Callers add this as a
  // positive path-loss term, so return the loss magnitude = -Gd(v).
  if (v <= -1) return 0
  if (v <= 0)  return -(20 * Math.log10(0.5 - 0.62 * v))
  if (v <= 1)  return -(20 * Math.log10(0.5 * Math.exp(-0.95 * v)))
  if (v <= 2.4) return -(20 * Math.log10(0.4 - Math.sqrt(0.1184 - Math.pow(0.38 - 0.1 * v, 2))))
  return -(20 * Math.log10(0.225 / v))
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
// a_perp = a_para = (1/sqrt(2)) * sqrt(P_rx). Real-valued scalar. The
// 1/sqrt(2) encodes equal-power excitation of two orthogonal polarization
// basis channels.
function makeScalarPath(txPowerDbm, apGainDbi, totalLossDb) {
  const rxPowerDb = txPowerDbm + apGainDbi + RX_ANT_GAIN_DBI - totalLossDb
  const amp = Math.sqrt(dbToLin(rxPowerDb)) / Math.SQRT2
  const a = { re: amp, im: 0 }
  return { perp: a, para: a }
}

// Build a reflected path: same 1/sqrt(2) excitation, but each polarization
// picks up its own complex Fresnel coefficient plus the shared roughness
// attenuation factor.
function makeReflectedPath(txPowerDbm, apGainDbi, pathLossDb, gammaPerp, gammaPara, roughness) {
  const rxPowerDb = txPowerDbm + apGainDbi + RX_ANT_GAIN_DBI - pathLossDb
  const amp = Math.sqrt(dbToLin(rxPowerDb)) / Math.SQRT2
  const base = { re: amp * roughness, im: 0 }
  return {
    perp: cmul(base, gammaPerp),
    para: cmul(base, gammaPara),
  }
}

// Per-ray AP antenna gain (dBi) at the departure direction from the AP.
// Peak = the AP's per-model per-band gain (47-10, scenario `antGainDbi` from
// buildScenario / getAPAntennaGain), falling back to AP_ANT_GAIN_DBI when the
// model doesn't list the band. Kept in sync with the shader, which reads the
// same value via `_antGainDbi` (sampleFieldGL packing).
// - omni:        flat peak (no vertical pattern — dipole ring was
//                explicitly rejected so existing omni results stay unchanged)
// - directional: peak, sector taper applied to BOTH the
//                horizontal and the vertical offset (same beamwidth cone).
// - custom:      peak + Gh(horizontal offset) + Gv(vertical offset), each cut
//                sampled from its OWN array on the catalog pattern (`samples`
//                for H, `samplesV` for V — the V cut is the 3GPP TR 38.901
//                element pattern). Matches the 3D lobe / preview surface
//                r = Gh(az) + Gv(el). Before the 2-cut split both planes read
//                the same array, which forced every pattern to be rotationally
//                symmetric.
// Azimuth/angles are taken in the canvas frame (+x = 0°, +y = 90°) to match
// APLayer's rendering convention. The pattern samples array is indexed in the
// same +x-origin, clockwise direction, so no frame conversion is required.
// Vertical offset (Phase 40) = ray elevation (atan2 of Z difference over
// horizontal distance, positive = up) − tiltDeg (boresight elevation,
// positive = up, default 0). targetZM is the target's absolute Z in metres.
// sectorTaperDb + its constants live in @/constants/antennaPatterns (imported
// above) — the directional-mode source of truth, shared with APPanel's preview.
function apGainDbi(ap, targetPoint, targetZM = 0) {
  const peak = ap.antGainDbi ?? AP_ANT_GAIN_DBI
  const mode = ap.antennaMode ?? 'omni'
  if (mode === 'omni') return peak

  const dx = targetPoint.x - ap.pos.x
  const dy = targetPoint.y - ap.pos.y
  const dz = targetZM - (ap.zM ?? 0)
  const az = ap.azimuthDeg ?? 0
  const tilt = ap.tiltDeg ?? 0
  let absOff, vertOff
  if (tilt === 0) {
    // Untilted: the horizontal / vertical split below IS the antenna frame
    // (kept verbatim so untilted APs are bit-identical to before 57-20).
    if (dx === 0 && dy === 0) return peak
    const rayDeg = Math.atan2(dy, dx) * 180 / Math.PI
    let off = rayDeg - az
    off = ((off + 540) % 360) - 180   // wrap to [-180, 180]
    absOff = Math.abs(off)
    const dxy = Math.sqrt(dx * dx + dy * dy)
    const elevDeg = Math.atan2(dz, dxy) * 180 / Math.PI
    vertOff = Math.abs(elevDeg)
  } else {
    // 57-20: rotate the ray into the antenna's own frame -- undo azimuth
    // (canvas frame: x right, y down, so azimuth is clockwise), then undo
    // tilt (+up) -- and only then split into H / V offsets. Subtracting tilt
    // from the elevation (the pre-57-20 rule) left the H cut in the world
    // horizontal plane, so a ceiling patch at -90 put its back lobe on half
    // the floor. Mirrored in both shaders' gain functions.
    const A = az * Math.PI / 180, T = tilt * Math.PI / 180
    const x1 = dx * Math.cos(A) + dy * Math.sin(A)
    const y1 = -dx * Math.sin(A) + dy * Math.cos(A)
    const x2 = x1 * Math.cos(T) + dz * Math.sin(T)
    const z2 = -x1 * Math.sin(T) + dz * Math.cos(T)
    if (x2 === 0 && y1 === 0 && z2 === 0) return peak
    absOff = Math.abs(Math.atan2(y1, x2)) * 180 / Math.PI
    vertOff = Math.abs(Math.atan2(z2, Math.sqrt(x2 * x2 + y1 * y1))) * 180 / Math.PI
  }

  if (mode === 'custom') {
    const pattern = getPatternById(ap.patternId)
    // 57-21: clamp the H + V sum at the pattern's front-to-back ratio.
    const relDb = Math.max(
      sampleGain(pattern, absOff * Math.PI / 180) + sampleGainV(pattern, vertOff * Math.PI / 180),
      patternBackFloorDb(pattern),
    )
    return peak + relDb
  }

  // directional (built-in sector approximation, same cone both planes)
  const half = (ap.beamwidthDeg ?? 60) / 2
  // 57-21: both planes bottom at -DIRECTIONAL_BACK_DB; so does their sum.
  return peak + Math.max(sectorTaperDb(absOff, half) + sectorTaperDb(vertOff, half), -DIRECTIONAL_BACK_DB)
}

// Point-in-polygon for a flat [x, y, x, y, ...] polygon (ray-casting).
function pointInPolyFlat(x, y, pts) {
  const n = pts.length / 2
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2],     yi = pts[i * 2 + 1]
    const xj = pts[j * 2],     yj = pts[j * 2 + 1]
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

// Sum the attenuation dB for every floor slab a ray crosses, honouring
// FloorHole bypasses and oblique-incidence magnification. The ray runs from
// (ap.pos.x, ap.pos.y, apZM) to (rx.x, rx.y, rxZM) where pos.x/pos.y are the
// horizontal XY coordinates (meters) and Z is vertical. For each boundary
// we solve for the t at which the ray's vertical coordinate equals
// boundary.yM, look up (X(t), Y(t)), and skip the slab's dB when that
// intersection falls inside any bypassHoles polygon.
// Oblique incidence (HM-F3c): slab normal is vertical, so
//   cos θ_incidence = |Δz| / 3D_distance
// and the per-crossing loss is multiplied by sec(θ) clamped ≤ 3.5, matching
// wallLossOblique. Near-horizontal rays therefore gain a lot of slab loss,
// preventing unphysical "sneaking through the ceiling edge-on".
// 57-18: slabs are treated as concrete for the refraction / Fresnel terms
// (ITU-R P.2040 concrete eta' = 5.24) -- see obliqueTerms.
const SLAB_EPS_R = 5.24
function accumulateSlabLoss(apPos, apZM, rxPos, rxZM, boundaries) {
  if (!boundaries || boundaries.length === 0) return 0
  const zLo = Math.min(apZM, rxZM)
  const zHi = Math.max(apZM, rxZM)
  const dz = rxZM - apZM
  const dx = rxPos.x - apPos.x
  const dy = rxPos.y - apPos.y
  const d3 = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const cosI = d3 > 1e-9 ? Math.abs(dz) / d3 : 1
  const { secT, extraDb } = obliqueTerms(cosI, SLAB_EPS_R)
  let loss = 0
  for (const b of boundaries) {
    if (!(b.yM > zLo && b.yM < zHi)) continue
    // Parametric t along the ray where vertical crosses b.yM.
    const t = Math.abs(dz) > 1e-9 ? (b.yM - apZM) / dz : 0
    const xAt = apPos.x + dx * t
    const yAt = apPos.y + dy * t
    let bypassed = false
    for (const poly of (b.bypassHoles ?? [])) {
      if (pointInPolyFlat(xAt, yAt, poly)) { bypassed = true; break }
    }
    if (!bypassed) loss += b.slabDb * secT + extraDb
  }
  return loss
}

// Count how many slab boundaries a ray crosses vertically (ignoring holes).
// Used as the same-floor test (0 = same floor). Hole bypass doesn't change
// "same floor"-ness — reflection/diffraction stay disabled across slabs even
// when a hole zeros out their attenuation.
function countSlabCrossings(z1, z2, boundaries) {
  if (!boundaries || boundaries.length === 0) return 0
  const zLo = Math.min(z1, z2)
  const zHi = Math.max(z1, z2)
  let n = 0
  for (const b of boundaries) {
    if (b.yM > zLo && b.yM < zHi) n += 1
  }
  return n
}

// Received power at rx from one AP. ap must carry centerMHz (see buildScenario).
// When `opts.floorBoundaries` + rx.zM / ap.zM are present, we add the total
// slab attenuation on the direct AP→rx ray (HM-F3a). Reflected / diffracted
// paths still use the horizontal walls only — cross-floor reflections are
// treated as negligible for the first iteration.
export function rssiFromAp(ap, rx, walls, corners, opts = {}) {
  const maxReflOrder = opts.maxReflOrder ?? 1
  const enableDiffraction = opts.enableDiffraction ?? true
  const boundaries = opts.floorBoundaries ?? null

  const freqMhz = ap.centerMHz || 5190
  const wavelength = C / (freqMhz * 1e6)
  const kWave = (2 * Math.PI) / wavelength
  // HM-F8: per-AP wall-loss frequency scale (1 at 2.4 GHz, ~1.6 at 5 GHz with
  // concrete's b=0.6). Threaded through every accumulateWallLoss call.
  const fOver24 = (freqMhz / 1000) / 2.4

  // Absolute Z of AP / rx; 0 when caller didn't provide elevation data.
  const apZM = ap.zM ?? 0
  const rxZM = rx.zM ?? 0
  const slabLossDirect = accumulateSlabLoss(ap.pos, apZM, rx, rxZM, boundaries)
  // Geometry-only same-floor test: "no slab between AP and rx". Distinct
  // from slabLossDirect === 0, which would also be true when all slabs
  // happen to have 0 dB attenuation.
  const slabCount = countSlabCrossings(apZM, rxZM, boundaries)

  const paths = []

  // Direct — use 3D distance so cross-floor Friis is correct. Horizontal
  // wall losses still use the 2D ray (walls have no cross-floor geometry
  // in this iteration), while slab losses come from slabLossDirect.
  const dxyDir = Math.max(dist(ap.pos, rx), 0.25)
  const dzDir  = apZM - rxZM
  const dDir   = Math.sqrt(dxyDir * dxyDir + dzDir * dzDir)
  const wallScan = accumulateWallLoss(ap.pos, rx, walls, apZM, rxZM, fOver24)
  const plDir = pathLossDb(dDir, freqMhz) + wallScan.totalLoss + slabLossDirect
  paths.push(makeScalarPath(ap.txDbm, apGainDbi(ap, rx, rxZM), plDir))

  // 1st-order image-source reflections with per-polarization Fresnel.
  // Cross-floor APs skip reflections — walls are 2D in this iteration and
  // mirror geometry across a horizontal wall doesn't correspond to anything
  // physical when AP and rx are on different floors. "Same floor" means the
  // AP↔rx ray crosses zero slab boundaries.
  const sameFloorRay = slabCount === 0
  if (maxReflOrder >= 1 && sameFloorRay) {
    // 57-13: a wall reflects only within its own height band. The reflection
    // point's Z lies between apZM and rxZM, so a wall whose band misses that
    // span can't reflect at all (cheap early-out — other floors' walls ride
    // in `walls` for cross-floor penetration); the exact check on reflZM
    // follows below. Mirrored in propagationGL.js.
    const zSpanLo = Math.min(apZM, rxZM), zSpanHi = Math.max(apZM, rxZM)
    for (const w of walls) {
      const hasZ = w.zLoM != null && w.zHiM != null
      if (hasZ && (w.zHiM < zSpanLo || w.zLoM > zSpanHi)) continue
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

      // Image-source ray apImage→rx maps to the reflected ray ap→reflPt→rx
      // with matching path length. Reflection point's Z lies on that
      // straight line, so interpolate by its fraction of total path length.
      const d1 = dist(ap.pos, reflPt)
      const d2 = dist(reflPt, rx)
      const reflZM = apZM + (rxZM - apZM) * (d1 / Math.max(d1 + d2, 1e-9))
      if (hasZ && (reflZM < w.zLoM || reflZM > w.zHiM)) continue
      const leg1 = accumulateWallLoss(ap.pos, reflPt, walls, apZM, reflZM, fOver24, w)
      const leg2 = accumulateWallLoss(reflPt, rx, walls, reflZM, rxZM, fOver24, w)
      const dTot = d1 + d2

      const plRef = pathLossDb(dTot, freqMhz) + leg1.totalLoss + leg2.totalLoss
      paths.push(makeReflectedPath(ap.txDbm, apGainDbi(ap, reflPt, reflZM), plRef, gPerp, gPara, rough))
    }
  }

  // Knife-edge diffraction around corners (only when direct is blocked).
  // Treated as polarization-neutral (scalar approximation). Disabled for
  // cross-floor rays for the same reason reflections are.
  if (enableDiffraction && wallScan.hits > 0 && sameFloorRay) {
    for (const c of corners) {
      const d1 = dist(ap.pos, c)
      const d2 = dist(c, rx)
      const cZM = apZM + (rxZM - apZM) * (d1 / Math.max(d1 + d2, 1e-9))
      // 57-40: only where the corner's walls exist (other floors' corners
      // never diffract here). 57-19: there must be an open side to bend
      // around, and the corner's own walls don't obstruct its legs.
      if (c.zLoM != null && (cZM < c.zLoM || cZM > c.zHiM)) continue
      if (c.dirs !== undefined && !cornerOpen(c, ap.pos, rx)) continue
      const s1 = accumulateWallLoss(ap.pos, c, walls, apZM, cZM, fOver24, null, c)
      const s2 = accumulateWallLoss(c, rx, walls, cZM, rxZM, fOver24, null, c)
      if (s1.hits > 1 || s2.hits > 1) continue
      const diff = cornerDiffractionDb(ap.pos, rx, c, wavelength)
      if (!isFinite(diff) || diff > 40) continue
      const dTot = d1 + d2
      const plDiff = pathLossDb(dTot, freqMhz) + s1.totalLoss + s2.totalLoss + diff
      paths.push(makeScalarPath(ap.txDbm, apGainDbi(ap, c, cZM), plDiff))
    }
  }

  // 57-22: power sum (local mean) over paths and both polarization channels:
  //   P = Σ_n ( |a_n,perp|^2 + |a_n,para|^2 )
  // The paths used to be summed coherently (phase -2π·f·τ_n, averaged over N
  // samples across the channel), but the interference pattern repeats every
  // ~λ/2 (3 cm at 5 GHz) and the 0.5 m grid only aliased it into fake fading
  // spots; planning tools show the local mean. The 1/sqrt(2) excitation
  // factor in each path's gain makes the two-channel sum total RX power.
  let powerSum = 0
  for (const p of paths) {
    powerSum += p.perp.re * p.perp.re + p.perp.im * p.perp.im
      + p.para.re * p.para.re + p.para.im * p.para.im
  }
  const rssiDbm = linToDb(powerSum)
  return { rssiDbm, pathsUsed: paths.length }
}

// Debug-only re-export of the complex/Fresnel kernels — used by the diff
// page's "step 1 fresnel parity" check during HM-F5c+d porting. These match
// the GLSL versions in fresnelGLDebug.js bit-for-bit (within fp32 limits).
// Not part of the production API.
export const __debug = {
  materialEpsC,
  fresnelGamma,
}

// SINR-aware aggregation: strongest AP is the signal; other APs contribute to
// interference only if they share spectrum with the signal AP.
// Returns { rssiDbm, sinrDb, snrDb, cciDbm, bestApIndex }.
//   - rssiDbm: strongest AP's received power
//   - sinrDb:  S / (N + ΣI_co-channel)
//   - snrDb:   S / N, ignores interferers (no-interference upper bound)
//   - cciDbm:  10·log10(ΣI_co-channel linear), or -Infinity if none
export function aggregateApContributions(perApDbm, apList, noiseDbm = NOISE_FLOOR_DBM) {
  if (!perApDbm.length) {
    return { rssiDbm: -120, sinrDb: -50, snrDb: -50, cciDbm: -Infinity, bestApIndex: -1 }
  }

  // Best (strongest) AP = "serving" AP.
  let bestIdx = 0
  for (let i = 1; i < perApDbm.length; i++) {
    if (perApDbm[i] > perApDbm[bestIdx]) bestIdx = i
  }
  const signalDb = perApDbm[bestIdx]
  const signalAp = apList[bestIdx]

  let cciLin = 0
  for (let i = 0; i < perApDbm.length; i++) {
    if (i === bestIdx) continue
    if (!apsShareSpectrum(signalAp, apList[i])) continue
    cciLin += dbToLin(perApDbm[i])
  }
  // Widen the noise floor for the serving AP's channel bandwidth — a 160 MHz
  // receiver admits ~9 dB more thermal noise than 20 MHz. Kept in sync with the
  // clientView SNR path and the GLSL aggregate shader.
  const effNoiseDbm = noiseDbm + widthNoiseDelta(signalAp.channelWidth ?? 20)
  const noiseLin = dbToLin(effNoiseDbm)
  const sinrDb = signalDb - linToDb(noiseLin + cciLin)
  const snrDb  = signalDb - effNoiseDbm
  const cciDbm = cciLin > 0 ? linToDb(cciLin) : -Infinity
  return { rssiDbm: signalDb, sinrDb, snrDb, cciDbm, bestApIndex: bestIdx }
}

// 57-7 / 57-9: table-driven aggregateApContributions for hot loops that fold
// many cells against one fixed AP list. apsShareSpectrum allocates two arrays
// per call and the noise widening calls Math.log10 — per AP pair, per cell.
// makeApAggregator hoists both out of the cell loop; aggregateWithTables then
// runs the exact same operations in the same order, so results are
// bit-identical to aggregateApContributions. `out` is reused (no per-cell
// allocation). Tables depend only on band / channel / width, not on txDbm.
export function makeApAggregator(apList, noiseDbm = NOISE_FLOOR_DBM) {
  const n = apList.length
  const share = new Uint8Array(n * n)
  const effNoiseDbm = new Float64Array(n)
  const noiseLin = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && apsShareSpectrum(apList[i], apList[j])) share[i * n + j] = 1
    }
    effNoiseDbm[i] = noiseDbm + widthNoiseDelta(apList[i].channelWidth ?? 20)
    noiseLin[i] = dbToLin(effNoiseDbm[i])
  }
  return { n, share, effNoiseDbm, noiseLin }
}

export function aggregateWithTables(tables, perApDbm, out) {
  const { n, share, effNoiseDbm, noiseLin } = tables
  if (!n) {
    out.rssiDbm = -120; out.sinrDb = -50; out.snrDb = -50; out.cciDbm = -Infinity; out.bestApIndex = -1
    return out
  }
  let bestIdx = 0
  for (let i = 1; i < n; i++) {
    if (perApDbm[i] > perApDbm[bestIdx]) bestIdx = i
  }
  const signalDb = perApDbm[bestIdx]
  const row = bestIdx * n
  let cciLin = 0
  for (let i = 0; i < n; i++) {
    if (i === bestIdx) continue
    if (!share[row + i]) continue
    cciLin += dbToLin(perApDbm[i])
  }
  out.rssiDbm = signalDb
  out.sinrDb = signalDb - linToDb(noiseLin[bestIdx] + cciLin)
  out.snrDb = signalDb - effNoiseDbm[bestIdx]
  out.cciDbm = cciLin > 0 ? linToDb(cciLin) : -Infinity
  out.bestApIndex = bestIdx
  return out
}

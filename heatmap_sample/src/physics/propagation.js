// Physics-based RF propagation for indoor 5 GHz.
// Models combined:
//   - Direct path with ITU-R P.1238 style log-distance path loss
//   - Wall penetration loss (per-wall dB, plus oblique-incidence factor)
//   - Specular reflection via image-source method (1st order off every wall)
//   - UTD-style knife-edge diffraction around wall endpoints (corners)
//   - Coherent/incoherent multipath combining
//   - Co-channel interference aggregation across APs sharing a channel
//
// All distances are meters. Coordinates are in meters (floorplan uses mm scale internally
// but is converted before being handed to this module).

import {
  FREQ_MHZ, WAVELENGTH, K_WAVENUM,
  AP_ANT_GAIN_DBI, RX_ANT_GAIN_DBI, ITU_N_OFFICE_5G
} from './constants.js';
import {
  sub, dot, len, dist, norm, segSegIntersect,
  pointSegDistance, mirrorPoint, segmentNormal
} from './geometry.js';

const dbToLin = (db) => Math.pow(10, db / 10);
const linToDb = (lin) => 10 * Math.log10(Math.max(lin, 1e-30));

// --- Free-space + indoor path loss (dB) from Tx to Rx over distance d (m) ---
// ITU-R P.1238 simplified: PL = 20*log10(f_MHz) + N*log10(d) - 28
// Blend with Friis at very short range to avoid singularities.
function pathLossDb(d) {
  const dEff = Math.max(d, 0.5);
  const friis = 20 * Math.log10(dEff) + 20 * Math.log10(FREQ_MHZ) - 27.55;
  const itu   = 20 * Math.log10(FREQ_MHZ) + ITU_N_OFFICE_5G * Math.log10(dEff) - 28;
  // Use the larger (more pessimistic) between FSPL and ITU indoor for realism.
  return Math.max(friis, itu);
}

// --- Wall penetration with oblique-incidence factor ---
// Effective loss increases as 1/cos(θi) (secant law) up to a cap.
function wallLossOblique(wall, rayDir) {
  const n = segmentNormal(wall.a, wall.b);
  const cosI = Math.abs(dot(norm(rayDir), n));
  const sec = 1 / Math.max(cosI, 0.2);   // cap at ~79° to avoid blow-up
  return wall.lossDb * Math.min(sec, 3.5);
}

// --- Intersect a segment with all walls; return loss sum + intersection count ---
function accumulateWallLoss(a, b, walls) {
  const rayDir = sub(b, a);
  let totalLoss = 0;
  let hits = 0;
  for (const w of walls) {
    const hit = segSegIntersect(a, b, w.a, w.b);
    if (hit) {
      totalLoss += wallLossOblique(w, rayDir);
      hits += 1;
    }
  }
  return { totalLoss, hits };
}

// --- UTD knife-edge diffraction around a corner point Pc ---
// Classic single-edge diffraction loss (dB). v = Fresnel-Kirchhoff parameter.
// We approximate with Lee's formula.
function knifeEdgeLossDb(v) {
  if (v <= -1) return 0;
  if (v <= 0)  return 20 * Math.log10(0.5 - 0.62 * v);
  if (v <= 1)  return 20 * Math.log10(0.5 * Math.exp(-0.95 * v));
  if (v <= 2.4) return 20 * Math.log10(0.4 - Math.sqrt(0.1184 - Math.pow(0.38 - 0.1 * v, 2)));
  return 20 * Math.log10(0.225 / v);
}

// For a corner at C blocking LOS between Tx and Rx, compute excess path length and v.
// We let the corner be a knife edge perpendicular to the Tx→Rx axis.
function cornerDiffractionDb(tx, rx, corner) {
  const d1 = dist(tx, corner);
  const d2 = dist(corner, rx);
  const d  = dist(tx, rx);
  // Perpendicular deviation h of corner from direct line:
  const seg = pointSegDistance(corner, tx, rx);
  const h = seg.d;
  // Only apply if corner projects inside the segment (i.e. it's "in the way").
  if (seg.t <= 0 || seg.t >= 1) return Infinity;
  const v = h * Math.sqrt((2 / WAVELENGTH) * ((d1 + d2) / (d1 * d2)));
  return Math.abs(knifeEdgeLossDb(-v)); // negative v => shadow region
}

// --- Build phasor contribution for one propagation path ---
// Returns complex {re, im} voltage at receiver (post antenna, post loss, with phase).
function pathPhasor(txPowerDbm, totalLossDb, distanceM, extraPhaseRad = 0) {
  const rxPowerDb = txPowerDbm + AP_ANT_GAIN_DBI + RX_ANT_GAIN_DBI - totalLossDb;
  const amp = Math.sqrt(dbToLin(rxPowerDb));   // voltage ~ sqrt(power)
  const phase = K_WAVENUM * distanceM + extraPhaseRad;
  return { re: amp * Math.cos(phase), im: amp * Math.sin(phase) };
}

// --- Main: compute received power at point P from one AP, summing multipath ---
// Returns { rssiDbm, pathsUsed }.
export function rssiFromAp(ap, rx, walls, corners, opts = {}) {
  const maxReflOrder = opts.maxReflOrder ?? 1;   // 1st order reflections
  const enableDiffraction = opts.enableDiffraction ?? true;

  // Coherent sum across paths.
  let Re = 0, Im = 0;
  let pathsUsed = 0;

  // ---------- 1) Direct path ----------
  const dDir = Math.max(dist(ap.pos, rx), 0.25);
  const wallScan = accumulateWallLoss(ap.pos, rx, walls);
  const plDir = pathLossDb(dDir) + wallScan.totalLoss;
  const phDir = pathPhasor(ap.txDbm, plDir, dDir);
  Re += phDir.re; Im += phDir.im; pathsUsed++;

  // ---------- 2) Specular reflections (image-source, 1st order) ----------
  if (maxReflOrder >= 1) {
    for (const w of walls) {
      // Image of AP across wall plane
      const apImage = mirrorPoint(ap.pos, w.a, w.b);
      // Check reflection point actually lies on the wall segment
      const hit = segSegIntersect(apImage, rx, w.a, w.b);
      if (!hit) continue;
      const reflPt = hit.point;

      // Geometry: incidence angle relative to wall normal
      const inDir = norm(sub(reflPt, ap.pos));
      const n = segmentNormal(w.a, w.b);
      const cosI = Math.abs(dot(inDir, n));
      if (cosI < 0.05) continue; // grazing → skip

      // Fresnel |Γ| scaled by incidence; also add roughness (Rayleigh) factor
      const gammaMag = w.reflectionMag * (0.5 + 0.5 * cosI);
      const rough = Math.exp(-2 * Math.pow(K_WAVENUM * w.roughnessM * cosI, 2));
      const rFactor = gammaMag * rough;
      if (rFactor < 0.02) continue;

      // Path: AP → reflPt → rx. Check wall losses along each leg (excluding the reflecting wall itself).
      const wallsExcl = walls.filter(x => x !== w);
      const leg1 = accumulateWallLoss(ap.pos, reflPt, wallsExcl);
      const leg2 = accumulateWallLoss(reflPt, rx, wallsExcl);
      const dTot = dist(ap.pos, reflPt) + dist(reflPt, rx);

      const reflLossDb = -20 * Math.log10(Math.max(rFactor, 1e-3));
      const plRef = pathLossDb(dTot) + leg1.totalLoss + leg2.totalLoss + reflLossDb;

      // Reflection adds π phase for hard boundary (approx).
      const ph = pathPhasor(ap.txDbm, plRef, dTot, Math.PI);
      Re += ph.re; Im += ph.im; pathsUsed++;
    }
  }

  // ---------- 3) Diffraction around corners (NLOS assist) ----------
  if (enableDiffraction && wallScan.hits > 0) {
    // Only spend effort on diffraction when direct path is blocked.
    for (const c of corners) {
      // Segment AP→corner and corner→rx should each be "mostly clear"
      // (allow at most 1 wall grazing, typical for corner diffraction).
      const s1 = accumulateWallLoss(ap.pos, c, walls);
      const s2 = accumulateWallLoss(c, rx, walls);
      if (s1.hits > 1 || s2.hits > 1) continue;

      const diff = cornerDiffractionDb(ap.pos, rx, c);
      if (!isFinite(diff) || diff > 40) continue;

      const d1 = dist(ap.pos, c);
      const d2 = dist(c, rx);
      const dTot = d1 + d2;
      const plDiff = pathLossDb(dTot) + s1.totalLoss + s2.totalLoss + diff;
      const ph = pathPhasor(ap.txDbm, plDiff, dTot);
      Re += ph.re; Im += ph.im; pathsUsed++;
    }
  }

  // Coherent sum → power
  const powerLin = Re * Re + Im * Im;
  const rssiDbm = linToDb(powerLin);
  return { rssiDbm, pathsUsed };
}

// --- Aggregate multiple co-channel APs ---
// For *signal* display we take the strongest AP's RSSI (that's what a client associates to).
// For SINR we add other APs as interference (linear power sum).
export function aggregateApContributions(perApDbm, noiseDbm = -95) {
  if (!perApDbm.length) return { rssiDbm: -120, sinrDb: -50 };
  const sorted = [...perApDbm].sort((a, b) => b - a);
  const signalDb = sorted[0];
  let interfLin = dbToLin(noiseDbm);
  for (let i = 1; i < sorted.length; i++) interfLin += dbToLin(sorted[i]);
  const sinrDb = signalDb - linToDb(interfLin);
  return { rssiDbm: signalDb, sinrDb };
}

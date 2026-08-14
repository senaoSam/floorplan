// WebGL2 fragment-shader implementation of `rssiFromAp` — HM-F5a..F5g.
//
// Two render entry points:
//   renderAp(ap, ...)       — per-AP RSSI grid (R32F). Reflection / diffraction
//                             path stays here because each fragment already
//                             carries an NMAX coherent-sum array; multiplying
//                             that by N_AP would explode register pressure.
//   renderField(scenario...) — HM-F5g. all-AP loop in shader, RGBA32F output =
//                             (rssi, sinr, snr, cci). Scalar path only (Friis
//                             + walls + slab + openings + antenna gain).
//                             Distance culling skips APs whose maximum
//                             possible RSSI at this fragment is below the
//                             usable floor, so 1000+ AP scenes don't pay an
//                             N_AP * frame_size overhead.
//
// The aggregated path is enabled for the F5a fast path (refl=off, diff=off,
// no custom-pattern APs). When any of those triggers, sampleFieldGL falls
// back to the per-AP renderAp loop so accuracy is preserved.
//
// Scope of the scalar path (mirrors HM-F5a/b/g):
//   - Friis path loss (3D distance) with per-AP centre frequency
//   - Per-wall penetration: oblique-incidence multiplier same as JS engine,
//     Z filter (skip wall hits whose Z falls outside [zLoM, zHiM])
//   - Slab attenuation across floor boundaries with FloorHole bypass and
//     sec(θ) oblique magnification capped at 3.5
//   - Wall openings already pre-expanded into segment list by buildScenario,
//     so shader sees them as just shorter wall segments with their own dbLoss
//   - AP antenna gain: omni and directional (patch/sector approximation).
//     Custom-pattern APs trigger host fallback (renderAp + JS aggregate).

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

// Wall record layout in `uWalls` (RGBA32F texture, 4 texels per wall):
//   texel 0 .rgba = (ax, ay, bx, by)            — endpoints in metres
//   texel 1 .rgba = (lossDb, zLo, zHi, roughnessM)
//                   lossDb is the 2.4 GHz anchor (HM-F8); per-AP per-crossing
//                   dB = lossDb * (fGhz/2.4) ** lossB.
//   texel 2 .rgba = (ituA, ituB, ituC, ituD) — ITU-R P.2040-3 coefficients;
//                   ituA < 0 sentinel = metal (Gamma → -1).
//   texel 3 .rgba = (lossB, _, _, _)            — ITU-R P.2040-3 frequency
//                   exponent for wall attenuation (HM-F8). lossB == 0 means
//                   the material is wideband-flat (e.g. metal) — shader
//                   short-circuits the pow().
//
// Slab boundary layout in `uSlabs` (RGBA32F, 1 texel per boundary):
//   .rgba = (yM, slabDb, holeStart, holeCount)
//   holeStart/holeCount index into uHolePoly (RGBA32F, points stored as
//   (x, y, _, _) with -1 sentinel between polygons).
//
// Hole polygon layout in `uHolePoly` (RGBA32F):
//   each polygon's points stored consecutively as (x, y, 0, 0) texels,
//   with a single (NaN, NaN, NaN, NaN) sentinel texel separating polygons
//   so the shader can iterate vertices for a given (start, count) range.

const FS = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uGridSize;        // (nx, ny)
uniform vec2 uOriginM;         // grid origin (m), usually (0,0)
uniform float uGridStepM;      // metres per grid cell

uniform vec3  uApPos;          // (x, y, zM) in metres
uniform float uTxDbm;
uniform float uCenterMHz;
uniform float uChannelWidthMHz;
uniform float uFOver24;        // HM-F8: (centerMHz/1000) / 2.4, host-precomputed
uniform float uAntGainDbi;     // base AP antenna gain (constant per AP)
uniform int   uAntMode;        // 0 = omni, 1 = directional, 2 = treat as omni (custom — host fallback handles real pattern)
uniform float uAntAzimuthDeg;
uniform float uAntBeamwidthDeg;
uniform float uAntTiltDeg;     // boresight elevation, degrees (+up, Phase 40)
uniform float uRxGainDbi;
uniform float uRxZM;

uniform sampler2D uWalls;      // RGBA32F, 2 texels per wall
uniform int uWallCount;
uniform sampler2D uSlabs;      // RGBA32F, 1 texel per boundary
uniform int uSlabCount;
uniform sampler2D uHolePoly;   // RGBA32F, hole polygon vertex pool
uniform int uHolePolyLen;

// Uniform-grid acceleration structure (HM-F5b).
//   uGridIdx (RGBA32F, nGx*nGy texels):
//     each texel = (start, count, 0, 0) — slice into uGridList for this cell
//   uGridList (R32F, flat list of wall indices, row-major up to 4096 width)
// uGridDims = (nGx, nGy), uGridCellM = metres per grid cell, uGridOriginM =
// world-space (x, y) of the (0,0) cell corner.
// When uGridDims.x == 0 the shader falls back to the brute-force loop —
// useful for small scenes where grid traversal overhead would beat the win.
uniform sampler2D uGridIdx;
uniform sampler2D uGridList;
uniform ivec2 uGridDims;
uniform float uGridCellM;
uniform vec2  uGridOriginM;
uniform int   uGridListWidth;

// HM-F5c step 2: image-source reflection on/off. When 0 the shader stays on
// the F5a scalar-dB path (RSSI = txDbm + gain - pathLoss). When 1 we switch
// to a coherent-sum path: direct + reflected complex amplitudes accumulated
// in (Hperp, Hpara), final power = |Hperp|^2 + |Hpara|^2.
// freqOverrideN matches the JS opts.freqOverrideN; step 2 always uses N=1.
uniform int uReflEnabled;
uniform int uFreqOverrideN;

// HM-F5c step 3: knife-edge diffraction around corners.
// uCorners packs one (x, y, 0, 0) texel per corner, similar to walls.
// uDiffEnabled gates the diffraction loop; runs only when refl path is active
// (the scalar-dB fast path keeps F5a/b semantics intact).
uniform int uDiffEnabled;
uniform sampler2D uCorners;
uniform int uCornerCount;

// HM-F5j: per-AP precomputed LOS field. Texture is R8 sized (uGridSize),
// 1 = direct AP→rx ray hits zero walls (LOS), 0 = blocked.
//   uLosEnabled = 0  → ignore (host didn't bake; legacy path)
//   uLosEnabled = 1  → strict mode A: LOS=1 short-circuits direct-path wall
//                       scan (wallLossDir=0, dirHits=0). Reflection loop
//                       still runs — refl contributions from other walls
//                       are physically present even when the direct ray
//                       sees no walls. Diffraction loop is naturally
//                       skipped (it gates on dirHits>0). Bit-equivalent
//                       to the no-LOS path mod fp32 round-off.
//   uLosFastMode = 1 → mode B: LOS=1 also skips reflections. Faster but
//                       drifts from JS reference; opt-in for drag-time use.
uniform sampler2D uLosTex;
uniform int uLosEnabled;
uniform int uLosFastMode;

// HM-F5l: per-fragment refl/diff cull threshold. If the AP's free-space-only
// RSSI at this fragment is already below uCullFloorDbm, the reflection and
// diffraction loops can be skipped entirely. Physics: refl path travels
// d1+d2 ≥ d (triangle inequality) with extra Fresnel attenuation (|Γ|≤1);
// diffraction adds knife-edge loss on top of an even longer path. So
// FS-only direct < cullFloor implies refl ≤ FS-only direct < cullFloor and
// diff < cullFloor. Skipping is bit-equivalent to the runtime path producing
// values < cullFloor that the host aggregator would clamp anyway. The direct
// Friis path itself still runs (cheap) so the per-AP RSSI grid stays
// consistent with no-cull behaviour.
//
// Threaded as the same uniform the aggregated FS_FIELD path already uses;
// renderAp binds it from opts.cullFloorDbm (defaults to -120 dBm).
uniform float uCullFloorDbm;

// HM-F5k: per-AP precomputed corner / wall geometry, baked once when AP or
// walls change and reused across every fragment.
//   uApCornersGeo (RGBA32F, 1×N_corners): per corner
//     .r = d1 (length AP→corner in metres)
//     .g = geomLos (1.0 = AP→corner crosses zero walls geometrically;
//                   0.0 = at least one wall geometrically crosses, must run
//                   the s1 wall scan in shader)
//     geomLos is conservative (no Z filter): when 1.0 the s1 DDA is a
//     guaranteed no-op for every fragment, so we skip it. When 0.0 we still
//     must run the scan because the Z filter (which depends on cZM, a
//     fragment-local quantity) may rescue some hits.
//   uApWallMirror (RGBA32F, 1×N_walls): per wall
//     .rg = apImg.xy = mirrorPoint(AP, wall.a, wall.b)
//     The reflection loop reads this instead of recomputing mirrorPoint per
//     fragment.
//   uApGeoEnabled = 0  → host did not bake (refl/diff path stays on
//                        per-fragment compute, identical to pre-F5k).
//                 = 1  → both textures populated for the current AP.
uniform sampler2D uApCornersGeo;
uniform sampler2D uApWallMirror;
uniform int uApGeoEnabled;

const float PI = 3.14159265358979;
const float SLAB_SEC_CAP = 3.5;
const float DIRECTIONAL_BACK_DB = 20.0;
const float DIRECTIONAL_EDGE_DEG = 15.0;
const float EPS0 = 8.854187817e-12;

// Complex arithmetic (vec2 = (re, im)). Mirror src/features/heatmap/propagation.js.
vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}
vec2 cdiv(vec2 a, vec2 b) {
  float den = b.x * b.x + b.y * b.y;
  return vec2((a.x * b.x + a.y * b.y) / den,
              (a.y * b.x - a.x * b.y) / den);
}
// Principal sqrt — same branch (non-negative re) as JS csqrt.
vec2 csqrt(vec2 z) {
  float r = sqrt(z.x * z.x + z.y * z.y);
  float re = sqrt(max((r + z.x) * 0.5, 0.0));
  float imMag = sqrt(max((r - z.x) * 0.5, 0.0));
  return vec2(re, z.y >= 0.0 ? imMag : -imMag);
}

// ITU-R P.2040-3 complex relative permittivity for a material.
//   itu = (a, b, c, d): eta' = a*f_GHz^b, sigma = c*f_GHz^d
//   eps_c = eta' - j * sigma / (2*pi*f*eps_0)
// Metal is encoded as ituA < 0 sentinel — caller treats that as Gamma = -1
// without invoking this function.
vec2 materialEpsC(vec4 itu, float freqMhz) {
  float fGhz = freqMhz * 0.001;
  float etaPrime = itu.x * pow(fGhz, itu.y);
  float sigma    = itu.z * pow(fGhz, itu.w);
  return vec2(etaPrime, -sigma / (2.0 * PI * freqMhz * 1e6 * EPS0));
}

// Fresnel reflection coefficients for TE / TM (perpendicular / parallel).
// Mirrors fresnelGamma in propagation.js. Returns perp in xy, para in zw.
//   isMetal: caller decides via itu sentinel — both pols collapse to (-1, 0).
//   root      = sqrt(eps_c - sin^2 theta)
//   Gamma_perp = (cosI - root) / (cosI + root)
//   Gamma_para = (eps_c*cosI - root) / (eps_c*cosI + root)
vec4 fresnelGamma(float cosI, vec2 epsC, bool isMetal) {
  if (isMetal) return vec4(-1.0, 0.0, -1.0, 0.0);
  float sinI2 = 1.0 - cosI * cosI;
  vec2 root = csqrt(vec2(epsC.x - sinI2, epsC.y));
  vec2 cI   = vec2(cosI, 0.0);
  vec2 perp = cdiv(vec2(cI.x - root.x, -root.y),
                   vec2(cI.x + root.x,  root.y));
  vec2 ecCos = cmul(epsC, cI);
  vec2 para = cdiv(vec2(ecCos.x - root.x, ecCos.y - root.y),
                   vec2(ecCos.x + root.x, ecCos.y + root.y));
  return vec4(perp, para);
}

// Indoor distance loss (dB/m) by band — mirrors JS indoorLossPerMeter().
float indoorLossPerM(float freqMhz) {
  if (freqMhz < 3000.0) return 0.15;
  if (freqMhz < 5925.0) return 0.25;
  return 0.35;
}

// Free-space (Friis) path loss + indoor distance-loss term (dB).
float pathLossDb(float d, float freqMhz) {
  float dEff = max(d, 0.5);
  return 20.0 * log(dEff)/log(10.0) + 20.0 * log(freqMhz)/log(10.0) - 27.55
    + indoorLossPerM(freqMhz) * dEff;
}

// Read a wall record (4 texels at base index w*4). HM-F8 added texel 3 for
// lossB (ITU-R frequency exponent) — read alongside lossDb so callers can
// thread both into wallLossOblique.
void readWall(int w, out vec2 a, out vec2 b, out float lossDb, out float lossB, out float zLo, out float zHi) {
  int t0 = w * 4;
  int t1 = t0 + 1;
  int t3 = t0 + 3;
  ivec2 p0 = ivec2(t0 % 4096, t0 / 4096);
  ivec2 p1 = ivec2(t1 % 4096, t1 / 4096);
  ivec2 p3 = ivec2(t3 % 4096, t3 / 4096);
  vec4 e0 = texelFetch(uWalls, p0, 0);
  vec4 e1 = texelFetch(uWalls, p1, 0);
  vec4 e3 = texelFetch(uWalls, p3, 0);
  a = e0.xy;  b = e0.zw;
  lossDb = e1.x;  zLo = e1.y;  zHi = e1.z;
  lossB  = e3.x;
}

// Read material (texel 2): ituA<0 sentinel = metal.
void readWallMaterial(int w, out vec4 itu, out float roughnessM, out bool isMetal) {
  int t1 = w * 4 + 1;
  int t2 = w * 4 + 2;
  ivec2 p1 = ivec2(t1 % 4096, t1 / 4096);
  ivec2 p2 = ivec2(t2 % 4096, t2 / 4096);
  roughnessM = texelFetch(uWalls, p1, 0).w;
  itu        = texelFetch(uWalls, p2, 0);
  isMetal    = itu.x < 0.0;
}

// 2D segment-segment intersection. Returns 1 in .x if hit, the parametric t
// (0..1 along ap→rx) in .y. Mirrors features/heatmap/geometry.js
// (segSegIntersect). Epsilon tightened to 1e-12 to match JS — looser values
// admit colinear ap→wall configurations as "hits", which then poisons the
// diffraction gate (dirHits > 0 launches the corner loop and inflates RSSI).
//
// HM-F5c-fix: t / u padding by SEG_HIT_EPS (1e-6). Two cases the strict
// [0, 1] test mishandles in fp32 but JS fp64 catches:
//   (a) rx sits exactly on a wall endpoint — fp32 t lands ≈1+ULP, naive
//       t > 1 rejects the wall. dense-aps's metal-box corners (which align
//       with grid sample points at gridStepM=0.5) need this pad.
//   (b) two walls share a vertex on the ray — fp32 u splits ±ULP between
//       them, so without padding one wall is admitted and the other isn't
//       depending on which side of the cliff fp32 fell.
// The pad on t is one-sided (1 + EPS upper bound only): admitting t > 0
// hits is correct for "ray going forward", while t < 0 padding would let
// walls behind the AP into the loss accumulation. Same caveat lifted from
// HM-F5c+d's failed earlier attempt — that one rejected at +EPS, the
// opposite direction; this one admits.
const float SEG_HIT_EPS = 1e-6;
vec2 segSegIntersect(vec2 p1, vec2 p2, vec2 p3, vec2 p4) {
  vec2 d1 = p2 - p1;
  vec2 d2 = p4 - p3;
  float denom = d1.x * d2.y - d1.y * d2.x;
  if (abs(denom) < 1e-12) return vec2(0.0, 0.0);
  vec2 r = p1 - p3;
  float t = (d2.x * r.y - d2.y * r.x) / denom;
  float u = (d1.x * r.y - d1.y * r.x) / denom;
  if (t < 0.0 || t > 1.0 + SEG_HIT_EPS) return vec2(0.0, 0.0);
  if (u < -SEG_HIT_EPS || u > 1.0 + SEG_HIT_EPS) return vec2(0.0, 0.0);
  return vec2(1.0, t);
}

// Wall normal (unit) and oblique-incidence loss (cap 3.5).
// rayDir-zero guard: when caller's two endpoints coincide (e.g. reflPt==rx
// in image-source reflection's degenerate cases) GLSL normalize((0,0)) is
// NaN and pollutes the coherent sum. JS's len(a) || 1 trick treats it as
// zero; we mirror that — a degenerate ray contributes no oblique magnification
// (cosI=0 → sec capped to 5.0 → lossDb * min(5.0, 3.5) = lossDb * 3.5),
// but the hit count at the call site is what really gates the path. The
// segSegIntersect 1e-12 epsilon already rejects most degenerate hits before
// we reach this function, so this guard is defence-in-depth.
// HM-F8: lossB is the per-material ITU-R frequency exponent. fOver24 is
// (centerMHz/1000)/2.4. Final per-crossing dB = lossDb * fOver24^lossB * sec.
// lossB == 0 short-circuits the pow() so wideband-flat materials (e.g. metal)
// stay numerically identical to pre-F8.
float wallLossOblique(vec2 a, vec2 b, vec2 rayDir, float lossDb, float lossB, float fOver24) {
  vec2 t = b - a;
  vec2 n = normalize(vec2(-t.y, t.x));
  float rL = length(rayDir);
  vec2 rDir = rL > 1e-12 ? rayDir / rL : vec2(0.0);
  float cosI = abs(dot(rDir, n));
  float sec = 1.0 / max(cosI, 0.2);
  float fAdj = lossB == 0.0 ? 1.0 : pow(fOver24, lossB);
  return lossDb * fAdj * min(sec, 3.5);
}

// Apply one wall hit: do segSegIntersect + Z filter, accumulate loss if hit.
// Splitting this out lets both the brute-force and the grid-traversal paths
// share the same Z-filtered "did we cross this wall?" semantics.
void applyWallContribution(int w, vec2 ap, float apZ, vec2 rx, float rxZ, vec2 rayDir, inout float total) {
  vec2 a, b;
  float lossDb, lossB, zLo, zHi;
  readWall(w, a, b, lossDb, lossB, zLo, zHi);
  vec2 hit = segSegIntersect(ap, rx, a, b);
  if (hit.x < 0.5) return;
  float zAt = apZ + (rxZ - apZ) * hit.y;
  if (zAt < zLo || zAt > zHi) return;
  total += wallLossOblique(a, b, rayDir, lossDb, lossB, uFOver24);
}

// Brute-force: every wall, every fragment. O(N_walls). Used when no grid is
// uploaded (small scenes / parity test path).
float accumulateWallLossBrute(vec2 ap, float apZ, vec2 rx, float rxZ) {
  float total = 0.0;
  vec2 rayDir = rx - ap;
  for (int w = 0; w < uWallCount; w++) {
    applyWallContribution(w, ap, apZ, rx, rxZ, rayDir, total);
  }
  return total;
}

// Read the (start, count) slice of uGridList that belongs to a uniform-grid
// cell at integer coords (cx, cy). Out-of-range cells return zero-length
// slices.
void readGridCell(int cx, int cy, out int start, out int count) {
  if (cx < 0 || cy < 0 || cx >= uGridDims.x || cy >= uGridDims.y) {
    start = 0; count = 0; return;
  }
  vec4 idx = texelFetch(uGridIdx, ivec2(cx, cy), 0);
  start = int(idx.x);
  count = int(idx.y);
}

// Read a wall index from uGridList[i].
int readGridWallIdx(int i) {
  ivec2 p = ivec2(i % uGridListWidth, i / uGridListWidth);
  return int(texelFetch(uGridList, p, 0).r);
}

// Process one cell's wall list. Walls straddling adjacent cells would
// otherwise have their loss double-counted, so we keep a small cyclic
// buffer of the SEEN_BUF most recently applied wall ids and skip any
// repeats. SEEN_BUF=16 covers dense-wall scenarios (~60 walls / 30×20 m)
// where a ray can touch >8 distinct walls per cell-cluster; the original
// SEEN_BUF=8 surfaced 5-14 dB friis-baseline drift on the dense-walls
// fixture. 16 is the smallest power of two that empirically clears the
// dense-walls F5b gate (≤1 dB) without measurable register pressure
// regression on basic / refl-min / dense-aps.
//
// A true "seen" set would need a bitmask texture per fragment, which is
// exactly what F5b is trying to avoid (fragment-local memory is scarce).
// The cyclic-buffer approximation keeps the shader stateless across cells
// and matches BVH-style watertight traversal accuracy in practice.
const int SEEN_BUF = 16;
void processCell(int cx, int cy, vec2 ap, float apZ, vec2 rx, float rxZ,
                 vec2 rayDir, inout float total,
                 inout int seenBuf[SEEN_BUF], inout int seenWritePos) {
  int start, count;
  readGridCell(cx, cy, start, count);
  for (int k = 0; k < count; k++) {
    int wIdx = readGridWallIdx(start + k);
    bool dup = false;
    for (int j = 0; j < SEEN_BUF; j++) {
      if (seenBuf[j] == wIdx) { dup = true; break; }
    }
    if (dup) continue;
    seenBuf[seenWritePos] = wIdx;
    seenWritePos = (seenWritePos + 1) % SEEN_BUF;
    applyWallContribution(wIdx, ap, apZ, rx, rxZ, rayDir, total);
  }
}

// Grid-accelerated wall-loss accumulation via Amanatides-Woo DDA.
// Walks the cells the AP→rx ray actually crosses, processing only walls
// whose AABBs touch those cells. With cellM ~1 m and walls ~5 m, average
// walls examined per fragment falls from O(N) to O(sqrt(N)) typical.
float accumulateWallLossGrid(vec2 ap, float apZ, vec2 rx, float rxZ) {
  float total = 0.0;
  vec2 rayDir = rx - ap;

  // Map ray endpoints into grid space.
  vec2 apG = (ap - uGridOriginM) / uGridCellM;
  vec2 rxG = (rx - uGridOriginM) / uGridCellM;

  int cx = int(floor(apG.x));
  int cy = int(floor(apG.y));
  int cxEnd = int(floor(rxG.x));
  int cyEnd = int(floor(rxG.y));

  vec2 d = rxG - apG;
  float dx = d.x;
  float dy = d.y;
  int stepX = dx > 0.0 ? 1 : (dx < 0.0 ? -1 : 0);
  int stepY = dy > 0.0 ? 1 : (dy < 0.0 ? -1 : 0);

  // tMax / tDelta in parametric units along the ray.
  float tMaxX = 1e30;
  float tDeltaX = 1e30;
  if (stepX != 0) {
    float nextX = stepX > 0 ? float(cx + 1) : float(cx);
    tMaxX = (nextX - apG.x) / dx;
    tDeltaX = abs(1.0 / dx);
  }
  float tMaxY = 1e30;
  float tDeltaY = 1e30;
  if (stepY != 0) {
    float nextY = stepY > 0 ? float(cy + 1) : float(cy);
    tMaxY = (nextY - apG.y) / dy;
    tDeltaY = abs(1.0 / dy);
  }

  int seenBuf[SEEN_BUF];
  for (int j = 0; j < SEEN_BUF; j++) seenBuf[j] = -1;
  int seenWritePos = 0;

  // Walk the ray in cell-parameter space, processing each cell the segment
  // [AP, rx] crosses. Termination logic:
  //   - destination cell (cxEnd, cyEnd) reached: process it, then stop.
  //   - parametric t at which we ENTER the next cell exceeds 1.0: the new
  //     cell lies past rx, do not process it.
  //   - maxSteps (nGx + nGy + 4) is a hard safety cap.
  // We do NOT bail when (cx, cy) sits outside the grid: when AP/rx are
  // outside the wall AABB the ray legitimately enters the grid mid-walk,
  // and an early bounds check would skip the wall-bearing cells in between.
  // readGridCell returns an empty slice for out-of-range cells anyway.
  float tCur = 0.0;
  // 53-G3 (P1-9): bound the walk by the ACTUAL cell distance this ray travels,
  // not by the grid diagonal. The walk starts at the AP cell, which may sit far
  // outside the wall-AABB grid -- the comment above says the ray legitimately
  // enters mid-walk -- so (nGx + nGy + 4) steps could burn out before reaching
  // the wall-bearing cells at all. Measured case: 60 walls packed into a
  // 21x21 m corner office (cellM 2.71, nGx=nGy=8, so maxSteps was 20) with the
  // AP 60 m away, about 22 cells out: the ray was cut at i=20 and reported ZERO
  // wall loss while the JS engine attenuated correctly. Manhattan span
  // start->end is exactly how many x plus y cell boundaries a DDA crosses, so
  // this bound is tight rather than merely larger.
  int maxSteps = abs(cxEnd - cx) + abs(cyEnd - cy) + 4;
  for (int i = 0; i < 4096; i++) {
    if (i >= maxSteps) break;
    processCell(cx, cy, ap, apZ, rx, rxZ, rayDir, total, seenBuf, seenWritePos);
    if (cx == cxEnd && cy == cyEnd) break;
    // Step into the next cell along whichever boundary we hit first.
    if (tMaxX < tMaxY) {
      tCur = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      tCur = tMaxY;
      tMaxY += tDeltaY;
      cy += stepY;
    }
    // tCur is the parametric t at which the ray entered the new (cx, cy).
    // If that is already past rx (t > 1) the new cell sits beyond the
    // segment, do not process it.
    if (tCur > 1.0) break;
  }
  return total;
}

// Wall loss dispatch: brute force when grid is empty, grid traversal otherwise.
float accumulateWallLoss(vec2 ap, float apZ, vec2 rx, float rxZ) {
  if (uGridDims.x == 0) return accumulateWallLossBrute(ap, apZ, rx, rxZ);
  return accumulateWallLossGrid(ap, apZ, rx, rxZ);
}

// HM-F5i: same DDA + SEEN_BUF dedup as accumulateWallLossGrid, but skips one
// designated wall index (used for image-source reflection legs — the
// reflecting wall must not contribute its own loss to either AP→reflPt or
// reflPt→rx). The exclude check happens BEFORE dedup interaction so the
// excluded wall doesn't waste a SEEN_BUF slot in dense-wall scenes.
void processCellExcept(int cx, int cy, vec2 ap, float apZ, vec2 rx, float rxZ,
                       vec2 rayDir, int excludeW, inout float total,
                       inout int seenBuf[SEEN_BUF], inout int seenWritePos) {
  int start, count;
  readGridCell(cx, cy, start, count);
  for (int k = 0; k < count; k++) {
    int wIdx = readGridWallIdx(start + k);
    if (wIdx == excludeW) continue;
    bool dup = false;
    for (int j = 0; j < SEEN_BUF; j++) {
      if (seenBuf[j] == wIdx) { dup = true; break; }
    }
    if (dup) continue;
    seenBuf[seenWritePos] = wIdx;
    seenWritePos = (seenWritePos + 1) % SEEN_BUF;
    applyWallContribution(wIdx, ap, apZ, rx, rxZ, rayDir, total);
  }
}

float accumulateWallLossExceptGrid(vec2 ap, float apZ, vec2 rx, float rxZ, int excludeW) {
  float total = 0.0;
  vec2 rayDir = rx - ap;

  vec2 apG = (ap - uGridOriginM) / uGridCellM;
  vec2 rxG = (rx - uGridOriginM) / uGridCellM;
  int cx = int(floor(apG.x));
  int cy = int(floor(apG.y));
  int cxEnd = int(floor(rxG.x));
  int cyEnd = int(floor(rxG.y));
  vec2 d = rxG - apG;
  float dx = d.x;
  float dy = d.y;
  int stepX = dx > 0.0 ? 1 : (dx < 0.0 ? -1 : 0);
  int stepY = dy > 0.0 ? 1 : (dy < 0.0 ? -1 : 0);
  float tMaxX = 1e30;
  float tDeltaX = 1e30;
  if (stepX != 0) {
    float nextX = stepX > 0 ? float(cx + 1) : float(cx);
    tMaxX = (nextX - apG.x) / dx;
    tDeltaX = abs(1.0 / dx);
  }
  float tMaxY = 1e30;
  float tDeltaY = 1e30;
  if (stepY != 0) {
    float nextY = stepY > 0 ? float(cy + 1) : float(cy);
    tMaxY = (nextY - apG.y) / dy;
    tDeltaY = abs(1.0 / dy);
  }
  int seenBuf[SEEN_BUF];
  for (int j = 0; j < SEEN_BUF; j++) seenBuf[j] = -1;
  int seenWritePos = 0;
  float tCur = 0.0;
  // 53-G3 (P1-9): bound the walk by the ACTUAL cell distance this ray travels,
  // not by the grid diagonal. The walk starts at the AP cell, which may sit far
  // outside the wall-AABB grid -- the comment above says the ray legitimately
  // enters mid-walk -- so (nGx + nGy + 4) steps could burn out before reaching
  // the wall-bearing cells at all. Measured case: 60 walls packed into a
  // 21x21 m corner office (cellM 2.71, nGx=nGy=8, so maxSteps was 20) with the
  // AP 60 m away, about 22 cells out: the ray was cut at i=20 and reported ZERO
  // wall loss while the JS engine attenuated correctly. Manhattan span
  // start->end is exactly how many x plus y cell boundaries a DDA crosses, so
  // this bound is tight rather than merely larger.
  int maxSteps = abs(cxEnd - cx) + abs(cyEnd - cy) + 4;
  for (int i = 0; i < 4096; i++) {
    if (i >= maxSteps) break;
    processCellExcept(cx, cy, ap, apZ, rx, rxZ, rayDir, excludeW, total, seenBuf, seenWritePos);
    if (cx == cxEnd && cy == cyEnd) break;
    if (tMaxX < tMaxY) { tCur = tMaxX; tMaxX += tDeltaX; cx += stepX; }
    else               { tCur = tMaxY; tMaxY += tDeltaY; cy += stepY; }
    if (tCur > 1.0) break;
  }
  return total;
}

// HM-F5i: same DDA + SEEN_BUF dedup as accumulateWallLossGrid, but also
// returns the hit count so the diffraction code can apply JS's
// "s1.hits > 1 || s2.hits > 1 → cull" rule. A "hit" is any wall whose
// segment is crossed by the AP→rx ray AND whose Z band contains the ray's
// z at the crossing — exactly the gating that applyWallContribution already
// performs internally, so we re-derive it here to extract both the loss
// and the boolean did-hit per wall.
void processCellWithHits(int cx, int cy, vec2 ap, float apZ, vec2 rx, float rxZ,
                         vec2 rayDir, inout vec2 acc,
                         inout int seenBuf[SEEN_BUF], inout int seenWritePos) {
  int start, count;
  readGridCell(cx, cy, start, count);
  for (int k = 0; k < count; k++) {
    int wIdx = readGridWallIdx(start + k);
    bool dup = false;
    for (int j = 0; j < SEEN_BUF; j++) {
      if (seenBuf[j] == wIdx) { dup = true; break; }
    }
    if (dup) continue;
    seenBuf[seenWritePos] = wIdx;
    seenWritePos = (seenWritePos + 1) % SEEN_BUF;

    vec2 a, b;
    float lossDb, lossB, zLo, zHi;
    readWall(wIdx, a, b, lossDb, lossB, zLo, zHi);
    vec2 hit = segSegIntersect(ap, rx, a, b);
    if (hit.x < 0.5) continue;
    float zAt = apZ + (rxZ - apZ) * hit.y;
    if (zAt < zLo || zAt > zHi) continue;
    acc.x += wallLossOblique(a, b, rayDir, lossDb, lossB, uFOver24);
    acc.y += 1.0;
  }
}

vec2 accumulateWallLossWithHitsGrid(vec2 ap, float apZ, vec2 rx, float rxZ) {
  vec2 acc = vec2(0.0);
  vec2 rayDir = rx - ap;

  vec2 apG = (ap - uGridOriginM) / uGridCellM;
  vec2 rxG = (rx - uGridOriginM) / uGridCellM;
  int cx = int(floor(apG.x));
  int cy = int(floor(apG.y));
  int cxEnd = int(floor(rxG.x));
  int cyEnd = int(floor(rxG.y));
  vec2 d = rxG - apG;
  float dx = d.x;
  float dy = d.y;
  int stepX = dx > 0.0 ? 1 : (dx < 0.0 ? -1 : 0);
  int stepY = dy > 0.0 ? 1 : (dy < 0.0 ? -1 : 0);
  float tMaxX = 1e30;
  float tDeltaX = 1e30;
  if (stepX != 0) {
    float nextX = stepX > 0 ? float(cx + 1) : float(cx);
    tMaxX = (nextX - apG.x) / dx;
    tDeltaX = abs(1.0 / dx);
  }
  float tMaxY = 1e30;
  float tDeltaY = 1e30;
  if (stepY != 0) {
    float nextY = stepY > 0 ? float(cy + 1) : float(cy);
    tMaxY = (nextY - apG.y) / dy;
    tDeltaY = abs(1.0 / dy);
  }
  int seenBuf[SEEN_BUF];
  for (int j = 0; j < SEEN_BUF; j++) seenBuf[j] = -1;
  int seenWritePos = 0;
  float tCur = 0.0;
  // 53-G3 (P1-9): bound the walk by the ACTUAL cell distance this ray travels,
  // not by the grid diagonal. The walk starts at the AP cell, which may sit far
  // outside the wall-AABB grid -- the comment above says the ray legitimately
  // enters mid-walk -- so (nGx + nGy + 4) steps could burn out before reaching
  // the wall-bearing cells at all. Measured case: 60 walls packed into a
  // 21x21 m corner office (cellM 2.71, nGx=nGy=8, so maxSteps was 20) with the
  // AP 60 m away, about 22 cells out: the ray was cut at i=20 and reported ZERO
  // wall loss while the JS engine attenuated correctly. Manhattan span
  // start->end is exactly how many x plus y cell boundaries a DDA crosses, so
  // this bound is tight rather than merely larger.
  int maxSteps = abs(cxEnd - cx) + abs(cyEnd - cy) + 4;
  for (int i = 0; i < 4096; i++) {
    if (i >= maxSteps) break;
    processCellWithHits(cx, cy, ap, apZ, rx, rxZ, rayDir, acc, seenBuf, seenWritePos);
    if (cx == cxEnd && cy == cyEnd) break;
    if (tMaxX < tMaxY) { tCur = tMaxX; tMaxX += tDeltaX; cx += stepX; }
    else               { tCur = tMaxY; tMaxY += tDeltaY; cy += stepY; }
    if (tCur > 1.0) break;
  }
  return acc;
}

// Point-in-poly via horizontal ray casting against a hole polygon stored in
// uHolePoly[start .. start+count-1] (each texel = (x, y, _, _)). Mirrors the
// JS reference exactly so a buggy edge case here doesn't appear as a "shader
// drift" surprise during diff.
// 53-G3 (P1-7): crossing-number test over a range that may hold SEVERAL
// rings, matching the JS reference (propagation.js:298-302), which returns
// true when the point is inside ANY of a boundary hole list.
//
// Each vertex texel carries (x, y, ringId). A ring is a maximal run of equal
// ringId, and each ring must be closed against its OWN first vertex -- not
// against the previous ring last vertex, which would add a bogus edge
// between rings and corrupt the parity. We therefore track each ring first
// vertex and fold in the closing edge when the run ends.
bool pointInAnyPoly(vec2 q, int start, int count) {
  if (count <= 0) return false;
  bool inside = false;
  vec4 first4 = texelFetch(uHolePoly, ivec2(start % 4096, start / 4096), 0);
  vec2 ringFirst = first4.xy;
  float ringId = first4.z;
  vec2 prev = ringFirst;
  for (int k = 1; k <= count; k++) {
    bool atEnd = (k == count);
    vec2 cur = vec2(0.0);
    float curRing = -1.0;
    if (!atEnd) {
      int idx = start + k;
      vec4 t4 = texelFetch(uHolePoly, ivec2(idx % 4096, idx / 4096), 0);
      cur = t4.xy;
      curRing = t4.z;
    }
    // Ring boundary (or end of range): close the current ring first.
    if (atEnd || curRing != ringId) {
      bool yc = (ringFirst.y > q.y) != (prev.y > q.y);
      if (yc) {
        float dy = prev.y - ringFirst.y;
        if (abs(dy) < 1e-12) dy = 1e-12;
        float xAt = (prev.x - ringFirst.x) * (q.y - ringFirst.y) / dy + ringFirst.x;
        if (q.x < xAt) inside = !inside;
      }
      if (inside) return true;   // inside one ring is enough (JS breaks too)
      if (atEnd) break;
      // Start the next ring.
      ringFirst = cur;
      ringId = curRing;
      prev = cur;
      continue;
    }
    // Ordinary edge prev -> cur inside the same ring.
    bool yCross = (cur.y > q.y) != (prev.y > q.y);
    if (yCross) {
      float dy = prev.y - cur.y;
      if (abs(dy) < 1e-12) dy = 1e-12;
      float xAt = (prev.x - cur.x) * (q.y - cur.y) / dy + cur.x;
      if (q.x < xAt) inside = !inside;
    }
    prev = cur;
  }
  return inside;
}

// Slab loss on the AP→rx ray, with FloorHole bypass and sec(θ) magnification.
float accumulateSlabLoss(vec2 ap, float apZ, vec2 rx, float rxZ) {
  if (uSlabCount == 0) return 0.0;
  float zLo = min(apZ, rxZ);
  float zHi = max(apZ, rxZ);
  float dz = rxZ - apZ;
  vec2  d2 = rx - ap;
  float d3 = sqrt(d2.x * d2.x + d2.y * d2.y + dz * dz);
  float cosI = d3 > 1e-9 ? abs(dz) / d3 : 1.0;
  float sec = 1.0 / max(cosI, 1.0 / SLAB_SEC_CAP);
  float loss = 0.0;

  for (int s = 0; s < uSlabCount; s++) {
    vec4 sb = texelFetch(uSlabs, ivec2(s, 0), 0);
    float yM = sb.x;
    float slabDb = sb.y;
    int holeStart = int(sb.z);
    int holeCount = int(sb.w);
    if (yM <= zLo || yM >= zHi) continue;
    float t = abs(dz) > 1e-9 ? (yM - apZ) / dz : 0.0;
    vec2 cross = ap + d2 * t;
    bool bypassed = false;
    // 53-G3: holeStart/holeCount span ALL of this boundary hole vertices,
    // possibly several rings distinguished by the ringId channel. One texel
    // per boundary now, so a hit on any ring bypasses the whole slab -- the
    // JS semantics the old multi-texel repack could not express.
    if (holeCount > 0 && pointInAnyPoly(cross, holeStart, holeCount)) bypassed = true;
    if (!bypassed) loss += slabDb * sec;
  }
  return loss;
}

// 2D wall-loss accumulation that excludes one wall index (used for the two
// legs of an image-source reflection — the reflecting wall itself must not
// contribute its own dB to either leg). Otherwise mirrors accumulateWallLoss.
// HM-F5i: dispatches to grid DDA when grid is present (reflection legs in
// dense-wall scenes spend most of their cost in this loop). Skip semantics
// are handled inside processCellExcept by checking wIdx == excludeW before
// dedup interaction.
float accumulateWallLossExceptBrute(vec2 ap, float apZ, vec2 rx, float rxZ, int excludeW) {
  float total = 0.0;
  vec2 rayDir = rx - ap;
  for (int w = 0; w < uWallCount; w++) {
    if (w == excludeW) continue;
    applyWallContribution(w, ap, apZ, rx, rxZ, rayDir, total);
  }
  return total;
}

float accumulateWallLossExcept(vec2 ap, float apZ, vec2 rx, float rxZ, int excludeW) {
  if (uGridDims.x == 0) return accumulateWallLossExceptBrute(ap, apZ, rx, rxZ, excludeW);
  return accumulateWallLossExceptGrid(ap, apZ, rx, rxZ, excludeW);
}

// Mirror point p across the infinite line through (a, b). Mirrors JS
// mirrorPoint exactly: n = unit segment normal, then p - 2*(p-a)·n * n.
vec2 mirrorPoint(vec2 p, vec2 a, vec2 b) {
  vec2 d = b - a;
  vec2 n = normalize(vec2(-d.y, d.x));
  float k = dot(p - a, n);
  return p - 2.0 * k * n;
}

// segSegIntersect tuned to JS's epsilon (1e-12). The version above
// (segSegIntersect with 1e-9) is for wall-loss tests where coarser tolerance
// is fine. Image-source reflection uses this stricter one to match the JS
// reference's rejection of near-parallel walls.
// Returns hit point in xy, valid flag in z (>0 = hit).
// HM-F5c-fix: same t / u padding as segSegIntersect — image-source reflection
// onto a vertex shared by two walls now picks both walls consistently
// instead of fp32-jitter-dependent.
vec3 segSegHit(vec2 p1, vec2 p2, vec2 p3, vec2 p4) {
  vec2 d1 = p2 - p1;
  vec2 d2 = p4 - p3;
  float denom = d1.x * d2.y - d1.y * d2.x;
  if (abs(denom) < 1e-12) return vec3(0.0, 0.0, 0.0);
  vec2 r = p1 - p3;
  float t = (d2.x * r.y - d2.y * r.x) / denom;
  float u = (d1.x * r.y - d1.y * r.x) / denom;
  if (t < 0.0 || t > 1.0 + SEG_HIT_EPS) return vec3(0.0, 0.0, 0.0);
  if (u < -SEG_HIT_EPS || u > 1.0 + SEG_HIT_EPS) return vec3(0.0, 0.0, 0.0);
  vec2 hit = p1 + d1 * t;
  return vec3(hit, 1.0);
}

// Knife-edge diffraction loss curve. Exact piecewise mirror of the JS
// reference (knifeEdgeLossDb in propagation.js). v is the Fresnel-Kirchhoff
// parameter (positive = corner blocks the ray, negative = clear).
float knifeEdgeLossDb(float v) {
  // ITU-R P.526 diffraction *gain* Gd(v) is non-positive; callers add this as
  // a positive path-loss term, so return the loss magnitude = -Gd(v).
  if (v <= -1.0) return 0.0;
  if (v <= 0.0)  return -(20.0 * log(0.5 - 0.62 * v) / log(10.0));
  if (v <= 1.0)  return -(20.0 * log(0.5 * exp(-0.95 * v)) / log(10.0));
  if (v <= 2.4) {
    float t = 0.38 - 0.1 * v;
    return -(20.0 * log(0.4 - sqrt(0.1184 - t * t)) / log(10.0));
  }
  return -(20.0 * log(0.225 / v) / log(10.0));
}

// Corner-diffraction Fresnel-Kirchhoff parameter v then dB loss.
// Mirrors cornerDiffractionDb. Returns +Infinity when the corner sits past
// the AP↔rx segment endpoints (seg.t outside (0, 1)).
// Returns 1e30 sentinel for "infeasible — skip" so caller can cull cleanly
// without a separate flag.
float cornerDiffractionDb(vec2 tx, vec2 rx, vec2 corner, float wavelengthM) {
  float d1 = length(corner - tx);
  float d2 = length(rx - corner);
  // Degenerate near-endpoint cull. When rx (or AP) sits closer than ~10 cm
  // to a corner, fp32 evaluation of v = h * sqrt((2/λ)·(d1+d2)/(d1·d2))
  // becomes unstable: d2 → 0 inflates 1/d2 catastrophically while h → 0
  // shrinks; the ratio is well-defined in fp64 (knife-edge gives large
  // loss at the edge), but in fp32 it collapses to v ≈ 0 → -6 dB, which
  // turns the diffraction path into a "shortcut" that out-bids the direct
  // ray and produces a bright square at every corner near a probe cell.
  // JS reference doesn't trip this because fp64 keeps the (d2, h) ratio
  // honest; the cull below is a fp32-only guard. 0.1 m is well below grid
  // resolution (gridStepM ≥ 0.5 m) so it can't shadow a real diffraction
  // contribution.
  if (d1 < 0.1 || d2 < 0.1) return 1e30;
  // Project corner onto AP→rx; t in [0,1] means corner sits between them.
  vec2 ab = rx - tx;
  float l2 = dot(ab, ab);
  if (l2 == 0.0) return 1e30;
  float t = dot(corner - tx, ab) / l2;
  if (t <= 0.0 || t >= 1.0) return 1e30;
  // Perpendicular distance corner ↔ AP→rx line.
  vec2 closest = tx + ab * t;
  float h = length(corner - closest);
  float v = h * sqrt((2.0 / wavelengthM) * ((d1 + d2) / (d1 * d2)));
  return knifeEdgeLossDb(v);
}

// Wall-loss accumulation that also returns hit count, so the diffraction
// code can apply JS's "s1.hits > 1 || s2.hits > 1 → cull" rule (and the
// direct path can gate diffraction with "any hit at all"). Out: x = total dB,
// y = hits as float (caller compares > 1.0 / > 0.0).
// HM-F5i: dispatches to grid DDA when grid is present. SEEN_BUF dedup
// guarantees each wall is counted at most once even when the ray crosses
// multiple cells that all reference it.
vec2 accumulateWallLossWithHitsBrute(vec2 ap, float apZ, vec2 rx, float rxZ) {
  vec2 acc = vec2(0.0);
  vec2 rayDir = rx - ap;
  for (int w = 0; w < uWallCount; w++) {
    vec2 a, b;
    float lossDb, lossB, zLo, zHi;
    readWall(w, a, b, lossDb, lossB, zLo, zHi);
    vec2 hit = segSegIntersect(ap, rx, a, b);
    if (hit.x < 0.5) continue;
    float zAt = apZ + (rxZ - apZ) * hit.y;
    if (zAt < zLo || zAt > zHi) continue;
    acc.x += wallLossOblique(a, b, rayDir, lossDb, lossB, uFOver24);
    acc.y += 1.0;
  }
  return acc;
}

vec2 accumulateWallLossWithHits(vec2 ap, float apZ, vec2 rx, float rxZ) {
  if (uGridDims.x == 0) return accumulateWallLossWithHitsBrute(ap, apZ, rx, rxZ);
  return accumulateWallLossWithHitsGrid(ap, apZ, rx, rxZ);
}

// Relative sector taper (≤ 0 dB): flat inside half-beamwidth, linear fall to
// the -20 dB back lobe. Mirrors sectorTaperDb in propagation.js.
float sectorTaperDb(float absOffDeg, float halfBwDeg) {
  if (absOffDeg <= halfBwDeg) return 0.0;
  if (absOffDeg >= halfBwDeg + DIRECTIONAL_EDGE_DEG) return -DIRECTIONAL_BACK_DB;
  return -DIRECTIONAL_BACK_DB * (absOffDeg - halfBwDeg) / DIRECTIONAL_EDGE_DEG;
}

// AP antenna gain in dBi for a ray heading from AP to target. Mirrors
// apGainDbi in propagation.js modulo custom-pattern (host falls back).
// Phase 40: the same sector taper also applies to the vertical offset
// (ray elevation − uAntTiltDeg), so a tilted directional AP loses gain
// toward rays leaving its beamwidth cone vertically.
float apGainDbi(vec2 target, float targetZ) {
  if (uAntMode == 0) return uAntGainDbi;
  if (uAntMode == 2) return uAntGainDbi;   // custom — caller already routes to JS path
  vec2 dxy = target - uApPos.xy;
  if (abs(dxy.x) < 1e-9 && abs(dxy.y) < 1e-9) return uAntGainDbi;
  float rayDeg = atan(dxy.y, dxy.x) * 180.0 / PI;
  float off = rayDeg - uAntAzimuthDeg;
  off = mod(off + 540.0, 360.0) - 180.0;
  float absOff = abs(off);
  float elevDeg = atan(targetZ - uApPos.z, length(dxy)) * 180.0 / PI;
  float vertOff = abs(elevDeg - uAntTiltDeg);
  float halfBw = uAntBeamwidthDeg * 0.5;
  return uAntGainDbi + sectorTaperDb(absOff, halfBw) + sectorTaperDb(vertOff, halfBw);
}

// Cap on the number of frequency samples in the band-sweep coherent sum.
// JS chooseFreqSamples is max(5, ceil(bwMhz/4)); 160 MHz → 40 samples is the
// realistic ceiling. NMAX=40 gives shader its array size; runtime N is the
// uniform uFreqN (always ≤ NMAX or the host clamps it).
const int NMAX = 40;

// Add one path's contribution to all N coherent-sum H accumulators. Mirrors
// the inner-loop body of propagation.js's H(f_i) sweep: each f_i sees the
// same path complex amplitude (Fresnel/material/roughness all use the
// channel's centre frequency, JS-style), only the phase ph_i = -2π·f_i·tau
// differs per sample.
//
// CRITICAL: f·tau spans 1000+ cycles for typical Friis distances. fp32 wrap-
// to-(-π, π] alone is not enough — when paths interfere in narrow
// destructive bands, the residual phase noise (~ULP·1300 = 0.001 rad) lets
// some grid cells diverge ~30 dB from the JS reference. We instead phase-
// reference every path against a shared tauRef (chosen as the direct
// path's tau), so cycles = f·(tau-tauRef) stays small (typically < 50)
// for all reasonable scenes. Multiplying every H by a global phase doesn't
// change |H|², so power is invariant.
void addPathHN(int N, float startHz, float stepHz, float tau, float tauRef,
               vec2 perpC, vec2 paraC,
               inout vec2 Hperp[NMAX], inout vec2 Hpara[NMAX]) {
  float dtau = tau - tauRef;
  for (int i = 0; i < NMAX; i++) {
    if (i >= N) break;
    float f = startHz + float(i) * stepHz;
    float cycles = f * dtau;
    float frac = cycles - floor(cycles);
    if (frac > 0.5) frac -= 1.0;
    float ph = -2.0 * PI * frac;
    float cs = cos(ph), sn = sin(ph);
    Hperp[i] += vec2(perpC.x * cs - perpC.y * sn, perpC.x * sn + perpC.y * cs);
    Hpara[i] += vec2(paraC.x * cs - paraC.y * sn, paraC.x * sn + paraC.y * cs);
  }
}

float dbToLin(float db) { return pow(10.0, db * 0.1); }
float linToDb(float lin) { return 10.0 * log(max(lin, 1e-30)) / log(10.0); }
const float SQRT2 = 1.4142135623730951;
const float C_LIGHT = 299792458.0;

// Reflection-aware RSSI in dBm. uReflEnabled gates the entire complex path;
// when 0 the caller takes the F5a scalar fast path. Step 2 hard-codes N=1
// (single tone at centre frequency); multi-frequency averaging lands in step 4.
float rssiWithReflections(vec2 rx, float rxZ) {
  // ---- direct path ----
  vec2 dxy = rx - uApPos.xy;
  float dxyLen = max(length(dxy), 0.25);
  float dz = uApPos.z - rxZ;
  float dDir = sqrt(dxyLen * dxyLen + dz * dz);

  // HM-F5l: free-space-RSSI cull. Refl/diff paths travel ≥ direct distance
  // with extra Fresnel / knife-edge attenuation, so FS-only direct < floor
  // means every other path is also below floor — skip the loops entirely.
  // The direct Friis path keeps running so the output dBm is still computed
  // correctly (just below floor). apGainDbi is direction-aware (lobe gain),
  // so we use uAntGainDbi here as the upper bound (boresight gain), which
  // is a strict superset of any apGainDbi(rx) value the runtime would pick.
  float fsBest = uTxDbm + uAntGainDbi + uRxGainDbi - pathLossDb(dDir, uCenterMHz);
  bool cullByFloor = fsBest < uCullFloorDbm;

  // HM-F5j: per-AP LOS lookup. losBit==1 means the host's bake pass
  // verified the AP→rx ray hits zero walls at this fragment, so the
  // direct-path wall scan is a guaranteed no-op. We skip the DDA entirely
  // (dirHits=0, wallLoss=0) — diffraction's dirHits>0 gate then naturally
  // skips its loop too, matching the JS reference's behaviour.
  // The bake uses the same Z filter + SEEN_BUF dedup as the runtime DDA, so
  // shading this short-circuit is bit-equivalent to running the full scan.
  bool losClear = false;
  if (uLosEnabled == 1) {
    ivec2 gpx = ivec2(gl_FragCoord.xy);
    losClear = texelFetch(uLosTex, gpx, 0).r > 0.5;
  }

  // Need both wall-loss dB and the hit count so the diffraction loop can
  // gate "direct path is blocked" the same way JS does (wallScan.hits > 0).
  // HM-F5i: grid DDA path with SEEN_BUF dedup is now used here (dispatched
  // inside accumulateWallLossWithHits when the grid is uploaded), giving
  // O(√N_walls) instead of O(N_walls).
  vec2 dirScan = losClear ? vec2(0.0) : accumulateWallLossWithHits(uApPos.xy, uApPos.z, rx, rxZ);
  float wallLossDir = dirScan.x;
  float dirHits     = dirScan.y;
  float slabLossDir = accumulateSlabLoss(uApPos.xy, uApPos.z, rx, rxZ);
  float plDir = pathLossDb(dDir, uCenterMHz) + wallLossDir + slabLossDir;

  // Geometry-only same-floor test for reflection eligibility — reflections
  // are 2D and only valid when AP↔rx ray crosses zero slab boundaries (same
  // logic as JS engine's sameFloorRay = slabCount === 0).
  // We approximate by sweeping slabs again with a "count crossings" pass; for
  // the typical scenario that's already done implicitly when slabLossDir was
  // computed but we don't expose the count. Simpler: just rerun the loop here.
  bool sameFloor = true;
  if (uSlabCount > 0) {
    float zLo = min(uApPos.z, rxZ);
    float zHi = max(uApPos.z, rxZ);
    for (int s = 0; s < uSlabCount; s++) {
      float yM = texelFetch(uSlabs, ivec2(s, 0), 0).x;
      if (yM > zLo && yM < zHi) { sameFloor = false; break; }
    }
  }

  // Direct path → complex H. amp = sqrt(rxLin) / sqrt(2); perp = para = (amp, 0).
  float rxDbDir = uTxDbm + apGainDbi(rx, rxZ) + uRxGainDbi - plDir;
  float ampDir = sqrt(dbToLin(rxDbDir)) / SQRT2;
  float tauDir = dDir / C_LIGHT;
  vec2  perpDir = vec2(ampDir, 0.0);
  vec2  paraDir = vec2(ampDir, 0.0);

  // Frequency-sweep parameters. JS chooseFreqSamples = max(5, ceil(bwMhz/4));
  // when uFreqOverrideN > 0 the caller pins it (debug N=1 path). N=1 collapses
  // to centre frequency only (matches propagation.js's startHz = centerHz
  // branch). N≥2 sweeps the band edge-to-edge with uniform spacing.
  float bwMhz   = uChannelWidthMHz > 0.0 ? uChannelWidthMHz : 20.0;
  float bwHz    = bwMhz * 1e6 * 0.9;        // 5% guard each edge
  float centerHz = uCenterMHz * 1e6;
  int N = uFreqOverrideN > 0
            ? max(1, uFreqOverrideN)
            : max(5, int(ceil(bwMhz / 4.0)));
  if (N > NMAX) N = NMAX;
  float startHz = N > 1 ? centerHz - bwHz * 0.5 : centerHz;
  float stepHz  = N > 1 ? bwHz / float(N - 1)   : 0.0;

  vec2 Hperp[NMAX];
  vec2 Hpara[NMAX];
  for (int i = 0; i < NMAX; i++) { Hperp[i] = vec2(0.0); Hpara[i] = vec2(0.0); }

  // Material/Fresnel etc. still use centre frequency (JS does the same:
  // wavelength = C / (freqMhz * 1e6) is computed once before the band
  // sweep). Only phase varies across samples.
  float f = centerHz;
  // Direct-path tau is the shared phase reference for all paths in this
  // fragment, so cycles=f·(tau-tauRef) stays small and fp32 round-off
  // doesn't poison destructive interference points (~30 dB outliers).
  float tauRef = tauDir;

  addPathHN(N, startHz, stepHz, tauDir, tauRef, perpDir, paraDir, Hperp, Hpara);

  // ---- 1st-order image-source reflections ----
  // uReflEnabled gates the loop separately from uDiffEnabled so the JS
  // engine's behaviour (refl + diff toggle independently) is preserved
  // when the caller routes diff=on/refl=off through this complex path.
  // HM-F5j fast mode (B): when uLosFastMode==1 AND LOS=1 we additionally
  // skip reflections. This is a *physics compromise* — reflections off
  // other walls can still reach a LOS=1 cell, especially metal (G≈-1).
  // Off by default; opt-in for drag-time speedup where ~5-15 dB transient
  // drift is acceptable. Strict mode (uLosFastMode==0) keeps full parity.
  bool reflSkipByLos = (uLosFastMode == 1) && losClear;
  if (uReflEnabled == 1 && sameFloor && !reflSkipByLos && !cullByFloor) {
    for (int w = 0; w < uWallCount; w++) {
      vec2 wa, wb;
      float wLossDb, wLossB, wZLo, wZHi;
      readWall(w, wa, wb, wLossDb, wLossB, wZLo, wZHi);
      vec4 itu;
      float roughM;
      bool isMetal;
      readWallMaterial(w, itu, roughM, isMetal);

      // HM-F5k: precomputed AP-mirror across this wall when baked. mirrorPoint
      // depends only on (AP, wall) so it's per-AP-constant; the bake hoists
      // 1 sub + 1 normalize + 1 dot + 1 sub-mul-mul out of the per-fragment
      // loop. Geometry is identical to JS — same n = unit segment normal,
      // same p - 2(p-a)·n·n.
      vec2 apImg = uApGeoEnabled == 1
        ? texelFetch(uApWallMirror, ivec2(w, 0), 0).xy
        : mirrorPoint(uApPos.xy, wa, wb);
      vec3 hit = segSegHit(apImg, rx, wa, wb);
      if (hit.z < 0.5) continue;
      vec2 reflPt = hit.xy;

      // Degenerate "AP sits on the wall's infinite line" makes mirror = AP
      // and reflPt = AP, so inDir = (0, 0). JS's norm() handles that as zero
      // (l ||= 1 guard); GLSL normalize() returns NaN, which would silently
      // poison the coherent sum (NaN amp → NaN H → power → -300 dBm sentinel).
      // Match JS behaviour: zero-length inDir → cosI = 0 → cull by threshold.
      vec2 inVec = reflPt - uApPos.xy;
      float inLen = length(inVec);
      vec2 inDir = inLen > 1e-12 ? inVec / inLen : vec2(0.0);
      vec2 nrm   = normalize(vec2(-(wb.y - wa.y), wb.x - wa.x));
      float cosI = abs(dot(inDir, nrm));
      if (cosI < 0.05) continue;

      vec2 epsC = isMetal ? vec2(0.0) : materialEpsC(itu, uCenterMHz);
      vec4 g = fresnelGamma(cosI, epsC, isMetal);
      vec2 gPerp = g.xy;
      vec2 gPara = g.zw;

      float kWave = 2.0 * PI / (C_LIGHT / f);
      float arg = kWave * roughM * cosI;
      float rough = exp(-2.0 * arg * arg);

      float magPerp = length(gPerp);
      float magPara = length(gPara);
      if (max(magPerp, magPara) * rough < 0.02) continue;

      float d1 = length(reflPt - uApPos.xy);
      float d2 = length(rx - reflPt);
      float dTot = d1 + d2;
      float reflZ = uApPos.z + (rxZ - uApPos.z) * (d1 / max(dTot, 1e-9));

      float leg1 = accumulateWallLossExcept(uApPos.xy, uApPos.z, reflPt, reflZ, w);
      float leg2 = accumulateWallLossExcept(reflPt, reflZ, rx, rxZ, w);
      float plRef = pathLossDb(dTot, uCenterMHz) + leg1 + leg2;

      float rxDbRef = uTxDbm + apGainDbi(reflPt, reflZ) + uRxGainDbi - plRef;
      float ampRef = sqrt(dbToLin(rxDbRef)) / SQRT2;
      vec2  baseR = vec2(ampRef * rough, 0.0);
      vec2  perpR = cmul(baseR, gPerp);
      vec2  paraR = cmul(baseR, gPara);
      float tauR  = dTot / C_LIGHT;
      addPathHN(N, startHz, stepHz, tauR, tauRef, perpR, paraR, Hperp, Hpara);
    }
  }

  // ---- knife-edge corner diffraction ----
  // Only worth considering when:
  //   - direct ray is blocked by ≥1 wall (otherwise direct dominates)
  //   - same-floor (cross-floor diffraction is 3D; out of scope)
  //   - diffraction toggle on
  // Mirrors JS: enableDiffraction && wallScan.hits > 0 && sameFloorRay.
  // Each path is polarization-neutral (scalar amp into both H channels),
  // matching makeScalarPath in propagation.js.
  if (uDiffEnabled == 1 && dirHits > 0.0 && sameFloor && !cullByFloor) {
    float wavelengthM = C_LIGHT / f;
    for (int ci = 0; ci < uCornerCount; ci++) {
      vec2 corner = texelFetch(uCorners, ivec2(ci % 4096, ci / 4096), 0).xy;
      // HM-F5k: pull AP→corner geometry from the precomputed texture when
      // baked. d1 is exact (deterministic per (AP, corner)); geomLos==1
      // means zero walls cross AP→corner geometrically, so the s1 DDA is
      // guaranteed empty and we can skip it (mirror semantics of HM-F5j's
      // direct-path LOS short-circuit).
      float d1;
      bool s1Skip = false;
      if (uApGeoEnabled == 1) {
        vec4 g = texelFetch(uApCornersGeo, ivec2(ci, 0), 0);
        d1 = g.r;
        s1Skip = g.g > 0.5;
      } else {
        d1 = length(corner - uApPos.xy);
      }
      float d2 = length(rx - corner);
      float dTotC = d1 + d2;
      float cZM = uApPos.z + (rxZ - uApPos.z) * (d1 / max(dTotC, 1e-9));
      // HM-F5f: hoist the geometric diffraction cull above the per-leg wall
      // scans. cornerDiffractionDb is pure 2D geometry (no DDA), so when the
      // corner sits past the AP-rx segment endpoints (1e30 sentinel) or the
      // knife-edge loss already exceeds 40 dB, we can skip both DDAs entirely.
      // Output is identical: the original order culled by s1.y/s2.y > 1
      // first then diff > 40; the two checks are independent (wall hit
      // count vs knife-edge geometry), and the second always runs after the
      // first either way, so reordering only changes which work gets paid
      // for on cells that ultimately get culled.
      float diff = cornerDiffractionDb(uApPos.xy, rx, corner, wavelengthM);
      if (diff >= 1e29 || diff > 40.0) continue;

      // Per-leg wall accumulation with hit count — JS culls if either leg
      // crosses more than one wall, since the corner is supposed to be the
      // single obstruction. >1 means the diffracted path is blocked too.
      vec2 s1 = s1Skip ? vec2(0.0) : accumulateWallLossWithHits(uApPos.xy, uApPos.z, corner, cZM);
      vec2 s2 = accumulateWallLossWithHits(corner, cZM, rx, rxZ);
      if (s1.y > 1.0 || s2.y > 1.0) continue;

      float plDiff = pathLossDb(dTotC, uCenterMHz) + s1.x + s2.x + diff;
      float rxDbD  = uTxDbm + apGainDbi(corner, cZM) + uRxGainDbi - plDiff;
      float ampD   = sqrt(dbToLin(rxDbD)) / SQRT2;
      vec2  perpD  = vec2(ampD, 0.0);
      vec2  paraD  = vec2(ampD, 0.0);
      float tauD   = dTotC / C_LIGHT;
      addPathHN(N, startHz, stepHz, tauD, tauRef, perpD, paraD, Hperp, Hpara);
    }
  }

  // Power = (1/N) Σ (|H_perp(f_i)|² + |H_para(f_i)|²). The factor 1/N matches
  // propagation.js's powerSum / N for an unbiased band-average.
  float powerSum = 0.0;
  for (int i = 0; i < NMAX; i++) {
    if (i >= N) break;
    powerSum += dot(Hperp[i], Hperp[i]) + dot(Hpara[i], Hpara[i]);
  }
  return linToDb(powerSum / float(N));
}

void main() {
  // Fragment → grid index (i, j); world coord at cell centre matches CPU.
  // CPU writes rssi[j*nx + i] with x = i*step, y = j*step. We treat row 0 as
  // j=0 here (no flip) and let the host read pixels back row-major.
  ivec2 gpx = ivec2(gl_FragCoord.xy);
  if (gpx.x >= int(uGridSize.x) || gpx.y >= int(uGridSize.y)) {
    outColor = vec4(0.0/0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 rx = uOriginM + vec2(float(gpx.x), float(gpx.y)) * uGridStepM;
  float rxZ = uRxZM;

  // Refl OR diff routes through the complex coherent-sum path; the loops
  // inside are gated separately so refl=off/diff=on stays independent
  // from refl=on/diff=off.
  if (uReflEnabled == 1 || uDiffEnabled == 1) {
    outColor = vec4(rssiWithReflections(rx, rxZ), 0.0, 0.0, 1.0);
    return;
  }

  // F5a fast path — scalar dB only, no complex coherent sum. Bit-for-bit
  // identical to pre-step-2 behaviour.
  vec2 dxy = rx - uApPos.xy;
  float dxyLen = max(length(dxy), 0.25);
  float dz = uApPos.z - rxZ;
  float dDir = sqrt(dxyLen * dxyLen + dz * dz);

  float wallLoss = accumulateWallLoss(uApPos.xy, uApPos.z, rx, rxZ);
  float slabLoss = accumulateSlabLoss(uApPos.xy, uApPos.z, rx, rxZ);

  float pl = pathLossDb(dDir, uCenterMHz) + wallLoss + slabLoss;
  float rxDb = uTxDbm + apGainDbi(rx, rxZ) + uRxGainDbi - pl;
  outColor = vec4(rxDb, 0.0, 0.0, 1.0);
}`

// HM-F5g: per-fragment all-AP loop. Output = (rssi, sinr, snr, cci) in dB(m).
//
// AP texture layout (uAps, RGBA32F, 4 texels per AP, packed 4096-wide):
//   t0 = (x, y, zM, txDbm)
//   t1 = (centerMHz, channelWidthMHz, antGainDbi, antMode)
//        antMode: 0 = omni, 1 = directional. Custom never reaches the
//        aggregated path — host falls back to renderAp.
//   t2 = (azimuthDeg, beamwidthDeg, freqLoMHz, freqHiMHz)
//        [freqLo, freqHi] = AP's occupied band; SINR co-channel test compares
//        against the serving AP's range (same band + interval intersect).
//   t3 = (band, tiltDeg, _, _)
//        band: 1=2.4 GHz, 2=5 GHz, 3=6 GHz. Cross-band APs never co-channel.
//        tiltDeg: boresight elevation in degrees (+up, Phase 40).
//
// Distance culling: free-space PL gives the maximum possible RSSI an AP can
// contribute to this fragment. If that's below uCullFloorDbm we skip the AP
// entirely — saves the wall-loss DDA, which is the per-AP bottleneck.
//
// Reflection/diffraction NOT supported here: the coherent NMAX array per
// fragment × per AP would explode register pressure. Host falls back to the
// per-AP renderAp dispatch when refl or diff is on.
const FS_FIELD = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uGridSize;        // (nx, ny)
uniform vec2 uOriginM;
uniform float uGridStepM;
uniform float uRxZM;
uniform float uRxGainDbi;
uniform float uNoiseDbm;
uniform float uCullFloorDbm;   // skip AP when its free-space-only RSSI is below this
uniform int   uRssiOnly;       // 1 = skip CCI/SINR loop, write sentinels into those channels

uniform sampler2D uWalls;
uniform int uWallCount;
uniform sampler2D uSlabs;
uniform int uSlabCount;
uniform sampler2D uHolePoly;
uniform int uHolePolyLen;

uniform sampler2D uGridIdx;
uniform sampler2D uGridList;
uniform ivec2 uGridDims;
uniform float uGridCellM;
uniform vec2  uGridOriginM;
uniform int   uGridListWidth;

uniform sampler2D uAps;
uniform int uApCount;

// HM-F5h cascade input. uCascadeFactor = 0 disables cascade (single-pass).
// uMask is the R8 dead/alive output of FS_FIELD_COARSE; uMaskSize is its
// resolution in texels. Each fine fragment maps to mask cell
// (gpx / uCascadeFactor) and we OR a 3×3 neighbourhood for dilation so the
// cell-boundary stays soft.
uniform sampler2D uMask;
uniform ivec2 uMaskSize;
uniform int uCascadeFactor;

const float PI = 3.14159265358979;
const float SLAB_SEC_CAP = 3.5;
const float DIRECTIONAL_BACK_DB = 20.0;
const float DIRECTIONAL_EDGE_DEG = 15.0;

// HM-F5c-fix: t / u padding mirrors the per-AP shader's segSegIntersect
// (above in this file). dense-aps caught both axes — rx grids align with
// metal-box corners (t-side) and cubicle endpoint pairs (u-side).
const float SEG_HIT_EPS = 1e-6;
vec2 segSegIntersect(vec2 p1, vec2 p2, vec2 p3, vec2 p4) {
  vec2 d1 = p2 - p1;
  vec2 d2 = p4 - p3;
  float denom = d1.x * d2.y - d1.y * d2.x;
  if (abs(denom) < 1e-12) return vec2(0.0, 0.0);
  vec2 r = p1 - p3;
  float t = (d2.x * r.y - d2.y * r.x) / denom;
  float u = (d1.x * r.y - d1.y * r.x) / denom;
  if (t < 0.0 || t > 1.0 + SEG_HIT_EPS) return vec2(0.0, 0.0);
  if (u < -SEG_HIT_EPS || u > 1.0 + SEG_HIT_EPS) return vec2(0.0, 0.0);
  return vec2(1.0, t);
}

// HM-F8: 4-texel wall record, mirrors per-AP shader's readWall above.
void readWall(int w, out vec2 a, out vec2 b, out float lossDb, out float lossB, out float zLo, out float zHi) {
  int t0 = w * 4;
  int t1 = t0 + 1;
  int t3 = t0 + 3;
  ivec2 p0 = ivec2(t0 % 4096, t0 / 4096);
  ivec2 p1 = ivec2(t1 % 4096, t1 / 4096);
  ivec2 p3 = ivec2(t3 % 4096, t3 / 4096);
  vec4 e0 = texelFetch(uWalls, p0, 0);
  vec4 e1 = texelFetch(uWalls, p1, 0);
  vec4 e3 = texelFetch(uWalls, p3, 0);
  a = e0.xy;  b = e0.zw;
  lossDb = e1.x;  zLo = e1.y;  zHi = e1.z;
  lossB  = e3.x;
}

float wallLossOblique(vec2 a, vec2 b, vec2 rayDir, float lossDb, float lossB, float fOver24) {
  vec2 t = b - a;
  vec2 n = normalize(vec2(-t.y, t.x));
  float rL = length(rayDir);
  vec2 rDir = rL > 1e-12 ? rayDir / rL : vec2(0.0);
  float cosI = abs(dot(rDir, n));
  float sec = 1.0 / max(cosI, 0.2);
  float fAdj = lossB == 0.0 ? 1.0 : pow(fOver24, lossB);
  return lossDb * fAdj * min(sec, 3.5);
}

void applyWallContribution(int w, vec2 ap, float apZ, vec2 rx, float rxZ, vec2 rayDir, float fOver24, inout float total) {
  vec2 a, b;
  float lossDb, lossB, zLo, zHi;
  readWall(w, a, b, lossDb, lossB, zLo, zHi);
  vec2 hit = segSegIntersect(ap, rx, a, b);
  if (hit.x < 0.5) return;
  float zAt = apZ + (rxZ - apZ) * hit.y;
  if (zAt < zLo || zAt > zHi) return;
  total += wallLossOblique(a, b, rayDir, lossDb, lossB, fOver24);
}

float accumulateWallLossBrute(vec2 ap, float apZ, vec2 rx, float rxZ, float fOver24) {
  float total = 0.0;
  vec2 rayDir = rx - ap;
  for (int w = 0; w < uWallCount; w++) {
    applyWallContribution(w, ap, apZ, rx, rxZ, rayDir, fOver24, total);
  }
  return total;
}

void readGridCell(int cx, int cy, out int start, out int count) {
  if (cx < 0 || cy < 0 || cx >= uGridDims.x || cy >= uGridDims.y) {
    start = 0; count = 0; return;
  }
  vec4 idx = texelFetch(uGridIdx, ivec2(cx, cy), 0);
  start = int(idx.x);
  count = int(idx.y);
}

int readGridWallIdx(int i) {
  ivec2 p = ivec2(i % uGridListWidth, i / uGridListWidth);
  return int(texelFetch(uGridList, p, 0).r);
}

const int SEEN_BUF = 16;

float accumulateWallLossGrid(vec2 ap, float apZ, vec2 rx, float rxZ, float fOver24) {
  float total = 0.0;
  vec2 rayDir = rx - ap;

  vec2 apG = (ap - uGridOriginM) / uGridCellM;
  vec2 rxG = (rx - uGridOriginM) / uGridCellM;

  int cx = int(floor(apG.x));
  int cy = int(floor(apG.y));
  int cxEnd = int(floor(rxG.x));
  int cyEnd = int(floor(rxG.y));

  vec2 d = rxG - apG;
  float dx = d.x;
  float dy = d.y;
  int stepX = dx > 0.0 ? 1 : (dx < 0.0 ? -1 : 0);
  int stepY = dy > 0.0 ? 1 : (dy < 0.0 ? -1 : 0);

  float tMaxX = 1e30;
  float tDeltaX = 1e30;
  if (stepX != 0) {
    float nextX = stepX > 0 ? float(cx + 1) : float(cx);
    tMaxX = (nextX - apG.x) / dx;
    tDeltaX = abs(1.0 / dx);
  }
  float tMaxY = 1e30;
  float tDeltaY = 1e30;
  if (stepY != 0) {
    float nextY = stepY > 0 ? float(cy + 1) : float(cy);
    tMaxY = (nextY - apG.y) / dy;
    tDeltaY = abs(1.0 / dy);
  }

  int seenBuf[SEEN_BUF];
  for (int j = 0; j < SEEN_BUF; j++) seenBuf[j] = -1;
  int seenWritePos = 0;

  float tCur = 0.0;
  // 53-G3 (P1-9): bound the walk by the ACTUAL cell distance this ray travels,
  // not by the grid diagonal. The walk starts at the AP cell, which may sit far
  // outside the wall-AABB grid -- the comment above says the ray legitimately
  // enters mid-walk -- so (nGx + nGy + 4) steps could burn out before reaching
  // the wall-bearing cells at all. Measured case: 60 walls packed into a
  // 21x21 m corner office (cellM 2.71, nGx=nGy=8, so maxSteps was 20) with the
  // AP 60 m away, about 22 cells out: the ray was cut at i=20 and reported ZERO
  // wall loss while the JS engine attenuated correctly. Manhattan span
  // start->end is exactly how many x plus y cell boundaries a DDA crosses, so
  // this bound is tight rather than merely larger.
  int maxSteps = abs(cxEnd - cx) + abs(cyEnd - cy) + 4;
  for (int i = 0; i < 4096; i++) {
    if (i >= maxSteps) break;
    int start, count;
    readGridCell(cx, cy, start, count);
    for (int k = 0; k < count; k++) {
      int wIdx = readGridWallIdx(start + k);
      bool dup = false;
      for (int j = 0; j < SEEN_BUF; j++) {
        if (seenBuf[j] == wIdx) { dup = true; break; }
      }
      if (dup) continue;
      seenBuf[seenWritePos] = wIdx;
      seenWritePos = (seenWritePos + 1) % SEEN_BUF;
      applyWallContribution(wIdx, ap, apZ, rx, rxZ, rayDir, fOver24, total);
    }
    if (cx == cxEnd && cy == cyEnd) break;
    if (tMaxX < tMaxY) {
      tCur = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      tCur = tMaxY;
      tMaxY += tDeltaY;
      cy += stepY;
    }
    if (tCur > 1.0) break;
  }
  return total;
}

float accumulateWallLossField(vec2 ap, float apZ, vec2 rx, float rxZ, float fOver24) {
  if (uGridDims.x == 0) return accumulateWallLossBrute(ap, apZ, rx, rxZ, fOver24);
  return accumulateWallLossGrid(ap, apZ, rx, rxZ, fOver24);
}

// 53-G3 (P1-7): crossing-number test over a range that may hold SEVERAL
// rings, matching the JS reference (propagation.js:298-302), which returns
// true when the point is inside ANY of a boundary hole list.
//
// Each vertex texel carries (x, y, ringId). A ring is a maximal run of equal
// ringId, and each ring must be closed against its OWN first vertex -- not
// against the previous ring last vertex, which would add a bogus edge
// between rings and corrupt the parity. We therefore track each ring first
// vertex and fold in the closing edge when the run ends.
bool pointInAnyPoly(vec2 q, int start, int count) {
  if (count <= 0) return false;
  bool inside = false;
  vec4 first4 = texelFetch(uHolePoly, ivec2(start % 4096, start / 4096), 0);
  vec2 ringFirst = first4.xy;
  float ringId = first4.z;
  vec2 prev = ringFirst;
  for (int k = 1; k <= count; k++) {
    bool atEnd = (k == count);
    vec2 cur = vec2(0.0);
    float curRing = -1.0;
    if (!atEnd) {
      int idx = start + k;
      vec4 t4 = texelFetch(uHolePoly, ivec2(idx % 4096, idx / 4096), 0);
      cur = t4.xy;
      curRing = t4.z;
    }
    // Ring boundary (or end of range): close the current ring first.
    if (atEnd || curRing != ringId) {
      bool yc = (ringFirst.y > q.y) != (prev.y > q.y);
      if (yc) {
        float dy = prev.y - ringFirst.y;
        if (abs(dy) < 1e-12) dy = 1e-12;
        float xAt = (prev.x - ringFirst.x) * (q.y - ringFirst.y) / dy + ringFirst.x;
        if (q.x < xAt) inside = !inside;
      }
      if (inside) return true;   // inside one ring is enough (JS breaks too)
      if (atEnd) break;
      // Start the next ring.
      ringFirst = cur;
      ringId = curRing;
      prev = cur;
      continue;
    }
    // Ordinary edge prev -> cur inside the same ring.
    bool yCross = (cur.y > q.y) != (prev.y > q.y);
    if (yCross) {
      float dy = prev.y - cur.y;
      if (abs(dy) < 1e-12) dy = 1e-12;
      float xAt = (prev.x - cur.x) * (q.y - cur.y) / dy + cur.x;
      if (q.x < xAt) inside = !inside;
    }
    prev = cur;
  }
  return inside;
}

float accumulateSlabLossField(vec2 ap, float apZ, vec2 rx, float rxZ) {
  if (uSlabCount == 0) return 0.0;
  float zLo = min(apZ, rxZ);
  float zHi = max(apZ, rxZ);
  float dz = rxZ - apZ;
  vec2  d2 = rx - ap;
  float d3 = sqrt(d2.x * d2.x + d2.y * d2.y + dz * dz);
  float cosI = d3 > 1e-9 ? abs(dz) / d3 : 1.0;
  float sec = 1.0 / max(cosI, 1.0 / SLAB_SEC_CAP);
  float loss = 0.0;

  for (int s = 0; s < uSlabCount; s++) {
    vec4 sb = texelFetch(uSlabs, ivec2(s, 0), 0);
    float yM = sb.x;
    float slabDb = sb.y;
    int holeStart = int(sb.z);
    int holeCount = int(sb.w);
    if (yM <= zLo || yM >= zHi) continue;
    float t = abs(dz) > 1e-9 ? (yM - apZ) / dz : 0.0;
    vec2 cross = ap + d2 * t;
    bool bypassed = false;
    if (holeCount > 0 && pointInAnyPoly(cross, holeStart, holeCount)) bypassed = true;
    if (!bypassed) loss += slabDb * sec;
  }
  return loss;
}

float indoorLossPerM(float freqMhz) {
  if (freqMhz < 3000.0) return 0.15;
  if (freqMhz < 5925.0) return 0.25;
  return 0.35;
}

float pathLossDbField(float d, float freqMhz) {
  float dEff = max(d, 0.5);
  return 20.0 * log(dEff)/log(10.0) + 20.0 * log(freqMhz)/log(10.0) - 27.55
    + indoorLossPerM(freqMhz) * dEff;
}

// Relative sector taper (≤ 0 dB) — same helper as the per-AP shader; mirrors
// sectorTaperDb in propagation.js.
float sectorTaperDb(float absOffDeg, float halfBwDeg) {
  if (absOffDeg <= halfBwDeg) return 0.0;
  if (absOffDeg >= halfBwDeg + DIRECTIONAL_EDGE_DEG) return -DIRECTIONAL_BACK_DB;
  return -DIRECTIONAL_BACK_DB * (absOffDeg - halfBwDeg) / DIRECTIONAL_EDGE_DEG;
}

// Per-AP gain at the fragment. apMode: 0 omni, 1 directional. azimuth/beamwidth
// /tilt only consulted when mode=1; matches apGainDbi in propagation.js.
// Phase 40: sector taper applies to the vertical offset (ray elevation −
// tiltDeg) as well as the horizontal one.
float apGainAt(vec2 apPos, float apZ, vec2 target, float targetZ, int mode,
               float gainDbi, float azDeg, float bwDeg, float tiltDeg) {
  if (mode == 0) return gainDbi;
  vec2 dxy = target - apPos;
  if (abs(dxy.x) < 1e-9 && abs(dxy.y) < 1e-9) return gainDbi;
  float rayDeg = atan(dxy.y, dxy.x) * 180.0 / PI;
  float off = rayDeg - azDeg;
  off = mod(off + 540.0, 360.0) - 180.0;
  float absOff = abs(off);
  float elevDeg = atan(targetZ - apZ, length(dxy)) * 180.0 / PI;
  float vertOff = abs(elevDeg - tiltDeg);
  float halfBw = bwDeg * 0.5;
  return gainDbi + sectorTaperDb(absOff, halfBw) + sectorTaperDb(vertOff, halfBw);
}

float dbToLin(float db) { return pow(10.0, db * 0.1); }
float linToDb(float lin) { return 10.0 * log(max(lin, 1e-30)) / log(10.0); }

void main() {
  ivec2 gpx = ivec2(gl_FragCoord.xy);
  if (gpx.x >= int(uGridSize.x) || gpx.y >= int(uGridSize.y)) {
    outColor = vec4(0.0/0.0);
    return;
  }
  vec2 rx = uOriginM + vec2(float(gpx.x), float(gpx.y)) * uGridStepM;
  float rxZ = uRxZM;

  // Two-pass over APs: first pass picks best (serving) AP RSSI; we keep the
  // serving AP's frequency window so the second pass can identify co-channel
  // interferers. Both passes share the same wall/slab traversal, so we do all
  // the heavy work twice — but each fragment still saves N_AP host dispatches.
  // Computing in a single pass would need per-fragment scratch for every AP's
  // RSSI which doesn't fit in registers; the 2× is the right tradeoff.
  //
  // Output sentinels (mirror sampleField.js + aggregateApContributions):
  //   no APs     → rssi=-120 sinr=-50 snr=-50 cci=-120
  //   no co-chan → cci=-120 (caller's CCI floor)
  if (uApCount == 0) {
    outColor = vec4(-120.0, -50.0, -50.0, -120.0);
    return;
  }

  // HM-F5h cascade early-exit. We checked the coarse mask at this fragment's
  // mapped cell + 1-cell dilated neighbourhood; if everyone says "dead", the
  // free-space-only RSSI is below uCullFloorDbm everywhere in this region, so
  // the full physics result has to be too — write the empty-AP sentinel.
  if (uCascadeFactor > 0) {
    int cx = gpx.x / uCascadeFactor;
    int cy = gpx.y / uCascadeFactor;
    float alive = 0.0;
    for (int oy = -1; oy <= 1; ++oy) {
      for (int ox = -1; ox <= 1; ++ox) {
        ivec2 p = ivec2(
          clamp(cx + ox, 0, uMaskSize.x - 1),
          clamp(cy + oy, 0, uMaskSize.y - 1)
        );
        alive = max(alive, texelFetch(uMask, p, 0).r);
      }
    }
    if (alive < 0.5) {
      outColor = vec4(-120.0, -50.0, -50.0, -120.0);
      return;
    }
  }

  float bestDb = -1e6;
  int   bestIdx = -1;
  float bestFreqLo = 0.0;
  float bestFreqHi = 0.0;
  float bestBand   = 0.0;
  float bestBw     = 20.0;

  for (int k = 0; k < 4096; k++) {
    if (k >= uApCount) break;
    int base = k * 4;
    vec4 t0 = texelFetch(uAps, ivec2((base    ) % 4096, (base    ) / 4096), 0);
    vec4 t1 = texelFetch(uAps, ivec2((base + 1) % 4096, (base + 1) / 4096), 0);
    vec4 t2 = texelFetch(uAps, ivec2((base + 2) % 4096, (base + 2) / 4096), 0);
    vec4 t3 = texelFetch(uAps, ivec2((base + 3) % 4096, (base + 3) / 4096), 0);
    vec3 apPos = t0.xyz; float txDbm = t0.w;
    float centerMHz = t1.x; float antGain = t1.z; int antMode = int(t1.w);
    float azDeg = t2.x; float bwDeg = t2.y; float tiltDeg = t3.y;

    // Cull by free-space-only RSSI: txDbm + max possible gain - PL(d) < floor.
    // Clamp horizontal distance to 0.25 m before the 3D combine, matching JS
    // propagation.js (dxyDir = max(dist, 0.25)) so the AP's own cell doesn't
    // blow up path loss.
    vec2 dxy = rx - apPos.xy;
    float dxyDir = max(length(dxy), 0.25);
    float dz = apPos.z - rxZ;
    float dDir = sqrt(dxyDir*dxyDir + dz*dz);
    float fsBest = txDbm + antGain + uRxGainDbi - pathLossDbField(dDir, centerMHz);
    if (fsBest < uCullFloorDbm) continue;

    float fOver24 = (centerMHz / 1000.0) / 2.4;
    float wallLoss = accumulateWallLossField(apPos.xy, apPos.z, rx, rxZ, fOver24);
    float slabLoss = accumulateSlabLossField(apPos.xy, apPos.z, rx, rxZ);
    float gain = apGainAt(apPos.xy, apPos.z, rx, rxZ, antMode, antGain, azDeg, bwDeg, tiltDeg);
    float pl = pathLossDbField(dDir, centerMHz) + wallLoss + slabLoss;
    float rxDb = txDbm + gain + uRxGainDbi - pl;

    if (rxDb > bestDb) {
      bestDb = rxDb;
      bestIdx = k;
      bestFreqLo = t2.z;
      bestFreqHi = t2.w;
      bestBand = t3.x;
      bestBw = t1.y;
    }
  }

  if (bestIdx < 0) {
    // Every AP got culled by uCullFloorDbm — nothing to serve. Use floor
    // values; CCI is also -120 by definition (no interferers either).
    outColor = vec4(-120.0, -50.0, -50.0, -120.0);
    return;
  }

  // RSSI-only fast path. Skip the per-fragment co-channel AP loop entirely —
  // the second loop re-runs wall DDA for every same-band AP and is the
  // dominant cost in scenes where most APs share a band. CCI/SINR get
  // sentinel values; the host only routes this output to the RSSI/SNR
  // colormap during drag, then re-renders full quality on dragend.
  // Widen the noise floor for the serving AP's channel bandwidth: a 160 MHz
  // receiver admits ~9 dB more thermal noise than 20 MHz. 10·log10(W/20).
  // Mirrors widthNoiseDelta in channelWidths.js / propagation.js.
  float effNoiseDbm = uNoiseDbm + 10.0 * log(bestBw / 20.0) / log(10.0);

  if (uRssiOnly == 1) {
    float snrDbFast = bestDb - effNoiseDbm;
    outColor = vec4(bestDb, -50.0, snrDbFast, -120.0);
    return;
  }

  float cciLin = 0.0;
  for (int k = 0; k < 4096; k++) {
    if (k >= uApCount) break;
    if (k == bestIdx) continue;
    int base = k * 4;
    vec4 t0 = texelFetch(uAps, ivec2((base    ) % 4096, (base    ) / 4096), 0);
    vec4 t1 = texelFetch(uAps, ivec2((base + 1) % 4096, (base + 1) / 4096), 0);
    vec4 t2 = texelFetch(uAps, ivec2((base + 2) % 4096, (base + 2) / 4096), 0);
    vec4 t3 = texelFetch(uAps, ivec2((base + 3) % 4096, (base + 3) / 4096), 0);
    // Co-channel test: same band AND occupied-MHz windows intersect.
    if (t3.x != bestBand) continue;
    float loA = t2.z, hiA = t2.w;
    if (loA >= bestFreqHi || hiA <= bestFreqLo) continue;

    vec3 apPos = t0.xyz; float txDbm = t0.w;
    float centerMHz = t1.x; float antGain = t1.z; int antMode = int(t1.w);
    float azDeg = t2.x; float bwDeg = t2.y; float tiltDeg = t3.y;

    vec2 dxy = rx - apPos.xy;
    float dxyDir = max(length(dxy), 0.25);
    float dz = apPos.z - rxZ;
    float dDir = sqrt(dxyDir*dxyDir + dz*dz);
    float fsBest = txDbm + antGain + uRxGainDbi - pathLossDbField(dDir, centerMHz);
    if (fsBest < uCullFloorDbm) continue;

    float fOver24 = (centerMHz / 1000.0) / 2.4;
    float wallLoss = accumulateWallLossField(apPos.xy, apPos.z, rx, rxZ, fOver24);
    float slabLoss = accumulateSlabLossField(apPos.xy, apPos.z, rx, rxZ);
    float gain = apGainAt(apPos.xy, apPos.z, rx, rxZ, antMode, antGain, azDeg, bwDeg, tiltDeg);
    float pl = pathLossDbField(dDir, centerMHz) + wallLoss + slabLoss;
    float rxDb = txDbm + gain + uRxGainDbi - pl;

    cciLin += dbToLin(rxDb);
  }

  float noiseLin = dbToLin(effNoiseDbm);
  float sinrDb = bestDb - linToDb(noiseLin + cciLin);
  float snrDb  = bestDb - effNoiseDbm;
  float cciDbm = cciLin > 0.0 ? linToDb(cciLin) : -120.0;
  outColor = vec4(bestDb, sinrDb, snrDb, cciDbm);
}`

// HM-F5h coarse mask. Skips wall DDA / slab loss entirely and only does the
// free-space-RSSI cull check across all APs at a coarse cell. Output is R8:
// 1.0 = at least one AP could conceivably reach this cell, 0.0 = all APs
// would be culled by the fine pass anyway. Fine pass reads this and skips
// any fragment whose mask cell (after 1-cell dilation) is dead.
//
// We deliberately use the same uCullFloorDbm threshold as the fine pass so
// no live-region fragment is wrongly killed: free-space RSSI is an upper
// bound (walls / slabs only attenuate further), so if FS-only is below the
// floor, the full physics result is always below too. This makes the cull
// numerically exact, no false negatives.
const FS_FIELD_COARSE = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uGridSize;        // coarse (nx, ny)
uniform vec2 uOriginM;
uniform float uGridStepM;      // coarse step (= fine step × cascade factor)
uniform float uRxZM;
uniform float uRxGainDbi;
uniform float uCullFloorDbm;

uniform sampler2D uAps;
uniform int uApCount;

float indoorLossPerM(float freqMhz) {
  if (freqMhz < 3000.0) return 0.15;
  if (freqMhz < 5925.0) return 0.25;
  return 0.35;
}

float pathLossDbField(float d, float freqMhz) {
  float dEff = max(d, 0.5);
  return 20.0 * log(dEff)/log(10.0) + 20.0 * log(freqMhz)/log(10.0) - 27.55
    + indoorLossPerM(freqMhz) * dEff;
}

void main() {
  ivec2 gpx = ivec2(gl_FragCoord.xy);
  if (gpx.x >= int(uGridSize.x) || gpx.y >= int(uGridSize.y)) {
    outColor = vec4(0.0);
    return;
  }
  vec2 rx = uOriginM + vec2(float(gpx.x), float(gpx.y)) * uGridStepM;
  float rxZ = uRxZM;

  for (int k = 0; k < 4096; k++) {
    if (k >= uApCount) break;
    int base = k * 4;
    vec4 t0 = texelFetch(uAps, ivec2((base    ) % 4096, (base    ) / 4096), 0);
    vec4 t1 = texelFetch(uAps, ivec2((base + 1) % 4096, (base + 1) / 4096), 0);
    vec3 apPos = t0.xyz; float txDbm = t0.w;
    float centerMHz = t1.x; float antGain = t1.z;

    vec2 dxy = rx - apPos.xy;
    float dz = apPos.z - rxZ;
    float dDir = sqrt(dxy.x*dxy.x + dxy.y*dxy.y + dz*dz);
    float fsBest = txDbm + antGain + uRxGainDbi - pathLossDbField(dDir, centerMHz);
    if (fsBest >= uCullFloorDbm) {
      outColor = vec4(1.0);
      return;
    }
  }
  outColor = vec4(0.0);
}`

// HM-F5j: LOS bake. For one AP and a fragment grid, write R8 1/0 indicating
// whether the AP→rx ray crosses any wall (with the same Z filter the runtime
// uses). Geometry-only — no Friis, no slab, no antenna gain. Stops on first
// confirmed hit, so the DDA cost is amortised down to "average walls visited
// before the first crossing", typically a small constant.
//
// The output sampler is later read by FS via `texelFetch(uLosTex, gpx)` —
// gpx is the same `ivec2(gl_FragCoord.xy)` that produced this texel during
// bake, so the (cell ↔ texel) mapping is the identity. No bilinear lookup
// needed; nearest filtering is the only sane mode.
const FS_LOS = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uGridSize;
uniform vec2 uOriginM;
uniform float uGridStepM;

uniform vec3 uApPos;
uniform float uRxZM;

uniform sampler2D uWalls;
uniform int uWallCount;

uniform sampler2D uGridIdx;
uniform sampler2D uGridList;
uniform ivec2 uGridDims;
uniform float uGridCellM;
uniform vec2  uGridOriginM;
uniform int   uGridListWidth;

const float SEG_HIT_EPS = 1e-6;

vec2 segSegIntersect(vec2 p1, vec2 p2, vec2 p3, vec2 p4) {
  vec2 d1 = p2 - p1;
  vec2 d2 = p4 - p3;
  float denom = d1.x * d2.y - d1.y * d2.x;
  if (abs(denom) < 1e-12) return vec2(0.0, 0.0);
  vec2 r = p1 - p3;
  float t = (d2.x * r.y - d2.y * r.x) / denom;
  float u = (d1.x * r.y - d1.y * r.x) / denom;
  if (t < 0.0 || t > 1.0 + SEG_HIT_EPS) return vec2(0.0, 0.0);
  if (u < -SEG_HIT_EPS || u > 1.0 + SEG_HIT_EPS) return vec2(0.0, 0.0);
  return vec2(1.0, t);
}

void readWall(int w, out vec2 a, out vec2 b, out float zLo, out float zHi) {
  int t0 = w * 4;
  int t1 = t0 + 1;
  ivec2 p0 = ivec2(t0 % 4096, t0 / 4096);
  ivec2 p1 = ivec2(t1 % 4096, t1 / 4096);
  vec4 e0 = texelFetch(uWalls, p0, 0);
  vec4 e1 = texelFetch(uWalls, p1, 0);
  a = e0.xy;  b = e0.zw;
  zLo = e1.y; zHi = e1.z;
}

// Did this wall block the AP→rx ray (segment hit + Z filter)?
bool wallBlocks(int w, vec2 ap, float apZ, vec2 rx, float rxZ) {
  vec2 a, b;
  float zLo, zHi;
  readWall(w, a, b, zLo, zHi);
  vec2 hit = segSegIntersect(ap, rx, a, b);
  if (hit.x < 0.5) return false;
  float zAt = apZ + (rxZ - apZ) * hit.y;
  return zAt >= zLo && zAt <= zHi;
}

void readGridCell(int cx, int cy, out int start, out int count) {
  if (cx < 0 || cy < 0 || cx >= uGridDims.x || cy >= uGridDims.y) {
    start = 0; count = 0; return;
  }
  vec4 idx = texelFetch(uGridIdx, ivec2(cx, cy), 0);
  start = int(idx.x);
  count = int(idx.y);
}

int readGridWallIdx(int i) {
  ivec2 p = ivec2(i % uGridListWidth, i / uGridListWidth);
  return int(texelFetch(uGridList, p, 0).r);
}

const int SEEN_BUF = 16;

// Brute-force fallback (no grid). Returns true when any wall blocks the ray.
bool anyBlockBrute(vec2 ap, float apZ, vec2 rx, float rxZ) {
  for (int w = 0; w < uWallCount; w++) {
    if (wallBlocks(w, ap, apZ, rx, rxZ)) return true;
  }
  return false;
}

// Grid-accelerated DDA early-out scan. Same SEEN_BUF cyclic dedup as the
// runtime accumulators so wall straddling between cells doesn't double-trip
// (or rather, doesn't waste work re-checking the same wall). Returns on the
// first confirmed hit — most LOS=0 cells exit after touching a single wall.
bool anyBlockGrid(vec2 ap, float apZ, vec2 rx, float rxZ) {
  vec2 apG = (ap - uGridOriginM) / uGridCellM;
  vec2 rxG = (rx - uGridOriginM) / uGridCellM;

  int cx = int(floor(apG.x));
  int cy = int(floor(apG.y));
  int cxEnd = int(floor(rxG.x));
  int cyEnd = int(floor(rxG.y));

  vec2 d = rxG - apG;
  float dx = d.x;
  float dy = d.y;
  int stepX = dx > 0.0 ? 1 : (dx < 0.0 ? -1 : 0);
  int stepY = dy > 0.0 ? 1 : (dy < 0.0 ? -1 : 0);

  float tMaxX = 1e30;
  float tDeltaX = 1e30;
  if (stepX != 0) {
    float nextX = stepX > 0 ? float(cx + 1) : float(cx);
    tMaxX = (nextX - apG.x) / dx;
    tDeltaX = abs(1.0 / dx);
  }
  float tMaxY = 1e30;
  float tDeltaY = 1e30;
  if (stepY != 0) {
    float nextY = stepY > 0 ? float(cy + 1) : float(cy);
    tMaxY = (nextY - apG.y) / dy;
    tDeltaY = abs(1.0 / dy);
  }

  int seenBuf[SEEN_BUF];
  for (int j = 0; j < SEEN_BUF; j++) seenBuf[j] = -1;
  int seenWritePos = 0;

  float tCur = 0.0;
  // 53-G3 (P1-9): bound the walk by the ACTUAL cell distance this ray travels,
  // not by the grid diagonal. The walk starts at the AP cell, which may sit far
  // outside the wall-AABB grid -- the comment above says the ray legitimately
  // enters mid-walk -- so (nGx + nGy + 4) steps could burn out before reaching
  // the wall-bearing cells at all. Measured case: 60 walls packed into a
  // 21x21 m corner office (cellM 2.71, nGx=nGy=8, so maxSteps was 20) with the
  // AP 60 m away, about 22 cells out: the ray was cut at i=20 and reported ZERO
  // wall loss while the JS engine attenuated correctly. Manhattan span
  // start->end is exactly how many x plus y cell boundaries a DDA crosses, so
  // this bound is tight rather than merely larger.
  int maxSteps = abs(cxEnd - cx) + abs(cyEnd - cy) + 4;
  for (int i = 0; i < 4096; i++) {
    if (i >= maxSteps) break;
    int start, count;
    readGridCell(cx, cy, start, count);
    for (int k = 0; k < count; k++) {
      int wIdx = readGridWallIdx(start + k);
      bool dup = false;
      for (int j = 0; j < SEEN_BUF; j++) {
        if (seenBuf[j] == wIdx) { dup = true; break; }
      }
      if (dup) continue;
      seenBuf[seenWritePos] = wIdx;
      seenWritePos = (seenWritePos + 1) % SEEN_BUF;
      if (wallBlocks(wIdx, ap, apZ, rx, rxZ)) return true;
    }
    if (cx == cxEnd && cy == cyEnd) break;
    if (tMaxX < tMaxY) { tCur = tMaxX; tMaxX += tDeltaX; cx += stepX; }
    else               { tCur = tMaxY; tMaxY += tDeltaY; cy += stepY; }
    if (tCur > 1.0) break;
  }
  return false;
}

void main() {
  ivec2 gpx = ivec2(gl_FragCoord.xy);
  if (gpx.x >= int(uGridSize.x) || gpx.y >= int(uGridSize.y)) {
    outColor = vec4(0.0);
    return;
  }
  vec2 rx = uOriginM + vec2(float(gpx.x), float(gpx.y)) * uGridStepM;
  float rxZ = uRxZM;

  bool blocked = uGridDims.x == 0
    ? anyBlockBrute(uApPos.xy, uApPos.z, rx, rxZ)
    : anyBlockGrid(uApPos.xy, uApPos.z, rx, rxZ);

  // R8 unsigned-byte target: write 1.0 (→ 255) for clear LOS, 0.0 for blocked.
  outColor = vec4(blocked ? 0.0 : 1.0);
}`

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error('Propagation shader compile failed: ' + log)
  }
  return sh
}

function link(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc)
  const prog = gl.createProgram()
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.bindAttribLocation(prog, 0, 'aPos')
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog)
    gl.deleteProgram(prog)
    throw new Error('Propagation program link failed: ' + log)
  }
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  return prog
}

// Provide a GL2 context. In Node we accept an injected one (headless-gl style)
// for the diff harness. Browsers create a fresh one per instance.
function defaultContext() {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  return canvas.getContext('webgl2', {
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    antialias: false,
    alpha: true,
  })
}

export function createPropagationGL({ gl: injectedGl } = {}) {
  const gl = injectedGl || defaultContext()
  if (!gl) throw new Error('WebGL2 not available')
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('EXT_color_buffer_float not supported')
  }

  const prog = link(gl, VS, FS)
  const progField = link(gl, VS, FS_FIELD)
  // HM-F5h coarse-pass program. Lazily linked because most callers never
  // trigger cascade (small scenes), but cheap enough to compile up-front.
  const progFieldCoarse = link(gl, VS, FS_FIELD_COARSE)
  // HM-F5j: LOS bake program — one R8 pass per AP, results cached across
  // frames. Compiled up-front because every refl/diff render uses it.
  const progLos = link(gl, VS, FS_LOS)

  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
     1, -1,  1,  1,  -1, 1,
  ]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)

  // Per-size render-target caches. The drag path (≥1.0 m), the idle coarse
  // stage (1.0 m) and the idle fine stage (user step, default 0.5 m) all
  // render at different grid sizes. With one mutable target per output, every
  // stage switch re-allocated the texture and re-ran checkFramebufferStatus —
  // a forced GPU-pipeline sync that profiled as ~0.5 s of long-task time
  // across a 300-AP drag on a software renderer. One target PER SIZE makes
  // stage switches free: allocation + completeness check run once per size,
  // then every later ensure() is a Map hit. Sizes in practice are 2-3 per
  // floor; the LRU cap only guards floor-resize churn.
  const SIZED_TARGET_CAP = 6
  function makeSizedTargets(label, internalFormat, format, type) {
    const bySize = new Map()   // 'nx,ny' -> { tex, fbo, lastUse }
    let useCounter = 0
    const ensure = (nx, ny) => {
      const key = nx + ',' + ny
      let e = bySize.get(key)
      if (!e) {
        const tex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, nx, ny, 0, format, type, null)
        const fbo = gl.createFramebuffer()
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(`${label} FBO incomplete`)
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        e = { tex, fbo, lastUse: 0 }
        bySize.set(key, e)
        if (bySize.size > SIZED_TARGET_CAP) {
          let oldestKey = null, oldestUse = Infinity
          for (const [k, v] of bySize) {
            if (v.lastUse < oldestUse) { oldestUse = v.lastUse; oldestKey = k }
          }
          const old = bySize.get(oldestKey)
          gl.deleteTexture(old.tex)
          gl.deleteFramebuffer(old.fbo)
          bySize.delete(oldestKey)
        }
      }
      e.lastUse = ++useCounter
      return e
    }
    const dispose = () => {
      for (const e of bySize.values()) {
        gl.deleteTexture(e.tex)
        gl.deleteFramebuffer(e.fbo)
      }
      bySize.clear()
    }
    return { ensure, dispose }
  }

  // R32F per-AP output target (one render per AP).
  const outTargets = makeSizedTargets('output', gl.R32F, gl.RED, gl.FLOAT)
  // HM-F5g: aggregated 4-channel output target (rssi, sinr, snr, cci) —
  // sampled once at end of renderField.
  const outFieldTargets = makeSizedTargets('field output', gl.RGBA32F, gl.RGBA, gl.FLOAT)
  // HM-F5h cascade mask: R8 alive/dead at coarse resolution. R8 (not R32F) so
  // the upload doesn't need EXT_color_buffer_float for *this* attachment —
  // R8 is universally renderable in WebGL2.
  const maskTargets = makeSizedTargets('mask', gl.R8, gl.RED, gl.UNSIGNED_BYTE)
  // Placeholder bound as the uMask sampler when cascade is off, so the unit
  // stays texture-complete. Shader gates on uCascadeFactor before fetching,
  // so this 1×1 zero is never read for output, only there to satisfy WebGL2
  // sampler validation.
  const maskPlaceholderTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, maskPlaceholderTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]))

  // Walls texture is reused across all AP renders within a frame. We pack
  // walls into a 4096-wide RGBA32F image and reupload only when the wall list
  // changes. Same for slabs and hole polygons.
  const wallsTex   = gl.createTexture()
  const slabsTex   = gl.createTexture()
  const holePolyTex = gl.createTexture()
  // F5b acceleration grid textures.
  const gridIdxTex  = gl.createTexture()
  const gridListTex = gl.createTexture()
  // HM-F5c step 3: corner texture for knife-edge diffraction. One (x, y, 0, 0)
  // texel per corner; reuploaded alongside walls.
  const cornersTex  = gl.createTexture()
  let cornerCount = 0
  // HM-F5g: AP texture (4 RGBA32F texels per AP).
  const apsTex = gl.createTexture()
  let apCount = 0

  // HM-F5j: LOS field cache. Each AP gets its own R8 texture sized to the
  // sample grid; we recompute only when geometry changes (walls update or
  // the AP itself moves). `wallsVersion` is bumped in uploadWalls and acts
  // as a cache-bust signature — any dependent entry whose hash references
  // the prior version is treated as stale and rebaked.
  // Cache shape: Map<apKey, { tex, fbo, hash, nx, ny }>
  // Hash signature combines per-AP geometry (pos x/y/z) with per-frame grid
  // params (rxZM, gridStepM, originX, originY, nx, ny, wallsVersion).
  // 1×1 placeholder so the FS sampler binding stays valid even when the
  // host hasn't called bakeLos (LOS feature is opt-in via opts.losEnabled).
  const losPlaceholderTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, losPlaceholderTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]))

  const losCache = new Map()
  let wallsVersion = 0
  // 任務 2 (C): content signature of the last uploaded wall set. uploadWalls is
  // called every sampleFieldGL frame, but the walls usually haven't changed
  // (AP drag, viewport, mode toggle). Skipping the re-upload + buildGrid + cache
  // bust on an unchanged wall set is what lets losCache / apGeoCache /
  // outGridCache actually survive across frames — without this they were
  // cleared and rebuilt every frame (a latent miss-every-time bug). null forces
  // the first call to run.
  let wallsSig = null
  let cornersSig = null
  // 53-G2 (E2): same purpose for slabs / floor-hole polygons.
  let slabsSig = null

  // HM-F5k: per-AP precomputed corner / wall geometry cache. Mirrors losCache
  // semantics — invalidated when walls change (uploadWalls bumps
  // wallsVersion) or when the AP itself moves (hash includes pos).
  // Cache shape: Map<apKey, { cornersTex, mirrorTex, hash, cornerCount, wallCount }>
  // The textures are owned by the cache; callers must not delete them.
  const apGeoCache = new Map()

  // 任務 2 (C): per-AP output-grid cache. renderAp's biggest cost is the
  // drawArrays + readPixels round-trip (a GPU→CPU sync stall, expensive on
  // SwiftShader); the JS custom-pattern path is an nx×ny rssiFromAp loop. Both
  // produce a Float32Array that only depends on that AP's inputs + the shared
  // geometry. When one AP is dragged the other N-1 APs are unchanged, so their
  // grids can be reused verbatim instead of re-rendered.
  //
  // The cache stores final per-AP grids keyed by a host-supplied hash. The
  // host (sampleFieldGL) owns the hash because it sees every input (AP fields,
  // grid params, opts, custom patternId); we own the container + invalidation
  // so it stays in lockstep with losCache/apGeoCache — any uploadWalls /
  // uploadCorners bumps wallsVersion and clears all three. Callers must include
  // wallsVersion (via getWallsVersion) in their hash so a wall edit that races
  // a cache write can't leave a stale entry. Cache shape:
  //   Map<apKey, { grid: Float32Array, hash, nx, ny }>
  const outGridCache = new Map()
  function getWallsVersion() { return wallsVersion }
  function getCachedGrid(apKey, hash) {
    const e = outGridCache.get(apKey)
    return (e && e.hash === hash) ? e : null
  }
  function setCachedGrid(apKey, hash, grid, nx, ny) {
    // Store a copy — renderAp returns a fresh array per call today, but copying
    // is cheap insurance against any future buffer reuse leaking a mutation
    // into the cache. The grid is read-only from the cache's perspective.
    outGridCache.set(apKey, { grid: grid.slice(), hash, nx, ny })
  }

  // 1×1 placeholder so the FS sampler bindings stay valid even when host
  // didn't bake (uApGeoEnabled=0 then short-circuits all reads).
  const apGeoPlaceholderTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, apGeoPlaceholderTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4))

  for (const t of [wallsTex, slabsTex, holePolyTex, gridIdxTex, gridListTex, cornersTex, apsTex]) {
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }
  // Grid metadata captured by uploadWalls and consumed in renderAp.
  let gridDimsX = 0, gridDimsY = 0, gridCellM = 1, gridOriginX = 0, gridOriginY = 0, gridListWidth = 1
  // HM-F5k: host-side snapshots of walls / corners so the AP→corner +
  // AP→wall-mirror bake can run on CPU without re-reading texture data. We
  // only stash a light view (endpoint coords + index) — full material data
  // is irrelevant for the bake (it's purely geometric).
  let bakeWalls = []   // [{ ax, ay, bx, by }] — same indices as wallsTex
  let bakeCorners = [] // [{ x, y }] — same indices as cornersTex

  function pack4096(values, valuesPerTexel = 4) {
    const totalTexels = Math.max(1, Math.ceil(values.length / valuesPerTexel))
    const w = Math.min(4096, totalTexels)
    const h = Math.ceil(totalTexels / 4096)
    const data = new Float32Array(w * h * 4)
    data.set(values)
    return { data, w, h }
  }

  // 任務 2 (C): FNV-1a over a Float32Array's raw bytes. Used as a cheap content
  // signature to skip redundant wall/corner re-uploads (and the cache busts
  // they trigger) when the geometry is unchanged across frames.
  function fnv32(f32) {
    const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
    let h = 0x811c9dc5
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
    }
    return h.toString(16)
  }

  // walls: array of { a:{x,y}, b:{x,y}, lossDb, lossB, zLoM, zHiM, itu, roughnessM }
  // Packs 4 texels per wall (16 floats):
  //   t0 = (ax, ay, bx, by)
  //   t1 = (lossDb, zLoM, zHiM, roughnessM)         lossDb is 2.4 GHz anchor
  //   t2 = (ituA, ituB, ituC, ituD)                 ituA<0 → metal sentinel
  //   t3 = (lossB, 0, 0, 0)                          HM-F8 frequency exponent
  // Reflection (HM-F5c step 2) uses ITU-R coefficients + roughness directly.
  // Also (re)builds the uniform-grid acceleration structure scoped to the
  // walls' AABB so the shader can DDA-walk it. opts.bbox lets the caller
  // override the grid extent when the scenario size doesn't match the wall
  // bounds (e.g. cross-floor walls extending beyond active floor).
  function uploadWalls(walls, opts = {}) {
    const flat = new Float32Array(walls.length * 16)
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]
      const o = i * 16
      flat[o     ] = w.a.x;  flat[o + 1] = w.a.y
      flat[o + 2 ] = w.b.x;  flat[o + 3] = w.b.y
      flat[o + 4 ] = w.lossDb
      flat[o + 5 ] = w.zLoM ?? -1e6
      flat[o + 6 ] = w.zHiM ??  1e6
      flat[o + 7 ] = w.roughnessM ?? 0.01
      const itu = w.itu
      if (itu && itu.metal) {
        flat[o + 8] = -1; flat[o + 9] = 0; flat[o + 10] = 0; flat[o + 11] = 0
      } else if (itu) {
        flat[o + 8] = itu.a ?? 0
        flat[o + 9] = itu.b ?? 0
        flat[o + 10] = itu.c ?? 0
        flat[o + 11] = itu.d ?? 0
      } else {
        flat[o + 8] = 0; flat[o + 9] = 0; flat[o + 10] = 0; flat[o + 11] = 0
      }
      flat[o + 12] = w.lossB ?? 0
      flat[o + 13] = 0; flat[o + 14] = 0; flat[o + 15] = 0
    }

    // 任務 2 (C): bail out when the wall content is byte-for-byte unchanged.
    // `flat` already contains every wall field the texture (and thus every
    // downstream grid) depends on, so a matching signature means the GPU
    // texture, accel grid, and all geometry caches are still valid — re-running
    // any of it would be wasted work AND would needlessly invalidate the
    // caches. opts.bbox feeds buildGrid, so fold it in too.
    const sig = fnv32(flat) + '|' + walls.length + '|' + (opts.bbox ? `${opts.bbox.minX},${opts.bbox.minY},${opts.bbox.maxX},${opts.bbox.maxY}` : '')
    if (sig === wallsSig) return
    wallsSig = sig

    bakeWalls = walls.map((w) => ({ ax: w.a.x, ay: w.a.y, bx: w.b.x, by: w.b.y }))
    const { data, w, h } = pack4096(flat)
    gl.bindTexture(gl.TEXTURE_2D, wallsTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data)

    buildGrid(walls, opts.bbox)

    // HM-F5j: any wall-list change invalidates every cached LOS field.
    // Dropping textures is cheaper than scanning entries; the next bakeLos
    // call regenerates only the APs that are actually rendered this frame.
    wallsVersion++
    for (const entry of losCache.values()) {
      gl.deleteTexture(entry.tex)
      gl.deleteFramebuffer(entry.fbo)
    }
    losCache.clear()
    // HM-F5k: same semantics for the AP→corner / AP→wall-mirror cache.
    // Wall geometry feeds into both d1/geomLos (needs wall segments for
    // intersection tests) and apImg (mirrorPoint depends on the wall line),
    // so any wall edit must invalidate every entry.
    for (const entry of apGeoCache.values()) {
      gl.deleteTexture(entry.cornersTex)
      gl.deleteTexture(entry.mirrorTex)
    }
    apGeoCache.clear()
    // 任務 2 (C): walls feed every per-AP grid (wall penetration + refl/diff),
    // so a wall edit invalidates the whole output-grid cache too. Just plain
    // Float32Arrays — no GL handles to delete.
    outGridCache.clear()
  }

  // HM-F5g: pack APs into a 4-texel-per-AP RGBA32F image. Layout matches the
  // FS_FIELD shader's expectations exactly:
  //   t0 = (x, y, zM, txDbm)
  //   t1 = (centerMHz, channelWidthMHz, antGainDbi, antMode)
  //          antMode 0 = omni, 1 = directional. Custom-pattern APs must be
  //          rejected at the host (sampleFieldGL falls back to renderAp), so
  //          they should never reach here — but if one does we encode it as 0
  //          (omni) to avoid producing garbage; the host fallback is
  //          authoritative.
  //   t2 = (azimuthDeg, beamwidthDeg, freqLoMHz, freqHiMHz)
  //   t3 = (band, tiltDeg, _, _)
  //          band 1=2.4 GHz, 2=5 GHz, 3=6 GHz; cross-band APs never co-channel.
  //          tiltDeg = boresight elevation (+up, Phase 40).
  function uploadAps(apList) {
    apCount = apList?.length ?? 0
    const totalTexels = Math.max(1, apCount * 4)
    const tw = Math.min(4096, totalTexels)
    const th = Math.ceil(totalTexels / 4096)
    const data = new Float32Array(tw * th * 4)
    for (let i = 0; i < apCount; i++) {
      const ap = apList[i]
      const o = i * 16
      const cx = ap.pos.x, cy = ap.pos.y, cz = ap.zM ?? 0
      data[o     ] = cx;  data[o + 1] = cy;  data[o + 2] = cz;  data[o + 3] = ap.txDbm
      const centerMHz = ap.centerMHz || 5190
      const bwMHz = ap.channelWidth || 20
      const gainDbi = ap._antGainDbi ?? 0
      const mode = ap.antennaMode === 'directional' ? 1 : 0
      data[o + 4] = centerMHz
      data[o + 5] = bwMHz
      data[o + 6] = gainDbi
      data[o + 7] = mode
      data[o + 8 ] = ap.azimuthDeg ?? 0
      data[o + 9 ] = ap.beamwidthDeg ?? 60
      data[o + 10] = centerMHz - bwMHz * 0.5
      data[o + 11] = centerMHz + bwMHz * 0.5
      // Band code = 1/2/3 for 2.4/5/6 GHz (matches buildScenario's ap.frequency
      // values 2.4 / 5 / 6). 0 sentinel = unknown so cross-band test still works.
      const f = ap.frequency
      const band = f === 2.4 ? 1 : f === 5 ? 2 : f === 6 ? 3 : 0
      data[o + 12] = band
      data[o + 13] = ap.tiltDeg ?? 0
    }
    gl.bindTexture(gl.TEXTURE_2D, apsTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, tw, th, 0, gl.RGBA, gl.FLOAT, data)
  }

  // HM-F5c step 3: pack corner points (wall segment endpoints) into a 4096-
  // wide RGBA32F texture for the diffraction loop. One (x, y, 0, 0) texel per
  // corner. Empty list still uploads a 1×1 placeholder so the sampler binding
  // stays valid; uCornerCount = 0 makes the shader skip the loop entirely.
  function uploadCorners(corners) {
    const n = corners?.length ?? 0
    const totalTexels = Math.max(1, n)
    const tw = Math.min(4096, totalTexels)
    const th = Math.ceil(totalTexels / 4096)
    const data = new Float32Array(tw * th * 4)
    for (let i = 0; i < n; i++) {
      const c = corners[i]
      data[i * 4    ] = c.x
      data[i * 4 + 1] = c.y
    }

    // 任務 2 (C): skip the re-upload + apGeo/outGrid invalidation when the
    // corner set is unchanged (same reason as uploadWalls — called every frame
    // but corners rarely move). `data` holds every corner coordinate.
    const sig = fnv32(data) + '|' + n
    if (sig === cornersSig) return
    cornersSig = sig

    cornerCount = n
    bakeCorners = (corners ?? []).map((c) => ({ x: c.x, y: c.y }))
    gl.bindTexture(gl.TEXTURE_2D, cornersTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, tw, th, 0, gl.RGBA, gl.FLOAT, data)
    // HM-F5k: corner topology is a per-AP cache key dimension (same AP, more
    // corners → larger texture); invalidate so the next bake resizes.
    for (const entry of apGeoCache.values()) {
      gl.deleteTexture(entry.cornersTex)
      gl.deleteTexture(entry.mirrorTex)
    }
    apGeoCache.clear()
    // 任務 2 (C): corners feed diffraction, so a corner change alters per-AP
    // grids when enableDiffraction is on. wallsVersion is NOT bumped here (that
    // would wrongly invalidate losCache, which depends only on walls), so we
    // clear the output-grid cache directly instead.
    outGridCache.clear()
  }

  // Build the uniform acceleration grid:
  //   - decide cell size + dimensions to keep both nGx*nGy and total wall-cell
  //     entries below WebGL2 texture limits while staying useful (~1 m cell)
  //   - rasterise each wall's segment AABB into cells (Amanatides-Woo on the
  //     wall, then dilate ±1 cell to cover endpoints near cell boundaries)
  //   - emit two textures: gridIdxTex (RGBA32F, nGx*nGy, .xy = start/count)
  //     and gridListTex (R32F, flat wall-index list, packed 4096-wide)
  // For zero walls or scenes where the grid would be a single cell, skip and
  // fall back to brute force (uGridDims.x = 0 sentinel in shader).
  function buildGrid(walls, bbox) {
    if (!walls || walls.length === 0) {
      gridDimsX = 0
      gridDimsY = 0
      // Bind 1×1 placeholders so shader sampler2D bindings stay valid.
      gl.bindTexture(gl.TEXTURE_2D, gridIdxTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4))
      gl.bindTexture(gl.TEXTURE_2D, gridListTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array(1))
      gridListWidth = 1
      return
    }

    // Compute bbox of all walls (or honour caller override).
    let minX, minY, maxX, maxY
    if (bbox) {
      ;[minX, minY, maxX, maxY] = bbox
    } else {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity
      for (const w of walls) {
        if (w.a.x < minX) minX = w.a.x; if (w.a.y < minY) minY = w.a.y
        if (w.a.x > maxX) maxX = w.a.x; if (w.a.y > maxY) maxY = w.a.y
        if (w.b.x < minX) minX = w.b.x; if (w.b.y < minY) minY = w.b.y
        if (w.b.x > maxX) maxX = w.b.x; if (w.b.y > maxY) maxY = w.b.y
      }
    }
    // Grow by a small margin so cells cover endpoints exactly on the AABB edge.
    const margin = 0.5
    minX -= margin; minY -= margin; maxX += margin; maxY += margin
    const spanX = Math.max(0.1, maxX - minX)
    const spanY = Math.max(0.1, maxY - minY)

    // Pick cell size: target ≈√(spanX·spanY / N) so total cells ≈ N (one cell
    // per wall on average), bounded to [0.5, 4] m so cell size matches typical
    // wall length scale and keeps DDA cost bounded.
    const targetCells = Math.max(walls.length, 16)
    const ideal = Math.sqrt((spanX * spanY) / targetCells)
    // 53-G3 (C3): cellM must be allowed to exceed the 4 m preference when the
    // extent demands it. With cellM hard-capped at 4 and nG* hard-capped at
    // 256, the grid covered at most 256 × 4 = 1024 m — and buildGrid's own
    // bucketing clamps (below) happily filed out-of-range walls into the edge
    // cells, while the shader's readGridCell returns count=0 for any cx/cy
    // outside uGridDims. So walls past 1024 m entered the list and could never
    // be read back: they applied ZERO attenuation, with the DDA deliberately
    // not bailing at the boundary. A 1500×800 m site silently lost a 476 m
    // strip, contradicting sampleField.js:21's "2 km campus" claim and
    // diverging from the JS reference, which brute-force scans every wall.
    //
    // GRID_DIM_MAX stays 256 (it bounds the idx texture and DDA step count);
    // the cell size grows instead so 256 cells always span the full extent.
    // Precision cost is real but bounded and strictly better than no
    // attenuation at all: cells get coarser, never absent.
    const GRID_DIM_MAX = 256
    const CELL_M_PREFERRED_MAX = 4
    const cellFloor = Math.max(0.5, Math.min(CELL_M_PREFERRED_MAX, ideal))
    const cellM = Math.max(
      cellFloor,
      spanX / GRID_DIM_MAX,
      spanY / GRID_DIM_MAX,
    )
    const nGx = Math.min(GRID_DIM_MAX, Math.max(1, Math.ceil(spanX / cellM)))
    const nGy = Math.min(GRID_DIM_MAX, Math.max(1, Math.ceil(spanY / cellM)))

    // First pass: bucket walls into cells via segment AABB. We rasterise each
    // wall into the cells it could possibly intersect using its 2D AABB
    // (cheap and conservative — overestimates by a factor < 2 vs. exact DDA
    // line rasterisation, but each cell's wall list is then deduped at use).
    const cells = new Array(nGx * nGy)
    for (let i = 0; i < cells.length; i++) cells[i] = []
    let totalEntries = 0
    for (let wi = 0; wi < walls.length; wi++) {
      const w = walls[wi]
      const wMinX = Math.min(w.a.x, w.b.x), wMaxX = Math.max(w.a.x, w.b.x)
      const wMinY = Math.min(w.a.y, w.b.y), wMaxY = Math.max(w.a.y, w.b.y)
      const cx0 = Math.max(0, Math.floor((wMinX - minX) / cellM))
      const cx1 = Math.min(nGx - 1, Math.floor((wMaxX - minX) / cellM))
      const cy0 = Math.max(0, Math.floor((wMinY - minY) / cellM))
      const cy1 = Math.min(nGy - 1, Math.floor((wMaxY - minY) / cellM))
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          cells[cy * nGx + cx].push(wi)
          totalEntries++
        }
      }
    }

    // Pack idx + list textures.
    const idxData = new Float32Array(nGx * nGy * 4)
    const listData = new Float32Array(Math.max(1, totalEntries))
    let cursor = 0
    for (let i = 0; i < cells.length; i++) {
      const list = cells[i]
      idxData[i * 4    ] = cursor
      idxData[i * 4 + 1] = list.length
      for (let k = 0; k < list.length; k++) listData[cursor + k] = list[k]
      cursor += list.length
    }
    gl.bindTexture(gl.TEXTURE_2D, gridIdxTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, nGx, nGy, 0, gl.RGBA, gl.FLOAT, idxData)

    const listWidth = Math.min(4096, Math.max(1, totalEntries))
    const listHeight = Math.ceil(Math.max(1, totalEntries) / listWidth)
    const padded = new Float32Array(listWidth * listHeight)
    padded.set(listData)
    gl.bindTexture(gl.TEXTURE_2D, gridListTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, listWidth, listHeight, 0, gl.RED, gl.FLOAT, padded)

    gridDimsX = nGx
    gridDimsY = nGy
    gridCellM = cellM
    gridOriginX = minX
    gridOriginY = minY
    gridListWidth = listWidth
  }

  // boundaries: [{ yM, slabDb, bypassHoles: [flatPolyArray, …] }]
  //
  // ONE slab texel per boundary: [yM, slabDb, vertStart, vertCount], where
  // (vertStart, vertCount) spans ALL of that boundary's hole vertices packed
  // back-to-back in uHolePoly. Each vertex texel is (x, y, ringId, _) — the
  // ringId lets the shader tell one polygon from the next inside a single
  // contiguous range, so it can test "is the crossing inside ANY of them"
  // exactly the way JS `accumulateSlabLoss` does.
  //
  // 53-G3 (P1-7): the previous packing expanded each (boundary × hole) pair
  // into its OWN texel, giving the first the real slabDb and the rest 0. The
  // old comment claimed that preserved JS semantics; it could not. The shader
  // judges bypass per texel, so a hit on hole #2 zeroed only its own record
  // (already 0) and left record #1 contributing the full slabDb. Result: with
  // two stairwells on one slab, only the first bypassed — measured as a
  // 61.24 dB divergence from JS across 44 cells, while a single hole matched
  // at 0.000 dB.
  function uploadSlabs(boundaries) {
    const slabRecords = []   // each: [yM, slabDb, vertStart, vertCount]
    const polyValues = []    // RGBA32F payload: (x, y, ringId, 0)

    let cursor = 0
    for (const b of boundaries) {
      const polys = b.bypassHoles ?? []
      let vertCount = 0
      for (let p = 0; p < polys.length; p++) {
        const verts = packPolyVerts(polys[p], p)
        polyValues.push(...verts)
        vertCount += polys[p].length / 2
      }
      slabRecords.push([b.yM, b.slabDb ?? 0, cursor, vertCount])
      cursor += vertCount
    }

    // ---- slabs texture ----
    const slabFlat = new Float32Array(Math.max(1, slabRecords.length) * 4)
    for (let i = 0; i < slabRecords.length; i++) {
      slabFlat[i * 4    ] = slabRecords[i][0]
      slabFlat[i * 4 + 1] = slabRecords[i][1]
      slabFlat[i * 4 + 2] = slabRecords[i][2]
      slabFlat[i * 4 + 3] = slabRecords[i][3]
    }
    const slabW = Math.max(1, slabRecords.length)

    // ---- hole polygon vertices ----
    const polyFlat = new Float32Array(Math.max(1, polyValues.length / 4) * 4)
    polyFlat.set(polyValues)
    const polyTexels = Math.max(1, polyValues.length / 4)
    const polyW = Math.min(4096, polyTexels)
    const polyH = Math.ceil(polyTexels / 4096)
    const padded = new Float32Array(polyW * polyH * 4)
    padded.set(polyFlat)

    const meta = { slabCount: Math.max(1, slabRecords.length) === 1 && slabRecords.length === 0 ? 0 : slabRecords.length, polyLen: polyTexels }

    // 53-G2 (E2): skip the re-upload AND clear the output-grid cache when the
    // slab content changes — same shape as uploadWalls:2203 / uploadCorners:2304.
    // Those two clear outGridCache; slabs did not, which was the SECOND of two
    // independent holes that let a FloorHole edit leave the heatmap untouched
    // (the first being the missing bypassHoles in sampleFieldGL's geomSig).
    // Fixing only one of the two changes nothing — both gates had to open.
    //
    // Signature is fnv32 over the actual uploaded bytes plus the texture dims,
    // which is the strongest form available here: it cannot miss a field,
    // because a field that doesn't reach these arrays doesn't reach the shader
    // either. Note the early return is AFTER `meta` is computed — callers use
    // the return value every frame, so it must not depend on the cache state.
    const sig = fnv32(slabFlat) + '|' + fnv32(padded) + '|' + slabW + '|' + polyW + 'x' + polyH
    if (sig === slabsSig) return meta
    slabsSig = sig

    gl.bindTexture(gl.TEXTURE_2D, slabsTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, slabW, 1, 0, gl.RGBA, gl.FLOAT, slabFlat)
    gl.bindTexture(gl.TEXTURE_2D, holePolyTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, polyW, polyH, 0, gl.RGBA, gl.FLOAT, padded)

    // Slabs feed the cross-floor leg and the hole bypass of every per-AP grid.
    // wallsVersion is NOT bumped (that would wrongly flush losCache, which
    // depends only on walls), so clear the output-grid cache directly.
    outGridCache.clear()

    return meta
  }

  function packPolyVerts(flatXY, ringId = 0) {
    // flatXY = [x, y, x, y, …] in metres. Pack each vertex into one RGBA32F
    // texel as (x, y, ringId, 0). 53-G3: ringId marks which polygon of the
    // boundary this vertex belongs to, so several rings can share one
    // contiguous range and the shader can still close each ring correctly.
    const out = []
    for (let i = 0; i < flatXY.length; i += 2) out.push(flatXY[i], flatXY[i + 1], ringId, 0)
    return out
  }

  // Force-disable the grid traversal in shader (bench / debug parity check).
  // When false, the shader takes the brute-force per-wall loop path.
  let useGrid = true
  function setUseGrid(v) { useGrid = !!v }

  // HM-F5j: bake one AP's LOS grid into an R8 texture, returning the texture
  // (and its size, for sampler binding). Cache key is the geometry signature:
  // moving the AP rebuilds only that entry, walls changing flushes everything
  // (handled by uploadWalls). Caller MUST have already called uploadWalls so
  // wallsTex / grid acceleration are populated.
  //
  // The returned object's `tex` is owned by the cache — callers must not
  // delete it. It stays alive until either uploadWalls or dispose() runs.
  function bakeLosOne(ap, apKey, gridStepM, originM, rxZM, nx, ny) {
    const apX = ap.pos.x, apY = ap.pos.y, apZ = ap.zM ?? 0
    // Hash uses fp32 bit patterns to detect any change — including cell-grid
    // resize, padding adjustments, AP elevation changes during multi-floor
    // toggles. Bake is geometry-only so antenna gain / channel changes are
    // legitimately ignored (LOS depends on rays, not radio).
    const hash = `${apX},${apY},${apZ},${gridStepM},${originM.x},${originM.y},${nx},${ny},${rxZM},${wallsVersion}`
    // Grid size is part of the CACHE KEY, not just the hash: the idle coarse
    // stage (1.0 m) and fine stage (0.5 m) alternate every recompute, and a
    // per-AP-only key made them evict each other's texture — 2×N texture
    // reallocs (each with a checkFramebufferStatus GPU sync) per recompute.
    // Per-(AP, size) entries persist across the alternation.
    const cacheKey = `${apKey}@@${nx}x${ny}`
    const cached = losCache.get(cacheKey)
    if (cached && cached.hash === hash) return cached

    // Allocate or resize this AP's texture + FBO. Keeping per-AP FBOs alive
    // saves a framebufferTexture2D + completeness check per frame.
    let entry = cached
    if (!entry) {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const fbo = gl.createFramebuffer()
      entry = { tex, fbo, hash: '', nx: 0, ny: 0, lastBake: 0 }
      losCache.set(cacheKey, entry)
    }
    if (entry.nx !== nx || entry.ny !== ny) {
      gl.bindTexture(gl.TEXTURE_2D, entry.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, nx, ny, 0, gl.RED, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.tex, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('LOS FBO incomplete')
      }
      entry.nx = nx; entry.ny = ny
    }

    // Run the bake pass: same wall texture / grid acceleration as the runtime
    // shader, just with a stop-on-first-hit DDA writing R8.
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo)
    gl.viewport(0, 0, nx, ny)
    gl.useProgram(progLos)

    gl.uniform2f(gl.getUniformLocation(progLos, 'uGridSize'), nx, ny)
    gl.uniform2f(gl.getUniformLocation(progLos, 'uOriginM'), originM.x, originM.y)
    gl.uniform1f(gl.getUniformLocation(progLos, 'uGridStepM'), gridStepM)
    gl.uniform3f(gl.getUniformLocation(progLos, 'uApPos'), apX, apY, apZ)
    gl.uniform1f(gl.getUniformLocation(progLos, 'uRxZM'), rxZM)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, wallsTex)
    gl.uniform1i(gl.getUniformLocation(progLos, 'uWalls'), 0)
    gl.uniform1i(gl.getUniformLocation(progLos, 'uWallCount'), wallsCountForLos)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, gridIdxTex)
    gl.uniform1i(gl.getUniformLocation(progLos, 'uGridIdx'), 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, gridListTex)
    gl.uniform1i(gl.getUniformLocation(progLos, 'uGridList'), 2)
    gl.uniform2i(gl.getUniformLocation(progLos, 'uGridDims'), useGrid ? gridDimsX : 0, useGrid ? gridDimsY : 0)
    gl.uniform1f(gl.getUniformLocation(progLos, 'uGridCellM'), gridCellM)
    gl.uniform2f(gl.getUniformLocation(progLos, 'uGridOriginM'), gridOriginX, gridOriginY)
    gl.uniform1i(gl.getUniformLocation(progLos, 'uGridListWidth'), gridListWidth)

    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    entry.hash = hash
    return entry
  }

  // HM-F5j: bake LOS textures for a list of APs. Caller passes a per-AP key
  // that MUST be stable across frames for the same AP (use ap.id when
  // available). Stale cache entries (APs no longer in the list) are evicted
  // here so the cache size tracks the live AP set.
  // Returns Map<apKey, { tex, nx, ny }> for the FS to bind per-AP.
  // wallCount is plumbed in as a snapshot from sampleFieldGL because the
  // shader uniform must match what was uploaded.
  let wallsCountForLos = 0
  // Age horizon for per-(AP, size) entries: a size that hasn't been baked for
  // this many bakeLos calls is dead (e.g. the user changed gridStepM, or a
  // floor resize shifted nx/ny) and its textures are reclaimed. Coarse/fine
  // alternate every idle recompute, so live sizes refresh every 1-2 calls —
  // 32 is comfortably past any legitimate gap.
  const LOS_STALE_BAKES = 32
  let losBakeCounter = 0
  function bakeLos(apEntries, gridStepM, originM, rxZM, nx, ny, wallCount) {
    wallsCountForLos = wallCount
    losBakeCounter++
    const seen = new Set()
    const out = new Map()
    for (const { ap, key } of apEntries) {
      seen.add(key)
      const entry = bakeLosOne(ap, key, gridStepM, originM, rxZM, nx, ny)
      entry.lastBake = losBakeCounter
      out.set(key, entry)
    }
    // Evict entries whose AP disappeared, or whose grid size hasn't been used
    // for a while (cache keys are per-(AP, size); the size part must NOT take
    // part in the disappeared-AP test or coarse and fine would evict each
    // other every alternation). Cheap: typical N is dozens/hundreds, the loop
    // is amortised across the bake we just did.
    for (const k of [...losCache.keys()]) {
      const e = losCache.get(k)
      const apPart = k.slice(0, k.lastIndexOf('@@'))
      if (!seen.has(apPart) || losBakeCounter - e.lastBake > LOS_STALE_BAKES) {
        gl.deleteTexture(e.tex)
        gl.deleteFramebuffer(e.fbo)
        losCache.delete(k)
      }
    }
    return out
  }

  // HM-F5k: CPU-side AP→corner / AP→wall geometry bake. The data is purely
  // 2D scalar/point math, so a small JS pass per AP is faster than spinning
  // up another shader program + framebuffer + readPixels (and this runs at
  // most once per AP per wall-edit, not per frame). See SEG_HIT_EPS in
  // geometry.js for the matching JS-side admit-pad rule.
  const BAKE_SEG_EPS = 1e-6
  function geomLosClear(ax, ay, bx, by, walls) {
    // Returns true iff the segment AP→corner crosses zero walls
    // *geometrically* (no Z filter). The JS check matches segSegIntersect's
    // padded admit rule so the shader's strict t/u test never disagrees.
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]
      const d1x = bx - ax, d1y = by - ay
      const d2x = w.bx - w.ax, d2y = w.by - w.ay
      const denom = d1x * d2y - d1y * d2x
      if (Math.abs(denom) < 1e-12) continue   // parallel
      const rx = ax - w.ax, ry = ay - w.ay
      const t = (d2x * ry - d2y * rx) / denom
      const u = (d1x * ry - d1y * rx) / denom
      if (t < 0 || t > 1 + BAKE_SEG_EPS) continue
      if (u < -BAKE_SEG_EPS || u > 1 + BAKE_SEG_EPS) continue
      return false
    }
    return true
  }

  function bakeApGeoOne(ap, apKey) {
    // Hash combines per-AP geometry (pos) with the wall topology version.
    // Antenna gain, frequency, channel — none affect mirrorPoint or the
    // geometric LOS test, so they don't bust the cache.
    const apX = ap.pos.x, apY = ap.pos.y
    const hash = `${apX},${apY},${wallsVersion},${bakeCorners.length},${bakeWalls.length}`
    const cached = apGeoCache.get(apKey)
    if (cached && cached.hash === hash) return cached

    // Allocate or resize textures. Layout:
    //   cornersTex: 1 row × N_corners texels, RGBA32F, .rg = (d1, geomLos)
    //   mirrorTex:  1 row × N_walls texels,   RGBA32F, .rg = (apImg.x, apImg.y)
    let entry = cached
    if (!entry) {
      const cornersTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, cornersTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const mirrorTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, mirrorTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      entry = { cornersTex, mirrorTex, hash: '', cornerCount: 0, wallCount: 0 }
      apGeoCache.set(apKey, entry)
    }

    // ---- corners pass ----
    const nC = Math.max(1, bakeCorners.length)
    const cData = new Float32Array(nC * 4)
    for (let i = 0; i < bakeCorners.length; i++) {
      const c = bakeCorners[i]
      const dx = c.x - apX, dy = c.y - apY
      const d1 = Math.sqrt(dx * dx + dy * dy)
      const los = geomLosClear(apX, apY, c.x, c.y, bakeWalls) ? 1.0 : 0.0
      cData[i * 4    ] = d1
      cData[i * 4 + 1] = los
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.cornersTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, nC, 1, 0, gl.RGBA, gl.FLOAT, cData)

    // ---- wall-mirror pass ----
    const nW = Math.max(1, bakeWalls.length)
    const mData = new Float32Array(nW * 4)
    for (let i = 0; i < bakeWalls.length; i++) {
      const w = bakeWalls[i]
      // mirrorPoint(AP, w.a, w.b): n = unit segment normal; apImg = AP - 2((AP-w.a)·n)·n
      const tx = w.bx - w.ax, ty = w.by - w.ay
      const tlen = Math.hypot(tx, ty) || 1
      const nx = -ty / tlen, ny = tx / tlen
      const k = (apX - w.ax) * nx + (apY - w.ay) * ny
      mData[i * 4    ] = apX - 2 * k * nx
      mData[i * 4 + 1] = apY - 2 * k * ny
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.mirrorTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, nW, 1, 0, gl.RGBA, gl.FLOAT, mData)

    entry.hash = hash
    entry.cornerCount = bakeCorners.length
    entry.wallCount = bakeWalls.length
    return entry
  }

  // HM-F5k: bake AP→corner + AP→wall-mirror textures for a list of APs.
  // Mirrors bakeLos's lifetime semantics — caller passes a stable per-AP
  // key, stale entries are evicted, returned Map gives renderAp the texture
  // handles via opts.apGeoEntry.
  function bakeApGeo(apEntries) {
    const seen = new Set()
    const out = new Map()
    for (const { ap, key } of apEntries) {
      seen.add(key)
      out.set(key, bakeApGeoOne(ap, key))
    }
    for (const k of [...apGeoCache.keys()]) {
      if (!seen.has(k)) {
        const e = apGeoCache.get(k)
        gl.deleteTexture(e.cornersTex)
        gl.deleteTexture(e.mirrorTex)
        apGeoCache.delete(k)
      }
    }
    return out
  }

  // ---- Phase 41-5: PBO + fence async readback plumbing ----
  // A sync readPixels stalls the main thread until the GPU drains every
  // queued command. The async path instead enqueues readPixels into a
  // PIXEL_PACK_BUFFER (non-blocking), drops a fence after the last enqueue,
  // polls it with clientWaitSync(0) off the hot path, and only then copies
  // out with getBufferSubData (a plain memcpy, 1-2 ms).
  //
  // Pool note: per-AP batches can be hundreds of PBOs in flight at once; the
  // pool retains up to PBO_POOL_MAX so steady-state reuse is allocation-free
  // while a one-off giant batch doesn't pin memory forever. Discarding a
  // stale handle just releases the buffer — a pending GPU write into it is
  // harmless because any future readback into the same buffer is enqueued
  // AFTER it (GL commands on one context are ordered).
  const pboPool = []
  const PBO_POOL_MAX = 32
  function pboAcquire(sizeBytes) {
    for (let i = 0; i < pboPool.length; i++) {
      if (pboPool[i].size === sizeBytes) return pboPool.splice(i, 1)[0]
    }
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf)
    gl.bufferData(gl.PIXEL_PACK_BUFFER, sizeBytes, gl.STREAM_READ)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    return { buf, size: sizeBytes }
  }
  function pboRelease(pbo) {
    if (pboPool.length < PBO_POOL_MAX) pboPool.push(pbo)
    else gl.deleteBuffer(pbo.buf)
  }
  // Resolves when every command issued before the fence has executed. Polls
  // at ~8 ms so waiting never blocks; timeout guards against a wedged
  // context (TDR) that would otherwise leave the caller pending forever.
  function waitFence(sync, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const t0 = performance.now()
      const poll = () => {
        if (gl.isContextLost()) {
          gl.deleteSync(sync)
          reject(new Error('GL context lost while awaiting fence'))
          return
        }
        const st = gl.clientWaitSync(sync, 0, 0)
        if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
          gl.deleteSync(sync)
          resolve()
          return
        }
        if (st === gl.WAIT_FAILED) {
          gl.deleteSync(sync)
          reject(new Error('clientWaitSync failed'))
          return
        }
        if (performance.now() - t0 > timeoutMs) {
          gl.deleteSync(sync)
          reject(new Error('fence wait timed out'))
          return
        }
        setTimeout(poll, 8)
      }
      poll()
    })
  }
  // fenceSync alone sits in the CPU-side queue; flush pushes it (and the
  // work before it) to the GPU so the fence can actually signal.
  function fenceFlush() {
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
    return sync
  }
  function readPboInto(pbo, out) {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo.buf)
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    pboRelease(pbo)
  }
  // Wait for the whole submitted batch (one fence covers every handle since
  // enqueue order is preserved), then copy each grid out.
  async function resolveApReads(handles) {
    if (handles.length === 0) return []
    const sync = fenceFlush()
    await waitFence(sync)
    return handles.map((h) => {
      const out = new Float32Array(h.nx * h.ny)
      readPboInto(h.pbo, out)
      return out
    })
  }
  // Stale-generation cleanup: recycle the buffers without reading them.
  function discardApReads(handles) {
    for (const h of handles) pboRelease(h.pbo)
  }

  // Uniform setup + draw for one AP, leaving the sized output FBO bound so the caller
  // picks its readback flavour (sync readPixels vs PBO enqueue).
  function renderApDraw(ap, scenario, gridStepM, originM, rxZM, slabMeta, opts = {}) {
    const nx = opts.gridSize?.nx ?? (Math.ceil(scenario.size.w / gridStepM) + 1)
    const ny = opts.gridSize?.ny ?? (Math.ceil(scenario.size.h / gridStepM) + 1)
    const outTarget = outTargets.ensure(nx, ny)

    gl.bindFramebuffer(gl.FRAMEBUFFER, outTarget.fbo)
    gl.viewport(0, 0, nx, ny)
    gl.useProgram(prog)

    gl.uniform2f(gl.getUniformLocation(prog, 'uGridSize'), nx, ny)
    gl.uniform2f(gl.getUniformLocation(prog, 'uOriginM'), originM.x, originM.y)
    gl.uniform1f(gl.getUniformLocation(prog, 'uGridStepM'), gridStepM)

    gl.uniform3f(gl.getUniformLocation(prog, 'uApPos'), ap.pos.x, ap.pos.y, ap.zM ?? 0)
    gl.uniform1f(gl.getUniformLocation(prog, 'uTxDbm'), ap.txDbm)
    const centerMHz = ap.centerMHz || 5190
    gl.uniform1f(gl.getUniformLocation(prog, 'uCenterMHz'), centerMHz)
    gl.uniform1f(gl.getUniformLocation(prog, 'uChannelWidthMHz'), ap.channelWidth || 20)
    // HM-F8: per-AP wall-loss frequency scale, host-precomputed so shader
    // skips the divide. lossB == 0 materials short-circuit pow() inside.
    gl.uniform1f(gl.getUniformLocation(prog, 'uFOver24'), (centerMHz / 1000) / 2.4)
    gl.uniform1f(gl.getUniformLocation(prog, 'uAntGainDbi'), ap._antGainDbi)
    gl.uniform1i(gl.getUniformLocation(prog, 'uAntMode'),
      ap.antennaMode === 'directional' ? 1 : (ap.antennaMode === 'custom' ? 2 : 0))
    gl.uniform1f(gl.getUniformLocation(prog, 'uAntAzimuthDeg'), ap.azimuthDeg ?? 0)
    gl.uniform1f(gl.getUniformLocation(prog, 'uAntBeamwidthDeg'), ap.beamwidthDeg ?? 60)
    gl.uniform1f(gl.getUniformLocation(prog, 'uAntTiltDeg'), ap.tiltDeg ?? 0)
    gl.uniform1f(gl.getUniformLocation(prog, 'uRxGainDbi'), ap._rxGainDbi)
    gl.uniform1f(gl.getUniformLocation(prog, 'uRxZM'), rxZM)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, wallsTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uWalls'), 0)
    gl.uniform1i(gl.getUniformLocation(prog, 'uWallCount'), scenario.walls.length)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, slabsTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uSlabs'), 1)
    gl.uniform1i(gl.getUniformLocation(prog, 'uSlabCount'), slabMeta.slabCount)

    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, holePolyTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uHolePoly'), 2)
    gl.uniform1i(gl.getUniformLocation(prog, 'uHolePolyLen'), slabMeta.polyLen)

    // F5b grid acceleration. uGridDims.x = 0 makes the shader fall back to
    // brute force, used both as a sentinel for "no walls" and as a debug
    // path if we want to verify parity by disabling the grid.
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, gridIdxTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uGridIdx'), 3)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, gridListTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uGridList'), 4)
    gl.uniform2i(gl.getUniformLocation(prog, 'uGridDims'), useGrid ? gridDimsX : 0, useGrid ? gridDimsY : 0)
    gl.uniform1f(gl.getUniformLocation(prog, 'uGridCellM'), gridCellM)
    gl.uniform2f(gl.getUniformLocation(prog, 'uGridOriginM'), gridOriginX, gridOriginY)
    gl.uniform1i(gl.getUniformLocation(prog, 'uGridListWidth'), gridListWidth)

    // HM-F5c step 2: reflection toggle + frequency-sample override.
    // refl=on switches the shader to coherent-sum H accumulation. step 2 only
    // supports N=1; real multi-frequency averaging lands in step 4.
    gl.uniform1i(gl.getUniformLocation(prog, 'uReflEnabled'),
      opts.maxReflOrder && opts.maxReflOrder > 0 ? 1 : 0)
    gl.uniform1i(gl.getUniformLocation(prog, 'uFreqOverrideN'), opts.freqOverrideN ?? 0)
    // HM-F5l: same cull floor the aggregated path uses. Default -120 dBm
    // matches JS aggregateApContributions's "below this is no signal".
    gl.uniform1f(gl.getUniformLocation(prog, 'uCullFloorDbm'), opts.cullFloorDbm ?? -120)

    // HM-F5c step 3: knife-edge diffraction toggle + corners texture.
    gl.uniform1i(gl.getUniformLocation(prog, 'uDiffEnabled'),
      opts.enableDiffraction ? 1 : 0)
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, cornersTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uCorners'), 5)
    gl.uniform1i(gl.getUniformLocation(prog, 'uCornerCount'), cornerCount)

    // HM-F5j: LOS field. opts.losTex is the R8 texture from a prior bakeLos
    // for this AP; missing → bind placeholder, disable lookup. losFastMode
    // enables mode B (skip reflections on LOS=1) — off by default.
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, opts.losTex || losPlaceholderTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uLosTex'), 6)
    gl.uniform1i(gl.getUniformLocation(prog, 'uLosEnabled'), opts.losTex ? 1 : 0)
    gl.uniform1i(gl.getUniformLocation(prog, 'uLosFastMode'), opts.losFastMode ? 1 : 0)

    // HM-F5k: per-AP precomputed AP→corner / AP→wall-mirror textures.
    // opts.apGeoEntry is the cache record from bakeApGeo for this AP; when
    // missing the shader's uApGeoEnabled=0 short-circuits all reads to the
    // unbaked compute path (mirrorPoint + d1 inline).
    const apGeoEntry = opts.apGeoEntry
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, apGeoEntry?.cornersTex || apGeoPlaceholderTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uApCornersGeo'), 7)
    gl.activeTexture(gl.TEXTURE8)
    gl.bindTexture(gl.TEXTURE_2D, apGeoEntry?.mirrorTex || apGeoPlaceholderTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uApWallMirror'), 8)
    gl.uniform1i(gl.getUniformLocation(prog, 'uApGeoEnabled'), apGeoEntry ? 1 : 0)

    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    return { nx, ny }
  }

  // Render one AP and read back nx*ny floats (dBm). Caller can override the
  // grid extent via opts.gridSize when sampling beyond scenario.size (padded
  // grids — see sampleFieldGL).
  function renderAp(ap, scenario, gridStepM, originM, rxZM, slabMeta, opts = {}) {
    const { nx, ny } = renderApDraw(ap, scenario, gridStepM, originM, rxZM, slabMeta, opts)
    const out = new Float32Array(nx * ny)
    if (gl.isContextLost()) throw new Error('GL context lost during renderAp (likely TDR on heavy brute-force scene)')
    gl.readPixels(0, 0, nx, ny, gl.RED, gl.FLOAT, out)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { rssi: out, nx, ny }
  }

  // Phase 41-5: draw + enqueue the readback into a pooled PBO without
  // waiting. Returns a handle for resolveApReads / discardApReads. Submitting
  // the whole AP batch first and fencing once removes the per-AP GPU stall
  // that made the sync loop O(N) round-trips.
  function renderApSubmit(ap, scenario, gridStepM, originM, rxZM, slabMeta, opts = {}) {
    const { nx, ny } = renderApDraw(ap, scenario, gridStepM, originM, rxZM, slabMeta, opts)
    if (gl.isContextLost()) throw new Error('GL context lost during renderApSubmit')
    const pbo = pboAcquire(nx * ny * 4)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo.buf)
    gl.readPixels(0, 0, nx, ny, gl.RED, gl.FLOAT, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { pbo, nx, ny }
  }

  // HM-F5g: aggregated all-AP single-pass render. Only valid for the scalar
  // path (no reflections, no diffraction). Returns 4 Float32Arrays of length
  // nx*ny: rssi, sinr, snr, cci. The caller has already filtered out custom-
  // pattern APs and verified opts.maxReflOrder/enableDiffraction are off.
  //
  // cullFloorDbm is the per-AP free-space-RSSI threshold below which an AP is
  // skipped entirely; -120 dBm matches the JS aggregateApContributions floor.
  //
  // renderFieldPrep does everything up to (but not including) the main-pass
  // drawArrays — cascade mask pass, program, uniforms, textures, FBO — so
  // renderField can issue one draw (sync path) while renderFieldAsync can
  // split the same draw into scissored row bands (the aggregated pass over
  // many APs is a single uninterruptible GPU atom; on a 300-AP scene it
  // measured ~2.4 s, stalling every GL call from every context).
  function renderFieldPrep(scenario, gridStepM, originM, rxZM, slabMeta, opts = {}) {
    const nx = opts.gridSize?.nx ?? (Math.ceil(scenario.size.w / gridStepM) + 1)
    const ny = opts.gridSize?.ny ?? (Math.ceil(scenario.size.h / gridStepM) + 1)
    const outFieldTarget = outFieldTargets.ensure(nx, ny)

    // HM-F5h cascade gate. We trigger the coarse pre-pass when AP count is
    // high enough that the per-fragment AP loop dominates frame time; below
    // that threshold the coarse-pass overhead beats the saving. The 20-AP
    // floor catches medium scenes (~26 APs is the user's drag-perf baseline)
    // where per-fragment AP iteration starts to dominate; the coarse pass is
    // dirt cheap per fragment so a bit of unnecessary work in borderline cases
    // is OK.
    const cullFloor = opts.cullFloorDbm ?? -120
    const cascadeFactor = (apCount >= 20) ? 4 : 0
    let mNx = 0, mNy = 0
    let maskTarget = null
    if (cascadeFactor > 0) {
      mNx = Math.max(1, Math.ceil(nx / cascadeFactor))
      mNy = Math.max(1, Math.ceil(ny / cascadeFactor))
      maskTarget = maskTargets.ensure(mNx, mNy)

      gl.bindFramebuffer(gl.FRAMEBUFFER, maskTarget.fbo)
      gl.viewport(0, 0, mNx, mNy)
      gl.useProgram(progFieldCoarse)

      gl.uniform2f(gl.getUniformLocation(progFieldCoarse, 'uGridSize'), mNx, mNy)
      gl.uniform2f(gl.getUniformLocation(progFieldCoarse, 'uOriginM'), originM.x, originM.y)
      // Coarse step in metres = fine step × cascadeFactor. nx*step ≈ scene
      // width, so coarse cell centres straddle the same world region the
      // fine cells will cover.
      gl.uniform1f(gl.getUniformLocation(progFieldCoarse, 'uGridStepM'), gridStepM * cascadeFactor)
      gl.uniform1f(gl.getUniformLocation(progFieldCoarse, 'uRxZM'), rxZM)
      gl.uniform1f(gl.getUniformLocation(progFieldCoarse, 'uRxGainDbi'), opts._rxGainDbi ?? 0)
      gl.uniform1f(gl.getUniformLocation(progFieldCoarse, 'uCullFloorDbm'), cullFloor)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, apsTex)
      gl.uniform1i(gl.getUniformLocation(progFieldCoarse, 'uAps'), 0)
      gl.uniform1i(gl.getUniformLocation(progFieldCoarse, 'uApCount'), apCount)

      gl.bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, outFieldTarget.fbo)
    gl.viewport(0, 0, nx, ny)
    gl.useProgram(progField)

    gl.uniform2f(gl.getUniformLocation(progField, 'uGridSize'), nx, ny)
    gl.uniform2f(gl.getUniformLocation(progField, 'uOriginM'), originM.x, originM.y)
    gl.uniform1f(gl.getUniformLocation(progField, 'uGridStepM'), gridStepM)
    gl.uniform1f(gl.getUniformLocation(progField, 'uRxZM'), rxZM)
    gl.uniform1f(gl.getUniformLocation(progField, 'uRxGainDbi'), opts._rxGainDbi ?? 0)
    gl.uniform1f(gl.getUniformLocation(progField, 'uNoiseDbm'), opts.noiseDbm ?? -95)
    gl.uniform1f(gl.getUniformLocation(progField, 'uCullFloorDbm'), opts.cullFloorDbm ?? -120)
    gl.uniform1i(gl.getUniformLocation(progField, 'uRssiOnly'), opts.rssiOnly ? 1 : 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, wallsTex)
    gl.uniform1i(gl.getUniformLocation(progField, 'uWalls'), 0)
    gl.uniform1i(gl.getUniformLocation(progField, 'uWallCount'), scenario.walls.length)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, slabsTex)
    gl.uniform1i(gl.getUniformLocation(progField, 'uSlabs'), 1)
    gl.uniform1i(gl.getUniformLocation(progField, 'uSlabCount'), slabMeta.slabCount)

    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, holePolyTex)
    gl.uniform1i(gl.getUniformLocation(progField, 'uHolePoly'), 2)
    gl.uniform1i(gl.getUniformLocation(progField, 'uHolePolyLen'), slabMeta.polyLen)

    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, gridIdxTex)
    gl.uniform1i(gl.getUniformLocation(progField, 'uGridIdx'), 3)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, gridListTex)
    gl.uniform1i(gl.getUniformLocation(progField, 'uGridList'), 4)
    gl.uniform2i(gl.getUniformLocation(progField, 'uGridDims'), useGrid ? gridDimsX : 0, useGrid ? gridDimsY : 0)
    gl.uniform1f(gl.getUniformLocation(progField, 'uGridCellM'), gridCellM)
    gl.uniform2f(gl.getUniformLocation(progField, 'uGridOriginM'), gridOriginX, gridOriginY)
    gl.uniform1i(gl.getUniformLocation(progField, 'uGridListWidth'), gridListWidth)

    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, apsTex)
    gl.uniform1i(gl.getUniformLocation(progField, 'uAps'), 5)
    gl.uniform1i(gl.getUniformLocation(progField, 'uApCount'), apCount)

    // HM-F5h: bind the coarse mask + tell the shader whether cascade is on.
    // When cascadeFactor = 0, the shader skips the mask check entirely (the
    // placeholder only keeps the sampler unit texture-complete).
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, maskTarget ? maskTarget.tex : maskPlaceholderTex)
    gl.uniform1i(gl.getUniformLocation(progField, 'uMask'), 6)
    gl.uniform2i(gl.getUniformLocation(progField, 'uMaskSize'), mNx, mNy)
    gl.uniform1i(gl.getUniformLocation(progField, 'uCascadeFactor'), cascadeFactor)

    gl.bindVertexArray(vao)
    return { nx, ny }
  }

  function renderFieldDraw(scenario, gridStepM, originM, rxZM, slabMeta, opts = {}) {
    const dims = renderFieldPrep(scenario, gridStepM, originM, rxZM, slabMeta, opts)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    return dims
  }

  // De-interleave the packed RGBA float readback into the 4 channel arrays
  // the host expects.
  function deinterleaveField(packed, nx, ny) {
    const n = nx * ny
    const rssi = new Float32Array(n)
    const sinr = new Float32Array(n)
    const snr  = new Float32Array(n)
    const cci  = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const o = i * 4
      rssi[i] = packed[o]
      sinr[i] = packed[o + 1]
      snr[i]  = packed[o + 2]
      cci[i]  = packed[o + 3]
    }
    return { rssi, sinr, snr, cci, nx, ny }
  }

  function renderField(scenario, gridStepM, originM, rxZM, slabMeta, opts = {}) {
    const { nx, ny } = renderFieldDraw(scenario, gridStepM, originM, rxZM, slabMeta, opts)
    const packed = new Float32Array(nx * ny * 4)
    if (gl.isContextLost()) throw new Error('GL context lost during renderField (likely TDR on heavy brute-force scene)')
    gl.readPixels(0, 0, nx, ny, gl.RGBA, gl.FLOAT, packed)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return deinterleaveField(packed, nx, ny)
  }

  // Phase 41-5: aggregated single-pass render with async readback. The main
  // thread never waits on the GPU — draw + readPixels-to-PBO are enqueued,
  // then we await a fence before the memcpy out.
  //
  // Many-AP scenes additionally split the main pass into scissored row bands
  // with a drained fence between bands: the per-fragment AP loop makes ONE
  // full-grid draw an uninterruptible multi-second GPU atom, and while it
  // runs every GL call from every context (PIXI render, the transition
  // animation's texture upload) blocks behind it. Bands keep the atom small
  // so foreground GPU work interleaves. Callers MUST NOT run two
  // renderFieldAsync calls concurrently on this instance — GL state persists
  // across the between-band awaits (sampleFieldGL serialises its callers).
  async function renderFieldAsync(scenario, gridStepM, originM, rxZM, slabMeta, opts = {}) {
    const { nx, ny } = renderFieldPrep(scenario, gridStepM, originM, rxZM, slabMeta, opts)
    if (gl.isContextLost()) throw new Error('GL context lost during renderFieldAsync')
    const bands = Math.max(1, Math.min(ny, Math.ceil(apCount / 24)))
    if (bands > 1) {
      gl.enable(gl.SCISSOR_TEST)
      const rowsPer = Math.ceil(ny / bands)
      for (let y0 = 0; y0 < ny; y0 += rowsPer) {
        gl.scissor(0, y0, nx, Math.min(rowsPer, ny - y0))
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        await waitFence(fenceFlush())
        // Abort between bands when the caller's generation moved on — a
        // synchronous drag-path render may have clobbered our GL state
        // across the await, and the result is doomed to be dropped anyway.
        if (opts.isStale && opts.isStale()) {
          gl.disable(gl.SCISSOR_TEST)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          return null
        }
      }
      gl.disable(gl.SCISSOR_TEST)
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    const pbo = pboAcquire(nx * ny * 16)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo.buf)
    gl.readPixels(0, 0, nx, ny, gl.RGBA, gl.FLOAT, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const sync = fenceFlush()
    await waitFence(sync)
    const packed = new Float32Array(nx * ny * 4)
    readPboInto(pbo, packed)
    return deinterleaveField(packed, nx, ny)
  }

  function dispose() {
    gl.deleteProgram(prog)
    gl.deleteProgram(progField)
    gl.deleteProgram(progFieldCoarse)
    gl.deleteProgram(progLos)
    gl.deleteBuffer(vbo)
    gl.deleteVertexArray(vao)
    for (const t of [wallsTex, slabsTex, holePolyTex, gridIdxTex, gridListTex, cornersTex, apsTex, maskPlaceholderTex, losPlaceholderTex, apGeoPlaceholderTex]) gl.deleteTexture(t)
    outTargets.dispose()
    outFieldTargets.dispose()
    maskTargets.dispose()
    for (const e of losCache.values()) {
      gl.deleteTexture(e.tex)
      gl.deleteFramebuffer(e.fbo)
    }
    losCache.clear()
    for (const e of apGeoCache.values()) {
      gl.deleteTexture(e.cornersTex)
      gl.deleteTexture(e.mirrorTex)
    }
    apGeoCache.clear()
    outGridCache.clear()
    for (const p of pboPool) gl.deleteBuffer(p.buf)
    pboPool.length = 0
  }

  return {
    uploadWalls, uploadCorners, uploadSlabs, uploadAps, bakeLos, bakeApGeo,
    renderAp, renderField,
    renderFieldAsync, renderApSubmit, resolveApReads, discardApReads,
    getWallsVersion, getCachedGrid, setCachedGrid, setUseGrid, dispose, gl,
  }
}

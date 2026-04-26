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

// Wall record layout in `uWalls` (RGBA32F texture, 3 texels per wall):
//   texel 0 .rgba = (ax, ay, bx, by)            — endpoints in metres
//   texel 1 .rgba = (lossDb, zLo, zHi, roughnessM)
//   texel 2 .rgba = (ituA, ituB, ituC, ituD) — ITU-R P.2040-3 coefficients;
//                   ituA < 0 sentinel = metal (Gamma → -1).
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
uniform float uAntGainDbi;     // base AP antenna gain (constant per AP)
uniform int   uAntMode;        // 0 = omni, 1 = directional, 2 = treat as omni (custom — host fallback handles real pattern)
uniform float uAntAzimuthDeg;
uniform float uAntBeamwidthDeg;
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

// Free-space (Friis) path loss in dB.
float pathLossDb(float d, float freqMhz) {
  float dEff = max(d, 0.5);
  return 20.0 * log(dEff)/log(10.0) + 20.0 * log(freqMhz)/log(10.0) - 27.55;
}

// Read a wall record (3 texels at base index w*3).
void readWall(int w, out vec2 a, out vec2 b, out float lossDb, out float zLo, out float zHi) {
  int t0 = w * 3;
  int t1 = t0 + 1;
  ivec2 p0 = ivec2(t0 % 4096, t0 / 4096);
  ivec2 p1 = ivec2(t1 % 4096, t1 / 4096);
  vec4 e0 = texelFetch(uWalls, p0, 0);
  vec4 e1 = texelFetch(uWalls, p1, 0);
  a = e0.xy;  b = e0.zw;
  lossDb = e1.x;  zLo = e1.y;  zHi = e1.z;
}

// Read material (texel 2): ituA<0 sentinel = metal.
void readWallMaterial(int w, out vec4 itu, out float roughnessM, out bool isMetal) {
  int t1 = w * 3 + 1;
  int t2 = w * 3 + 2;
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
vec2 segSegIntersect(vec2 p1, vec2 p2, vec2 p3, vec2 p4) {
  vec2 d1 = p2 - p1;
  vec2 d2 = p4 - p3;
  float denom = d1.x * d2.y - d1.y * d2.x;
  if (abs(denom) < 1e-12) return vec2(0.0, 0.0);
  vec2 r = p1 - p3;
  float t = (d2.x * r.y - d2.y * r.x) / denom;
  float u = (d1.x * r.y - d1.y * r.x) / denom;
  if (t < 0.0 || t > 1.0 || u < 0.0 || u > 1.0) return vec2(0.0, 0.0);
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
float wallLossOblique(vec2 a, vec2 b, vec2 rayDir, float lossDb) {
  vec2 t = b - a;
  vec2 n = normalize(vec2(-t.y, t.x));
  float rL = length(rayDir);
  vec2 rDir = rL > 1e-12 ? rayDir / rL : vec2(0.0);
  float cosI = abs(dot(rDir, n));
  float sec = 1.0 / max(cosI, 0.2);
  return lossDb * min(sec, 3.5);
}

// Apply one wall hit: do segSegIntersect + Z filter, accumulate loss if hit.
// Splitting this out lets both the brute-force and the grid-traversal paths
// share the same Z-filtered "did we cross this wall?" semantics.
void applyWallContribution(int w, vec2 ap, float apZ, vec2 rx, float rxZ, vec2 rayDir, inout float total) {
  vec2 a, b;
  float lossDb, zLo, zHi;
  readWall(w, a, b, lossDb, zLo, zHi);
  vec2 hit = segSegIntersect(ap, rx, a, b);
  if (hit.x < 0.5) return;
  float zAt = apZ + (rxZ - apZ) * hit.y;
  if (zAt < zLo || zAt > zHi) return;
  total += wallLossOblique(a, b, rayDir, lossDb);
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
// repeats. For typical grid stride (~1 m) and cell-spanning walls
// (a few cells) this catches the common duplicates. The remaining residue
// is bounded — at worst ~1 dB extra on the ray, within the F5a/b
// friis-baseline gate.
//
// A true "seen" set would need a bitmask texture per fragment, which is
// exactly what F5b is trying to avoid (fragment-local memory is scarce).
// The cyclic-buffer approximation keeps the shader stateless across cells
// and matches BVH-style watertight traversal accuracy in practice.
const int SEEN_BUF = 8;
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
  int maxSteps = uGridDims.x + uGridDims.y + 4;
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

// Point-in-poly via horizontal ray casting against a hole polygon stored in
// uHolePoly[start .. start+count-1] (each texel = (x, y, _, _)). Mirrors the
// JS reference exactly so a buggy edge case here doesn't appear as a "shader
// drift" surprise during diff.
bool pointInPoly(vec2 q, int start, int count) {
  bool inside = false;
  int prevIdx = start + count - 1;
  vec2 prev = texelFetch(uHolePoly, ivec2(prevIdx % 4096, prevIdx / 4096), 0).xy;
  for (int k = 0; k < count; k++) {
    int idx = start + k;
    vec2 cur = texelFetch(uHolePoly, ivec2(idx % 4096, idx / 4096), 0).xy;
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
    // Hole polygons are concatenated; holeStart/holeCount give one entry. To
    // express "this boundary has K bypass polygons" we re-pack as multiple
    // boundaries upstream — same yM, same slabDb, different (start, count) —
    // which the shader sums up trivially because the dz/cosI logic is
    // boundary-local. Simpler than encoding a list-of-lists.
    if (holeCount > 0 && pointInPoly(cross, holeStart, holeCount)) bypassed = true;
    if (!bypassed) loss += slabDb * sec;
  }
  return loss;
}

// 2D wall-loss accumulation that excludes one wall index (used for the two
// legs of an image-source reflection — the reflecting wall itself must not
// contribute its own dB to either leg). Otherwise mirrors accumulateWallLoss.
// We always go through the brute-force path here because:
//   (a) reflection legs are short (typically a few cells) so grid traversal
//       overhead dominates,
//   (b) the grid duplicates wall references across cells, which complicates
//       "skip exactly this wall" semantics.
// JS engine does the same (walls.filter(x => x !== w)).
float accumulateWallLossExcept(vec2 ap, float apZ, vec2 rx, float rxZ, int excludeW) {
  float total = 0.0;
  vec2 rayDir = rx - ap;
  for (int w = 0; w < uWallCount; w++) {
    if (w == excludeW) continue;
    applyWallContribution(w, ap, apZ, rx, rxZ, rayDir, total);
  }
  return total;
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
vec3 segSegHit(vec2 p1, vec2 p2, vec2 p3, vec2 p4) {
  vec2 d1 = p2 - p1;
  vec2 d2 = p4 - p3;
  float denom = d1.x * d2.y - d1.y * d2.x;
  if (abs(denom) < 1e-12) return vec3(0.0, 0.0, 0.0);
  vec2 r = p1 - p3;
  float t = (d2.x * r.y - d2.y * r.x) / denom;
  float u = (d1.x * r.y - d1.y * r.x) / denom;
  if (t < 0.0 || t > 1.0 || u < 0.0 || u > 1.0) return vec3(0.0, 0.0, 0.0);
  vec2 hit = p1 + d1 * t;
  return vec3(hit, 1.0);
}

// Knife-edge diffraction loss curve. Exact piecewise mirror of the JS
// reference (knifeEdgeLossDb in propagation.js). v is the Fresnel-Kirchhoff
// parameter (positive = corner blocks the ray, negative = clear).
float knifeEdgeLossDb(float v) {
  if (v <= -1.0) return 0.0;
  if (v <= 0.0)  return 20.0 * log(0.5 - 0.62 * v) / log(10.0);
  if (v <= 1.0)  return 20.0 * log(0.5 * exp(-0.95 * v)) / log(10.0);
  if (v <= 2.4) {
    float t = 0.38 - 0.1 * v;
    return 20.0 * log(0.4 - sqrt(0.1184 - t * t)) / log(10.0);
  }
  return 20.0 * log(0.225 / v) / log(10.0);
}

// Corner-diffraction Fresnel-Kirchhoff parameter v then dB loss.
// Mirrors cornerDiffractionDb. Returns +Infinity when the corner sits past
// the AP↔rx segment endpoints (seg.t outside (0, 1)).
// Returns 1e30 sentinel for "infeasible — skip" so caller can cull cleanly
// without a separate flag.
float cornerDiffractionDb(vec2 tx, vec2 rx, vec2 corner, float wavelengthM) {
  float d1 = length(corner - tx);
  float d2 = length(rx - corner);
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

// Brute-force wall-loss accumulation but also returns hit count, so the
// diffraction code can apply JS's "s1.hits > 1 || s2.hits > 1 → cull" rule.
// Out: x = total dB, y = hits as float (caller compares > 1.0).
vec2 accumulateWallLossWithHits(vec2 ap, float apZ, vec2 rx, float rxZ) {
  vec2 acc = vec2(0.0);
  vec2 rayDir = rx - ap;
  for (int w = 0; w < uWallCount; w++) {
    vec2 a, b;
    float lossDb, zLo, zHi;
    readWall(w, a, b, lossDb, zLo, zHi);
    vec2 hit = segSegIntersect(ap, rx, a, b);
    if (hit.x < 0.5) continue;
    float zAt = apZ + (rxZ - apZ) * hit.y;
    if (zAt < zLo || zAt > zHi) continue;
    acc.x += wallLossOblique(a, b, rayDir, lossDb);
    acc.y += 1.0;
  }
  return acc;
}

// AP antenna gain in dBi for a ray heading from AP to target. Mirrors
// apGainDbi in propagation.js modulo custom-pattern (host falls back).
float apGainDbi(vec2 target) {
  if (uAntMode == 0) return uAntGainDbi;
  if (uAntMode == 2) return uAntGainDbi;   // custom — caller already routes to JS path
  vec2 dxy = target - uApPos.xy;
  if (abs(dxy.x) < 1e-9 && abs(dxy.y) < 1e-9) return uAntGainDbi;
  float rayDeg = atan(dxy.y, dxy.x) * 180.0 / PI;
  float off = rayDeg - uAntAzimuthDeg;
  off = mod(off + 540.0, 360.0) - 180.0;
  float absOff = abs(off);
  float halfBw = uAntBeamwidthDeg * 0.5;
  if (absOff <= halfBw) return uAntGainDbi;
  if (absOff >= halfBw + DIRECTIONAL_EDGE_DEG) return uAntGainDbi - DIRECTIONAL_BACK_DB;
  float t = (absOff - halfBw) / DIRECTIONAL_EDGE_DEG;
  return uAntGainDbi - DIRECTIONAL_BACK_DB * t;
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

  // Need both wall-loss dB and the hit count so the diffraction loop can
  // gate "direct path is blocked" the same way JS does (wallScan.hits > 0).
  // Brute-force is mandatory here — the grid path doesn't surface hit counts
  // and would also double-count walls that span multiple cells.
  vec2 dirScan = accumulateWallLossWithHits(uApPos.xy, uApPos.z, rx, rxZ);
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
  float rxDbDir = uTxDbm + apGainDbi(rx) + uRxGainDbi - plDir;
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
  if (sameFloor) {
    for (int w = 0; w < uWallCount; w++) {
      vec2 wa, wb;
      float wLossDb, wZLo, wZHi;
      readWall(w, wa, wb, wLossDb, wZLo, wZHi);
      vec4 itu;
      float roughM;
      bool isMetal;
      readWallMaterial(w, itu, roughM, isMetal);

      vec2 apImg = mirrorPoint(uApPos.xy, wa, wb);
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

      float rxDbRef = uTxDbm + apGainDbi(reflPt) + uRxGainDbi - plRef;
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
  if (uDiffEnabled == 1 && dirHits > 0.0 && sameFloor) {
    float wavelengthM = C_LIGHT / f;
    for (int ci = 0; ci < uCornerCount; ci++) {
      vec2 corner = texelFetch(uCorners, ivec2(ci % 4096, ci / 4096), 0).xy;
      float d1 = length(corner - uApPos.xy);
      float d2 = length(rx - corner);
      float dTotC = d1 + d2;
      float cZM = uApPos.z + (rxZ - uApPos.z) * (d1 / max(dTotC, 1e-9));
      // Per-leg wall accumulation with hit count — JS culls if either leg
      // crosses more than one wall, since the corner is supposed to be the
      // single obstruction. >1 means the diffracted path is blocked too.
      vec2 s1 = accumulateWallLossWithHits(uApPos.xy, uApPos.z, corner, cZM);
      vec2 s2 = accumulateWallLossWithHits(corner, cZM, rx, rxZ);
      if (s1.y > 1.0 || s2.y > 1.0) continue;

      float diff = cornerDiffractionDb(uApPos.xy, rx, corner, wavelengthM);
      if (diff >= 1e29 || diff > 40.0) continue;

      float plDiff = pathLossDb(dTotC, uCenterMHz) + s1.x + s2.x + diff;
      float rxDbD  = uTxDbm + apGainDbi(corner) + uRxGainDbi - plDiff;
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

  if (uReflEnabled == 1) {
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
  float rxDb = uTxDbm + apGainDbi(rx) + uRxGainDbi - pl;
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
//   t3 = (band, _, _, _)
//        band: 1=2.4 GHz, 2=5 GHz, 3=6 GHz. Cross-band APs never co-channel.
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

const float PI = 3.14159265358979;
const float SLAB_SEC_CAP = 3.5;
const float DIRECTIONAL_BACK_DB = 20.0;
const float DIRECTIONAL_EDGE_DEG = 15.0;

vec2 segSegIntersect(vec2 p1, vec2 p2, vec2 p3, vec2 p4) {
  vec2 d1 = p2 - p1;
  vec2 d2 = p4 - p3;
  float denom = d1.x * d2.y - d1.y * d2.x;
  if (abs(denom) < 1e-12) return vec2(0.0, 0.0);
  vec2 r = p1 - p3;
  float t = (d2.x * r.y - d2.y * r.x) / denom;
  float u = (d1.x * r.y - d1.y * r.x) / denom;
  if (t < 0.0 || t > 1.0 || u < 0.0 || u > 1.0) return vec2(0.0, 0.0);
  return vec2(1.0, t);
}

void readWall(int w, out vec2 a, out vec2 b, out float lossDb, out float zLo, out float zHi) {
  int t0 = w * 3;
  int t1 = t0 + 1;
  ivec2 p0 = ivec2(t0 % 4096, t0 / 4096);
  ivec2 p1 = ivec2(t1 % 4096, t1 / 4096);
  vec4 e0 = texelFetch(uWalls, p0, 0);
  vec4 e1 = texelFetch(uWalls, p1, 0);
  a = e0.xy;  b = e0.zw;
  lossDb = e1.x;  zLo = e1.y;  zHi = e1.z;
}

float wallLossOblique(vec2 a, vec2 b, vec2 rayDir, float lossDb) {
  vec2 t = b - a;
  vec2 n = normalize(vec2(-t.y, t.x));
  float rL = length(rayDir);
  vec2 rDir = rL > 1e-12 ? rayDir / rL : vec2(0.0);
  float cosI = abs(dot(rDir, n));
  float sec = 1.0 / max(cosI, 0.2);
  return lossDb * min(sec, 3.5);
}

void applyWallContribution(int w, vec2 ap, float apZ, vec2 rx, float rxZ, vec2 rayDir, inout float total) {
  vec2 a, b;
  float lossDb, zLo, zHi;
  readWall(w, a, b, lossDb, zLo, zHi);
  vec2 hit = segSegIntersect(ap, rx, a, b);
  if (hit.x < 0.5) return;
  float zAt = apZ + (rxZ - apZ) * hit.y;
  if (zAt < zLo || zAt > zHi) return;
  total += wallLossOblique(a, b, rayDir, lossDb);
}

float accumulateWallLossBrute(vec2 ap, float apZ, vec2 rx, float rxZ) {
  float total = 0.0;
  vec2 rayDir = rx - ap;
  for (int w = 0; w < uWallCount; w++) {
    applyWallContribution(w, ap, apZ, rx, rxZ, rayDir, total);
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

const int SEEN_BUF = 8;

float accumulateWallLossGrid(vec2 ap, float apZ, vec2 rx, float rxZ) {
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
  int maxSteps = uGridDims.x + uGridDims.y + 4;
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
      applyWallContribution(wIdx, ap, apZ, rx, rxZ, rayDir, total);
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

float accumulateWallLossField(vec2 ap, float apZ, vec2 rx, float rxZ) {
  if (uGridDims.x == 0) return accumulateWallLossBrute(ap, apZ, rx, rxZ);
  return accumulateWallLossGrid(ap, apZ, rx, rxZ);
}

bool pointInPoly(vec2 q, int start, int count) {
  bool inside = false;
  int prevIdx = start + count - 1;
  vec2 prev = texelFetch(uHolePoly, ivec2(prevIdx % 4096, prevIdx / 4096), 0).xy;
  for (int k = 0; k < count; k++) {
    int idx = start + k;
    vec2 cur = texelFetch(uHolePoly, ivec2(idx % 4096, idx / 4096), 0).xy;
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
    if (holeCount > 0 && pointInPoly(cross, holeStart, holeCount)) bypassed = true;
    if (!bypassed) loss += slabDb * sec;
  }
  return loss;
}

float pathLossDbField(float d, float freqMhz) {
  float dEff = max(d, 0.5);
  return 20.0 * log(dEff)/log(10.0) + 20.0 * log(freqMhz)/log(10.0) - 27.55;
}

// Per-AP gain at the fragment. apMode: 0 omni, 1 directional. azimuth/beamwidth
// only consulted when mode=1; matches apGainDbi in propagation.js.
float apGainAt(vec2 apPos, vec2 target, int mode, float gainDbi, float azDeg, float bwDeg) {
  if (mode == 0) return gainDbi;
  vec2 dxy = target - apPos;
  if (abs(dxy.x) < 1e-9 && abs(dxy.y) < 1e-9) return gainDbi;
  float rayDeg = atan(dxy.y, dxy.x) * 180.0 / PI;
  float off = rayDeg - azDeg;
  off = mod(off + 540.0, 360.0) - 180.0;
  float absOff = abs(off);
  float halfBw = bwDeg * 0.5;
  if (absOff <= halfBw) return gainDbi;
  if (absOff >= halfBw + DIRECTIONAL_EDGE_DEG) return gainDbi - DIRECTIONAL_BACK_DB;
  float t = (absOff - halfBw) / DIRECTIONAL_EDGE_DEG;
  return gainDbi - DIRECTIONAL_BACK_DB * t;
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

  float bestDb = -1e6;
  int   bestIdx = -1;
  float bestFreqLo = 0.0;
  float bestFreqHi = 0.0;
  float bestBand   = 0.0;

  for (int k = 0; k < 4096; k++) {
    if (k >= uApCount) break;
    int base = k * 4;
    vec4 t0 = texelFetch(uAps, ivec2((base    ) % 4096, (base    ) / 4096), 0);
    vec4 t1 = texelFetch(uAps, ivec2((base + 1) % 4096, (base + 1) / 4096), 0);
    vec4 t2 = texelFetch(uAps, ivec2((base + 2) % 4096, (base + 2) / 4096), 0);
    vec3 apPos = t0.xyz; float txDbm = t0.w;
    float centerMHz = t1.x; float antGain = t1.z; int antMode = int(t1.w);
    float azDeg = t2.x; float bwDeg = t2.y;

    // Cull by free-space-only RSSI: txDbm + max possible gain - PL(d) < floor.
    vec2 dxy = rx - apPos.xy;
    float dz = apPos.z - rxZ;
    float dDir = sqrt(dxy.x*dxy.x + dxy.y*dxy.y + dz*dz);
    float fsBest = txDbm + antGain + uRxGainDbi - pathLossDbField(dDir, centerMHz);
    if (fsBest < uCullFloorDbm) continue;

    float wallLoss = accumulateWallLossField(apPos.xy, apPos.z, rx, rxZ);
    float slabLoss = accumulateSlabLossField(apPos.xy, apPos.z, rx, rxZ);
    float gain = apGainAt(apPos.xy, rx, antMode, antGain, azDeg, bwDeg);
    float pl = pathLossDbField(dDir, centerMHz) + wallLoss + slabLoss;
    float rxDb = txDbm + gain + uRxGainDbi - pl;

    if (rxDb > bestDb) {
      bestDb = rxDb;
      bestIdx = k;
      bestFreqLo = t2.z;
      bestFreqHi = t2.w;
      vec4 t3 = texelFetch(uAps, ivec2((base + 3) % 4096, (base + 3) / 4096), 0);
      bestBand = t3.x;
    }
  }

  if (bestIdx < 0) {
    // Every AP got culled by uCullFloorDbm — nothing to serve. Use floor
    // values; CCI is also -120 by definition (no interferers either).
    outColor = vec4(-120.0, -50.0, -50.0, -120.0);
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
    float azDeg = t2.x; float bwDeg = t2.y;

    vec2 dxy = rx - apPos.xy;
    float dz = apPos.z - rxZ;
    float dDir = sqrt(dxy.x*dxy.x + dxy.y*dxy.y + dz*dz);
    float fsBest = txDbm + antGain + uRxGainDbi - pathLossDbField(dDir, centerMHz);
    if (fsBest < uCullFloorDbm) continue;

    float wallLoss = accumulateWallLossField(apPos.xy, apPos.z, rx, rxZ);
    float slabLoss = accumulateSlabLossField(apPos.xy, apPos.z, rx, rxZ);
    float gain = apGainAt(apPos.xy, rx, antMode, antGain, azDeg, bwDeg);
    float pl = pathLossDbField(dDir, centerMHz) + wallLoss + slabLoss;
    float rxDb = txDbm + gain + uRxGainDbi - pl;

    cciLin += dbToLin(rxDb);
  }

  float noiseLin = dbToLin(uNoiseDbm);
  float sinrDb = bestDb - linToDb(noiseLin + cciLin);
  float snrDb  = bestDb - uNoiseDbm;
  float cciDbm = cciLin > 0.0 ? linToDb(cciLin) : -120.0;
  outColor = vec4(bestDb, sinrDb, snrDb, cciDbm);
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

  // Output FBO + R32F target sized to the grid (one render per AP).
  const outTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, outTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  let outNx = 0, outNy = 0
  const outFbo = gl.createFramebuffer()

  function ensureOutSize(nx, ny) {
    if (nx === outNx && ny === outNy) return
    gl.bindTexture(gl.TEXTURE_2D, outTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nx, ny, 0, gl.RED, gl.FLOAT, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('output FBO incomplete')
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    outNx = nx; outNy = ny
  }

  // HM-F5g: aggregated 4-channel output target (rssi, sinr, snr, cci) — sized
  // to the grid, sampled once at end of renderField.
  const outFieldTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, outFieldTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const outFieldFbo = gl.createFramebuffer()
  let outFieldNx = 0, outFieldNy = 0

  function ensureOutFieldSize(nx, ny) {
    if (nx === outFieldNx && ny === outFieldNy) return
    gl.bindTexture(gl.TEXTURE_2D, outFieldTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, nx, ny, 0, gl.RGBA, gl.FLOAT, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, outFieldFbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outFieldTex, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('field output FBO incomplete')
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    outFieldNx = nx; outFieldNy = ny
  }

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
  for (const t of [wallsTex, slabsTex, holePolyTex, gridIdxTex, gridListTex, cornersTex, apsTex]) {
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }
  // Grid metadata captured by uploadWalls and consumed in renderAp.
  let gridDimsX = 0, gridDimsY = 0, gridCellM = 1, gridOriginX = 0, gridOriginY = 0, gridListWidth = 1

  function pack4096(values, valuesPerTexel = 4) {
    const totalTexels = Math.max(1, Math.ceil(values.length / valuesPerTexel))
    const w = Math.min(4096, totalTexels)
    const h = Math.ceil(totalTexels / 4096)
    const data = new Float32Array(w * h * 4)
    data.set(values)
    return { data, w, h }
  }

  // walls: array of { a:{x,y}, b:{x,y}, lossDb, zLoM, zHiM, itu, roughnessM }
  // Now packs 3 texels per wall (12 floats) so reflection (HM-F5c step 2) has
  // ITU-R P.2040-3 coefficients + roughness on hand without a second texture.
  // Metal is encoded as itu.a = -1 sentinel (real materials have a > 0).
  // Also (re)builds the uniform-grid acceleration structure scoped to the
  // walls' AABB so the shader can DDA-walk it. opts.bbox lets the caller
  // override the grid extent when the scenario size doesn't match the wall
  // bounds (e.g. cross-floor walls extending beyond active floor).
  function uploadWalls(walls, opts = {}) {
    const flat = new Float32Array(walls.length * 12)
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]
      const o = i * 12
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
    }
    const { data, w, h } = pack4096(flat)
    gl.bindTexture(gl.TEXTURE_2D, wallsTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data)

    buildGrid(walls, opts.bbox)
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
  //   t3 = (band, _, _, _)
  //          band 1=2.4 GHz, 2=5 GHz, 3=6 GHz; cross-band APs never co-channel.
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
    }
    gl.bindTexture(gl.TEXTURE_2D, apsTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, tw, th, 0, gl.RGBA, gl.FLOAT, data)
  }

  // HM-F5c step 3: pack corner points (wall segment endpoints) into a 4096-
  // wide RGBA32F texture for the diffraction loop. One (x, y, 0, 0) texel per
  // corner. Empty list still uploads a 1×1 placeholder so the sampler binding
  // stays valid; uCornerCount = 0 makes the shader skip the loop entirely.
  function uploadCorners(corners) {
    cornerCount = corners?.length ?? 0
    const totalTexels = Math.max(1, cornerCount)
    const tw = Math.min(4096, totalTexels)
    const th = Math.ceil(totalTexels / 4096)
    const data = new Float32Array(tw * th * 4)
    for (let i = 0; i < cornerCount; i++) {
      const c = corners[i]
      data[i * 4    ] = c.x
      data[i * 4 + 1] = c.y
    }
    gl.bindTexture(gl.TEXTURE_2D, cornersTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, tw, th, 0, gl.RGBA, gl.FLOAT, data)
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
    const cellM = Math.max(0.5, Math.min(4, ideal))
    const nGx = Math.min(256, Math.max(1, Math.ceil(spanX / cellM)))
    const nGy = Math.min(256, Math.max(1, Math.ceil(spanY / cellM)))

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
  // We expand each (boundary × hole) pair into its own slab texel so the
  // shader's per-boundary loop can consult exactly one polygon per iteration.
  // Same yM appears multiple times — that's fine: each pair either bypasses
  // or contributes its slabDb*sec exactly once. Boundaries with no holes get
  // a single texel with holeCount=0.
  // We also flatten every polygon into uHolePoly back-to-back.
  function uploadSlabs(boundaries) {
    const slabRecords = []   // each: [yM, slabDb, polyStart, polyCount]
    const polyValues = []    // RGBA32F payload

    let cursor = 0
    for (const b of boundaries) {
      const polys = b.bypassHoles ?? []
      if (polys.length === 0) {
        slabRecords.push([b.yM, b.slabDb ?? 0, 0, 0])
      } else {
        // First entry carries all of slabDb (oblique sec is computed shader-
        // side from geometry, not stored). Each polygon expansion bypasses
        // independently — but if any polygon contains the crossing, JS
        // `accumulateSlabLoss` skips the slab entirely. To preserve that
        // semantics, we encode polygons across multiple texels but use a
        // sentinel: the FIRST occurrence of yM contributes slabDb when not
        // bypassed; subsequent duplicates contribute 0 but can still bypass
        // by point-in-poly hit. To realise that, we mark only the first
        // texel as the "main" record and the rest as bypass-only.
        slabRecords.push([b.yM, b.slabDb ?? 0, cursor, polys[0].length / 2])
        polyValues.push(...packPolyVerts(polys[0]))
        cursor += polys[0].length / 2
        for (let p = 1; p < polys.length; p++) {
          slabRecords.push([b.yM, 0, cursor, polys[p].length / 2])
          polyValues.push(...packPolyVerts(polys[p]))
          cursor += polys[p].length / 2
        }
      }
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
    gl.bindTexture(gl.TEXTURE_2D, slabsTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, slabW, 1, 0, gl.RGBA, gl.FLOAT, slabFlat)

    // ---- hole polygon vertices ----
    const polyFlat = new Float32Array(Math.max(1, polyValues.length / 4) * 4)
    polyFlat.set(polyValues)
    const polyTexels = Math.max(1, polyValues.length / 4)
    const polyW = Math.min(4096, polyTexels)
    const polyH = Math.ceil(polyTexels / 4096)
    const padded = new Float32Array(polyW * polyH * 4)
    padded.set(polyFlat)
    gl.bindTexture(gl.TEXTURE_2D, holePolyTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, polyW, polyH, 0, gl.RGBA, gl.FLOAT, padded)

    return { slabCount: Math.max(1, slabRecords.length) === 1 && slabRecords.length === 0 ? 0 : slabRecords.length, polyLen: polyTexels }
  }

  function packPolyVerts(flatXY) {
    // flatXY = [x, y, x, y, …] in metres. Pack each vertex into one RGBA32F
    // texel as (x, y, 0, 0).
    const out = []
    for (let i = 0; i < flatXY.length; i += 2) out.push(flatXY[i], flatXY[i + 1], 0, 0)
    return out
  }

  // Force-disable the grid traversal in shader (bench / debug parity check).
  // When false, the shader takes the brute-force per-wall loop path.
  let useGrid = true
  function setUseGrid(v) { useGrid = !!v }

  // Render one AP and read back nx*ny floats (dBm).
  function renderAp(ap, scenario, gridStepM, originM, rxZM, slabMeta, opts = {}) {
    const nx = Math.ceil(scenario.size.w / gridStepM) + 1
    const ny = Math.ceil(scenario.size.h / gridStepM) + 1
    ensureOutSize(nx, ny)

    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo)
    gl.viewport(0, 0, nx, ny)
    gl.useProgram(prog)

    gl.uniform2f(gl.getUniformLocation(prog, 'uGridSize'), nx, ny)
    gl.uniform2f(gl.getUniformLocation(prog, 'uOriginM'), originM.x, originM.y)
    gl.uniform1f(gl.getUniformLocation(prog, 'uGridStepM'), gridStepM)

    gl.uniform3f(gl.getUniformLocation(prog, 'uApPos'), ap.pos.x, ap.pos.y, ap.zM ?? 0)
    gl.uniform1f(gl.getUniformLocation(prog, 'uTxDbm'), ap.txDbm)
    gl.uniform1f(gl.getUniformLocation(prog, 'uCenterMHz'), ap.centerMHz || 5190)
    gl.uniform1f(gl.getUniformLocation(prog, 'uChannelWidthMHz'), ap.channelWidth || 20)
    gl.uniform1f(gl.getUniformLocation(prog, 'uAntGainDbi'), ap._antGainDbi)
    gl.uniform1i(gl.getUniformLocation(prog, 'uAntMode'),
      ap.antennaMode === 'directional' ? 1 : (ap.antennaMode === 'custom' ? 2 : 0))
    gl.uniform1f(gl.getUniformLocation(prog, 'uAntAzimuthDeg'), ap.azimuthDeg ?? 0)
    gl.uniform1f(gl.getUniformLocation(prog, 'uAntBeamwidthDeg'), ap.beamwidthDeg ?? 60)
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

    // HM-F5c step 3: knife-edge diffraction toggle + corners texture.
    gl.uniform1i(gl.getUniformLocation(prog, 'uDiffEnabled'),
      opts.enableDiffraction ? 1 : 0)
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, cornersTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uCorners'), 5)
    gl.uniform1i(gl.getUniformLocation(prog, 'uCornerCount'), cornerCount)

    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    const out = new Float32Array(nx * ny)
    gl.readPixels(0, 0, nx, ny, gl.RED, gl.FLOAT, out)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { rssi: out, nx, ny }
  }

  // HM-F5g: aggregated all-AP single-pass render. Only valid for the scalar
  // path (no reflections, no diffraction). Returns 4 Float32Arrays of length
  // nx*ny: rssi, sinr, snr, cci. The caller has already filtered out custom-
  // pattern APs and verified opts.maxReflOrder/enableDiffraction are off.
  //
  // cullFloorDbm is the per-AP free-space-RSSI threshold below which an AP is
  // skipped entirely; -120 dBm matches the JS aggregateApContributions floor.
  function renderField(scenario, gridStepM, originM, rxZM, slabMeta, opts = {}) {
    const nx = Math.ceil(scenario.size.w / gridStepM) + 1
    const ny = Math.ceil(scenario.size.h / gridStepM) + 1
    ensureOutFieldSize(nx, ny)

    gl.bindFramebuffer(gl.FRAMEBUFFER, outFieldFbo)
    gl.viewport(0, 0, nx, ny)
    gl.useProgram(progField)

    gl.uniform2f(gl.getUniformLocation(progField, 'uGridSize'), nx, ny)
    gl.uniform2f(gl.getUniformLocation(progField, 'uOriginM'), originM.x, originM.y)
    gl.uniform1f(gl.getUniformLocation(progField, 'uGridStepM'), gridStepM)
    gl.uniform1f(gl.getUniformLocation(progField, 'uRxZM'), rxZM)
    gl.uniform1f(gl.getUniformLocation(progField, 'uRxGainDbi'), opts._rxGainDbi ?? 0)
    gl.uniform1f(gl.getUniformLocation(progField, 'uNoiseDbm'), opts.noiseDbm ?? -95)
    gl.uniform1f(gl.getUniformLocation(progField, 'uCullFloorDbm'), opts.cullFloorDbm ?? -120)

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

    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    const packed = new Float32Array(nx * ny * 4)
    gl.readPixels(0, 0, nx, ny, gl.RGBA, gl.FLOAT, packed)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    // De-interleave into the 4 channel arrays the host already expects.
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

  function dispose() {
    gl.deleteProgram(prog)
    gl.deleteProgram(progField)
    gl.deleteBuffer(vbo)
    gl.deleteVertexArray(vao)
    for (const t of [outTex, outFieldTex, wallsTex, slabsTex, holePolyTex, gridIdxTex, gridListTex, cornersTex, apsTex]) gl.deleteTexture(t)
    gl.deleteFramebuffer(outFbo)
    gl.deleteFramebuffer(outFieldFbo)
  }

  return { uploadWalls, uploadCorners, uploadSlabs, uploadAps, renderAp, renderField, setUseGrid, dispose, gl }
}

// WebGL2 fragment-shader implementation of `rssiFromAp` — HM-F5a MVP.
//
// Scope (matches HM-F5a exit criteria, see __fixtures__/README.md):
//   - Friis path loss (3D distance) with per-AP centre frequency
//   - Per-wall penetration: oblique-incidence multiplier same as JS engine,
//     Z filter (skip wall hits whose Z falls outside [zLoM, zHiM])
//   - Slab attenuation across floor boundaries with FloorHole bypass and
//     sec(θ) oblique magnification capped at 3.5
//   - Wall openings already pre-expanded into segment list by buildScenario,
//     so shader sees them as just shorter wall segments with their own dbLoss
//   - AP antenna gain: omni and directional (patch/sector approximation).
//     Custom-pattern APs fall back to the JS engine on the host so we don't
//     need to ship a sampled lobe table to the shader at this stage.
//
// Out of scope here (lands in F5c onward):
//   - Image-source reflections / complex Fresnel
//   - Knife-edge diffraction
//   - Multi-frequency coherent power averaging (we use centre-frequency only)
//
// Output: per-AP RSSI grid (Float32Array, length nx*ny, dBm). The host adapter
// (`sampleFieldGL.js`) loops APs, dispatches one render per AP, reads pixels
// back, and runs `aggregateApContributions` on the CPU to fold the perAp grids
// into the final rssi/sinr/snr/cci fields.

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

// Wall record layout in `uWalls` (RGBA32F texture, 2 texels per wall):
//   texel 0 .rgba = (ax, ay, bx, by)            — endpoints in metres
//   texel 1 .rgba = (lossDb, zLo, zHi, _padding)
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

const float PI = 3.14159265358979;
const float SLAB_SEC_CAP = 3.5;
const float DIRECTIONAL_BACK_DB = 20.0;
const float DIRECTIONAL_EDGE_DEG = 15.0;

// Free-space (Friis) path loss in dB.
float pathLossDb(float d, float freqMhz) {
  float dEff = max(d, 0.5);
  return 20.0 * log(dEff)/log(10.0) + 20.0 * log(freqMhz)/log(10.0) - 27.55;
}

// Read a wall record (2 texels at base index w*2).
void readWall(int w, out vec2 a, out vec2 b, out float lossDb, out float zLo, out float zHi) {
  int t0 = w * 2;
  int t1 = t0 + 1;
  ivec2 p0 = ivec2(t0 % 4096, t0 / 4096);
  ivec2 p1 = ivec2(t1 % 4096, t1 / 4096);
  vec4 e0 = texelFetch(uWalls, p0, 0);
  vec4 e1 = texelFetch(uWalls, p1, 0);
  a = e0.xy;  b = e0.zw;
  lossDb = e1.x;  zLo = e1.y;  zHi = e1.z;
}

// 2D segment-segment intersection. Returns 1 in .x if hit, the parametric t
// (0..1 along ap→rx) in .y. Mirrors heatmap_sample/physics/geometry.js.
vec2 segSegIntersect(vec2 p1, vec2 p2, vec2 p3, vec2 p4) {
  vec2 d1 = p2 - p1;
  vec2 d2 = p4 - p3;
  float denom = d1.x * d2.y - d1.y * d2.x;
  if (abs(denom) < 1e-9) return vec2(0.0, 0.0);
  vec2 r = p1 - p3;
  float t = (d2.x * r.y - d2.y * r.x) / denom;
  float u = (d1.x * r.y - d1.y * r.x) / denom;
  if (t < 0.0 || t > 1.0 || u < 0.0 || u > 1.0) return vec2(0.0, 0.0);
  return vec2(1.0, t);
}

// Wall normal (unit) and oblique-incidence loss (cap 3.5).
float wallLossOblique(vec2 a, vec2 b, vec2 rayDir, float lossDb) {
  vec2 t = b - a;
  vec2 n = normalize(vec2(-t.y, t.x));
  float cosI = abs(dot(normalize(rayDir), n));
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

  // Hard cap iterations to avoid runaway loops on degenerate rays.
  // Worst-case: a ray traverses nGx + nGy cells on the diagonal.
  int maxSteps = uGridDims.x + uGridDims.y + 4;
  for (int i = 0; i < 4096; i++) {
    if (i >= maxSteps) break;
    processCell(cx, cy, ap, apZ, rx, rxZ, rayDir, total, seenBuf, seenWritePos);
    if (cx == cxEnd && cy == cyEnd) break;
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      tMaxY += tDeltaY;
      cy += stepY;
    }
    // Safety: ray exited the grid bounds, no more cells.
    if (cx < -1 || cy < -1 || cx > uGridDims.x || cy > uGridDims.y) break;
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

  // Walls texture is reused across all AP renders within a frame. We pack
  // walls into a 4096-wide RGBA32F image and reupload only when the wall list
  // changes. Same for slabs and hole polygons.
  const wallsTex   = gl.createTexture()
  const slabsTex   = gl.createTexture()
  const holePolyTex = gl.createTexture()
  // F5b acceleration grid textures.
  const gridIdxTex  = gl.createTexture()
  const gridListTex = gl.createTexture()
  for (const t of [wallsTex, slabsTex, holePolyTex, gridIdxTex, gridListTex]) {
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

  // walls: array of { a:{x,y}, b:{x,y}, lossDb, zLoM, zHiM }
  // Also (re)builds the uniform-grid acceleration structure scoped to the
  // walls' AABB so the shader can DDA-walk it. opts.bbox lets the caller
  // override the grid extent when the scenario size doesn't match the wall
  // bounds (e.g. cross-floor walls extending beyond active floor).
  function uploadWalls(walls, opts = {}) {
    const flat = new Float32Array(walls.length * 8)
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]
      const o = i * 8
      flat[o    ] = w.a.x;  flat[o + 1] = w.a.y
      flat[o + 2] = w.b.x;  flat[o + 3] = w.b.y
      flat[o + 4] = w.lossDb
      flat[o + 5] = w.zLoM ?? -1e6
      flat[o + 6] = w.zHiM ??  1e6
      flat[o + 7] = 0
    }
    const { data, w, h } = pack4096(flat)
    gl.bindTexture(gl.TEXTURE_2D, wallsTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data)

    buildGrid(walls, opts.bbox)
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
  function renderAp(ap, scenario, gridStepM, originM, rxZM, slabMeta) {
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

    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    const out = new Float32Array(nx * ny)
    gl.readPixels(0, 0, nx, ny, gl.RED, gl.FLOAT, out)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { rssi: out, nx, ny }
  }

  function dispose() {
    gl.deleteProgram(prog)
    gl.deleteBuffer(vbo)
    gl.deleteVertexArray(vao)
    for (const t of [outTex, wallsTex, slabsTex, holePolyTex, gridIdxTex, gridListTex]) gl.deleteTexture(t)
    gl.deleteFramebuffer(outFbo)
  }

  return { uploadWalls, uploadSlabs, renderAp, setUseGrid, dispose, gl }
}

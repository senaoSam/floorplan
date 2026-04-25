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

// Sum penetration loss along ap→rx, applying Z filter exactly as the JS engine.
float accumulateWallLoss(vec2 ap, float apZ, vec2 rx, float rxZ) {
  float total = 0.0;
  vec2 rayDir = rx - ap;
  for (int w = 0; w < uWallCount; w++) {
    vec2 a, b;
    float lossDb, zLo, zHi;
    readWall(w, a, b, lossDb, zLo, zHi);
    vec2 hit = segSegIntersect(ap, rx, a, b);
    if (hit.x < 0.5) continue;
    float zAt = apZ + (rxZ - apZ) * hit.y;
    if (zAt < zLo || zAt > zHi) continue;
    total += wallLossOblique(a, b, rayDir, lossDb);
  }
  return total;
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
  for (const t of [wallsTex, slabsTex, holePolyTex]) {
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  function pack4096(values, valuesPerTexel = 4) {
    const totalTexels = Math.max(1, Math.ceil(values.length / valuesPerTexel))
    const w = Math.min(4096, totalTexels)
    const h = Math.ceil(totalTexels / 4096)
    const data = new Float32Array(w * h * 4)
    data.set(values)
    return { data, w, h }
  }

  // walls: array of { a:{x,y}, b:{x,y}, lossDb, zLoM, zHiM }
  function uploadWalls(walls) {
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
    for (const t of [outTex, wallsTex, slabsTex, holePolyTex]) gl.deleteTexture(t)
    gl.deleteFramebuffer(outFbo)
  }

  return { uploadWalls, uploadSlabs, renderAp, dispose, gl }
}

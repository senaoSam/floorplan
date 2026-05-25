// Step 1 of HM-F5c+d port — pure-function GLSL parity check.
//
// Verifies the GLSL versions of cmul / cdiv / csqrt / materialEpsC /
// fresnelGamma match propagation.js bit-for-bit-ish under fp32. The shader
// renders a single-fragment 1×1 RGBA32F texture whose channels carry
// (Gamma_perp.re, Gamma_perp.im, Gamma_para.re, Gamma_para.im). Caller passes
// the same (cosI, freqMhz, ITU coefficients, isMetal) it would feed
// fresnelGamma in JS and compares.
//
// This is throwaway scaffolding for the porting work — it never runs in
// production, only behind the diff page's "step 1 fresnel parity" button.

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

// Mirror of helpers in propagationGL.js's main FS. Kept self-contained so a
// driver bug in one path can't silently mask the other (and vice versa).
const FS = `#version 300 es
precision highp float;
out vec4 outColor;

uniform float uCosI;
uniform float uFreqMhz;
uniform vec4  uItu;       // (a, b, c, d) ITU-R P.2040-3 coefficients
uniform int   uIsMetal;   // 1 = metal special case (Gamma = -1)

const float PI = 3.14159265358979;
const float EPS0 = 8.854187817e-12;

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}
vec2 cdiv(vec2 a, vec2 b) {
  float den = b.x * b.x + b.y * b.y;
  return vec2((a.x * b.x + a.y * b.y) / den,
              (a.y * b.x - a.x * b.y) / den);
}
vec2 csqrt(vec2 z) {
  float r = sqrt(z.x * z.x + z.y * z.y);
  float re = sqrt(max((r + z.x) * 0.5, 0.0));
  float imMag = sqrt(max((r - z.x) * 0.5, 0.0));
  return vec2(re, z.y >= 0.0 ? imMag : -imMag);
}
vec2 materialEpsC(vec4 itu, float freqMhz) {
  float fGhz = freqMhz * 0.001;
  float etaPrime = itu.x * pow(fGhz, itu.y);
  float sigma    = itu.z * pow(fGhz, itu.w);
  return vec2(etaPrime, -sigma / (2.0 * PI * freqMhz * 1e6 * EPS0));
}
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

void main() {
  vec2 epsC = materialEpsC(uItu, uFreqMhz);
  vec4 g = fresnelGamma(uCosI, epsC, uIsMetal != 0);
  outColor = g;
}
`

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error('fresnelGLDebug shader compile failed: ' + log)
  }
  return sh
}

// Build a one-shot GL2 program + 1×1 framebuffer. Reused across calls so we
// don't pay setup cost per fixture row.
let cached = null
function ensureContext() {
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 1; canvas.height = 1
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true })
  if (!gl) throw new Error('WebGL2 not available')
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('EXT_color_buffer_float not supported')
  }
  const vs = compile(gl, gl.VERTEX_SHADER, VS)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FS)
  const prog = gl.createProgram()
  gl.attachShader(prog, vs); gl.attachShader(prog, fs)
  gl.bindAttribLocation(prog, 0, 'aPos')
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('fresnelGLDebug link failed: ' + gl.getProgramInfoLog(prog))
  }

  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  3, -1,  -1,  3,
  ]), gl.STATIC_DRAW)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

  const fbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)

  cached = { gl, prog, vao, fbo }
  return cached
}

// One-shot evaluation of GLSL fresnelGamma. Returns
//   { perp:{re,im}, para:{re,im} }
// matching the JS function's shape, so the caller can diff field-by-field.
export function evaluateFresnelGL({ cosI, freqMhz, itu, isMetal }) {
  const { gl, prog, vao, fbo } = ensureContext()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.viewport(0, 0, 1, 1)
  gl.useProgram(prog)
  gl.bindVertexArray(vao)
  gl.uniform1f(gl.getUniformLocation(prog, 'uCosI'), cosI)
  gl.uniform1f(gl.getUniformLocation(prog, 'uFreqMhz'), freqMhz)
  gl.uniform4f(gl.getUniformLocation(prog, 'uItu'),
    itu?.a ?? 0, itu?.b ?? 0, itu?.c ?? 0, itu?.d ?? 0)
  gl.uniform1i(gl.getUniformLocation(prog, 'uIsMetal'), isMetal ? 1 : 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  const out = new Float32Array(4)
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return {
    perp: { re: out[0], im: out[1] },
    para: { re: out[2], im: out[3] },
  }
}

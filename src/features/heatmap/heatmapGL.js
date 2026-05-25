// WebGL2 heatmap renderer. Consumes a coarse `field.rssi` (Float32Array,
// nx×ny) and produces an RGBA off-screen canvas:
//   • hardware bilinear (LINEAR filter on R32F texture, manual fallback)
//   • separable gaussian blur (2 passes, dynamic kernel up to radius 24)
//   • 5-anchor colormap; anchors come in via render(colorConfig.anchors)
//
// Usage:
//   const r = createHeatmapGL()
//   r.render(field, outW, outH, metersPerPixel, blurRadius, showContours, { anchors }) → HTMLCanvasElement
//   r.dispose()

// Default anchor table — mode-specific anchors are supplied by getModeConfig().
const ANCHORS = [
  [ -35, 235,  26,  26, 0.90],
  [ -45, 255, 128,  13, 0.88],
  [ -55, 255, 217,  26, 0.86],
  [ -65, 102, 217,  64, 0.84],
  [ -75,  26, 191, 204, 0.80]
];

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Pass 1: sample R32F rssi grid → rssi in dBm into R32F FBO using Catmull-Rom
// bicubic. The earlier bilinear path produced visible step-edges along grid
// cell boundaries — most obvious as zig-zags on iso-contours, since fwidth(d)
// in the colormap pass amplifies the C^0 slope discontinuity that bilinear
// leaves at every integer texel boundary. Catmull-Rom is C^1 across cells, so
// the dBm field reads continuous and contour lines stay smooth even when the
// underlying physics grid is coarse (e.g. drag-lod's 1.5 m grid step).
//
// 16-tap implementation. We could fold 4×4 fetches into 9 via hardware-LINEAR
// tricks (Sigg-Hadwiger), but R32F isn't filterable on every driver, and 16
// nearest fetches at output resolution is cheap (sub-millisecond at 1080p on
// any GPU shipped this decade). NaN propagation is preserved: any NaN in the
// 4×4 stencil bleeds through, matching bilinear's behaviour for out-of-scope
// cells. Catmull-Rom can produce small overshoots near sharp anchor crossings;
// the visual cost is far smaller than bilinear's stair-stepping, and the
// colormap's per-anchor lookup absorbs most of it.
const FS_SAMPLE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uField;
uniform vec2 uFieldSize;      // (nx, ny)
out vec4 outColor;

// Catmull-Rom basis weights for fractional offset t ∈ [0, 1] across the four
// neighbours (i-1, i, i+1, i+2).
vec4 cubicWeights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(
    -0.5 * t3 +       t2 - 0.5 * t,
     1.5 * t3 - 2.5 * t2            + 1.0,
    -1.5 * t3 + 2.0 * t2 + 0.5 * t,
     0.5 * t3 - 0.5 * t2
  );
}

float sampleCatmullRom(vec2 uv) {
  vec2 sz = uFieldSize;
  vec2 f = uv * sz - 0.5;
  vec2 i = floor(f);
  vec2 t = f - i;
  vec4 wx = cubicWeights(t.x);
  vec4 wy = cubicWeights(t.y);

  float result = 0.0;
  for (int oy = -1; oy <= 2; ++oy) {
    float ry = 0.0;
    for (int ox = -1; ox <= 2; ++ox) {
      // CLAMP_TO_EDGE on the texture handles out-of-range fetches; we still
      // clamp manually so the integer index is always in-bounds for
      // texelFetch (cheaper + driver-portable than relying on wrap).
      ivec2 p = ivec2(
        clamp(int(i.x) + ox, 0, int(sz.x) - 1),
        clamp(int(i.y) + oy, 0, int(sz.y) - 1)
      );
      float v = texelFetch(uField, p, 0).r;
      ry += v * wx[ox + 1];
    }
    result += ry * wy[oy + 1];
  }
  return result;
}

void main() {
  // Flip Y when sampling the coarse field: the CPU lays out rssi[j*nx+i] with
  // j=0 at world y=0 (top), but GL textures treat row 0 as the bottom.
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  outColor = vec4(sampleCatmullRom(uv), 0.0, 0.0, 1.0);
}`;

// Pass 2/3: separable gaussian blur on R32F. Blur is applied in *output pixel*
// space (matches the CPU path which blurred the rendered ImageData).
const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2  uTexel;      // 1/width, 1/height of src
uniform vec2  uDir;        // (1,0) horizontal, (0,1) vertical
uniform int   uRadius;     // 0..24
uniform float uSigma;
out vec4 outColor;
void main() {
  if (uRadius <= 0) {
    outColor = texture(uSrc, vUv);
    return;
  }
  float sum = 0.0;
  float wsum = 0.0;
  for (int k = -24; k <= 24; ++k) {
    if (k < -uRadius || k > uRadius) continue;
    float fk = float(k);
    float w = exp(-(fk * fk) / (2.0 * uSigma * uSigma));
    vec2 off = uDir * uTexel * fk;
    sum  += texture(uSrc, vUv + off).r * w;
    wsum += w;
  }
  outColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`;

// Pass 4: rssi dBm → RGBA8 using ANCHORS, matching dbmToRgb / dbmToAlpha.
// Anchors are uploaded as a uniform array; we do a simple linear search (8 steps).
const FS_COLORMAP = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec4  uAnchors[5];      // xyzw = (dbm, r, g, b) with r,g,b in 0..255
uniform float uAnchorAlpha[5]; // alpha 0..255 per anchor
uniform int   uContours;        // 0 = off, 1 = draw iso-lines at anchor dbm
out vec4 outColor;

void main() {
  float d = texture(uSrc, vUv).r;
  vec3 rgb;
  float a;
  if (!(d == d)) {
    outColor = vec4(0.0);
    return;
  } else if (d >= uAnchors[0].x) {
    rgb = uAnchors[0].yzw;
    a   = uAnchorAlpha[0];
  } else if (d <= uAnchors[4].x) {
    rgb = uAnchors[4].yzw;
    a   = uAnchorAlpha[4];
  } else {
    rgb = uAnchors[4].yzw;
    a   = uAnchorAlpha[4];
    for (int i = 0; i < 4; ++i) {
      vec4  hi  = uAnchors[i];
      vec4  lo  = uAnchors[i + 1];
      float aHi = uAnchorAlpha[i];
      float aLo = uAnchorAlpha[i + 1];
      if (d <= hi.x && d >= lo.x) {
        float t = (hi.x - d) / (hi.x - lo.x);
        rgb = floor(hi.yzw + (lo.yzw - hi.yzw) * t + 0.5);
        a   = floor(aHi   + (aLo   - aHi  ) * t + 0.5);
        break;
      }
    }
  }
  // Iso-contour lines at anchor dBm levels: screen-space aware so line width
  // stays visually ~1.2 px regardless of zoom. Smoothstep gives a soft edge.
  if (uContours == 1) {
    float halfW = fwidth(d) * 1.2;
    float lineA = 0.0;
    for (int i = 0; i < 5; ++i) {
      float dist = abs(d - uAnchors[i].x);
      lineA = max(lineA, 1.0 - smoothstep(0.0, halfW, dist));
    }
    // Blend toward black at 0.6 opacity where lines are.
    vec3 lineRgb = vec3(0.0);
    float lineAlpha = lineA * 0.6;
    rgb = mix(rgb, lineRgb * 255.0, lineAlpha);
    a   = mix(a, 255.0, lineAlpha);
  }

  outColor = vec4(rgb / 255.0, a / 255.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile failed: ' + log);
  }
  return sh;
}

function link(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error('Program link failed: ' + log);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

export function createHeatmapGL() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    antialias: false,
    alpha: true
  });
  if (!gl) throw new Error('WebGL2 not supported');

  // R32F render targets need this extension.
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('EXT_color_buffer_float not supported');
  }
  // R32F filter setup: the bicubic sample pass uses texelFetch, so the field
  // texture's MIN/MAG filter is functionally irrelevant. NEAREST is the
  // portable default that doesn't require OES_texture_float_linear.

  const progSample   = link(gl, VS, FS_SAMPLE);
  const progBlur     = link(gl, VS, FS_BLUR);
  const progColormap = link(gl, VS, FS_COLORMAP);

  // Fullscreen triangle strip (two triangles).
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
     1, -1,  1,  1,  -1, 1
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Resources reused across frames.
  const fieldTex = gl.createTexture();
  let fieldNx = 0, fieldNy = 0;

  // Two ping-pong R32F targets for sample + blur passes.
  const targets = [createTarget(gl), createTarget(gl)];
  let targetW = 0, targetH = 0;

  // Precomputed anchor uniform (Float32Array of 5*4).
  const anchorData  = new Float32Array(5 * 4);
  const alphaData   = new Float32Array(5);
  function setAnchors(anchors) {
    const src = anchors ?? ANCHORS;
    for (let i = 0; i < 5; i++) {
      anchorData[i * 4    ] = src[i][0];
      anchorData[i * 4 + 1] = src[i][1];
      anchorData[i * 4 + 2] = src[i][2];
      anchorData[i * 4 + 3] = src[i][3];
      alphaData[i]           = Math.round(src[i][4] * 255);
    }
  }
  setAnchors(null);

  function ensureTargets(w, h) {
    if (w === targetW && h === targetH) return;
    targetW = w;
    targetH = h;
    for (const t of targets) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
    }
  }

  function uploadField(field) {
    const { rssi, nx, ny } = field;
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    if (nx !== fieldNx || ny !== fieldNy) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nx, ny, 0, gl.RED, gl.FLOAT, rssi);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      fieldNx = nx;
      fieldNy = ny;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nx, ny, gl.RED, gl.FLOAT, rssi);
    }
  }

  function drawQuad() {
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function render(field, outW, outH, _metersPerPixel, blurRadius, showContours, colorConfig) {
    canvas.width = outW;
    canvas.height = outH;
    ensureTargets(outW, outH);
    uploadField(field);
    setAnchors(colorConfig?.anchors ?? null);

    // --- Pass 1: sample coarse field → targets[0] (R32F, output res) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[0].fbo);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(progSample);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.uniform1i(gl.getUniformLocation(progSample, 'uField'), 0);
    gl.uniform2f(gl.getUniformLocation(progSample, 'uFieldSize'), field.nx, field.ny);
    drawQuad();

    let src = 0; // index into targets[] holding the latest result

    // --- Pass 2/3: separable gaussian blur (skip if radius == 0) ---
    const radius = Math.max(0, Math.min(24, blurRadius | 0));
    if (radius > 0) {
      const sigma = Math.max(radius * 0.8, 0.5);
      gl.useProgram(progBlur);
      gl.uniform1i(gl.getUniformLocation(progBlur, 'uSrc'), 0);
      gl.uniform1i(gl.getUniformLocation(progBlur, 'uRadius'), radius);
      gl.uniform1f(gl.getUniformLocation(progBlur, 'uSigma'), sigma);
      gl.uniform2f(gl.getUniformLocation(progBlur, 'uTexel'), 1 / outW, 1 / outH);

      // horizontal
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1 - src].fbo);
      gl.viewport(0, 0, outW, outH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[src].tex);
      gl.uniform2f(gl.getUniformLocation(progBlur, 'uDir'), 1, 0);
      drawQuad();
      src = 1 - src;

      // vertical
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1 - src].fbo);
      gl.viewport(0, 0, outW, outH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[src].tex);
      gl.uniform2f(gl.getUniformLocation(progBlur, 'uDir'), 0, 1);
      drawQuad();
      src = 1 - src;
    }

    // --- Pass 4: colormap + alpha → default framebuffer (RGBA8 canvas) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outW, outH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(progColormap);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[src].tex);
    gl.uniform1i(gl.getUniformLocation(progColormap, 'uSrc'), 0);
    gl.uniform4fv(gl.getUniformLocation(progColormap, 'uAnchors'), anchorData);
    gl.uniform1fv(gl.getUniformLocation(progColormap, 'uAnchorAlpha'), alphaData);
    gl.uniform1i(gl.getUniformLocation(progColormap, 'uContours'), showContours ? 1 : 0);
    drawQuad();

    return canvas;
  }

  function dispose() {
    gl.deleteProgram(progSample);
    gl.deleteProgram(progBlur);
    gl.deleteProgram(progColormap);
    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(vao);
    gl.deleteTexture(fieldTex);
    for (const t of targets) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
  }

  return { render, dispose, canvas };
}

function createTarget(gl) {
  // R32F intermediate targets: blur/colormap sample on exact texel centers so
  // NEAREST is both safe and avoids the OES_texture_float_linear requirement.
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}

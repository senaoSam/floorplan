import React, { useRef, useEffect } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'

const MAX_APS   = 32
const MAX_WALLS = 64

const FREQ_MHZ = { 2.4: 2437, 5: 5500, 6: 6000 }

// ── Vertex Shader：全螢幕四邊形 ──────────────────────────────────────
const VERT_SRC = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

// ── Fragment Shader：逐像素 RSSI + 牆體衰減 ─────────────────────────
const FRAG_SRC = `#version 300 es
precision highp float;

#define MAX_APS   ${MAX_APS}
#define MAX_WALLS ${MAX_WALLS}

uniform vec2  u_resolution;           // canvas px size
uniform float u_vpX;                  // viewport transform
uniform float u_vpY;
uniform float u_vpScale;
uniform float u_floorScale;           // px per meter
uniform int   u_apCount;
uniform int   u_wallCount;
uniform vec4  u_aps[MAX_APS];         // xy=canvasPos, z=txPower, w=freqMHz
uniform vec4  u_walls[MAX_WALLS];     // xy=segStart, zw=segEnd
uniform float u_wallLoss[MAX_WALLS];  // dB loss per wall

out vec4 outColor;

// log10 via ln
float log10v(float x) { return log(x) * 0.4342944819; }

// 參數式線段相交：0 < t < 1 且 0 < u < 1
bool segHit(vec2 p1, vec2 p2, vec2 p3, vec2 p4) {
  vec2 r   = p2 - p1;
  vec2 s   = p4 - p3;
  float rxs = r.x * s.y - r.y * s.x;
  if (abs(rxs) < 1e-6) return false;  // 平行
  vec2  qp  = p3 - p1;
  float t   = (qp.x * s.y - qp.y * s.x) / rxs;
  float u   = (qp.x * r.y - qp.y * r.x) / rxs;
  return t > 0.0 && t < 1.0 && u > 0.0 && u < 1.0;
}

float wallLoss(vec2 px, vec2 ap) {
  float loss = 0.0;
  for (int i = 0; i < MAX_WALLS; i++) {
    if (i >= u_wallCount) break;
    if (segHit(px, ap, u_walls[i].xy, u_walls[i].zw))
      loss += u_wallLoss[i];
  }
  return loss;
}

// 6 色階：-45(綠) → -60 → -70(黃) → -80 → -90(紅) → -100(暗紅)
vec4 rssiToColor(float v) {
  if (v >= -45.0) return vec4(0.000, 0.902, 0.463, 0.784);
  if (v <= -100.0) return vec4(0.0);
  vec4 c0 = vec4(0.000, 0.902, 0.463, 0.784);
  vec4 c1 = vec4(0.392, 0.863, 0.118, 0.725);
  vec4 c2 = vec4(1.000, 0.784, 0.000, 0.667);
  vec4 c3 = vec4(1.000, 0.314, 0.000, 0.588);
  vec4 c4 = vec4(0.824, 0.000, 0.000, 0.471);
  vec4 c5 = vec4(0.471, 0.000, 0.000, 0.235);
  if (v >= -60.0) return mix(c0, c1, (v + 45.0) / -15.0);
  if (v >= -70.0) return mix(c1, c2, (v + 60.0) / -10.0);
  if (v >= -80.0) return mix(c2, c3, (v + 70.0) / -10.0);
  if (v >= -90.0) return mix(c3, c4, (v + 80.0) / -10.0);
  return              mix(c4, c5, (v + 90.0) / -10.0);
}

void main() {
  if (u_apCount == 0) { outColor = vec4(0.0); return; }

  // 螢幕像素 → canvas 座標（WebGL Y 軸朝上，需翻轉）
  vec2 screen = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 canvas = (screen - vec2(u_vpX, u_vpY)) / u_vpScale;

  float best = -1e10;

  for (int i = 0; i < MAX_APS; i++) {
    if (i >= u_apCount) break;
    vec2  apPos = u_aps[i].xy;
    float txPow = u_aps[i].z;
    float fMHz  = u_aps[i].w;

    float dist = length(canvas - apPos);
    float rssi;
    if (dist < 0.5) {
      rssi = txPow;
    } else {
      float distM = dist / u_floorScale;
      float fspl  = 20.0 * log10v(distM) + 20.0 * log10v(fMHz) + 32.44;
      float wl    = wallLoss(canvas, apPos);
      rssi = txPow - fspl - wl;
    }
    best = max(best, rssi);
  }

  outColor = rssiToColor(best);
}`

// ── WebGL helpers ─────────────────────────────────────────────────────
function makeShader(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[HeatmapWebGL] shader error:\n', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

function makeProgram(gl) {
  const vs = makeShader(gl, gl.VERTEX_SHADER,   VERT_SRC)
  const fs = makeShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
  if (!vs || !fs) return null
  const prog = gl.createProgram()
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[HeatmapWebGL] link error:', gl.getProgramInfoLog(prog))
    return null
  }
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  return prog
}

// ── 主元件 ────────────────────────────────────────────────────────────
function HeatmapWebGL({ width, height, stageRef, draggingAPRef }) {
  const canvasRef = useRef(null)

  const showHeatmap   = useEditorStore((s) => s.showHeatmap)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floorScale    = useFloorStore((s) => s.scale)

  const showHeatmapRef   = useRef(showHeatmap)
  const activeFloorIdRef = useRef(activeFloorId)
  const floorScaleRef    = useRef(floorScale)

  useEffect(() => { showHeatmapRef.current   = showHeatmap   }, [showHeatmap])
  useEffect(() => { activeFloorIdRef.current = activeFloorId }, [activeFloorId])
  useEffect(() => { floorScaleRef.current    = floorScale    }, [floorScale])

  // ── WebGL 初始化 + RAF loop（mount 一次）──────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false })
    if (!gl) {
      console.warn('[HeatmapWebGL] WebGL2 not supported')
      return
    }

    const prog = makeProgram(gl)
    if (!prog) return

    // 全螢幕四邊形（兩個三角形）
    const vao    = gl.createVertexArray()
    const posBuf = gl.createBuffer()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),
      gl.STATIC_DRAW)
    const posLoc = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    // Uniform locations
    const locs = {
      resolution: gl.getUniformLocation(prog, 'u_resolution'),
      vpX:        gl.getUniformLocation(prog, 'u_vpX'),
      vpY:        gl.getUniformLocation(prog, 'u_vpY'),
      vpScale:    gl.getUniformLocation(prog, 'u_vpScale'),
      floorScale: gl.getUniformLocation(prog, 'u_floorScale'),
      apCount:    gl.getUniformLocation(prog, 'u_apCount'),
      wallCount:  gl.getUniformLocation(prog, 'u_wallCount'),
      aps:        gl.getUniformLocation(prog, 'u_aps[0]'),
      walls:      gl.getUniformLocation(prog, 'u_walls[0]'),
      wallLoss:   gl.getUniformLocation(prog, 'u_wallLoss[0]'),
    }

    // 預分配 uniform 資料緩衝（避免每幀 GC）
    const apData       = new Float32Array(MAX_APS   * 4)
    const wallPosData  = new Float32Array(MAX_WALLS * 4)
    const wallLossData = new Float32Array(MAX_WALLS)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(prog)

    // ── RAF loop ─────────────────────────────────────────────────────
    let rafId
    let prevKey = null

    const loop = () => {
      rafId = requestAnimationFrame(loop)

      const stage   = stageRef.current
      const showH   = showHeatmapRef.current
      const floorId = activeFloorIdRef.current
      const floorS  = floorScaleRef.current
      const w = canvas.width
      const h = canvas.height

      if (!stage || w === 0 || h === 0) return

      // 隱藏或無比例尺 → 清除
      if (!showH || !floorS) {
        if (prevKey !== null) {
          gl.viewport(0, 0, w, h)
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          prevKey = null
        }
        return
      }

      // 取得最新 AP 資料
      let aps = useAPStore.getState().apsByFloor[floorId] ?? []
      const drag = draggingAPRef?.current
      if (drag) aps = aps.map((a) => a.id === drag.id ? { ...a, x: drag.x, y: drag.y } : a)

      if (aps.length === 0) {
        if (prevKey !== null) {
          gl.viewport(0, 0, w, h)
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          prevKey = null
        }
        return
      }

      const rawWalls = useWallStore.getState().wallsByFloor[floorId] ?? []
      const vp = { x: stage.x(), y: stage.y(), scale: stage.scaleX() }

      // 變化偵測，未變化直接跳過
      const apKey   = aps.map((a) => `${a.id}:${a.x.toFixed(1)},${a.y.toFixed(1)},${a.txPower},${a.frequency}`).join('|')
      const wallKey = rawWalls.map((wl) => `${wl.startX},${wl.startY},${wl.endX},${wl.endY},${wl.material?.dbLoss}`).join('|')
      const key = `${w},${h},${vp.x.toFixed(1)},${vp.y.toFixed(1)},${vp.scale.toFixed(4)},${floorS},${apKey},${wallKey}`
      if (key === prevKey) return
      prevKey = key

      // 填充 AP uniform 資料
      const apCount = Math.min(aps.length, MAX_APS)
      for (let i = 0; i < apCount; i++) {
        const a = aps[i]
        apData[i*4]   = a.x
        apData[i*4+1] = a.y
        apData[i*4+2] = a.txPower
        apData[i*4+3] = FREQ_MHZ[a.frequency] ?? 5500
      }

      // 填充 Wall uniform 資料
      const wallCount = Math.min(rawWalls.length, MAX_WALLS)
      for (let i = 0; i < wallCount; i++) {
        const wl = rawWalls[i]
        wallPosData[i*4]   = wl.startX
        wallPosData[i*4+1] = wl.startY
        wallPosData[i*4+2] = wl.endX
        wallPosData[i*4+3] = wl.endY
        wallLossData[i]    = wl.material?.dbLoss ?? 0
      }

      // 繪製
      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.uniform2f(locs.resolution, w, h)
      gl.uniform1f(locs.vpX,        vp.x)
      gl.uniform1f(locs.vpY,        vp.y)
      gl.uniform1f(locs.vpScale,    vp.scale)
      gl.uniform1f(locs.floorScale, floorS)
      gl.uniform1i(locs.apCount,    apCount)
      gl.uniform1i(locs.wallCount,  wallCount)
      gl.uniform4fv(locs.aps,       apData)
      gl.uniform4fv(locs.walls,     wallPosData)
      gl.uniform1fv(locs.wallLoss,  wallLossData)

      gl.bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      gl.bindVertexArray(null)
    }

    rafId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafId)
      gl.deleteVertexArray(vao)
      gl.deleteBuffer(posBuf)
      gl.deleteProgram(prog)
    }
  }, [stageRef, draggingAPRef])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        display: showHeatmap ? 'block' : 'none',
      }}
    />
  )
}

export default HeatmapWebGL

import React, { useRef, useEffect } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useScopeStore } from '@/store/useScopeStore'

const MAX_APS        = 32
const MAX_WALLS      = 64
const MAX_SCOPE_PTS  = 64

const FREQ_MHZ    = { 2.4: 2437, 5: 5500, 6: 6000 }
const DEFAULT_CHAN = { 2.4: 1,    5: 36,   6: 1    }

// ── Vertex Shader：全螢幕四邊形 ──────────────────────────────────────
const VERT_SRC = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

// ── Fragment Shader：逐像素 SINR（含同頻干擾 + 牆體衰減 + Scope mask）
const FRAG_SRC = `#version 300 es
precision highp float;

#define MAX_APS       ${MAX_APS}
#define MAX_WALLS     ${MAX_WALLS}
#define MAX_SCOPE_PTS ${MAX_SCOPE_PTS}

uniform vec2  u_resolution;
uniform float u_vpX;
uniform float u_vpY;
uniform float u_vpScale;
uniform float u_floorScale;
uniform int   u_apCount;
uniform int   u_wallCount;
uniform vec4  u_aps[MAX_APS];
uniform float u_apChannels[MAX_APS];
uniform vec4  u_walls[MAX_WALLS];
uniform float u_wallLoss[MAX_WALLS];
uniform vec2  u_scopePts[MAX_SCOPE_PTS];
uniform int   u_scopePtCount;

out vec4 outColor;

float log10v(float x) { return log(x) * 0.4342944819; }

bool segHit(vec2 p1, vec2 p2, vec2 p3, vec2 p4) {
  vec2 r   = p2 - p1;
  vec2 s   = p4 - p3;
  float rxs = r.x * s.y - r.y * s.x;
  if (abs(rxs) < 1e-6) return false;
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

// Ray-casting point-in-polygon（canvas 座標）
bool pointInScope(vec2 p) {
  bool inside = false;
  int n = u_scopePtCount;
  int j = n - 1;
  for (int i = 0; i < MAX_SCOPE_PTS; i++) {
    if (i >= n) break;
    vec2 pi = u_scopePts[i];
    vec2 pj = u_scopePts[j];
    if ((pi.y > p.y) != (pj.y > p.y) &&
        p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

// SINR 色階（參考 Hamina 配色）
vec4 sinrToColor(float v) {
  if (v >= 25.0) return vec4(0.659, 0.831, 0.000, 0.85);
  if (v <= -3.0) return vec4(0.0);
  vec4 c0 = vec4(0.659, 0.831, 0.000, 0.85);   // 25 dB  萊姆黃綠
  vec4 c1 = vec4(0.800, 0.900, 0.100, 0.82);   // 20 dB  亮黃綠
  vec4 c2 = vec4(1.000, 0.820, 0.000, 0.80);   // 15 dB  黃
  vec4 c3 = vec4(1.000, 0.420, 0.000, 0.80);   // 10 dB  橘
  vec4 c4 = vec4(0.900, 0.100, 0.050, 0.78);   //  5 dB  紅
  vec4 c5 = vec4(0.600, 0.000, 0.000, 0.70);   //  0 dB  暗紅
  vec4 c6 = vec4(0.400, 0.000, 0.000, 0.0);    // -3 dB  透明消退
  if (v >= 20.0) return mix(c0, c1, (25.0 - v) / 5.0);
  if (v >= 15.0) return mix(c1, c2, (20.0 - v) / 5.0);
  if (v >= 10.0) return mix(c2, c3, (15.0 - v) / 5.0);
  if (v >=  5.0) return mix(c3, c4, (10.0 - v) / 5.0);
  if (v >=  0.0) return mix(c4, c5, ( 5.0 - v) / 5.0);
  return               mix(c5, c6, ( 0.0 - v) / 3.0);
}

void main() {
  if (u_apCount == 0) { outColor = vec4(0.0); return; }

  vec2 screen = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 canvas = (screen - vec2(u_vpX, u_vpY)) / u_vpScale;

  // Scope mask：有定義範圍時，範圍外不渲染
  if (u_scopePtCount > 0 && !pointInScope(canvas)) {
    outColor = vec4(0.0);
    return;
  }

  // Pass 1：計算每顆 AP 的 RSSI，找出最佳服務 AP
  float rssis[MAX_APS];
  float bestRSSI = -1e10;
  int   bestIdx  = 0;

  for (int i = 0; i < MAX_APS; i++) {
    float rssi = -1e10;
    if (i < u_apCount) {
      vec2  apPos = u_aps[i].xy;
      float txPow = u_aps[i].z;
      float fMHz  = u_aps[i].w;
      float dist  = length(canvas - apPos);
      if (dist < 0.5) {
        rssi = txPow;
      } else {
        float distM = dist / u_floorScale;
        float fspl  = 20.0 * log10v(distM) + 20.0 * log10v(fMHz) - 27.56;
        rssi = txPow - fspl - wallLoss(canvas, apPos);
      }
      if (rssi > bestRSSI) { bestRSSI = rssi; bestIdx = i; }
    }
    rssis[i] = rssi;
  }

  if (bestRSSI < -100.0) { outColor = vec4(0.0); return; }

  // Pass 2：累積同頻干擾
  float servingChan = u_apChannels[bestIdx];
  float servingFreq = u_aps[bestIdx].w;

  const float NOISE_DBM = -95.0;
  float intfLinear = pow(10.0, NOISE_DBM / 10.0);

  for (int i = 0; i < MAX_APS; i++) {
    if (i >= u_apCount) break;
    if (i == bestIdx) continue;
    if (abs(u_apChannels[i] - servingChan) > 0.5) continue;
    if (abs(u_aps[i].w      - servingFreq) > 100.0) continue;
    intfLinear += pow(10.0, rssis[i] / 10.0);
  }

  float sinr = 10.0 * log10v(pow(10.0, bestRSSI / 10.0) / intfLinear);
  outColor = sinrToColor(sinr);
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

// ── SINR Legend ───────────────────────────────────────────────────────
const LEGEND_ITEMS = [
  { label: '≥ 25 dB', color: 'rgba(168,212,0,0.85)' },
  { label: '20 dB',   color: 'rgba(204,230,26,0.82)' },
  { label: '15 dB',   color: 'rgba(255,209,0,0.80)'  },
  { label: '10 dB',   color: 'rgba(255,107,0,0.80)'  },
  { label: '5 dB',    color: 'rgba(230,26,13,0.78)'  },
  { label: '0 dB',    color: 'rgba(153,0,0,0.70)'    },
  { label: '無覆蓋',  color: 'transparent', noSignal: true },
]

function HeatmapLegend() {
  return (
    <div style={{
      position: 'absolute',
      bottom: 16,
      right: 16,
      zIndex: 400,
      background: 'rgba(18,18,30,0.90)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 8,
      padding: '8px 12px',
      minWidth: 110,
      pointerEvents: 'none',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#4fc3f7', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
        SINR
      </div>
      {LEGEND_ITEMS.map((item) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
          <div style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            background: item.noSignal ? 'transparent' : item.color,
            border: item.noSignal ? '1px dashed rgba(255,255,255,0.3)' : 'none',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', fontFamily: 'monospace' }}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── 主元件 ────────────────────────────────────────────────────────────
function HeatmapWebGL({ width, height, stageRef, draggingAPRef, draggingWallRef, draggingScopeRef }) {
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

    // 全螢幕四邊形
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
      resolution:   gl.getUniformLocation(prog, 'u_resolution'),
      vpX:          gl.getUniformLocation(prog, 'u_vpX'),
      vpY:          gl.getUniformLocation(prog, 'u_vpY'),
      vpScale:      gl.getUniformLocation(prog, 'u_vpScale'),
      floorScale:   gl.getUniformLocation(prog, 'u_floorScale'),
      apCount:      gl.getUniformLocation(prog, 'u_apCount'),
      wallCount:    gl.getUniformLocation(prog, 'u_wallCount'),
      aps:          gl.getUniformLocation(prog, 'u_aps[0]'),
      apChannels:   gl.getUniformLocation(prog, 'u_apChannels[0]'),
      walls:        gl.getUniformLocation(prog, 'u_walls[0]'),
      wallLoss:     gl.getUniformLocation(prog, 'u_wallLoss[0]'),
      scopePts:     gl.getUniformLocation(prog, 'u_scopePts[0]'),
      scopePtCount: gl.getUniformLocation(prog, 'u_scopePtCount'),
    }

    // 預分配 uniform 資料緩衝
    const apData       = new Float32Array(MAX_APS        * 4)
    const apChanData   = new Float32Array(MAX_APS)
    const wallPosData  = new Float32Array(MAX_WALLS      * 4)
    const wallLossData = new Float32Array(MAX_WALLS)
    const scopePtsData = new Float32Array(MAX_SCOPE_PTS  * 2)

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

      if (!showH || !floorS) {
        if (prevKey !== null) {
          gl.viewport(0, 0, w, h)
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          prevKey = null
        }
        return
      }

      // AP 資料（含拖移覆蓋）
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

      // 牆體資料（含拖移覆蓋）
      let rawWalls = useWallStore.getState().wallsByFloor[floorId] ?? []
      const dragWall = draggingWallRef?.current
      if (dragWall) {
        rawWalls = rawWalls.map((wl) =>
          wl.id === dragWall.id
            ? { ...wl, startX: wl.startX + dragWall.dx, startY: wl.startY + dragWall.dy,
                       endX:   wl.endX   + dragWall.dx, endY:   wl.endY   + dragWall.dy }
            : wl
        )
      }

      // Scope mask：取第一個 type:'in' 的範圍（含拖移偏移）
      const scopes  = useScopeStore.getState().scopesByFloor[floorId] ?? []
      const inScope = scopes.find((s) => s.type === 'in')
      let scopePtCount = 0
      if (inScope) {
        const dragScope = draggingScopeRef?.current
        const isDragging = dragScope && dragScope.id === inScope.id
        const dx = isDragging ? dragScope.dx : 0
        const dy = isDragging ? dragScope.dy : 0
        const pts = inScope.points  // flat [x0,y0,x1,y1,...]
        scopePtCount = Math.min(pts.length / 2, MAX_SCOPE_PTS)
        for (let i = 0; i < scopePtCount; i++) {
          scopePtsData[i * 2]     = pts[i * 2]     + dx
          scopePtsData[i * 2 + 1] = pts[i * 2 + 1] + dy
        }
      }

      const vp = { x: stage.x(), y: stage.y(), scale: stage.scaleX() }

      // 變化偵測
      const apKey    = aps.map((a) => `${a.id}:${a.x.toFixed(1)},${a.y.toFixed(1)},${a.txPower},${a.frequency},${a.channel ?? 0}`).join('|')
      const wallKey  = rawWalls.map((wl) => `${wl.startX},${wl.startY},${wl.endX},${wl.endY},${wl.material?.dbLoss}`).join('|')
      const dragScope = draggingScopeRef?.current
      const scopeKey  = inScope
        ? `${inScope.id},${dragScope?.id === inScope.id ? `${dragScope.dx.toFixed(1)},${dragScope.dy.toFixed(1)}` : '0,0'}`
        : 'none'
      const key = `${w},${h},${vp.x.toFixed(1)},${vp.y.toFixed(1)},${vp.scale.toFixed(4)},${floorS},${apKey},${wallKey},${scopeKey}`
      if (key === prevKey) return
      prevKey = key

      // 填充 AP uniform
      const apCount = Math.min(aps.length, MAX_APS)
      for (let i = 0; i < apCount; i++) {
        const a = aps[i]
        apData[i*4]   = a.x
        apData[i*4+1] = a.y
        apData[i*4+2] = a.txPower
        apData[i*4+3] = FREQ_MHZ[a.frequency] ?? 5500
        apChanData[i] = a.channel ?? DEFAULT_CHAN[a.frequency] ?? 1
      }

      // 填充 Wall uniform
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

      gl.uniform2f(locs.resolution,   w, h)
      gl.uniform1f(locs.vpX,          vp.x)
      gl.uniform1f(locs.vpY,          vp.y)
      gl.uniform1f(locs.vpScale,      vp.scale)
      gl.uniform1f(locs.floorScale,   floorS)
      gl.uniform1i(locs.apCount,      apCount)
      gl.uniform1i(locs.wallCount,    wallCount)
      gl.uniform4fv(locs.aps,         apData)
      gl.uniform1fv(locs.apChannels,  apChanData)
      gl.uniform4fv(locs.walls,       wallPosData)
      gl.uniform1fv(locs.wallLoss,    wallLossData)
      gl.uniform2fv(locs.scopePts,    scopePtsData)
      gl.uniform1i(locs.scopePtCount, scopePtCount)

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
  }, [stageRef, draggingAPRef, draggingWallRef, draggingScopeRef])

  return (
    <>
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
      {showHeatmap && <HeatmapLegend />}
    </>
  )
}

export default HeatmapWebGL

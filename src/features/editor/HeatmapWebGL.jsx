import React, { useRef, useEffect } from 'react'
import { useEditorStore, HEATMAP_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useScopeStore } from '@/store/useScopeStore'

const MAX_APS        = 32
const MAX_WALLS      = 64
const MAX_SCOPE_PTS  = 256

const FREQ_MHZ    = { 2.4: 2437, 5: 5500, 6: 6000 }
const DEFAULT_CHAN = { 2.4: 1,    5: 36,   6: 1    }

// 頻段索引：用於 wallLoss3 查表（0=2.4, 1=5, 2=6）
const FREQ_BAND_INDEX = { 2.4: 0, 5: 1, 6: 2 }

// ── Vertex Shader：全螢幕四邊形 ──────────────────────────────────────
const VERT_SRC = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

// ── Fragment Shader：逐像素多模式（RSSI / SINR / SNR / Channel Overlap / Data Rate / AP Count）
const FRAG_SRC = `#version 300 es
precision highp float;

#define MAX_APS       ${MAX_APS}
#define MAX_WALLS     ${MAX_WALLS}
#define MAX_SCOPE_PTS ${MAX_SCOPE_PTS}

// 模式常數
#define MODE_RSSI             0
#define MODE_SINR             1
#define MODE_SNR              2
#define MODE_CHANNEL_OVERLAP  3
#define MODE_DATA_RATE        4
#define MODE_AP_COUNT         5

uniform vec2  u_resolution;
uniform float u_vpX;
uniform float u_vpY;
uniform float u_vpScale;
uniform float u_floorScale;
uniform int   u_apCount;
uniform int   u_wallCount;
uniform vec4  u_aps[MAX_APS];          // xy = pos, z = txPower, w = freqMHz
uniform float u_apChannels[MAX_APS];
uniform float u_apFreqBand[MAX_APS];   // 頻段索引 0=2.4, 1=5, 2=6
uniform vec4  u_walls[MAX_WALLS];
uniform vec3  u_wallLoss3[MAX_WALLS];  // xyz = 2.4GHz / 5GHz / 6GHz 衰減
uniform vec2  u_scopePts[MAX_SCOPE_PTS];
uniform int   u_scopePtCount;
uniform int   u_mode;
uniform float u_pathLossN;

out vec4 outColor;

const float NOISE_DBM = -95.0;
const float NOISE_LIN = 3.1623e-10;  // pow(10, -95/10)

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

// 頻段相關的牆體衰減
float wallLoss(vec2 px, vec2 ap, int freqIdx) {
  float loss = 0.0;
  for (int i = 0; i < MAX_WALLS; i++) {
    if (i >= u_wallCount) break;
    if (segHit(px, ap, u_walls[i].xy, u_walls[i].zw)) {
      loss += (freqIdx == 0) ? u_wallLoss3[i].x
            : (freqIdx == 1) ? u_wallLoss3[i].y
            :                  u_wallLoss3[i].z;
    }
  }
  return loss;
}

// 多 scope 聯集：u_scopeRanges[k] = (start, count)，每組為一個多邊形
// 落在任一多邊形內即為 true
#define MAX_SCOPES 8
uniform vec2 u_scopeRanges[MAX_SCOPES];     // in-scope (start, count)
uniform int  u_scopeCount;
uniform vec2 u_outScopeRanges[MAX_SCOPES];  // out-scope (start, count)
uniform int  u_outScopeCount;

bool pointInPoly(vec2 p, int start, int n) {
  bool inside = false;
  int j = start + n - 1;
  for (int i = 0; i < MAX_SCOPE_PTS; i++) {
    int idx = start + i;
    if (i >= n) break;
    vec2 pi = u_scopePts[idx];
    vec2 pj = u_scopePts[j];
    if ((pi.y > p.y) != (pj.y > p.y) &&
        p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
    j = idx;
  }
  return inside;
}

bool pointInScope(vec2 p) {
  // 有 in-scope 時：必須在任一 in-scope 內
  if (u_scopeCount > 0) {
    bool inAny = false;
    for (int k = 0; k < MAX_SCOPES; k++) {
      if (k >= u_scopeCount) break;
      int start = int(u_scopeRanges[k].x);
      int count = int(u_scopeRanges[k].y);
      if (pointInPoly(p, start, count)) { inAny = true; break; }
    }
    if (!inAny) return false;
  }
  // 不能在任何 out-scope 內
  for (int k = 0; k < MAX_SCOPES; k++) {
    if (k >= u_outScopeCount) break;
    int start = int(u_outScopeRanges[k].x);
    int count = int(u_outScopeRanges[k].y);
    if (pointInPoly(p, start, count)) return false;
  }
  return true;
}

// ── Cisco 風格色階（紅=強、藍=弱）──────────────────────────────────

// RSSI 色階（Cisco 風格 — 紅→橘→黃→綠→青→藍）
vec4 rssiColor(float v) {
  if (v >= -35.0) return vec4(0.92, 0.10, 0.10, 0.90);   // 亮紅（最強）
  if (v < -85.0)  return vec4(0.0);
  vec4 c0 = vec4(0.92, 0.10, 0.10, 0.90);  // -35  紅（極佳）
  vec4 c1 = vec4(1.0,  0.50, 0.05, 0.88);  // -45  橘
  vec4 c2 = vec4(1.0,  0.85, 0.10, 0.86);  // -55  黃
  vec4 c3 = vec4(0.40, 0.85, 0.25, 0.84);  // -65  綠
  vec4 c4 = vec4(0.10, 0.75, 0.80, 0.80);  // -75  青
  vec4 c5 = vec4(0.12, 0.35, 0.80, 0.55);  // -85  藍（淡出）

  if (v >= -45.0) return mix(c0, c1, (-35.0 - v) / 10.0);
  if (v >= -55.0) return mix(c1, c2, (-45.0 - v) / 10.0);
  if (v >= -65.0) return mix(c2, c3, (-55.0 - v) / 10.0);
  if (v >= -75.0) return mix(c3, c4, (-65.0 - v) / 10.0);
  return             mix(c4, c5, (-75.0 - v) / 10.0);
}

// SINR 色階（Cisco 風格）
vec4 sinrColor(float v) {
  if (v >= 25.0) return vec4(0.92, 0.10, 0.10, 0.90);
  if (v < 0.0)   return vec4(0.0);
  vec4 c0 = vec4(0.92, 0.10, 0.10, 0.90);  // 25 dB 紅（極佳）
  vec4 c1 = vec4(1.0,  0.50, 0.05, 0.88);  // 20 dB 橘
  vec4 c2 = vec4(1.0,  0.85, 0.10, 0.85);  // 15 dB 黃
  vec4 c3 = vec4(0.40, 0.85, 0.25, 0.82);  // 10 dB 綠
  vec4 c4 = vec4(0.10, 0.75, 0.80, 0.78);  //  5 dB 青
  vec4 c5 = vec4(0.12, 0.35, 0.80, 0.40);  //  0 dB 藍（淡出）
  if (v >= 20.0) return mix(c0, c1, (25.0 - v) / 5.0);
  if (v >= 15.0) return mix(c1, c2, (20.0 - v) / 5.0);
  if (v >= 10.0) return mix(c2, c3, (15.0 - v) / 5.0);
  if (v >=  5.0) return mix(c3, c4, (10.0 - v) / 5.0);
  return               mix(c4, c5, ( 5.0 - v) / 5.0);
}

// SNR 色階（Cisco 風格）
vec4 snrColor(float v) {
  if (v >= 40.0) return vec4(0.92, 0.10, 0.10, 0.90);
  if (v <= 0.0)  return vec4(0.0);
  vec4 c0 = vec4(0.92, 0.10, 0.10, 0.90);  // 40 dB 紅
  vec4 c1 = vec4(1.0,  0.50, 0.05, 0.88);  // 30 dB 橘
  vec4 c2 = vec4(1.0,  0.85, 0.10, 0.85);  // 20 dB 黃
  vec4 c3 = vec4(0.10, 0.75, 0.80, 0.78);  // 10 dB 青
  vec4 c4 = vec4(0.12, 0.35, 0.80, 0.40);  //  0 dB 藍
  if (v >= 30.0) return mix(c0, c1, (40.0 - v) / 10.0);
  if (v >= 20.0) return mix(c1, c2, (30.0 - v) / 10.0);
  if (v >= 10.0) return mix(c2, c3, (20.0 - v) / 10.0);
  return               mix(c3, c4, (10.0 - v) / 10.0);
}

// Channel Overlap 色階（Cisco 風格：1=紅最佳、4+=藍過多）
vec4 overlapColor(int count) {
  if (count <= 0)  return vec4(0.0);
  if (count == 1)  return vec4(0.92, 0.10, 0.10, 0.80);  // 紅 — 無重疊（佳）
  if (count == 2)  return vec4(1.0,  0.85, 0.10, 0.78);  // 黃 — 2 重疊
  if (count == 3)  return vec4(0.10, 0.75, 0.80, 0.75);  // 青 — 3 重疊
  return                  vec4(0.12, 0.35, 0.80, 0.75);  // 藍 — 4+（差）
}

// Data Rate 色階（Cisco 風格：高速=紅、低速=藍）
vec4 dataRateColor(float rate) {
  if (rate <= 0.0) return vec4(0.0);
  float t = clamp(rate / 600.0, 0.0, 1.0);
  vec4 cLow  = vec4(0.12, 0.35, 0.80, 0.55);  // 藍（低速）
  vec4 cMid  = vec4(1.0,  0.85, 0.10, 0.78);  // 黃（中速）
  vec4 cHigh = vec4(0.92, 0.10, 0.10, 0.90);  // 紅（高速）
  if (t < 0.5) return mix(cLow, cMid, t * 2.0);
  return mix(cMid, cHigh, (t - 0.5) * 2.0);
}

// AP Count 色階（Cisco 風格）
vec4 apCountColor(int count) {
  if (count <= 0) return vec4(0.0);
  if (count == 1) return vec4(0.12, 0.35, 0.80, 0.60);  // 藍 — 僅 1 顆（冗餘不足）
  if (count == 2) return vec4(0.92, 0.10, 0.10, 0.80);  // 紅 — 2 顆（理想）
  if (count == 3) return vec4(1.0,  0.50, 0.05, 0.78);  // 橘 — 3 顆
  return                 vec4(1.0,  0.85, 0.10, 0.75);  // 黃 — 4+（過多）
}

// SINR → 預估 Data Rate (Mbps)，簡化 MCS 映射
float sinrToRate(float sinr) {
  if (sinr < 2.0)  return 0.0;
  if (sinr < 5.0)  return 6.5;     // MCS 0
  if (sinr < 9.0)  return 13.0;    // MCS 1
  if (sinr < 11.0) return 19.5;    // MCS 2
  if (sinr < 15.0) return 26.0;    // MCS 3
  if (sinr < 18.0) return 39.0;    // MCS 4
  if (sinr < 20.0) return 52.0;    // MCS 5
  if (sinr < 22.0) return 58.5;    // MCS 6
  if (sinr < 25.0) return 65.0;    // MCS 7
  if (sinr < 29.0) return 78.0;    // MCS 8
  return 86.5;                      // MCS 9
  // 多 spatial streams 倍率由顯示端換算
}

void main() {
  if (u_apCount == 0) { outColor = vec4(0.0); return; }

  vec2 screen = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 canvas = (screen - vec2(u_vpX, u_vpY)) / u_vpScale;

  if (u_scopeCount > 0 || u_outScopeCount > 0) {
    if (!pointInScope(canvas)) { outColor = vec4(0.0); return; }
  }

  // Pass 1：計算每顆 AP 的 RSSI
  float rssis[MAX_APS];
  float bestRSSI = -1e10;
  int   bestIdx  = 0;
  int   hearable = 0;  // RSSI > -85 的 AP 數

  for (int i = 0; i < MAX_APS; i++) {
    float rssi = -1e10;
    if (i < u_apCount) {
      vec2  apPos  = u_aps[i].xy;
      float txPow  = u_aps[i].z;
      float fMHz   = u_aps[i].w;
      int   fIdx   = int(u_apFreqBand[i]);
      float dist   = length(canvas - apPos);
      if (dist < 0.5) {
        rssi = txPow;
      } else {
        float distM = dist / u_floorScale;
        float fspl  = 10.0 * u_pathLossN * log10v(distM) + 20.0 * log10v(fMHz) - 27.55;
        rssi = txPow - fspl - wallLoss(canvas, apPos, fIdx);
      }
      if (rssi > bestRSSI) { bestRSSI = rssi; bestIdx = i; }
      if (rssi > -85.0) hearable++;
    }
    rssis[i] = rssi;
  }

  if (bestRSSI < -100.0) { outColor = vec4(0.0); return; }

  // ── Mode: RSSI ──
  if (u_mode == MODE_RSSI) {
    outColor = rssiColor(bestRSSI);
    return;
  }

  // ── Mode: AP Count ──
  if (u_mode == MODE_AP_COUNT) {
    outColor = apCountColor(hearable);
    return;
  }

  // Pass 2：共用 — 計算 SINR / SNR
  float servingChan = u_apChannels[bestIdx];
  float servingFreq = u_aps[bestIdx].w;
  float signalLin   = pow(10.0, bestRSSI / 10.0);
  float intfLinear  = NOISE_LIN;

  // Channel overlap 計數
  int overlapCount = 0;

  for (int i = 0; i < MAX_APS; i++) {
    if (i >= u_apCount) break;
    if (rssis[i] < -100.0) continue;

    // 同頻段、同頻道判斷
    bool sameChan = abs(u_apChannels[i] - servingChan) < 0.5 &&
                    abs(u_aps[i].w - servingFreq) < 100.0;

    if (sameChan && rssis[i] > -85.0) overlapCount++;

    if (i == bestIdx) continue;
    if (!sameChan) continue;
    intfLinear += pow(10.0, rssis[i] / 10.0);
  }

  float sinr = 10.0 * log10v(signalLin / intfLinear);
  float snr  = bestRSSI - NOISE_DBM;

  // ── Mode: SINR ──
  if (u_mode == MODE_SINR) {
    outColor = sinrColor(sinr);
    return;
  }

  // ── Mode: SNR ──
  if (u_mode == MODE_SNR) {
    outColor = snrColor(snr);
    return;
  }

  // ── Mode: Channel Overlap ──
  if (u_mode == MODE_CHANNEL_OVERLAP) {
    outColor = overlapColor(overlapCount);
    return;
  }

  // ── Mode: Data Rate ──
  if (u_mode == MODE_DATA_RATE) {
    float rate = sinrToRate(sinr);
    // 假設 2 spatial streams → ×2
    rate *= 2.0;
    outColor = dataRateColor(rate);
    return;
  }

  outColor = vec4(0.0);
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

// ── 模式名稱對應 shader int ────────────────────────────────────────
const MODE_INT = {
  [HEATMAP_MODE.RSSI]:            0,
  [HEATMAP_MODE.SINR]:            1,
  [HEATMAP_MODE.SNR]:             2,
  [HEATMAP_MODE.CHANNEL_OVERLAP]: 3,
  [HEATMAP_MODE.DATA_RATE]:       4,
  [HEATMAP_MODE.AP_COUNT]:        5,
}

// ── Legend 配置 ──────────────────────────────────────────────────────
const LEGENDS = {
  [HEATMAP_MODE.RSSI]: {
    title: 'RSSI',
    items: [
      { label: '≥ −35 dBm', color: 'rgba(235,26,26,0.90)' },
      { label: '−45 dBm',   color: 'rgba(255,128,13,0.88)' },
      { label: '−55 dBm',   color: 'rgba(255,217,26,0.86)' },
      { label: '−65 dBm',   color: 'rgba(102,217,64,0.84)' },
      { label: '−75 dBm',   color: 'rgba(26,191,204,0.80)' },
      { label: '−85 dBm',   color: 'rgba(31,89,204,0.55)' },
      { label: '無覆蓋',     color: 'transparent', noSignal: true },
    ],
  },
  [HEATMAP_MODE.SINR]: {
    title: 'SINR',
    items: [
      { label: '≥ 25 dB', color: 'rgba(235,26,26,0.90)' },
      { label: '20 dB',   color: 'rgba(255,128,13,0.88)' },
      { label: '15 dB',   color: 'rgba(255,217,26,0.85)' },
      { label: '10 dB',   color: 'rgba(102,217,64,0.82)' },
      { label: '5 dB',    color: 'rgba(26,191,204,0.78)' },
      { label: '0 dB',    color: 'rgba(31,89,204,0.40)' },
      { label: '無覆蓋',   color: 'transparent', noSignal: true },
    ],
  },
  [HEATMAP_MODE.SNR]: {
    title: 'SNR',
    items: [
      { label: '≥ 40 dB', color: 'rgba(235,26,26,0.90)' },
      { label: '30 dB',   color: 'rgba(255,128,13,0.88)' },
      { label: '20 dB',   color: 'rgba(255,217,26,0.85)' },
      { label: '10 dB',   color: 'rgba(26,191,204,0.78)' },
      { label: '0 dB',    color: 'rgba(31,89,204,0.40)' },
    ],
  },
  [HEATMAP_MODE.CHANNEL_OVERLAP]: {
    title: '頻道重疊',
    items: [
      { label: '1 AP',  color: 'rgba(235,26,26,0.80)' },
      { label: '2 AP',  color: 'rgba(255,217,26,0.78)' },
      { label: '3 AP',  color: 'rgba(26,191,204,0.75)' },
      { label: '4+ AP', color: 'rgba(31,89,204,0.75)' },
      { label: '無覆蓋', color: 'transparent', noSignal: true },
    ],
  },
  [HEATMAP_MODE.DATA_RATE]: {
    title: '預估速率',
    items: [
      { label: '≥ 130 Mbps', color: 'rgba(235,26,26,0.90)' },
      { label: '100 Mbps',   color: 'rgba(255,128,13,0.85)' },
      { label: '60 Mbps',    color: 'rgba(255,217,26,0.78)' },
      { label: '26 Mbps',    color: 'rgba(26,191,204,0.70)' },
      { label: '< 13 Mbps',  color: 'rgba(31,89,204,0.55)' },
      { label: '無覆蓋',      color: 'transparent', noSignal: true },
    ],
  },
  [HEATMAP_MODE.AP_COUNT]: {
    title: '可用 AP 數',
    items: [
      { label: '1 顆',  color: 'rgba(31,89,204,0.60)' },
      { label: '2 顆',  color: 'rgba(235,26,26,0.80)' },
      { label: '3 顆',  color: 'rgba(255,128,13,0.78)' },
      { label: '4+ 顆', color: 'rgba(255,217,26,0.75)' },
      { label: '無覆蓋', color: 'transparent', noSignal: true },
    ],
  },
}

// ── Legend 元件 ──────────────────────────────────────────────────────
function HeatmapLegend({ mode }) {
  const legend = LEGENDS[mode] || LEGENDS[HEATMAP_MODE.SINR]
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
        {legend.title}
      </div>
      {legend.items.map((item) => (
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

  const showHeatmap      = useEditorStore((s) => s.showHeatmap)
  const heatmapMode      = useEditorStore((s) => s.heatmapMode)
  const pathLossExponent = useEditorStore((s) => s.pathLossExponent)
  const activeFloorId    = useFloorStore((s) => s.activeFloorId)
  const floorScale       = useFloorStore((s) => s.scale)

  const showHeatmapRef      = useRef(showHeatmap)
  const heatmapModeRef      = useRef(heatmapMode)
  const pathLossExponentRef = useRef(pathLossExponent)
  const activeFloorIdRef    = useRef(activeFloorId)
  const floorScaleRef       = useRef(floorScale)

  useEffect(() => { showHeatmapRef.current      = showHeatmap      }, [showHeatmap])
  useEffect(() => { heatmapModeRef.current      = heatmapMode      }, [heatmapMode])
  useEffect(() => { pathLossExponentRef.current = pathLossExponent  }, [pathLossExponent])
  useEffect(() => { activeFloorIdRef.current    = activeFloorId     }, [activeFloorId])
  useEffect(() => { floorScaleRef.current       = floorScale        }, [floorScale])

  // ── WebGL 初始化 + RAF loop ──────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false })
    if (!gl) {
      console.warn('[HeatmapWebGL] WebGL2 not supported')
      return
    }

    const prog = makeProgram(gl)
    if (!prog) return

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

    const locs = {
      resolution:     gl.getUniformLocation(prog, 'u_resolution'),
      vpX:            gl.getUniformLocation(prog, 'u_vpX'),
      vpY:            gl.getUniformLocation(prog, 'u_vpY'),
      vpScale:        gl.getUniformLocation(prog, 'u_vpScale'),
      floorScale:     gl.getUniformLocation(prog, 'u_floorScale'),
      apCount:        gl.getUniformLocation(prog, 'u_apCount'),
      wallCount:      gl.getUniformLocation(prog, 'u_wallCount'),
      aps:            gl.getUniformLocation(prog, 'u_aps[0]'),
      apChannels:     gl.getUniformLocation(prog, 'u_apChannels[0]'),
      apFreqBand:     gl.getUniformLocation(prog, 'u_apFreqBand[0]'),
      walls:          gl.getUniformLocation(prog, 'u_walls[0]'),
      wallLoss3:      gl.getUniformLocation(prog, 'u_wallLoss3[0]'),
      scopePts:       gl.getUniformLocation(prog, 'u_scopePts[0]'),
      scopePtCount:   gl.getUniformLocation(prog, 'u_scopePtCount'),
      scopeRanges:    gl.getUniformLocation(prog, 'u_scopeRanges[0]'),
      scopeCount:     gl.getUniformLocation(prog, 'u_scopeCount'),
      outScopeRanges: gl.getUniformLocation(prog, 'u_outScopeRanges[0]'),
      outScopeCount:  gl.getUniformLocation(prog, 'u_outScopeCount'),
      mode:           gl.getUniformLocation(prog, 'u_mode'),
      pathLossN:      gl.getUniformLocation(prog, 'u_pathLossN'),
    }

    const apData        = new Float32Array(MAX_APS       * 4)
    const apChanData    = new Float32Array(MAX_APS)
    const apFreqData    = new Float32Array(MAX_APS)
    const wallPosData   = new Float32Array(MAX_WALLS     * 4)
    const wallLoss3Data = new Float32Array(MAX_WALLS     * 3)
    const scopePtsData    = new Float32Array(MAX_SCOPE_PTS * 2)
    const scopeRangesData    = new Float32Array(8 * 2)  // MAX_SCOPES=8, vec2 each
    const outScopeRangesData = new Float32Array(8 * 2)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(prog)

    let rafId
    let prevKey = null

    const loop = () => {
      rafId = requestAnimationFrame(loop)

      const stage    = stageRef.current
      const showH    = showHeatmapRef.current
      const floorId  = activeFloorIdRef.current
      const floorS   = floorScaleRef.current
      const curMode  = heatmapModeRef.current
      const plN      = pathLossExponentRef.current
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

      // 展開門窗 openings 為獨立子段（不同材質/dB）
      const expandedWalls = []
      for (const wl of rawWalls) {
        const ops = wl.openings ?? []
        if (ops.length === 0) { expandedWalls.push(wl); continue }
        // 排序 openings by startFrac
        const sorted = [...ops].sort((a, b) => a.startFrac - b.startFrac)
        const dx = wl.endX - wl.startX, dy = wl.endY - wl.startY
        let cursor = 0
        for (const op of sorted) {
          // 牆段：cursor → op.startFrac
          if (op.startFrac > cursor + 0.001) {
            expandedWalls.push({ ...wl, openings: undefined,
              startX: wl.startX + cursor * dx, startY: wl.startY + cursor * dy,
              endX:   wl.startX + op.startFrac * dx, endY: wl.startY + op.startFrac * dy })
          }
          // opening 段
          expandedWalls.push({ ...wl, openings: undefined, material: op.material,
            startX: wl.startX + op.startFrac * dx, startY: wl.startY + op.startFrac * dy,
            endX:   wl.startX + op.endFrac * dx,   endY:   wl.startY + op.endFrac * dy })
          cursor = op.endFrac
        }
        // 剩餘牆段
        if (cursor < 0.999) {
          expandedWalls.push({ ...wl, openings: undefined,
            startX: wl.startX + cursor * dx, startY: wl.startY + cursor * dy,
            endX: wl.endX, endY: wl.endY })
        }
      }
      // 保留原始牆體 openings 用於 cache key
      const openingsKey = rawWalls.filter((wl) => (wl.openings ?? []).length > 0)
        .map((wl) => wl.openings.map((o) => `${o.id}:${o.type},${o.startFrac},${o.endFrac},${o.material?.id}`).join(';'))
        .join('|')
      rawWalls = expandedWalls

      const scopes     = useScopeStore.getState().scopesByFloor[floorId] ?? []
      const inScopes   = scopes.filter((s) => s.type === 'in')
      const outScopes  = scopes.filter((s) => s.type === 'out')
      let scopePtCount   = 0
      let scopeCount     = 0
      let outScopeCount  = 0
      const dragScope    = draggingScopeRef?.current

      // 填入 in-scope 多邊形
      for (let si = 0; si < inScopes.length && si < 8 && scopePtCount < MAX_SCOPE_PTS; si++) {
        const sc = inScopes[si]
        const isDragging = dragScope && dragScope.id === sc.id
        const dx = isDragging ? dragScope.dx : 0
        const dy = isDragging ? dragScope.dy : 0
        const pts = sc.points
        const vtxCount = Math.min(pts.length / 2, MAX_SCOPE_PTS - scopePtCount)
        scopeRangesData[si * 2]     = scopePtCount
        scopeRangesData[si * 2 + 1] = vtxCount
        for (let i = 0; i < vtxCount; i++) {
          scopePtsData[(scopePtCount + i) * 2]     = pts[i * 2]     + dx
          scopePtsData[(scopePtCount + i) * 2 + 1] = pts[i * 2 + 1] + dy
        }
        scopePtCount += vtxCount
        scopeCount++
      }

      // 填入 out-scope 多邊形（共用 scopePtsData）
      for (let si = 0; si < outScopes.length && si < 8 && scopePtCount < MAX_SCOPE_PTS; si++) {
        const sc = outScopes[si]
        const isDragging = dragScope && dragScope.id === sc.id
        const dx = isDragging ? dragScope.dx : 0
        const dy = isDragging ? dragScope.dy : 0
        const pts = sc.points
        const vtxCount = Math.min(pts.length / 2, MAX_SCOPE_PTS - scopePtCount)
        outScopeRangesData[si * 2]     = scopePtCount
        outScopeRangesData[si * 2 + 1] = vtxCount
        for (let i = 0; i < vtxCount; i++) {
          scopePtsData[(scopePtCount + i) * 2]     = pts[i * 2]     + dx
          scopePtsData[(scopePtCount + i) * 2 + 1] = pts[i * 2 + 1] + dy
        }
        scopePtCount += vtxCount
        outScopeCount++
      }

      const vp = { x: stage.x(), y: stage.y(), scale: stage.scaleX() }

      const apKey    = aps.map((a) => `${a.id}:${a.x.toFixed(1)},${a.y.toFixed(1)},${a.txPower},${a.frequency},${a.channel ?? 0}`).join('|')
      const wallKey  = rawWalls.map((wl) => `${wl.startX.toFixed(1)},${wl.startY.toFixed(1)},${wl.endX.toFixed(1)},${wl.endY.toFixed(1)},${wl.material?.id ?? ''},${wl.material?.dbLoss ?? 0}`).join('|')
      const scopeKey = [...inScopes, ...outScopes].map((sc) => {
        const d = dragScope && dragScope.id === sc.id ? `${dragScope.dx.toFixed(1)},${dragScope.dy.toFixed(1)}` : '0,0'
        return `${sc.id},${sc.type},${d}`
      }).join('|') || 'none'
      const key = `${w},${h},${vp.x.toFixed(1)},${vp.y.toFixed(1)},${vp.scale.toFixed(4)},${floorS},${curMode},${plN},${apKey},${wallKey},${openingsKey},${scopeKey}`
      if (key === prevKey) return
      prevKey = key

      const apCount = Math.min(aps.length, MAX_APS)
      for (let i = 0; i < apCount; i++) {
        const a = aps[i]
        apData[i*4]   = a.x
        apData[i*4+1] = a.y
        apData[i*4+2] = a.txPower
        apData[i*4+3] = FREQ_MHZ[a.frequency] ?? 5500
        apChanData[i] = a.channel ?? DEFAULT_CHAN[a.frequency] ?? 1
        apFreqData[i] = FREQ_BAND_INDEX[a.frequency] ?? 1
      }

      const wallCount = Math.min(rawWalls.length, MAX_WALLS)
      for (let i = 0; i < wallCount; i++) {
        const wl = rawWalls[i]
        wallPosData[i*4]   = wl.startX
        wallPosData[i*4+1] = wl.startY
        wallPosData[i*4+2] = wl.endX
        wallPosData[i*4+3] = wl.endY
        const baseLoss = wl.material?.dbLoss ?? 0
        const ff = wl.material?.freqFactor ?? { 2.4: 1, 5: 1, 6: 1 }
        wallLoss3Data[i*3]   = baseLoss * (ff[2.4] ?? 1)
        wallLoss3Data[i*3+1] = baseLoss * (ff[5]   ?? 1)
        wallLoss3Data[i*3+2] = baseLoss * (ff[6]   ?? 1)
      }

      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.uniform2f(locs.resolution,    w, h)
      gl.uniform1f(locs.vpX,           vp.x)
      gl.uniform1f(locs.vpY,           vp.y)
      gl.uniform1f(locs.vpScale,       vp.scale)
      gl.uniform1f(locs.floorScale,    floorS)
      gl.uniform1i(locs.apCount,       apCount)
      gl.uniform1i(locs.wallCount,     wallCount)
      gl.uniform4fv(locs.aps,          apData)
      gl.uniform1fv(locs.apChannels,   apChanData)
      gl.uniform1fv(locs.apFreqBand,   apFreqData)
      gl.uniform4fv(locs.walls,        wallPosData)
      gl.uniform3fv(locs.wallLoss3,    wallLoss3Data)
      gl.uniform2fv(locs.scopePts,     scopePtsData)
      gl.uniform1i(locs.scopePtCount,  scopePtCount)
      gl.uniform2fv(locs.scopeRanges,     scopeRangesData)
      gl.uniform1i(locs.scopeCount,      scopeCount)
      gl.uniform2fv(locs.outScopeRanges, outScopeRangesData)
      gl.uniform1i(locs.outScopeCount,   outScopeCount)
      gl.uniform1i(locs.mode,          MODE_INT[curMode] ?? 1)
      gl.uniform1f(locs.pathLossN,     plN)

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
      {showHeatmap && <HeatmapLegend mode={heatmapMode} />}
    </>
  )
}

export default HeatmapWebGL

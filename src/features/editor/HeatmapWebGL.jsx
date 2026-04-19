import React, { useRef, useEffect } from 'react'
import { useEditorStore, HEATMAP_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { getPatternById, DEFAULT_PATTERN_ID, PATTERN_SAMPLES } from '@/constants/antennaPatterns'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'
import { NOISE_FLOOR_DBM_PER_BAND, HEATMAP_DEFAULTS } from '@/constants/rfDefaults'
import { wallAttAtFreq } from '@/utils/ituR2040'

const MAX_APS        = 32
const MAX_WALLS      = 64
const MAX_SCOPE_PTS  = 256
const MAX_FLOORS     = 16
const MAX_HOLES_TOTAL = 32
const MAX_HOLE_PTS   = 128

const FREQ_MHZ    = { 2.4: 2437, 5: 5500, 6: 6000 }
const DEFAULT_CHAN = { 2.4: 1,    5: 36,   6: 1    }

// 頻段索引：用於 wallLoss3 查表（0=2.4, 1=5, 2=6）
const FREQ_BAND_INDEX = { 2.4: 0, 5: 1, 6: 2 }

// 將點依樓層的 align transform 轉至共同「世界」坐標（以圖像中心為樞紐）。
// transform: { imageWidth, imageHeight, alignOffsetX, alignOffsetY, alignScale, alignRotation }
function alignFwd(pt, f) {
  const cx = f.imageWidth / 2, cy = f.imageHeight / 2
  const sc = f.alignScale ?? 1
  const rad = ((f.alignRotation ?? 0) * Math.PI) / 180
  const dx = pt.x - cx, dy = pt.y - cy
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad)
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad)
  return {
    x: cx + (f.alignOffsetX ?? 0) + rx * sc,
    y: cy + (f.alignOffsetY ?? 0) + ry * sc,
  }
}

// alignFwd 的反函數。
function alignInv(pt, f) {
  const cx = f.imageWidth / 2, cy = f.imageHeight / 2
  const sc = f.alignScale ?? 1
  const rad = ((f.alignRotation ?? 0) * Math.PI) / 180
  const px = (pt.x - cx - (f.alignOffsetX ?? 0)) / sc
  const py = (pt.y - cy - (f.alignOffsetY ?? 0)) / sc
  // 反向旋轉
  return {
    x: cx + px * Math.cos(-rad) - py * Math.sin(-rad),
    y: cy + px * Math.sin(-rad) + py * Math.cos(-rad),
  }
}

// 將 AP 的本地座標（在 srcFloor）轉至 activeFloor 的本地座標，供熱圖渲染使用。
function projectApToActive(apPos, srcFloor, activeFloor) {
  if (!srcFloor || !activeFloor || srcFloor.id === activeFloor.id) return apPos
  return alignInv(alignFwd(apPos, srcFloor), activeFloor)
}

// 頻道中心頻率 (MHz)：2.4 → 2407+5N，5 → 5000+5N，6 → 5950+5N
function channelCenterMHz(band, channel) {
  if (band === 2.4) return 2407 + 5 * channel
  if (band === 5)   return 5000 + 5 * channel
  if (band === 6)   return 5950 + 5 * channel
  return 5500
}

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
#define MAX_FLOORS       ${MAX_FLOORS}
#define MAX_HOLES_TOTAL  ${MAX_HOLES_TOTAL}
#define MAX_HOLE_PTS     ${MAX_HOLE_PTS}
#define PATTERN_SAMPLES ${PATTERN_SAMPLES}

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
uniform float u_apCenterMHz[MAX_APS];  // 該頻道+頻寬的中心頻率 (MHz)
uniform float u_apWidthMHz[MAX_APS];   // 頻寬 (MHz)
uniform float u_apSrcFloorIdx[MAX_APS];// AP 所在樓層索引 (float for uniform typing)
uniform float u_apInstallHeight[MAX_APS]; // PHY-6: AP 安裝高度 (m)
uniform vec4  u_apAnt[MAX_APS];        // x = mode(0=omni,1=dir,2=custom), y = azimuthRad, z = halfBeamwidthRad, w = frontBackDb

// 9-3d: 多樓層 slab + floor hole 資料，供 per-pixel 跨樓層 bypass 判定
uniform int   u_floorCount;
uniform int   u_activeFloorIdx;
uniform float u_floorSlabDb[MAX_FLOORS];
uniform vec4  u_floorAlign[MAX_FLOORS];    // (offsetX, offsetY, scale, rotationRad)
uniform vec2  u_floorImgCenter[MAX_FLOORS];// (imgW/2, imgH/2) — align pivot
uniform vec2  u_holePts[MAX_HOLE_PTS];     // 所有樓層 hole 頂點（存於 source 樓的 local 座標）
uniform vec4  u_holeRanges[MAX_HOLES_TOTAL]; // (start, count, bottomFloorIdx, topFloorIdx) — 9-3e 垂直範圍
uniform float u_holeSrcFloorIdx[MAX_HOLES_TOTAL]; // hole 多邊形所在樓層索引（頂點座標的參考系）
uniform int   u_holeCount;
uniform sampler2D u_apPattern;         // MAX_APS x PATTERN_SAMPLES, R32F, value = gain dB at (AP, angleBin)
uniform vec4  u_walls[MAX_WALLS];
uniform vec3  u_wallLoss3[MAX_WALLS];  // xyz = 2.4GHz / 5GHz / 6GHz 衰減
uniform vec2  u_scopePts[MAX_SCOPE_PTS];
uniform int   u_scopePtCount;
uniform int   u_mode;
// PHY-1: per-band PLE，索引 [0]=2.4G, [1]=5G, [2]=6G（與 u_apFreqBand 對齊）
uniform float u_pleByBand[3];
// PHY-5: per-band wifi noise floor (dBm @ 20MHz)，索引同上
uniform float u_noiseFloorByBand[3];
// PHY-7: 超距 AP 不算（meter）。RSSI 直接設為 -1e10 跳過
uniform float u_cutoutDistMeters;
// PHY-6: heatmap 接收平面高度 (m，0.5~2.0 典型)
uniform float u_clientHeightMeters;

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

// 從 custom pattern texture 採樣增益 (dB)。signedOffset 範圍 [-PI, PI]，對應到 pattern 0..N-1 後線性插值。
float customGainLookup(int apIdx, float signedOffset) {
  // 把 signedOffset 轉成 [0, 2PI) 後 → 索引 [0, N)
  float t = signedOffset;
  if (t < 0.0) t += 6.28318530;
  float idxF = t / 6.28318530 * float(PATTERN_SAMPLES);
  int lo = int(floor(idxF)) % PATTERN_SAMPLES;
  int hi = (lo + 1) % PATTERN_SAMPLES;
  float frac = idxF - floor(idxF);
  float a = texelFetch(u_apPattern, ivec2(lo, apIdx), 0).r;
  float b = texelFetch(u_apPattern, ivec2(hi, apIdx), 0).r;
  return mix(a, b, frac);
}

// 天線增益（dB）：mode 0=omni / 1=directional / 2=custom
float antennaGain(int apIdx, vec2 px, vec2 ap, vec4 ant) {
  int mode = int(ant.x + 0.5);
  if (mode == 0) return 0.0;
  float azim = ant.y;
  // 像素相對 AP 的方向角（+x=0，順時針）— canvas y 朝下，atan2 的 y 用 px.y - ap.y
  float targetAng = atan(px.y - ap.y, px.x - ap.x);
  float diff = targetAng - azim;
  // wrap to [-PI, PI]
  diff = mod(diff + 3.14159265, 6.28318530) - 3.14159265;
  if (mode == 2) {
    // custom pattern lookup：diff 作為相對中軸的帶符號角
    return customGainLookup(apIdx, diff);
  }
  // directional cosine-squared
  float halfBW = ant.z;
  float frontBack = ant.w;
  float offset = abs(diff);
  if (halfBW < 0.0001) return -frontBack;
  float norm = offset / halfBW;
  float g = -12.0 * norm * norm;
  return max(g, -frontBack);
}

// ── 9-3d: 多樓層 align transform helpers ──────────────────────────
// alignFwd: local → world。f = (offX, offY, scale, rotRad), c = pivot (imgW/2, imgH/2)
vec2 alignFwdGL(vec2 pt, vec4 f, vec2 c) {
  vec2 d = pt - c;
  float cs = cos(f.w), sn = sin(f.w);
  vec2 r = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
  return c + f.xy + r * f.z;
}

vec2 alignInvGL(vec2 pt, vec4 f, vec2 c) {
  vec2 p = (pt - c - f.xy) / f.z;
  float cs = cos(-f.w), sn = sin(-f.w);
  return c + vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
}

// 點是否在某樓層的任何 floor hole 內。9-3e: hole 有垂直延伸範圍
// [bottomFloorIdx, topFloorIdx]，樓層 i 在此閉區間內即參與判定。
// 輸入 pLocalFi 為樓 i 的 local 座標，內部會轉至 hole 所屬樓層的 local 再比對。
bool pointInFloorHoles(vec2 pLocalFi, int floorIdx) {
  vec2 pWorld = alignFwdGL(pLocalFi, u_floorAlign[floorIdx], u_floorImgCenter[floorIdx]);
  for (int k = 0; k < MAX_HOLES_TOTAL; k++) {
    if (k >= u_holeCount) break;
    vec4 r = u_holeRanges[k];
    int bottomIdx = int(r.z + 0.5);
    int topIdx    = int(r.w + 0.5);
    if (floorIdx < bottomIdx || floorIdx > topIdx) continue;
    int holeSrc   = int(u_holeSrcFloorIdx[k] + 0.5);
    vec2 p = alignInvGL(pWorld, u_floorAlign[holeSrc], u_floorImgCenter[holeSrc]);
    int start = int(r.x + 0.5);
    int n     = int(r.y + 0.5);
    // Ray-cast point-in-polygon
    bool inside = false;
    int j = start + n - 1;
    for (int i2 = 0; i2 < MAX_HOLE_PTS; i2++) {
      int idx = start + i2;
      if (i2 >= n) break;
      vec2 pi = u_holePts[idx];
      vec2 pj = u_holePts[j];
      if ((pi.y > p.y) != (pj.y > p.y) &&
          p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y) + pi.x) {
        inside = !inside;
      }
      j = idx;
    }
    if (inside) return true;
  }
  return false;
}

// 跨樓層斜線穿越點（per-pixel）：AP src 樓 → pixel active 樓。
// 對每個中間樓 i 的樓板，取 3D 斜線 midpoint (i+0.5) 水平投影，轉到樓 i 的 local，
// 若在該樓 hole 內則 bypass 此 slab。
float slabAttDb(vec2 apActiveLocal, vec2 pxActiveLocal, int srcIdx, int actIdx) {
  if (srcIdx == actIdx) return 0.0;
  if (u_activeFloorIdx < 0) return 0.0;

  // 把 AP 和 pixel 都轉到「世界座標」（以 active 樓的 align 為基準之外的共同空間）
  vec4 actAlign = u_floorAlign[actIdx];
  vec2 actPivot = u_floorImgCenter[actIdx];
  vec2 apWorld  = alignFwdGL(apActiveLocal, actAlign, actPivot);
  vec2 pxWorld  = alignFwdGL(pxActiveLocal, actAlign, actPivot);

  float srcF = float(srcIdx), actF = float(actIdx);
  float denom = actF - srcF;  // 非 0（已排除同樓）

  int lo = srcIdx < actIdx ? srcIdx : actIdx;
  int hi = srcIdx < actIdx ? actIdx : srcIdx;

  float total = 0.0;
  for (int i = 0; i < MAX_FLOORS; i++) {
    if (i < lo) continue;
    if (i >= hi) break;
    float slab = u_floorSlabDb[i];
    if (slab <= 0.0) continue;

    // 該 slab 穿越點在 3D 斜線參數 t = (midFloor - srcIdx) / (actIdx - srcIdx)
    float midFloor = float(i) + 0.5;
    float t = (midFloor - srcF) / denom;
    vec2 crossWorld = mix(apWorld, pxWorld, t);
    vec2 crossLocal = alignInvGL(crossWorld, u_floorAlign[i], u_floorImgCenter[i]);
    if (pointInFloorHoles(crossLocal, i)) continue;
    total += slab;
  }
  return total;
}

// 頻段相關的牆體衰減
// PHY-4: 入射角修正（.tmp-heatmap §2.2）
//   等效厚度 = width / cos(θ_inc)
//   refAttDb 對應正射入射 → 斜射時 loss *= 1/cos(θ)
//   clamp cos(θ) ≥ 0.1 避免擦邊路徑爆值（對應 84° 入射角上限）
float wallLoss(vec2 px, vec2 ap, int freqIdx) {
  float loss = 0.0;
  vec2 rayDir = normalize(ap - px);  // 射線方向（單位向量）
  for (int i = 0; i < MAX_WALLS; i++) {
    if (i >= u_wallCount) break;
    vec4 w = u_walls[i];
    if (segHit(px, ap, w.xy, w.zw)) {
      float baseDb = (freqIdx == 0) ? u_wallLoss3[i].x
                   : (freqIdx == 1) ? u_wallLoss3[i].y
                   :                  u_wallLoss3[i].z;
      // 牆法線（2D 中垂直於牆向量）
      vec2 wallVec = w.zw - w.xy;
      vec2 n = normalize(vec2(-wallVec.y, wallVec.x));
      // cos(θ) = |ray · normal|（射線方向與法線夾角的餘弦絕對值）
      float cosTheta = max(abs(dot(rayDir, n)), 0.1);
      loss += baseDb / cosTheta;
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
      float distPx = length(canvas - apPos);
      // PHY-6: 3D 距離納入 AP 安裝高度與 client 平面高度差
      //   d_3D = sqrt(d_2D² + (z_ap - z_client)²)
      float dist2DM = distPx / u_floorScale;
      float dz = u_apInstallHeight[i] - u_clientHeightMeters;
      float distMRaw = sqrt(dist2DM * dist2DM + dz * dz);
      // PHY-7: 超距 AP 跳過，省 wallLoss / slabAttDb / antennaGain 迴圈
      if (distMRaw <= u_cutoutDistMeters) {
        int apSrc = int(u_apSrcFloorIdx[i] + 0.5);
        float slabDb = slabAttDb(apPos, canvas, apSrc, u_activeFloorIdx);
        // PHY-1: NPv1 規格（08-implementation-guide.md §3.2）
        //   d_m = max(distance_m, 0.1)              // 避免 log(0)，與規格 1:1
        //   PL = FSPL(1m, f) + 10·n·log10(d_m)
        //   FSPL(1m, f) = 20·log10(f_MHz) - 27.55   // d=1m 代入 FSPL 通式
        //   n 取 per-band（fIdx: 0=2.4G, 1=5G, 2=6G）
        float distM = max(distMRaw, 0.1);
        float ple    = u_pleByBand[fIdx];
        float fspl1m = 20.0 * log10v(fMHz) - 27.55;
        float pl     = fspl1m + 10.0 * ple * log10v(distM);
        float gain   = antennaGain(i, canvas, apPos, u_apAnt[i]);
        rssi = txPow + gain - pl - wallLoss(canvas, apPos, fIdx) - slabDb;
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
  float servingBand   = u_apFreqBand[bestIdx];
  float servingCenter = u_apCenterMHz[bestIdx];
  float servingWidth  = u_apWidthMHz[bestIdx];
  float servingLo     = servingCenter - servingWidth * 0.5;
  float servingHi     = servingCenter + servingWidth * 0.5;

  // PHY-5: 底噪依 serving AP 頻段取對應 wifiNoiseFloor，再依頻寬修正
  //   N(BW) = wifiNoiseFloor[band] + 10·log10(BW/20)
  int servingBandIdx = int(servingBand + 0.5);
  float noiseDbm = u_noiseFloorByBand[servingBandIdx] + 10.0 * log10v(servingWidth / 20.0);
  float noiseLin = pow(10.0, noiseDbm / 10.0);

  float signalLin   = pow(10.0, bestRSSI / 10.0);
  float intfLinear  = noiseLin;

  // Channel overlap 計數（含部分重疊）
  int overlapCount = 0;

  for (int i = 0; i < MAX_APS; i++) {
    if (i >= u_apCount) break;
    if (rssis[i] < -100.0) continue;

    // 同頻段 + 頻率範圍有交集 = 干擾候選
    float iLo = u_apCenterMHz[i] - u_apWidthMHz[i] * 0.5;
    float iHi = u_apCenterMHz[i] + u_apWidthMHz[i] * 0.5;
    bool sameBand = abs(u_apFreqBand[i] - servingBand) < 0.5;
    bool freqOverlap = sameBand && (iLo < servingHi) && (servingLo < iHi);

    if (freqOverlap && rssis[i] > -85.0) overlapCount++;

    if (i == bestIdx) continue;
    if (!freqOverlap) continue;
    intfLinear += pow(10.0, rssis[i] / 10.0);
  }

  float sinr = 10.0 * log10v(signalLin / intfLinear);
  float snr  = bestRSSI - noiseDbm;

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
    // 頻寬倍率：20→×1、40→×2.1、80→×4.5、160→×9
    float bwMul = 1.0;
    if (servingWidth >= 160.0)     bwMul = 9.0;
    else if (servingWidth >= 80.0) bwMul = 4.5;
    else if (servingWidth >= 40.0) bwMul = 2.1;
    rate *= bwMul;
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
// Exported so HeatmapControl can render the swatches alongside its mode selector.
export const LEGENDS = {
  [HEATMAP_MODE.RSSI]: {
    title: 'RSSI',
    items: [
      { label: '≥ −35 dBm', color: 'rgba(235,26,26,0.90)' },
      { label: '−45 dBm',   color: 'rgba(255,128,13,0.88)' },
      { label: '−55 dBm',   color: 'rgba(255,217,26,0.86)' },
      { label: '−65 dBm',   color: 'rgba(102,217,64,0.84)' },
      { label: '−75 dBm',   color: 'rgba(26,191,204,0.80)' },
      { label: '−85 dBm',   color: 'rgba(31,89,204,0.55)' },
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
    ],
  },
  [HEATMAP_MODE.AP_COUNT]: {
    title: '可用 AP 數',
    items: [
      { label: '1 顆',  color: 'rgba(31,89,204,0.60)' },
      { label: '2 顆',  color: 'rgba(235,26,26,0.80)' },
      { label: '3 顆',  color: 'rgba(255,128,13,0.78)' },
      { label: '4+ 顆', color: 'rgba(255,217,26,0.75)' },
    ],
  },
}


// ── 主元件 ────────────────────────────────────────────────────────────
// P-2 LOD：拖曳期間 framebuffer 以此倍率渲染（CSS 尺寸不變，只降取樣解析度）
const DRAG_RENDER_SCALE = 0.3

function HeatmapWebGL({ width, height, stageRef, draggingAPRef, draggingWallRef, draggingScopeRef }) {
  const canvasRef = useRef(null)

  const showHeatmap      = useEditorStore((s) => s.showHeatmap)
  const heatmapMode      = useEditorStore((s) => s.heatmapMode)
  const pleByBand        = useEditorStore((s) => s.pleByBand)
  const activeFloorId    = useFloorStore((s) => s.activeFloorId)
  const floorScale       = useFloorStore((s) => s.floors.find((f) => f.id === s.activeFloorId)?.scale ?? null)

  const showHeatmapRef      = useRef(showHeatmap)
  const heatmapModeRef      = useRef(heatmapMode)
  const pleByBandRef        = useRef(pleByBand)
  const activeFloorIdRef    = useRef(activeFloorId)
  const floorScaleRef       = useRef(floorScale)
  const cssSizeRef          = useRef({ w: width, h: height })

  useEffect(() => { showHeatmapRef.current      = showHeatmap      }, [showHeatmap])
  useEffect(() => { heatmapModeRef.current      = heatmapMode      }, [heatmapMode])
  useEffect(() => { pleByBandRef.current        = pleByBand         }, [pleByBand])
  useEffect(() => { activeFloorIdRef.current    = activeFloorId     }, [activeFloorId])
  useEffect(() => { floorScaleRef.current       = floorScale        }, [floorScale])
  useEffect(() => { cssSizeRef.current          = { w: width, h: height } }, [width, height])

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
      apCenterMHz:    gl.getUniformLocation(prog, 'u_apCenterMHz[0]'),
      apWidthMHz:     gl.getUniformLocation(prog, 'u_apWidthMHz[0]'),
      apSrcFloorIdx:  gl.getUniformLocation(prog, 'u_apSrcFloorIdx[0]'),
      apInstallHeight: gl.getUniformLocation(prog, 'u_apInstallHeight[0]'),
      apAnt:          gl.getUniformLocation(prog, 'u_apAnt[0]'),
      floorCount:     gl.getUniformLocation(prog, 'u_floorCount'),
      activeFloorIdx: gl.getUniformLocation(prog, 'u_activeFloorIdx'),
      floorSlabDb:    gl.getUniformLocation(prog, 'u_floorSlabDb[0]'),
      floorAlign:     gl.getUniformLocation(prog, 'u_floorAlign[0]'),
      floorImgCenter: gl.getUniformLocation(prog, 'u_floorImgCenter[0]'),
      holePts:        gl.getUniformLocation(prog, 'u_holePts[0]'),
      holeRanges:     gl.getUniformLocation(prog, 'u_holeRanges[0]'),
      holeSrcFloorIdx: gl.getUniformLocation(prog, 'u_holeSrcFloorIdx[0]'),
      holeCount:      gl.getUniformLocation(prog, 'u_holeCount'),
      apPattern:      gl.getUniformLocation(prog, 'u_apPattern'),
      walls:          gl.getUniformLocation(prog, 'u_walls[0]'),
      wallLoss3:      gl.getUniformLocation(prog, 'u_wallLoss3[0]'),
      scopePts:       gl.getUniformLocation(prog, 'u_scopePts[0]'),
      scopePtCount:   gl.getUniformLocation(prog, 'u_scopePtCount'),
      scopeRanges:    gl.getUniformLocation(prog, 'u_scopeRanges[0]'),
      scopeCount:     gl.getUniformLocation(prog, 'u_scopeCount'),
      outScopeRanges: gl.getUniformLocation(prog, 'u_outScopeRanges[0]'),
      outScopeCount:  gl.getUniformLocation(prog, 'u_outScopeCount'),
      mode:           gl.getUniformLocation(prog, 'u_mode'),
      pleByBand:      gl.getUniformLocation(prog, 'u_pleByBand[0]'),
      noiseFloorByBand: gl.getUniformLocation(prog, 'u_noiseFloorByBand[0]'),
      cutoutDistMeters: gl.getUniformLocation(prog, 'u_cutoutDistMeters'),
      clientHeightMeters: gl.getUniformLocation(prog, 'u_clientHeightMeters'),
    }

    const apData        = new Float32Array(MAX_APS       * 4)
    const apChanData    = new Float32Array(MAX_APS)
    const apFreqData    = new Float32Array(MAX_APS)
    const apCenterData  = new Float32Array(MAX_APS)
    const apWidthData   = new Float32Array(MAX_APS)
    const apSrcFloorIdxData = new Float32Array(MAX_APS)
    const apInstallHeightData = new Float32Array(MAX_APS)
    const apAntData     = new Float32Array(MAX_APS       * 4)
    const floorSlabDbData    = new Float32Array(MAX_FLOORS)
    const floorAlignData     = new Float32Array(MAX_FLOORS * 4)
    const floorImgCenterData = new Float32Array(MAX_FLOORS * 2)
    const holePtsData         = new Float32Array(MAX_HOLE_PTS * 2)
    const holeRangesData      = new Float32Array(MAX_HOLES_TOTAL * 4)
    const holeSrcFloorIdxData = new Float32Array(MAX_HOLES_TOTAL)
    const apPatternData = new Float32Array(MAX_APS       * PATTERN_SAMPLES)

    // R32F 2D texture: width = PATTERN_SAMPLES, height = MAX_APS. Each row = one AP's pattern.
    const patternTex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, patternTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const extFloat = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('OES_texture_float')
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, PATTERN_SAMPLES, MAX_APS, 0, gl.RED, gl.FLOAT, null)
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
    let prevRenderScale = 1

    const loop = () => {
      rafId = requestAnimationFrame(loop)

      const stage    = stageRef.current
      const showH    = showHeatmapRef.current
      const floorId  = activeFloorIdRef.current
      const floorS   = floorScaleRef.current
      const curMode  = heatmapModeRef.current
      const ple3     = pleByBandRef.current

      // P-2 LOD：判斷是否正在拖曳任一物件，拖曳期間降低 framebuffer 解析度
      const isDragging =
        !!(draggingAPRef?.current)   ||
        !!(draggingWallRef?.current) ||
        !!(draggingScopeRef?.current)
      const renderScale = isDragging ? DRAG_RENDER_SCALE : 1

      // CSS 尺寸永遠為 logical size；framebuffer 尺寸隨 renderScale 變動
      // 不能讀 canvas.clientWidth/width（我們每幀在改 canvas.width，會形成自我反饋迴圈）
      const cssW = cssSizeRef.current.w
      const cssH = cssSizeRef.current.h
      const targetW = Math.max(1, Math.round(cssW * renderScale))
      const targetH = Math.max(1, Math.round(cssH * renderScale))
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width  = targetW
        canvas.height = targetH
      }
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

      // Cross-floor (9-3b): collect APs from all floors; project their positions
      // into the active floor's local canvas space via align transforms.
      // 9-3d: slab attenuation is now computed per-pixel in shader (supports
      // diagonal crossing through floor holes). Here we only tag AP with its
      // source floor index.
      const allFloors      = useFloorStore.getState().floors
      const activeFlr      = allFloors.find((f) => f.id === floorId)
      const activeIdx      = allFloors.findIndex((f) => f.id === floorId)
      const apsByFloor     = useAPStore.getState().apsByFloor
      const floorHolesByFl = useFloorHoleStore.getState().floorHolesByFloor
      const drag           = draggingAPRef?.current
      let aps = []
      for (let fi = 0; fi < allFloors.length; fi++) {
        const f = allFloors[fi]
        const fApsRaw = apsByFloor[f.id] ?? []
        if (fApsRaw.length === 0) continue
        for (const a of fApsRaw) {
          const isActive = f.id === floorId
          let x = a.x, y = a.y
          if (isActive && drag && drag.id === a.id) { x = drag.x; y = drag.y }
          if (!isActive) {
            const p = projectApToActive({ x, y }, f, activeFlr)
            x = p.x; y = p.y
          }
          aps.push({ ...a, x, y, _srcFloorIdx: fi })
        }
      }

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
      // P-2 LOD：vp uniforms 是 CSS-pixel 空間，framebuffer 若縮放 k 倍，三者同步 × k 才能與 gl_FragCoord 對齊
      const vpXScaled     = vp.x     * renderScale
      const vpYScaled     = vp.y     * renderScale
      const vpScaleScaled = vp.scale * renderScale

      const apKey    = aps.map((a) => `${a.id}:${a.x.toFixed(1)},${a.y.toFixed(1)},${a.z ?? 2.4},${a.txPower},${a.frequency},${a.channel ?? 0},${a.channelWidth ?? 0},${a.antennaMode ?? 'omni'},${a.azimuth ?? 0},${a.beamwidth ?? 60},${a.patternId ?? ''},${a._srcFloorIdx ?? 0}`).join('|')
      // PHY-2: cache key 用材質 id + refAttDb（ITU 係數變動會帶不同 id 或 refAttDb）
      const wallKey  = rawWalls.map((wl) => `${wl.startX.toFixed(1)},${wl.startY.toFixed(1)},${wl.endX.toFixed(1)},${wl.endY.toFixed(1)},${wl.material?.id ?? ''},${wl.material?.refAttDb ?? wl.material?.dbLoss ?? 0}`).join('|')
      const scopeKey = [...inScopes, ...outScopes].map((sc) => {
        const d = dragScope && dragScope.id === sc.id ? `${dragScope.dx.toFixed(1)},${dragScope.dy.toFixed(1)}` : '0,0'
        return `${sc.id},${sc.type},${d}`
      }).join('|') || 'none'
      const slabKey = allFloors.map((f) => `${f.id}:${(f.floorSlabAttenuationDb ?? 0).toFixed(1)},${(f.alignOffsetX ?? 0).toFixed(1)},${(f.alignOffsetY ?? 0).toFixed(1)},${(f.alignScale ?? 1).toFixed(3)},${(f.alignRotation ?? 0).toFixed(2)}`).join('|')
      // 9-3c: Floor holes on every floor affect per-AP slab attenuation
      // 9-3e: bottom/topFloorId 也納入 key
      const holesKey = allFloors.map((f) => {
        const holes = floorHolesByFl[f.id] ?? []
        if (holes.length === 0) return `${f.id}:none`
        return `${f.id}:${holes.map((h) => `${h.id}[${h.points.map((p) => p.toFixed(1)).join(',')}]b=${h.bottomFloorId ?? f.id}t=${h.topFloorId ?? f.id}`).join(';')}`
      }).join('|')
      const pleKey = `${ple3[2.4]},${ple3[5]},${ple3[6]}`
      const key = `${w},${h},${renderScale},${vp.x.toFixed(1)},${vp.y.toFixed(1)},${vp.scale.toFixed(4)},${floorS},${curMode},${pleKey},${apKey},${wallKey},${openingsKey},${scopeKey},${slabKey},${holesKey}`
      if (key === prevKey && renderScale === prevRenderScale) return
      prevKey = key
      prevRenderScale = renderScale

      const apCount = Math.min(aps.length, MAX_APS)
      for (let i = 0; i < apCount; i++) {
        const a = aps[i]
        apData[i*4]   = a.x
        apData[i*4+1] = a.y
        apData[i*4+2] = a.txPower
        apData[i*4+3] = FREQ_MHZ[a.frequency] ?? 5500
        const ch = a.channel ?? DEFAULT_CHAN[a.frequency] ?? 1
        const bw = a.channelWidth ?? DEFAULT_CHANNEL_WIDTH[a.frequency] ?? 20
        apChanData[i] = ch
        apFreqData[i] = FREQ_BAND_INDEX[a.frequency] ?? 1
        apCenterData[i] = channelCenterMHz(a.frequency, ch)
        apWidthData[i] = bw
        apSrcFloorIdxData[i] = a._srcFloorIdx ?? 0
        apInstallHeightData[i] = a.z ?? 2.4
        // Antenna: omni(0) / directional(1) / custom(2); custom AP fills its pattern row.
        const mode = a.antennaMode === 'directional' ? 1 : a.antennaMode === 'custom' ? 2 : 0
        const azDeg     = ((a.azimuth ?? 0) % 360 + 360) % 360
        const bwDeg     = Math.max(10, Math.min(180, a.beamwidth ?? 60))
        apAntData[i*4]   = mode
        apAntData[i*4+1] = azDeg * Math.PI / 180
        apAntData[i*4+2] = (bwDeg / 2) * Math.PI / 180
        apAntData[i*4+3] = 20  // frontBackDb: 背面最多衰減 20 dB
        if (mode === 2) {
          const pat = getPatternById(a.patternId ?? DEFAULT_PATTERN_ID)
          for (let k = 0; k < PATTERN_SAMPLES; k++) {
            apPatternData[i * PATTERN_SAMPLES + k] = pat.samples[k]
          }
        } else {
          // Zero-fill so stale pattern data doesn't leak into a non-custom AP.
          for (let k = 0; k < PATTERN_SAMPLES; k++) {
            apPatternData[i * PATTERN_SAMPLES + k] = 0
          }
        }
      }

      const wallCount = Math.min(rawWalls.length, MAX_WALLS)
      for (let i = 0; i < wallCount; i++) {
        const wl = rawWalls[i]
        wallPosData[i*4]   = wl.startX
        wallPosData[i*4+1] = wl.startY
        wallPosData[i*4+2] = wl.endX
        wallPosData[i*4+3] = wl.endY
        // PHY-2: ITU-R P.2040-3 頻率外推（取代手調 freqFactor 乘數）
        // 從材質 (a,b,c,d) + refAttDb @ refFreqMHz 算各頻段對應 dB
        const m = wl.material
        wallLoss3Data[i*3]   = wallAttAtFreq(m, FREQ_MHZ[2.4])
        wallLoss3Data[i*3+1] = wallAttAtFreq(m, FREQ_MHZ[5])
        wallLoss3Data[i*3+2] = wallAttAtFreq(m, FREQ_MHZ[6])
      }

      // 9-3d: per-floor slab/align + floor hole data for shader-side per-pixel bypass
      const floorCount = Math.min(allFloors.length, MAX_FLOORS)
      for (let i = 0; i < floorCount; i++) {
        const f = allFloors[i]
        floorSlabDbData[i] = f.floorSlabAttenuationDb ?? 0
        floorAlignData[i*4]   = f.alignOffsetX ?? 0
        floorAlignData[i*4+1] = f.alignOffsetY ?? 0
        floorAlignData[i*4+2] = f.alignScale ?? 1
        floorAlignData[i*4+3] = ((f.alignRotation ?? 0) * Math.PI) / 180
        floorImgCenterData[i*2]   = (f.imageWidth ?? 0) / 2
        floorImgCenterData[i*2+1] = (f.imageHeight ?? 0) / 2
      }

      // 9-3e: 每個 hole 可設垂直延伸範圍 (bottomFloorId, topFloorId)
      // 預設 = hole 所屬樓層（單層行為）
      let holePtCount = 0
      let holeCount   = 0
      for (let fi = 0; fi < floorCount && holeCount < MAX_HOLES_TOTAL; fi++) {
        const holes = floorHolesByFl[allFloors[fi].id] ?? []
        for (const h of holes) {
          if (holeCount >= MAX_HOLES_TOTAL) break
          const n = Math.min(h.points.length / 2, MAX_HOLE_PTS - holePtCount)
          if (n < 3) continue
          const bottomId = h.bottomFloorId ?? allFloors[fi].id
          const topId    = h.topFloorId    ?? allFloors[fi].id
          const bIdxRaw  = allFloors.findIndex((f) => f.id === bottomId)
          const tIdxRaw  = allFloors.findIndex((f) => f.id === topId)
          const bIdx = bIdxRaw >= 0 ? bIdxRaw : fi
          const tIdx = tIdxRaw >= 0 ? tIdxRaw : fi
          holeRangesData[holeCount*4]   = holePtCount
          holeRangesData[holeCount*4+1] = n
          holeRangesData[holeCount*4+2] = Math.min(bIdx, tIdx)
          holeRangesData[holeCount*4+3] = Math.max(bIdx, tIdx)
          holeSrcFloorIdxData[holeCount] = fi
          for (let k = 0; k < n; k++) {
            holePtsData[(holePtCount + k)*2]   = h.points[k*2]
            holePtsData[(holePtCount + k)*2+1] = h.points[k*2+1]
          }
          holePtCount += n
          holeCount++
        }
      }

      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.uniform2f(locs.resolution,    w, h)
      gl.uniform1f(locs.vpX,           vpXScaled)
      gl.uniform1f(locs.vpY,           vpYScaled)
      gl.uniform1f(locs.vpScale,       vpScaleScaled)
      gl.uniform1f(locs.floorScale,    floorS)
      gl.uniform1i(locs.apCount,       apCount)
      gl.uniform1i(locs.wallCount,     wallCount)
      gl.uniform4fv(locs.aps,          apData)
      gl.uniform1fv(locs.apChannels,   apChanData)
      gl.uniform1fv(locs.apFreqBand,   apFreqData)
      gl.uniform1fv(locs.apCenterMHz,  apCenterData)
      gl.uniform1fv(locs.apWidthMHz,   apWidthData)
      gl.uniform1fv(locs.apSrcFloorIdx, apSrcFloorIdxData)
      gl.uniform1fv(locs.apInstallHeight, apInstallHeightData)
      gl.uniform4fv(locs.apAnt,        apAntData)
      gl.uniform1i(locs.floorCount,     floorCount)
      gl.uniform1i(locs.activeFloorIdx, activeIdx >= 0 ? activeIdx : 0)
      gl.uniform1fv(locs.floorSlabDb,   floorSlabDbData)
      gl.uniform4fv(locs.floorAlign,    floorAlignData)
      gl.uniform2fv(locs.floorImgCenter, floorImgCenterData)
      gl.uniform2fv(locs.holePts,       holePtsData)
      gl.uniform4fv(locs.holeRanges,    holeRangesData)
      gl.uniform1fv(locs.holeSrcFloorIdx, holeSrcFloorIdxData)
      gl.uniform1i(locs.holeCount,      holeCount)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, patternTex)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PATTERN_SAMPLES, MAX_APS, gl.RED, gl.FLOAT, apPatternData)
      gl.uniform1i(locs.apPattern, 0)
      gl.uniform4fv(locs.walls,        wallPosData)
      gl.uniform3fv(locs.wallLoss3,    wallLoss3Data)
      gl.uniform2fv(locs.scopePts,     scopePtsData)
      gl.uniform1i(locs.scopePtCount,  scopePtCount)
      gl.uniform2fv(locs.scopeRanges,     scopeRangesData)
      gl.uniform1i(locs.scopeCount,      scopeCount)
      gl.uniform2fv(locs.outScopeRanges, outScopeRangesData)
      gl.uniform1i(locs.outScopeCount,   outScopeCount)
      gl.uniform1i(locs.mode,          MODE_INT[curMode] ?? 1)
      // PHY-1: per-band PLE，索引對齊 FREQ_BAND_INDEX，三值來自 store（獨立可調）
      gl.uniform1fv(locs.pleByBand,    new Float32Array([ple3[2.4], ple3[5], ple3[6]]))
      // PHY-5: per-band noise floor (dBm @ 20MHz)
      gl.uniform1fv(locs.noiseFloorByBand, new Float32Array([
        NOISE_FLOOR_DBM_PER_BAND[2.4],
        NOISE_FLOOR_DBM_PER_BAND[5],
        NOISE_FLOOR_DBM_PER_BAND[6],
      ]))
      // PHY-7: cutout 距離（meter）
      gl.uniform1f(locs.cutoutDistMeters, HEATMAP_DEFAULTS.cutoutDistanceMeters)
      // PHY-6: client 接收平面高度（meter）
      gl.uniform1f(locs.clientHeightMeters, HEATMAP_DEFAULTS.clientHeightMeters)

      gl.bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      gl.bindVertexArray(null)
    }

    rafId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafId)
      gl.deleteVertexArray(vao)
      gl.deleteBuffer(posBuf)
      gl.deleteTexture(patternTex)
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
          width:  `${width}px`,   // P-2 LOD：CSS 尺寸固定，framebuffer 會在拖曳時縮到 0.7×
          height: `${height}px`,
          pointerEvents: 'none',
          display: showHeatmap ? 'block' : 'none',
        }}
      />
    </>
  )
}

export default HeatmapWebGL

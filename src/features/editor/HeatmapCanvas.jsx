import React, { useRef, useEffect } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'

// 頻段對應中心頻率 (MHz)
const FREQ_MHZ = { 2.4: 2437, 5: 5500, 6: 6000 }

// 取樣步長（每 N 個螢幕像素取一個樣本）
const STEP = 4

// RSSI 顏色區間（由強到弱）
const COLOR_STOPS = [
  { rssi: -45,  r: 0,   g: 230, b: 118, a: 190 },
  { rssi: -60,  r: 118, g: 215, b: 40,  a: 175 },
  { rssi: -70,  r: 255, g: 210, b: 0,   a: 165 },
  { rssi: -80,  r: 255, g: 120, b: 0,   a: 155 },
  { rssi: -90,  r: 220, g: 20,  b: 0,   a: 140 },
  { rssi: -100, r: 150, g: 0,   b: 0,   a: 80  },
]

function rssiToRGBA(rssi) {
  if (rssi >= COLOR_STOPS[0].rssi) {
    const s = COLOR_STOPS[0]
    return [s.r, s.g, s.b, s.a]
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1]
  if (rssi <= last.rssi) return null

  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const s1 = COLOR_STOPS[i]
    const s2 = COLOR_STOPS[i + 1]
    if (rssi >= s2.rssi) {
      const t = (rssi - s1.rssi) / (s2.rssi - s1.rssi)
      return [
        Math.round(s1.r + (s2.r - s1.r) * t),
        Math.round(s1.g + (s2.g - s1.g) * t),
        Math.round(s1.b + (s2.b - s1.b) * t),
        Math.round(s1.a + (s2.a - s1.a) * t),
      ]
    }
  }
  return null
}

// FSPL：RSSI = TxPower - 20·log10(d_m) - 20·log10(f_MHz) - 32.44
function calcRSSI(ap, cx, cy, floorScale) {
  const dx = cx - ap.x
  const dy = cy - ap.y
  const distPx = Math.sqrt(dx * dx + dy * dy)
  if (distPx < 0.5) return ap.txPower
  const distM = distPx / floorScale
  const freqMHz = FREQ_MHZ[ap.frequency] ?? 5500
  const fspl = 20 * Math.log10(distM) + 20 * Math.log10(freqMHz) + 32.44
  return ap.txPower - fspl
}

function renderHeatmap(ctx, w, h, vp, aps, floorScale) {
  const offW = Math.ceil(w / STEP)
  const offH = Math.ceil(h / STEP)
  const off = document.createElement('canvas')
  off.width  = offW
  off.height = offH
  const offCtx  = off.getContext('2d')
  const imgData = offCtx.createImageData(offW, offH)
  const data    = imgData.data

  const { x: vpX, y: vpY, scale: vpS } = vp

  for (let iy = 0; iy < offH; iy++) {
    const cy = (iy * STEP - vpY) / vpS
    for (let ix = 0; ix < offW; ix++) {
      const cx = (ix * STEP - vpX) / vpS
      let maxRSSI = -Infinity
      for (const ap of aps) {
        const rssi = calcRSSI(ap, cx, cy, floorScale)
        if (rssi > maxRSSI) maxRSSI = rssi
      }
      const color = rssiToRGBA(maxRSSI)
      if (!color) continue
      const idx = (iy * offW + ix) * 4
      data[idx]     = color[0]
      data[idx + 1] = color[1]
      data[idx + 2] = color[2]
      data[idx + 3] = color[3]
    }
  }

  offCtx.putImageData(imgData, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(off, 0, 0, w, h)
}

// stageRef    — 直接讀 Konva Stage 位置，無需 React state 更新即可即時追蹤
// draggingAPRef — { id, x, y } 拖移中的 AP 暫存位置，null 表示無拖移
function HeatmapCanvas({ width, height, stageRef, draggingAPRef }) {
  const canvasRef = useRef(null)

  // 用 React hooks 訂閱 store，再同步到 ref 供 RAF loop 讀取
  const showHeatmap   = useEditorStore((s) => s.showHeatmap)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floorScale    = useFloorStore((s) => s.scale)

  const showHeatmapRef   = useRef(showHeatmap)
  const activeFloorIdRef = useRef(activeFloorId)
  const floorScaleRef    = useRef(floorScale)

  useEffect(() => { showHeatmapRef.current = showHeatmap },   [showHeatmap])
  useEffect(() => { activeFloorIdRef.current = activeFloorId }, [activeFloorId])
  useEffect(() => { floorScaleRef.current = floorScale },     [floorScale])

  // RAF loop：每幀直接讀 Stage 位置，只在有變化時重新渲染
  useEffect(() => {
    let rafId
    let prevKey = null

    const loop = () => {
      rafId = requestAnimationFrame(loop)

      const canvas = canvasRef.current
      const stage  = stageRef.current
      if (!canvas || !stage) return

      const showH   = showHeatmapRef.current
      const floorS  = floorScaleRef.current
      const floorId = activeFloorIdRef.current
      const w = canvas.width
      const h = canvas.height

      // 直接從 Zustand store 讀最新 AP 資料（不觸發訂閱/re-render）
      let aps = useAPStore.getState().apsByFloor[floorId] ?? []

      // 若有 AP 正在拖移，覆蓋其座標
      const drag = draggingAPRef?.current
      if (drag) {
        aps = aps.map((ap) => ap.id === drag.id ? { ...ap, x: drag.x, y: drag.y } : ap)
      }

      if (!showH || aps.length === 0 || !floorS || w === 0 || h === 0) {
        if (prevKey !== null) {
          canvas.getContext('2d').clearRect(0, 0, w, h)
          prevKey = null
        }
        return
      }

      // 直接讀 Stage 當前位置（支援 pan 即時更新）
      const vp = { x: stage.x(), y: stage.y(), scale: stage.scaleX() }

      // 變化偵測：內容相同就跳過渲染
      const apKey = aps.map((a) =>
        `${a.id}:${Math.round(a.x)},${Math.round(a.y)},${a.txPower},${a.frequency}`
      ).join('|')
      const key = `${w},${h},${vp.x.toFixed(1)},${vp.y.toFixed(1)},${vp.scale.toFixed(4)},${floorS},${apKey}`
      if (key === prevKey) return
      prevKey = key

      renderHeatmap(canvas.getContext('2d'), w, h, vp, aps, floorS)
    }

    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
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

export default HeatmapCanvas

import React, { useRef, useEffect } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'

const STEP = 4

// stageRef      — 直接讀 Konva Stage 即時位置
// draggingAPRef — { id, x, y } AP 拖移中的暫存座標
function HeatmapCanvas({ width, height, stageRef, draggingAPRef }) {
  const canvasRef = useRef(null)

  // React 訂閱（觸發 re-render 以更新 ref）
  const showHeatmap   = useEditorStore((s) => s.showHeatmap)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floorScale    = useFloorStore((s) => s.scale)

  // Ref 供 RAF loop 讀取，避免 stale closure
  const showHeatmapRef   = useRef(showHeatmap)
  const activeFloorIdRef = useRef(activeFloorId)
  const floorScaleRef    = useRef(floorScale)

  useEffect(() => { showHeatmapRef.current = showHeatmap },     [showHeatmap])
  useEffect(() => { activeFloorIdRef.current = activeFloorId }, [activeFloorId])
  useEffect(() => { floorScaleRef.current = floorScale },       [floorScale])

  // Worker + RAF loop：mount 時建立，unmount 時終止
  useEffect(() => {
    const worker = new Worker(
      new URL('./heatmapWorker.js', import.meta.url),
      { type: 'classic' }
    )

    let rafId
    let prevKey      = null
    let workerBusy   = false
    let pendingReq   = null  // 計算中若有新請求，暫存於此

    // ── Worker 回應：繪製結果 ────────────────────────────
    worker.onerror = (e) => {
      console.error('[HeatmapWorker] error:', e.message, e)
    }

    worker.onmessage = (e) => {
      workerBusy = false
      const canvas = canvasRef.current
      if (!canvas) return

      const { buffer, offW, offH, canvasW, canvasH } = e.data
      // 若畫布尺寸已變動，丟棄過期結果
      if (canvas.width !== canvasW || canvas.height !== canvasH) {
        if (pendingReq) { worker.postMessage(pendingReq); workerBusy = true; pendingReq = null }
        return
      }

      // 把低解析度 buffer 放大繪製到主 canvas
      const pixels  = new Uint8ClampedArray(buffer)
      const imgData = new ImageData(pixels, offW, offH)
      const off     = document.createElement('canvas')
      off.width  = offW
      off.height = offH
      off.getContext('2d').putImageData(imgData, 0, 0)

      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvasW, canvasH)
      ctx.imageSmoothingEnabled = false   // 保留銳利邊界，讓牆體衰減邊界清晰可見
      ctx.drawImage(off, 0, 0, canvasW, canvasH)

      // 若有待送請求，立即發送
      if (pendingReq) {
        worker.postMessage(pendingReq)
        workerBusy = true
        pendingReq = null
      }
    }

    // ── RAF loop：偵測變化，送任務給 Worker ──────────────
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

      // 直接讀最新 AP 資料（不觸發訂閱）
      let aps = useAPStore.getState().apsByFloor[floorId] ?? []

      // 若有 AP 正在拖移，覆蓋其座標（不更新 store，不觸發 re-render）
      const drag = draggingAPRef?.current
      if (drag) {
        aps = aps.map((ap) => ap.id === drag.id ? { ...ap, x: drag.x, y: drag.y } : ap)
      }

      // 直接讀牆體資料
      const rawWalls = useWallStore.getState().wallsByFloor[floorId] ?? []
      const walls = rawWalls.map((w) => ({
        startX: w.startX, startY: w.startY,
        endX:   w.endX,   endY:   w.endY,
        dbLoss: w.material?.dbLoss ?? 0,
      }))

      if (!showH || aps.length === 0 || !floorS || w === 0 || h === 0) {
        if (prevKey !== null) {
          canvas.getContext('2d').clearRect(0, 0, w, h)
          prevKey = null
        }
        return
      }

      // 直接讀 Stage 當前位置（支援 pan/zoom 即時更新）
      const vp = { x: stage.x(), y: stage.y(), scale: stage.scaleX() }

      // 變化偵測：相同就跳過
      const apKey   = aps.map((a) => `${a.id}:${Math.round(a.x)},${Math.round(a.y)},${a.txPower},${a.frequency}`).join('|')
      const wallKey = walls.map((w) => `${Math.round(w.startX)},${Math.round(w.startY)},${Math.round(w.endX)},${Math.round(w.endY)},${w.dbLoss}`).join('|')
      const key = `${w},${h},${vp.x.toFixed(1)},${vp.y.toFixed(1)},${vp.scale.toFixed(4)},${floorS},${apKey},${wallKey}`
      if (key === prevKey) return
      prevKey = key

      const req = { aps, walls, viewport: vp, floorScale: floorS, width: w, height: h, step: STEP }

      if (workerBusy) {
        pendingReq = req   // 暫存，等 Worker 回應後立即送
      } else {
        worker.postMessage(req)
        workerBusy = true
      }
    }

    rafId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafId)
      worker.terminate()
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

export default HeatmapCanvas

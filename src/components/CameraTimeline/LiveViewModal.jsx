import React, { useEffect, useRef } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { deviceStatus, DEVICE_STATUS } from '@/features/cameras/deviceStatus'
import { isCameraDetecting } from '@/features/cameras/detectionBus'
import { formatClockSec } from '@/features/cameras/mockTracks'
import './LiveViewModal.sass'

// Mock live-view popover (Verkada parity). Clicking a device in Command opens
// its live feed; we have no real stream, so this paints a believable MOCK
// CCTV frame on a canvas: subtle gradient + drifting scanline + moving noise,
// a timecode bound to the playback clock, the camera name, a REC dot, and a
// "MOTION" detection box while the camera is seeing a target. Offline cameras
// show a no-signal screen. The point is the interaction, not the imagery —
// a future product integration swaps this canvas for a real <video>.

const W = 480
const H = 270

function LiveViewModal() {
  const liveViewCameraId = useCameraStore((s) => s.liveViewCameraId)
  const closeLiveView = useCameraStore((s) => s.closeLiveView)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const camera = useCameraStore((s) =>
    (s.camerasByFloor[activeFloorId] ?? []).find((c) => c.id === liveViewCameraId))
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!camera) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const offline = deviceStatus(camera) === DEVICE_STATUS.OFFLINE
    let raf = 0
    let frame = 0

    const draw = () => {
      frame++
      if (offline) {
        // No-signal: TV static.
        const img = ctx.createImageData(W, H)
        for (let i = 0; i < img.data.length; i += 4) {
          const v = (Math.sin(i * 12.9898 + frame * 7.13) * 43758.5) % 1
          const n = Math.abs(v) * 255
          img.data[i] = img.data[i + 1] = img.data[i + 2] = n
          img.data[i + 3] = 255
        }
        ctx.putImageData(img, 0, 0)
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(0, H / 2 - 22, W, 44)
        ctx.fillStyle = '#f97316'
        ctx.font = '600 18px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('無訊號 · 裝置離線', W / 2, H / 2 + 6)
        raf = requestAnimationFrame(draw)
        return
      }

      // Online: dim room gradient + drifting scanline + faint grain.
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#1f2937')
      g.addColorStop(1, '#0b1220')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      // floor perspective lines, slow drift
      ctx.strokeStyle = 'rgba(148,163,184,0.12)'
      ctx.lineWidth = 1
      const drift = (frame * 0.3) % 40
      for (let y = -40 + drift; y < H; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + 18); ctx.stroke()
      }
      // grain
      ctx.fillStyle = 'rgba(255,255,255,0.015)'
      for (let i = 0; i < 60; i++) {
        const gx = (Math.sin(i * 99 + frame) * 0.5 + 0.5) * W
        const gy = (Math.cos(i * 57 + frame * 1.3) * 0.5 + 0.5) * H
        ctx.fillRect(gx, gy, 2, 2)
      }
      // scanline
      const sy = (frame * 2) % H
      ctx.fillStyle = 'rgba(56,189,248,0.06)'
      ctx.fillRect(0, sy, W, 3)

      // detection box when the camera is currently seeing a target
      if (isCameraDetecting(camera.id)) {
        const bx = W * 0.38 + Math.sin(frame * 0.05) * 30
        const by = H * 0.42 + Math.cos(frame * 0.04) * 18
        ctx.strokeStyle = '#f59e0b'
        ctx.lineWidth = 2
        ctx.strokeRect(bx, by, 70, 110)
        ctx.fillStyle = '#f59e0b'
        ctx.font = '600 11px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText('PERSON', bx, by - 5)
      }

      // HUD overlays
      const t = useTrackingStore.getState().clockSec
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '600 13px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(formatClockSec(t), 12, 22)
      ctx.textAlign = 'right'
      ctx.fillText(camera.name, W - 12, 22)
      // REC blinking dot
      if (Math.floor(frame / 30) % 2 === 0) {
        ctx.fillStyle = '#ef4444'
        ctx.beginPath(); ctx.arc(W - 64, 17, 5, 0, Math.PI * 2); ctx.fill()
      }
      ctx.fillStyle = '#ef4444'
      ctx.font = '700 12px system-ui, sans-serif'
      ctx.fillText('REC', W - 18, 38)

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [camera])

  if (!camera) return null

  return (
    <div className="live-view" onClick={closeLiveView}>
      <div className="live-view__frame" onClick={(e) => e.stopPropagation()}>
        <div className="live-view__bar">
          <span className="live-view__title">📹 即時影像 · {camera.name}</span>
          <button type="button" className="live-view__close" onClick={closeLiveView}>✕</button>
        </div>
        <canvas ref={canvasRef} width={W} height={H} className="live-view__canvas" />
        <div className="live-view__hint">模擬畫面（無實體攝影機）；偵測到目標時顯示框</div>
      </div>
    </div>
  )
}

export default LiveViewModal

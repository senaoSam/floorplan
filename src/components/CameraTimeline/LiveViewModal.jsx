import React, { useEffect, useRef } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { deviceStatus, DEVICE_STATUS } from '@/features/cameras/deviceStatus'
import { isCameraDetecting } from '@/features/cameras/detectionBus'
import { formatClockSec } from '@/features/cameras/mockTracks'
import { drawCctvFrame } from '@/features/cameras/mockCctv'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
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
      const t = useTrackingStore.getState().clockSec
      drawCctvFrame(ctx, {
        w: W,
        h: H,
        frame,
        camera,
        variant: 'live',
        online: !offline,
        detecting: isCameraDetecting(camera.id),
        clockText: formatClockSec(t),
        renderMode: 'mock',
      })
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [camera])

  const dismiss = useOverlayDismiss(closeLiveView)

  if (!camera) return null

  return (
    <div className="live-view" {...dismiss}>
      <div className="live-view__frame">
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

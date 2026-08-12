import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useCameraStore } from '@/store/useCameraStore'
import { solveHomography } from '@/utils/homography'
import { FRAME_W, FRAME_H } from '@/features/cameras/frameConstants'
import { drawCctvFrame } from '@/features/cameras/mockCctv'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
import './CalibrationModal.sass'

// Heat-map calibration modal (Verkada parity, see verkada-notes §L, stage 1).
// The user drops 4 points on the floorplan (left) and the 4 matching points on
// a MOCK camera frame (right); we solve a homography mapping frame → floorplan
// and store it on the camera. This is the real maths — feed it real corner
// correspondences and the matrix is valid; the camera frame is mock placeholder
// imagery only (stage 2 will route mock detections through the matrix).
//
// Points are stored in their native coordinate spaces:
//   floorPts — floorplan IMAGE px (so they survive zoom/pan and match detections)
//   framePts — camera-frame px (the FRAME_W×FRAME_H mock canvas)

const PLAN_W = 420
const PLAN_H = 300
const DOT_COLORS = ['#f97316', '#10b981', '#38bdf8', '#a855f7']   // 1..4

// Shoelace area of a 4-point ring (abs). Used to flag a near-collinear or
// cramped quad — those make the homography ill-conditioned and inaccurate.
//
// 52-B2: the Math.abs() here is exactly what hides a crossed quad — the two
// triangles of a bowtie have opposite signs and partly cancel, so the area
// alone can look healthy. Convexity needs the per-corner cross products, below.
function quadArea(pts) {
  if (pts.length < 4) return 0
  let a = 0
  for (let i = 0; i < 4; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % 4]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

// 52-B2: true when the 4-point ring is a simple convex quad — every turn has
// the same sign. A crossed ("bowtie") ordering flips one, and the homography
// it produces is non-singular yet maps part of the frame to infinity, writing
// ±Infinity into persisted track coordinates. Winding may be CW or CCW; only
// consistency matters.
function isConvexQuad(pts) {
  if (pts.length < 4) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % 4]
    const c = pts[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-9) return false      // collinear corner
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false             // turn reversed → crossed
  }
  return true
}

function CalibrationModal() {
  const calibrateCameraId = useCameraStore((s) => s.calibrateCameraId)
  const closeCalibrate = useCameraStore((s) => s.closeCalibrate)
  const updateCamera = useCameraStore((s) => s.updateCamera)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floor = useFloorStore((s) =>
    s.floors.find((f) => f.id === s.activeFloorId))
  const camera = useCameraStore((s) =>
    (s.camerasByFloor[activeFloorId] ?? []).find((c) => c.id === calibrateCameraId))

  const [floorPts, setFloorPts] = useState([])
  const [framePts, setFramePts] = useState([])
  const frameCanvasRef = useRef(null)

  // Load any existing calibration when the modal opens for a camera.
  useEffect(() => {
    if (!camera) return
    setFloorPts(camera.calibration?.floorPts ?? [])
    setFramePts(camera.calibration?.framePts ?? [])
  }, [calibrateCameraId])   // eslint-disable-line react-hooks/exhaustive-deps

  // The floorplan is letterboxed into PLAN_W×PLAN_H — compute the fit so we can
  // map clicks back to image px and place existing dots.
  const fit = useMemo(() => {
    const iw = floor?.imageWidth ?? PLAN_W
    const ih = floor?.imageHeight ?? PLAN_H
    const k = Math.min(PLAN_W / iw, PLAN_H / ih)
    const dw = iw * k
    const dh = ih * k
    return { k, dw, dh, offX: (PLAN_W - dw) / 2, offY: (PLAN_H - dh) / 2, iw, ih }
  }, [floor])

  // Mock camera frame (same dark-CCTV style as LiveViewModal, static one frame).
  useEffect(() => {
    if (!camera) return
    const ctx = frameCanvasRef.current?.getContext('2d')
    if (!ctx) return
    drawCctvFrame(ctx, {
      w: FRAME_W,
      h: FRAME_H,
      camera,
      variant: 'calib',
      renderMode: 'mock',
    })
  }, [camera])

  if (!camera || !floor) return null

  const planToImage = (px, py) => ({
    x: Math.round((px - fit.offX) / fit.k),
    y: Math.round((py - fit.offY) / fit.k),
  })
  const imageToPlan = (ix, iy) => ({
    x: fit.offX + ix * fit.k,
    y: fit.offY + iy * fit.k,
  })

  const onPlanClick = (e) => {
    if (floorPts.length >= 4) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    // ignore clicks in the letterbox margin
    if (px < fit.offX || px > fit.offX + fit.dw || py < fit.offY || py > fit.offY + fit.dh) return
    setFloorPts([...floorPts, planToImage(px, py)])
  }

  const onFrameClick = (e) => {
    if (framePts.length >= 4) return
    const rect = e.currentTarget.getBoundingClientRect()
    setFramePts([...framePts, {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
    }])
  }

  const reset = () => { setFloorPts([]); setFramePts([]) }

  const ready = floorPts.length === 4 && framePts.length === 4
  // frame → floorplan-image homography (what we want at runtime for detections)
  const H = ready ? solveHomography(framePts, floorPts) : null

  // Quality check (no user-facing number — reprojection error is useless with
  // exactly 4 points, it always fits perfectly). The real risk is a cramped /
  // near-collinear quad, which makes H ill-conditioned. We flag it when the
  // worse of the two panes' quads covers under MIN_SPREAD_FRAC of its area.
  const MIN_SPREAD_FRAC = 0.04
  const frameFrac = framePts.length === 4 ? quadArea(framePts) / (FRAME_W * FRAME_H) : 0
  const planFrac = floorPts.length === 4
    ? quadArea(floorPts.map((p) => imageToPlan(p.x, p.y))) / (fit.dw * fit.dh) : 0
  const quadWarn = ready && Math.min(frameFrac, planFrac) < MIN_SPREAD_FRAC

  // 52-B2: a crossed quad in EITHER pane is unusable — block the save rather
  // than warn, since the resulting H silently produces infinite coordinates.
  const crossedQuad = ready && !(
    isConvexQuad(framePts) && isConvexQuad(floorPts.map((p) => imageToPlan(p.x, p.y)))
  )
  const canSave = !!H && !crossedQuad

  const save = () => {
    if (!canSave) return
    updateCamera(activeFloorId, camera.id, {
      calibration: { floorPts, framePts, H, source: 'manual' },
    })
    closeCalibrate()
  }

  // Which pane is active. The step prompt lives ON that pane's label so it
  // always sits directly above the image the user should be clicking — stage 1
  // over the floorplan (left), stage 2 over the camera frame (right).
  const onPlanStage = floorPts.length < 4
  const onFrameStage = !onPlanStage && framePts.length < 4
  const allDone = !onPlanStage && !onFrameStage
  const planStep = onPlanStage ? `① 在平面圖點第 ${floorPts.length + 1} 點` : null
  const frameStep = onFrameStage ? `② 在相機畫面點對應的第 ${framePts.length + 1} 點` : null

  const dismiss = useOverlayDismiss(closeCalibrate)

  return (
    <div className="calib" {...dismiss}>
      <div className="calib__frame">
        <div className="calib__bar">
          <span className="calib__title">🎯 相機校正 · 用於人流熱圖 · {camera.name}</span>
          <button type="button" className="calib__close" onClick={closeCalibrate}>✕</button>
        </div>

        {allDone && <div className="calib__step">✓ 四對點完成，可儲存</div>}

        <div className="calib__panes">
          <div className="calib__pane">
            <div className="calib__pane-label">
              平面圖（依序點 4 點）
              {planStep && <span className="calib__pane-step">{planStep}</span>}
            </div>
            <div
              className="calib__plan"
              style={{ width: PLAN_W, height: PLAN_H }}
              onClick={onPlanClick}
            >
              <img
                className="calib__plan-img"
                src={floor.imageUrl}
                alt=""
                style={{ width: fit.dw, height: fit.dh, left: fit.offX, top: fit.offY }}
                draggable={false}
              />
              {/* camera position marker for orientation */}
              <span
                className="calib__cam-dot"
                style={{ left: imageToPlan(camera.x, camera.y).x, top: imageToPlan(camera.x, camera.y).y }}
                title={camera.name}
              />
              {floorPts.map((p, i) => {
                const d = imageToPlan(p.x, p.y)
                return (
                  <span key={i} className="calib__dot" style={{ left: d.x, top: d.y, background: DOT_COLORS[i] }}>
                    {i + 1}
                  </span>
                )
              })}
            </div>
          </div>

          <div className="calib__pane">
            <div className="calib__pane-label">
              相機畫面（點相同的 4 點）
              {frameStep && <span className="calib__pane-step">{frameStep}</span>}
            </div>
            <div className="calib__frame-wrap" style={{ width: FRAME_W, height: FRAME_H }} onClick={onFrameClick}>
              <canvas ref={frameCanvasRef} width={FRAME_W} height={FRAME_H} className="calib__frame-canvas" />
              {framePts.map((p, i) => (
                <span key={i} className="calib__dot" style={{ left: p.x, top: p.y, background: DOT_COLORS[i] }}>
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="calib__footer">
          <span className={`calib__status${(ready && (!H || crossedQuad || quadWarn)) ? ' calib__status--warn' : ''}`}>
            {ready
              ? (!H
                ? '⚠ 四點過於共線，無法求解，請重設'
                : crossedQuad
                  ? '⚠ 四點順序交叉成「Z 字」，會算出無效座標；請依同一方向（順時針或逆時針）重點'
                  : quadWarn
                    ? '⚠ 四邊形過小／太接近共線，精度低；建議攤開四角重點'
                    : '校正完成')
              : `已點 ${floorPts.length}+${framePts.length} / 4+4`}
          </span>
          <div className="calib__actions">
            <button type="button" className="calib__btn" onClick={reset}>重設</button>
            <button type="button" className="calib__btn calib__btn--primary" onClick={save} disabled={!canSave}>
              儲存校正
            </button>
          </div>
        </div>
        <div className="calib__hint">
          點地面上構成一個四邊形的 4 個角，兩邊依<b>相同順序</b>對應；四角攤越開越準，避免共線或擠在一起。
        </div>
      </div>
    </div>
  )
}

export default CalibrationModal

import React, { useEffect, useRef, useState } from 'react'
import { sampleGain } from '@/constants/antennaPatterns'
import { wrapAzimuth } from '@/utils/angle'

// 3D preview of a custom antenna pattern — the same volumetric lobe the 3D
// viewer renders (radius = normalized Gh(az) + Gv(el) in dB space), drawn on
// a plain 2D canvas with painter-sorted Lambert-shaded quads so we don't pay
// for another WebGL context just for a ~120 px thumbnail.
//
// Interaction:
//   horizontal drag — rotates the AZIMUTH. Only the local preview rotates
//     while the button is held; the store commit happens ONCE on release, so
//     no heatmap work can start mid-drag (a mid-drag pause longer than the
//     debounce window would otherwise fire a full recompute while dragging).
//   vertical drag — adjusts the antenna TILT (boresight elevation, +up/−down,
//     clamped ±90°). Same commit-on-release rule as azimuth (Phase 40).
//   Shift + vertical drag — tilts the preview CAMERA pitch (view-only, not
//     persisted), for inspecting the lobe from above / the side / below.
//
// Orientation matches the app convention: azimuth 0 = +x (right), clockwise.
// The lobe surface renders the exact engine formula r = Gh(az) + Gv(el − tilt)
// so what the user sees is what apGainDbi computes.
const SIZE = 120
const MAX_R = 46
const MIN_DB = -25          // matches APLayer3D CUSTOM_MIN_DB
const AZ_SEGS = 48
const EL_SEGS = 20
const DEFAULT_PITCH_DEG = 32   // camera elevation above the horizon
const MIN_PITCH_DEG = -80
const MAX_PITCH_DEG = 80
const AZ_DEG_PER_PX = 1.5
const PITCH_DEG_PER_PX = 0.6
const TILT_DEG_PER_PX = 0.6
const MIN_TILT_DEG = -90
const MAX_TILT_DEG = 90

// Light from the upper-left-front, matching the dark-panel aesthetic.
const LIGHT = (() => {
  const v = [-0.35, 0.85, -0.4]
  const len = Math.hypot(...v)
  return v.map((c) => c / len)
})()

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function drawPreview(canvas, pattern, color, azimuthDeg, tiltDeg, pitchDeg) {
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== SIZE * dpr) {
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, SIZE, SIZE)
  const cx = SIZE / 2
  const cy = SIZE / 2 + 4   // lobe reads better slightly below center
  const azRad = azimuthDeg * Math.PI / 180
  const tiltRad = tiltDeg * Math.PI / 180
  const pitch = pitchDeg * Math.PI / 180
  const sinP = Math.sin(pitch)
  const cosP = Math.cos(pitch)
  const [cr, cg, cb] = hexToRgb(color)

  // Project world (X right, Y up, Z toward screen-bottom) → screen px.
  // Depth grows toward the camera (at elevation `pitch` on the +Z side).
  const project = (x, y, z) => ({
    sx: cx + x,
    sy: cy + z * sinP - y * cosP,
    depth: y * sinP + z * cosP,
  })

  // ── Ground reference: projected circles (r/3, 2r/3, r) + axis cross ──
  const groundEllipse = (r, stroke, dash) => {
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, Math.max(Math.abs(r * sinP), 0.01), 0, 0, Math.PI * 2)
    ctx.strokeStyle = stroke
    ctx.setLineDash(dash)
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
  }
  groundEllipse(MAX_R / 3, 'rgba(255,255,255,0.10)', [2, 3])
  groundEllipse((MAX_R * 2) / 3, 'rgba(255,255,255,0.10)', [2, 3])
  groundEllipse(MAX_R, 'rgba(255,255,255,0.22)', [])
  ctx.beginPath()
  ctx.moveTo(cx - MAX_R, cy)
  ctx.lineTo(cx + MAX_R, cy)
  ctx.moveTo(cx, cy - MAX_R * sinP)
  ctx.lineTo(cx, cy + MAX_R * sinP)
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Boresight direction (dashed, like the 2D preview) — lifted out of the
  // ground plane by the tilt so the aim line matches the lobe's main axis.
  const bore = project(
    MAX_R * Math.cos(tiltRad) * Math.cos(azRad),
    MAX_R * Math.sin(tiltRad),
    MAX_R * Math.cos(tiltRad) * Math.sin(azRad),
  )
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(bore.sx, bore.sy)
  ctx.strokeStyle = color
  ctx.setLineDash([3, 2])
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.setLineDash([])

  // ── Lobe surface: vertex grid → painter-sorted shaded quads ──
  const verts = []   // (EL_SEGS+1) × (AZ_SEGS+1) rows of [x, y, z]
  for (let j = 0; j <= EL_SEGS; j++) {
    const el = -Math.PI / 2 + (j / EL_SEGS) * Math.PI
    const gv = sampleGain(pattern, el - tiltRad)
    for (let i = 0; i <= AZ_SEGS; i++) {
      const az = (i / AZ_SEGS) * 2 * Math.PI
      const db = Math.max(sampleGain(pattern, az) + gv, MIN_DB)
      const r = ((db - MIN_DB) / -MIN_DB) * MAX_R
      const world = az + azRad
      verts.push([
        r * Math.cos(el) * Math.cos(world),
        r * Math.sin(el),
        r * Math.cos(el) * Math.sin(world),
      ])
    }
  }
  const idx = (j, i) => j * (AZ_SEGS + 1) + i
  const quads = []
  for (let j = 0; j < EL_SEGS; j++) {
    for (let i = 0; i < AZ_SEGS; i++) {
      const a = verts[idx(j, i)]
      const b = verts[idx(j, i + 1)]
      const c = verts[idx(j + 1, i + 1)]
      const d = verts[idx(j + 1, i)]
      const mx = (a[0] + b[0] + c[0] + d[0]) / 4
      const my = (a[1] + b[1] + c[1] + d[1]) / 4
      const mz = (a[2] + b[2] + c[2] + d[2]) / 4
      // Degenerate at the poles when r collapses — skip invisible slivers.
      if (Math.hypot(mx, my, mz) < 0.5) continue
      // Normal from the quad diagonals; orient outward (star-shaped surface).
      const d1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const d2 = [d[0] - b[0], d[1] - b[1], d[2] - b[2]]
      let nx = d1[1] * d2[2] - d1[2] * d2[1]
      let ny = d1[2] * d2[0] - d1[0] * d2[2]
      let nz = d1[0] * d2[1] - d1[1] * d2[0]
      const nl = Math.hypot(nx, ny, nz) || 1
      nx /= nl; ny /= nl; nz /= nl
      if (nx * mx + ny * my + nz * mz < 0) { nx = -nx; ny = -ny; nz = -nz }
      const shade = 0.32 + 0.62 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2])
      quads.push({
        pts: [a, b, c, d],
        depth: my * sinP + mz * cosP,
        shade,
      })
    }
  }
  quads.sort((q1, q2) => q1.depth - q2.depth)   // far → near
  for (const q of quads) {
    ctx.beginPath()
    for (let k = 0; k < 4; k++) {
      const [x, y, z] = q.pts[k]
      const { sx, sy } = project(x, y, z)
      if (k === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }
    ctx.closePath()
    ctx.fillStyle = `rgba(${Math.round(cr * q.shade)}, ${Math.round(cg * q.shade)}, ${Math.round(cb * q.shade)}, 0.96)`
    ctx.fill()
  }
}

export default function PatternPreview3D({ pattern, color, azimuth = 0, tilt = 0, onAzimuthChange, onTiltChange }) {
  const canvasRef = useRef(null)
  // Local azimuth/tilt while dragging (unwrapped accumulation for a smooth
  // spin); null = follow the store values.
  const [dragAz, setDragAz] = useState(null)
  const [dragTilt, setDragTilt] = useState(null)
  // View pitch — preview-only state, not persisted on the AP.
  const [pitchDeg, setPitchDeg] = useState(DEFAULT_PITCH_DEG)
  const dragRef = useRef(null)   // { startX, startY, startAz, startTilt, startPitch, viewMode, moved }
  const displayAz = dragAz ?? azimuth
  const displayTilt = dragTilt ?? tilt

  useEffect(() => {
    if (canvasRef.current) drawPreview(canvasRef.current, pattern, color, displayAz, displayTilt, pitchDeg)
  }, [pattern, color, displayAz, displayTilt, pitchDeg])

  const onPointerDown = (e) => {
    e.preventDefault()
    // Keeps the drag alive when the pointer leaves the 120px canvas; guarded
    // because a pointerId with no active pointer (synthetic events) throws.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* noop */ }
    // Shift at press time picks the mode for the whole drag: view-pitch
    // (camera only) vs edit (azimuth + tilt, committed on release).
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startAz: azimuth,
      startTilt: tilt,
      startPitch: pitchDeg,
      viewMode: e.shiftKey,
      moved: false,
    }
    if (!e.shiftKey) {
      setDragAz(azimuth)
      setDragTilt(tilt)
    }
  }
  const onPointerMove = (e) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.viewMode) {
      // Shift-drag: vertical → view pitch (drag down = look from above, up =
      // from below, matching OrbitControls' orbit direction in the 3D viewer).
      const nextPitch = Math.max(MIN_PITCH_DEG, Math.min(MAX_PITCH_DEG,
        drag.startPitch + (e.clientY - drag.startY) * PITCH_DEG_PER_PX))
      setPitchDeg(nextPitch)
      return
    }
    // Horizontal → azimuth, vertical → tilt (drag up = boresight up). Both
    // preview-local only while the button is held — the store (and thus any
    // heatmap recompute) is untouched until release.
    const nextAz = Math.round(drag.startAz + (e.clientX - drag.startX) * AZ_DEG_PER_PX)
    const nextTilt = Math.round(Math.max(MIN_TILT_DEG, Math.min(MAX_TILT_DEG,
      drag.startTilt - (e.clientY - drag.startY) * TILT_DEG_PER_PX)))
    if (nextAz !== drag.startAz || nextTilt !== drag.startTilt) drag.moved = true
    setDragAz(nextAz)
    setDragTilt(nextTilt)
  }
  const onPointerUp = () => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    // Single commit on release; the debounced heatmap recompute follows.
    if (!drag.viewMode && drag.moved) {
      if (dragAz != null && dragAz !== drag.startAz && onAzimuthChange) onAzimuthChange(wrapAzimuth(dragAz))
      if (dragTilt != null && dragTilt !== drag.startTilt && onTiltChange) onTiltChange(dragTilt)
    }
    setDragAz(null)
    setDragTilt(null)
  }

  return (
    <canvas
      ref={canvasRef}
      className="ap-panel__pattern-canvas"
      style={{ width: SIZE, height: SIZE, cursor: dragRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
      title="左右拖曳＝方位角；上下拖曳＝俯仰角；Shift+上下＝觀察視角"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

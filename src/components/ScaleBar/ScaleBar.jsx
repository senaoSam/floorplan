import React from 'react'
import './ScaleBar.sass'

// Bottom-right floating scale indicator. Shown only when the active floor has
// a calibrated px/m scale. Picks a "nice" round meter value so the on-screen
// bar lands somewhere in the 80–120 px range — same idea as map scale bars.

const TARGET_PX = 100   // ideal on-screen bar width
const NICE_M = [
  0.1, 0.2, 0.5,
  1, 2, 5,
  10, 20, 50,
  100, 200, 500,
  1000, 2000, 5000,
]

function pickNiceMeters(pxPerScreenMeter) {
  if (!isFinite(pxPerScreenMeter) || pxPerScreenMeter <= 0) return null
  // Find the NICE_M value whose screen width is closest to TARGET_PX (in log space).
  let best = NICE_M[0]
  let bestDist = Infinity
  for (const m of NICE_M) {
    const px = m * pxPerScreenMeter
    const dist = Math.abs(Math.log(px / TARGET_PX))
    if (dist < bestDist) {
      bestDist = dist
      best = m
    }
  }
  return best
}

function formatMeters(m) {
  if (m >= 1) return `${m} m`
  return `${(m * 100).toFixed(0)} cm`
}

export default function ScaleBar({ floorPxPerM, viewportScale }) {
  if (!floorPxPerM || !viewportScale) return null
  // floorPxPerM = canvas-px per meter (image space)
  // viewportScale = screen-px per canvas-px
  // → screen-px per meter:
  const screenPxPerM = floorPxPerM * viewportScale
  const meters = pickNiceMeters(screenPxPerM)
  if (meters == null) return null
  const widthPx = meters * screenPxPerM

  return (
    <div className="scale-bar" title={`目前 1 公尺 ≈ ${screenPxPerM.toFixed(1)} 螢幕像素`}>
      <div className="scale-bar__label">{formatMeters(meters)}</div>
      <div className="scale-bar__bar" style={{ width: `${widthPx}px` }}>
        <span className="scale-bar__tick scale-bar__tick--left" />
        <span className="scale-bar__tick scale-bar__tick--right" />
      </div>
    </div>
  )
}

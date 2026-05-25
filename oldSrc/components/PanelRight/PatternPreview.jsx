import React from 'react'

// Polar preview of a custom antenna pattern. 36 dB samples → normalized radius.
// Orientation: index 0 points right (+x), matching our azimuth convention.
export default function PatternPreview({ pattern, color, azimuth = 0, className = 'ap-panel__pattern-svg' }) {
  const size = 96
  const cx = size / 2
  const cy = size / 2
  const maxR = 38
  const minDb = -30
  const samples = pattern.samples
  const n = samples.length
  const pts = []
  for (let i = 0; i < n; i++) {
    const db = Math.max(samples[i], minDb)
    const r = ((db - minDb) / -minDb) * maxR
    const angDeg = i * (360 / n) + azimuth
    const ang = angDeg * Math.PI / 180
    pts.push(`${(cx + r * Math.cos(ang)).toFixed(2)},${(cy + r * Math.sin(ang)).toFixed(2)}`)
  }
  return (
    <svg width={size} height={size} className={className}>
      {[(1/3) * maxR, (2/3) * maxR, maxR].map((r, i) => (
        <circle key={r} cx={cx} cy={cy} r={r} fill="none"
          stroke={i === 2 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'}
          strokeDasharray={i === 2 ? '' : '2 3'} strokeWidth="1" />
      ))}
      <line x1={cx - maxR} y1={cy} x2={cx + maxR} y2={cy} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <line x1={cx} y1={cy - maxR} x2={cx} y2={cy + maxR} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <polygon points={pts.join(' ')} fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.5" />
      <line
        x1={cx} y1={cy}
        x2={cx + maxR * Math.cos(azimuth * Math.PI / 180)}
        y2={cy + maxR * Math.sin(azimuth * Math.PI / 180)}
        stroke={color} strokeWidth="1.5" strokeDasharray="3 2"
      />
    </svg>
  )
}

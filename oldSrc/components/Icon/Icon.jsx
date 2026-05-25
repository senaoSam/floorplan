import React from 'react'

// Single-stroke / minimal-fill icon set used by the floating toolbar (Phase 18).
// Every icon is 24x24 in viewBox, drawn in "currentColor" so button states
// (hover / active / disabled) just swap CSS color instead of re-themed SVGs.
//
// Avoided emoji entirely (per Phase 18 design): SVG icons keep stroke weight
// consistent across OS-rendered emoji fonts and stay crisp at 24px size.

const ICONS = {
  // Pointer / arrow cursor (top-left)
  select: (
    <path
      d="M5 3l13 6-6 2-2 6-5-14z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  ),

  // Marquee selection — dashed rectangle
  marquee: (
    <rect
      x="4" y="4" width="16" height="16"
      fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeDasharray="2.5 2.5"
    />
  ),

  // Pan — open palm (simplified hand silhouette)
  pan: (
    <path
      d="M9 6v6.5M12 4.5v8M15 6v6.5M7 11c0-1 .8-1.6 1.6-1.4M9 12.5v-1M12 12.5V12M15 12.5v-1M7 12c0 4 2 7 5 7s5-3 5-7v-2"
      fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round"
    />
  ),

  // Wall — thick horizontal segment with endpoint dots
  wall: (
    <>
      <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="4" cy="12" r="2" fill="currentColor" />
      <circle cx="20" cy="12" r="2" fill="currentColor" />
    </>
  ),

  // Door + Window — small wall break with door swing
  doorWindow: (
    <>
      <line x1="3" y1="17" x2="9" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="15" y1="17" x2="21" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 17v-6h6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 11a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.5 1.5" />
    </>
  ),

  // Floor hole — dashed polygon (void / atrium)
  floorHole: (
    <polygon
      points="6,5 19,5 19,19 6,19"
      fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeDasharray="3 2"
    />
  ),

  // AP — concentric WiFi waves
  ap: (
    <>
      <path d="M7 14a5 5 0 0 1 10 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4 14a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="14" r="1.8" fill="currentColor" />
    </>
  ),

  // Switch — chassis with port row
  switch: (
    <>
      <rect x="3" y="9" width="18" height="8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <line x1="6"  y1="14.5" x2="6.6" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="8.5" y1="14.5" x2="9.1" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="11" y1="14.5" x2="11.6" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="13.5" y1="14.5" x2="14.1" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="16" y1="14.5" x2="16.6" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="18" y1="14.5" x2="18.6" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),

  // Cable tray — two parallel rails + dashed centreline
  cableTray: (
    <>
      <line x1="3" y1="8" x2="21" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="3" y1="16" x2="21" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
    </>
  ),

  // Riser — up/down arrows through a vertical chase
  riser: (
    <>
      <rect x="9" y="4" width="6" height="16" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2.5 L12 7 M10 4.5 L12 2.5 L14 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 21.5 L12 17 M10 19.5 L12 21.5 L14 19.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  // Scope — hexagon outline (RF evaluation area)
  scope: (
    <polygon
      points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5"
      fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinejoin="round"
    />
  ),

  // Ruler / scale — horizontal ruler with tick marks
  scale: (
    <>
      <rect x="2.5" y="9" width="19" height="6" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="6"  y1="9" x2="6"  y2="12" stroke="currentColor" strokeWidth="1.4" />
      <line x1="10" y1="9" x2="10" y2="13" stroke="currentColor" strokeWidth="1.4" />
      <line x1="14" y1="9" x2="14" y2="12" stroke="currentColor" strokeWidth="1.4" />
      <line x1="18" y1="9" x2="18" y2="13" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),

  // Undo — counter-clockwise arrow
  undo: (
    <path
      d="M9 7 L4 7 L4 12 M4 7a8 8 0 1 1 -1 8"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
    />
  ),

  // Redo — clockwise arrow
  redo: (
    <path
      d="M15 7 L20 7 L20 12 M20 7a8 8 0 1 0 1 8"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
    />
  ),

  // Eye — open (layer visible)
  eye: (
    <>
      <path d="M2.5 12 C5 7, 8.5 5, 12 5 S19 7, 21.5 12 C19 17, 15.5 19, 12 19 S5 17, 2.5 12 Z"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </>
  ),

  // Eye-off — closed (layer hidden) — slashed eye
  eyeOff: (
    <>
      <path d="M2.5 12 C5 7, 8.5 5, 12 5 S19 7, 21.5 12 C19 17, 15.5 19, 12 19 S5 17, 2.5 12 Z"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),

  // Chevron right (collapsed)
  chevronRight: (
    <path d="M9 5 L16 12 L9 19" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" />
  ),

  // Chevron down (expanded)
  chevronDown: (
    <path d="M5 9 L12 16 L19 9" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" />
  ),

  // AI Walls — wand-like sparkle on a wall segment
  aiWalls: (
    <>
      <line x1="3" y1="18" x2="14" y2="18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M17 4 L17 8 M15 6 L19 6 M20 9 L20 12 M18.5 10.5 L21.5 10.5 M15 11 L15 14 M13.5 12.5 L16.5 12.5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
}

export const ICON_NAMES = Object.freeze(Object.keys(ICONS))

function Icon({ name, size = 18, className = '', strokeColor }) {
  const node = ICONS[name]
  if (!node) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={strokeColor ? { color: strokeColor } : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {node}
    </svg>
  )
}

export default Icon

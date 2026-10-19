import React from 'react'

// Single-stroke / minimal-fill icon set used by the floating toolbar (Phase 18).
// Every icon is 24x24 in viewBox, drawn in "currentColor" so button states
// (hover / active / disabled) just swap CSS color instead of re-themed SVGs.
//
// Avoided emoji entirely (per Phase 18 design): SVG icons keep stroke weight
// consistent across OS-rendered emoji fonts and stay crisp at 24px size.

// Lucide icons (https://lucide.dev, v1.59.0, ISC License, Copyright (c)
// 2026 Lucide Icons and Contributors) -- copied as paths, no package. They
// replace the emoji the UI used to carry; same 24x24 stroke style.
const LUCIDE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

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

  // Door — wall break + hinged door leaf + swing arc
  door: (
    <>
      <line x1="3" y1="19" x2="7" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="17" y1="19" x2="21" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="7" y1="19" x2="7" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 7a12 12 0 0 1 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.5 1.5" />
    </>
  ),

  // Window — wall break + double glazing lines
  window: (
    <>
      <line x1="3" y1="17" x2="6" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="18" y1="17" x2="21" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="6" y1="15" x2="18" y2="15" stroke="currentColor" strokeWidth="1.4" />
      <line x1="6" y1="19" x2="18" y2="19" stroke="currentColor" strokeWidth="1.4" />
      <line x1="6" y1="15" x2="6" y2="19" stroke="currentColor" strokeWidth="1.4" />
      <line x1="18" y1="15" x2="18" y2="19" stroke="currentColor" strokeWidth="1.4" />
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

  // Chevron left (expand toward the left / collapse a right dock)
  chevronLeft: (
    <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" />
  ),

  // Chevron down (expanded)
  chevronDown: (
    <path d="M5 9 L12 16 L19 9" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" />
  ),

  // Client view — a person/device head+shoulders with a small signal arc,
  // reading as "the network from a client's point of view".
  client: (
    <>
      <circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16.5 5.2a4 4 0 0 1 2.6 2.6 M18.2 3.3a7 7 0 0 1 4 4"
        fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),

  // Stats — a three-bar bar chart on a baseline, reading as "live network
  // statistics / dashboard".
  stats: (
    <>
      <line x1="4" y1="20" x2="20" y2="20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <rect x="5.5" y="12" width="3.5" height="7" rx="0.6" fill="currentColor" />
      <rect x="10.5" y="7" width="3.5" height="12" rx="0.6" fill="currentColor" />
      <rect x="15.5" y="14" width="3.5" height="5" rx="0.6" fill="currentColor" />
    </>
  ),

  // Camera — video camera body with a lens cone pointing right
  camera: (
    <>
      <rect x="2.5" y="7" width="12.5" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15 11 L21 8 V16 L15 13 Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="8.5" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),

  // AI Walls — wand-like sparkle on a wall segment
  aiWalls: (
    <>
      <line x1="3" y1="18" x2="14" y2="18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M17 4 L17 8 M15 6 L19 6 M20 9 L20 12 M18.5 10.5 L21.5 10.5 M15 11 L15 14 M13.5 12.5 L16.5 12.5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),

  // lucide: triangle-alert
  warning: (
    <g {...LUCIDE}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </g>
  ),
  // lucide: lock
  lock: (
    <g {...LUCIDE}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </g>
  ),
  // lucide: play
  play: (
    <g {...LUCIDE}>
      <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
    </g>
  ),
  // lucide: pause
  pause: (
    <g {...LUCIDE}>
      <rect x="14" y="3" width="5" height="18" rx="1" />
      <rect x="5" y="3" width="5" height="18" rx="1" />
    </g>
  ),
  // lucide: skip-back
  skipBack: (
    <g {...LUCIDE}>
      <path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z" />
      <path d="M3 20V4" />
    </g>
  ),
  // lucide: skip-forward
  skipForward: (
    <g {...LUCIDE}>
      <path d="M21 4v16" />
      <path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z" />
    </g>
  ),
  // lucide: zoom-in
  zoomIn: (
    <g {...LUCIDE}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
      <line x1="11" x2="11" y1="8" y2="14" />
      <line x1="8" x2="14" y1="11" y2="11" />
    </g>
  ),
  // lucide: file-text
  fileText: (
    <g {...LUCIDE}>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </g>
  ),
  // lucide: crosshair
  crosshair: (
    <g {...LUCIDE}>
      <circle cx="12" cy="12" r="10" />
      <line x1="22" x2="18" y1="12" y2="12" />
      <line x1="6" x2="2" y1="12" y2="12" />
      <line x1="12" x2="12" y1="6" y2="2" />
      <line x1="12" x2="12" y1="22" y2="18" />
    </g>
  ),
  // lucide: video
  video: (
    <g {...LUCIDE}>
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </g>
  ),
  // lucide: clipboard-list
  clipboardList: (
    <g {...LUCIDE}>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </g>
  ),
  // lucide: dices
  dices: (
    <g {...LUCIDE}>
      <rect width="12" height="12" x="2" y="10" rx="2" ry="2" />
      <path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6" />
      <path d="M6 18h.01" />
      <path d="M10 14h.01" />
      <path d="M15 6h.01" />
      <path d="M18 9h.01" />
    </g>
  ),
  // lucide: timer
  timer: (
    <g {...LUCIDE}>
      <line x1="10" x2="14" y1="2" y2="2" />
      <line x1="12" x2="15" y1="14" y2="11" />
      <circle cx="12" cy="14" r="8" />
    </g>
  ),
  // lucide: radio-tower
  radioTower: (
    <g {...LUCIDE}>
      <path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" />
      <path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" />
      <circle cx="12" cy="9" r="2" />
      <path d="M16.2 4.8c2 2 2.26 5.11.8 7.47" />
      <path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1" />
      <path d="M9.5 18h5" />
      <path d="m8 22 4-11 4 11" />
    </g>
  ),
  // lucide: radio
  radio: (
    <g {...LUCIDE}>
      <path d="M16.247 7.761a6 6 0 0 1 0 8.478" />
      <path d="M19.075 4.933a10 10 0 0 1 0 14.134" />
      <path d="M4.925 19.067a10 10 0 0 1 0-14.134" />
      <path d="M7.753 16.239a6 6 0 0 1 0-8.478" />
      <circle cx="12" cy="12" r="2" />
    </g>
  ),
  // lucide: hourglass
  hourglass: (
    <g {...LUCIDE}>
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </g>
  ),
  // lucide: image
  image: (
    <g {...LUCIDE}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </g>
  ),
  // lucide: pin
  pin: (
    <g {...LUCIDE}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </g>
  ),
  // lucide: map-pin
  mapPin: (
    <g {...LUCIDE}>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </g>
  ),
  // lucide: zap
  zap: (
    <g {...LUCIDE}>
      <path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" />
    </g>
  ),
  // lucide: snowflake
  snowflake: (
    <g {...LUCIDE}>
      <path d="m10 20-1.25-2.5L6 18" />
      <path d="M10 4 8.75 6.5 6 6" />
      <path d="m14 20 1.25-2.5L18 18" />
      <path d="m14 4 1.25 2.5L18 6" />
      <path d="m17 21-3-6h-4" />
      <path d="m17 3-3 6 1.5 3" />
      <path d="M2 12h6.5L10 9" />
      <path d="m20 10-1.5 2 1.5 2" />
      <path d="M22 12h-6.5L14 15" />
      <path d="m4 10 1.5 2L4 14" />
      <path d="m7 21 3-6-1.5-3" />
      <path d="m7 3 3 6h4" />
    </g>
  ),
  // lucide: scissors
  scissors: (
    <g {...LUCIDE}>
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </g>
  ),
  // lucide: arrow-left-right
  arrowLeftRight: (
    <g {...LUCIDE}>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </g>
  ),
  // lucide: map
  map: (
    <g {...LUCIDE}>
      <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <path d="M15 5.764v15" />
      <path d="M9 3.236v15" />
    </g>
  ),
  // lucide: mouse-pointer-click
  mouseClick: (
    <g {...LUCIDE}>
      <path d="M14 4.1 12 6" />
      <path d="m5.1 8-2.9-.8" />
      <path d="m6 12-1.9 2" />
      <path d="M7.2 2.2 8 5.1" />
      <path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" />
    </g>
  ),
  // lucide: square-check
  checkSquare: (
    <g {...LUCIDE}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="m16 9-5.5 5.5L8 12" />
    </g>
  ),
  // lucide: square
  square: (
    <g {...LUCIDE}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </g>
  ),
  // lucide: globe
  globe: (
    <g {...LUCIDE}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </g>
  ),
  // lucide: octagon-x
  octagonX: (
    <g {...LUCIDE}>
      <path d="m15 9-6 6" />
      <path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z" />
      <path d="m9 9 6 6" />
    </g>
  ),
  // lucide: info
  info: (
    <g {...LUCIDE}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </g>
  ),
  // lucide: plug
  plug: (
    <g {...LUCIDE}>
      <path d="M12 22v-5" />
      <path d="M15 8V2" />
      <path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z" />
      <path d="M9 8V2" />
    </g>
  ),
  // lucide: arrow-left
  arrowLeft: (
    <g {...LUCIDE}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </g>
  ),
  // lucide: locate-fixed
  locate: (
    <g {...LUCIDE}>
      <line x1="2" x2="5" y1="12" y2="12" />
      <line x1="19" x2="22" y1="12" y2="12" />
      <line x1="12" x2="12" y1="2" y2="5" />
      <line x1="12" x2="12" y1="19" y2="22" />
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  // lucide: arrow-up-down
  arrowUpDown: (
    <g {...LUCIDE}>
      <path d="m21 16-4 4-4-4" />
      <path d="M17 20V4" />
      <path d="m3 8 4-4 4 4" />
      <path d="M7 4v16" />
    </g>
  ),
  // lucide: rotate-ccw
  rotateCcw: (
    <g {...LUCIDE}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </g>
  ),
  // lucide: rotate-cw
  rotateCw: (
    <g {...LUCIDE}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </g>
  ),
}

export const ICON_NAMES = Object.freeze(Object.keys(ICONS))

// `inline`: sits in a line of text (baseline-aligned, does not shrink), in
// place of the emoji that used to lead a label.
const INLINE_STYLE = { display: 'inline-block', verticalAlign: '-0.15em', flexShrink: 0 }

function Icon({ name, size = 18, className = '', strokeColor, inline = false, style }) {
  const node = ICONS[name]
  if (!node) return null
  const merged = inline || strokeColor || style
    ? { ...(inline ? INLINE_STYLE : null), ...(strokeColor ? { color: strokeColor } : null), ...style }
    : undefined
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={merged}
      aria-hidden="true"
      focusable="false"
    >
      {node}
    </svg>
  )
}

export default Icon

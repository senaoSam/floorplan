import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { rasterizeCoverageCounts, buildFovMaskGrid } from '@/features/cameras/fovRasterize'
import { computeOccupancyGrid, renderOccupancyCanvas } from '@/features/cameras/occupancyGrid'
import { useFrame } from '@react-three/fiber'
import { computeFlowGrid, computeStreamlines } from '@/features/cameras/analyticsStats'

const EMPTY = Object.freeze([])

// px/m fallback when a floor has no calibrated scale — mirrors
// camerasLayer.FALLBACK_PX_PER_M (and fovRasterize's literal 40). Inlined to
// avoid pulling the PIXI-side camerasLayer module into the Three.js bundle.
const FALLBACK_PX_PER_M = 40

// 3D projections of the 2D Camera-mode planning overlays. Each plane reuses the
// SAME rasteriser / colouriser the 2D PIXI layer uses so the 3D image is
// pixel-identical to 2D — no duplicated FOV geometry, no re-tuned colours:
//
//   BlindSpotPlane3D  ← rasterizeCoverageCounts (shared FOV rasteriser, the
//                        same one overlapLayer.js + coverageStats.js use). The
//                        0-camera pixels get the 2D blind-spot shade colour.
//                        Gated on useCameraStore.showBlindSpots (mirrors
//                        blindSpotLayer.js).
//   OverlapPlane3D    ← rasterizeCoverageCounts + the exact amber/teal colour
//                        map copied from overlapLayer.js. Gated on
//                        useCameraStore.showOverlap.
//   OccupancyPlane3D  ← computeOccupancyGrid + renderOccupancyCanvas (occupancy
//                        grid module, same as occupancyLayer.js). Gated on
//                        useTrackingStore.occupancyMode being 'traffic'/'dwell'.
//                        The 'flow' mode is a vector field, not a raster, so it
//                        projects via FlowPlane3D (streamline plane) instead.
//   FlowPlane3D       ← computeFlowGrid + computeStreamlines (same modules +
//                        params as occupancyLayer's flow branch). Gated on
//                        occupancyMode === 'flow'. Paints the SAME streamline
//                        picture as 2D (canvas 2D port of drawStreamlines)
//                        onto a floor plane, chevron-crawl animated via
//                        useFrame.
//
// Each plane wraps its offscreen canvas as a CanvasTexture on a floor-sized
// PlaneGeometry (image px × pxToM = metres) sitting a hair above the floor.
// Each gets its own y-lift so multiple overlays on at once don't z-fight (and
// they sit above the heatmap plane's 0.02 lift). Mounted inside the per-floor
// FloorStack group (active floor only) like HeatmapPlane3D, so they inherit the
// floor elevation + align transform.

// Mirror overlapLayer.js exactly.
const MAX_CANVAS_PX_OVERLAP = 1100
const SINGLE_RGB = [245, 158, 11]   // amber — single coverage
const MULTI_RGB = [20, 184, 166]    // teal — redundant (≥2)
const SINGLE_ALPHA = 90             // 0..255
const MULTI_ALPHA = 105

// Mirror blindSpotLayer.js exactly.
const MAX_CANVAS_PX_BLIND = 1400
const BLIND_RGBA = [15, 23, 42, 133] // rgba(15,23,42,0.52) → 0.52*255 ≈ 133

// y-lifts (metres above the floor image). Heatmap plane sits at 0.02; stagger
// the camera overlays above it so several-on doesn't z-fight.
const Y_OCCUPANCY = 0.03
const Y_OVERLAP   = 0.04
const Y_BLIND     = 0.05
const Y_FLOW      = 0.06   // flow arrows sit above all the heatmap planes

// Flow streamline styling mirrored from occupancyLayer.js exactly — the 3D
// flow view is the SAME streamline picture as 2D, painted on a floor plane.
const FLOW_COLOR_CSS = '#e879f9'      // FLOW_COLOR in occupancyLayer.js (fuchsia-400)
// Chevrons: black ">>" strokes, mirroring occupancyLayer's FLOW_CHEVRON_COLOR
// — same hue as the corridor made the arrows invisible, and a filled dart
// read as an aeroplane.
const FLOW_CHEVRON_CSS = '#000000'
const FLOW_DASH_PX = 26               // spacing between flow chevrons (canvas px)
const FLOW_CRAWL_PX_PER_SEC = 34      // how fast the chevrons march along the line
const MAX_CANVAS_PX_FLOW = 2048       // cap on the flow canvas's long edge
const FLOW_REDRAW_FPS = 30            // crawl redraw throttle inside useFrame

// Build a CanvasTexture from an offscreen canvas (sRGB, flagged for upload).
function makeTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas)
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  else tex.encoding = THREE.sRGBEncoding
  tex.needsUpdate = true
  return tex
}

// Shared mesh: a floor-aligned plane carrying `texture`, sized in metres.
function OverlayMesh({ texture, wM, hM, yLift }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[wM / 2, yLift, hM / 2]}>
      <planeGeometry args={[wM, hM]} />
      <meshBasicMaterial
        map={texture}
        side={THREE.DoubleSide}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

function BlindSpotPlane3D({ floorId, pxToM }) {
  const floors = useFloorStore((s) => s.floors)
  const floor  = floors.find((f) => f.id === floorId) ?? null
  const walls  = useWallStore((s) => s.wallsByFloor[floorId] ?? EMPTY)
  const cameras = useCameraStore((s) => s.camerasByFloor[floorId] ?? EMPTY)
  const showBlindSpots = useCameraStore((s) => s.showBlindSpots)

  // Reuse the shared FOV rasteriser, then shade the 0-camera pixels with the 2D
  // blind-spot colour. This is the same coverage union blindSpotLayer.js punches
  // out, expressed as "where counts === 0" — no duplicated FOV geometry.
  const canvas = useMemo(() => {
    if (!showBlindSpots || !floor?.imageWidth) return null
    const raster = rasterizeCoverageCounts({ cameras, walls, floor, maxCanvasPx: MAX_CANVAS_PX_BLIND })
    if (!raster) return null
    const { counts, cw, ch, total } = raster
    const out = document.createElement('canvas')
    out.width = cw
    out.height = ch
    const octx = out.getContext('2d')
    const img = octx.createImageData(cw, ch)
    const [r, g, b, a] = BLIND_RGBA
    for (let px = 0, p = 0; px < total; px++, p += 4) {
      if (counts[px] !== 0) continue   // covered → leave transparent
      img.data[p] = r
      img.data[p + 1] = g
      img.data[p + 2] = b
      img.data[p + 3] = a
    }
    octx.putImageData(img, 0, 0)
    return out
  }, [showBlindSpots, floor, cameras, walls])

  const texture = useMemo(() => (canvas ? makeTexture(canvas) : null), [canvas])
  useEffect(() => () => { texture?.dispose() }, [texture])

  if (!texture || !floor?.imageWidth) return null
  return (
    <OverlayMesh
      texture={texture}
      wM={floor.imageWidth * pxToM}
      hM={floor.imageHeight * pxToM}
      yLift={Y_BLIND}
    />
  )
}

function OverlapPlane3D({ floorId, pxToM }) {
  const floors = useFloorStore((s) => s.floors)
  const floor  = floors.find((f) => f.id === floorId) ?? null
  const walls  = useWallStore((s) => s.wallsByFloor[floorId] ?? EMPTY)
  const cameras = useCameraStore((s) => s.camerasByFloor[floorId] ?? EMPTY)
  const showOverlap = useCameraStore((s) => s.showOverlap)

  // Reuse the shared FOV rasteriser + overlapLayer.js's exact colour map.
  const canvas = useMemo(() => {
    if (!showOverlap || !floor?.imageWidth) return null
    const raster = rasterizeCoverageCounts({ cameras, walls, floor, maxCanvasPx: MAX_CANVAS_PX_OVERLAP })
    if (!raster) return null
    const { counts, cw, ch, total } = raster
    const out = document.createElement('canvas')
    out.width = cw
    out.height = ch
    const octx = out.getContext('2d')
    const img = octx.createImageData(cw, ch)
    for (let px = 0, p = 0; px < total; px++, p += 4) {
      const c = counts[px]
      if (c === 0) continue   // 0-camera area owned by the blind layer
      const [r, g, b] = c >= 2 ? MULTI_RGB : SINGLE_RGB
      img.data[p] = r
      img.data[p + 1] = g
      img.data[p + 2] = b
      img.data[p + 3] = c >= 2 ? MULTI_ALPHA : SINGLE_ALPHA
    }
    octx.putImageData(img, 0, 0)
    return out
  }, [showOverlap, floor, cameras, walls])

  const texture = useMemo(() => (canvas ? makeTexture(canvas) : null), [canvas])
  useEffect(() => () => { texture?.dispose() }, [texture])

  if (!texture || !floor?.imageWidth) return null
  return (
    <OverlayMesh
      texture={texture}
      wM={floor.imageWidth * pxToM}
      hM={floor.imageHeight * pxToM}
      yLift={Y_OVERLAP}
    />
  )
}

function OccupancyPlane3D({ floorId, pxToM }) {
  const floors = useFloorStore((s) => s.floors)
  const floor  = floors.find((f) => f.id === floorId) ?? null
  const tracks = useTrackingStore((s) => s.tracksByFloor[floorId] ?? EMPTY)
  const occupancyMode    = useTrackingStore((s) => s.occupancyMode)
  const occupancyFromSec = useTrackingStore((s) => s.occupancyFromSec)
  const occupancyToSec   = useTrackingStore((s) => s.occupancyToSec)
  const cameras    = useCameraStore((s) => s.camerasByFloor[floorId] ?? EMPTY)
  const walls      = useWallStore((s) => s.wallsByFloor[floorId] ?? EMPTY)
  const clipToFov  = useCameraStore((s) => s.clipHeatmapToFov)

  // Reuse the occupancy grid module verbatim (same compute + colourise as
  // occupancyLayer.js). 'off' renders nothing; 'flow' (arrow vectors) has no 3D
  // raster yet, so only 'traffic' / 'dwell' project. When "clip to FOV" is on,
  // the SAME maskFn the 2D layer uses clips cells outside camera coverage so 3D
  // and 2D stay pixel-identical.
  const canvas = useMemo(() => {
    if (occupancyMode === 'off' || occupancyMode === 'flow') return null
    if (!floor?.imageWidth) return null
    const maskFn = clipToFov
      ? (cols, rows, cellPx) => buildFovMaskGrid({ cameras, walls, floor, cols, rows, cellPx })
      : null
    const result = computeOccupancyGrid({
      tracks,
      tFromSec: occupancyFromSec,
      tToSec: occupancyToSec,
      imageWidth: floor.imageWidth,
      imageHeight: floor.imageHeight,
      pxPerM: floor.scale ?? FALLBACK_PX_PER_M,
      mode: occupancyMode,
      maskFn,
    })
    if (!result) return null
    return renderOccupancyCanvas(result)
  }, [occupancyMode, occupancyFromSec, occupancyToSec, floor, tracks, clipToFov, cameras, walls])

  const texture = useMemo(() => (canvas ? makeTexture(canvas) : null), [canvas])
  useEffect(() => () => { texture?.dispose() }, [texture])

  if (!texture || !floor?.imageWidth) return null
  return (
    <OverlayMesh
      texture={texture}
      wM={floor.imageWidth * pxToM}
      hM={floor.imageHeight * pxToM}
      yLift={Y_OCCUPANCY}
    />
  )
}

// 3D projection of the 2D flow map (occupancyMode === 'flow') — the SAME
// streamline picture the 2D layer draws (computeFlowGrid + computeStreamlines,
// identical params), painted with canvas 2D onto a floor-aligned plane like
// the occupancy heatmap, chevron-crawl animation included. Earlier this was an
// InstancedMesh of upright cones ("one arrow per cell"), which stopped making
// sense once the 2D side moved to streamlines — and read as noise from any
// angle. A textured plane is byte-for-byte the 2D look, just lying on the
// floor.
//
// The polyline/chevron maths and styling numbers are ported 1:1 from
// occupancyLayer.js (drawStreamlines/pointAtArc) with PIXI Graphics swapped
// for canvas 2D. The crawl redraws the offscreen canvas inside useFrame
// (throttled to FLOW_REDRAW_FPS) and flags the texture for re-upload — the 3D
// frameloop is 'always' while visible, so the chevrons march exactly like 2D.

// Walk a streamline's cumulative-length table to the point at arc-length `d`,
// returning { x, y, ux, uy } (position + unit tangent). Port of
// occupancyLayer.js pointAtArc.
function flowPointAtArc(line, d) {
  const { pts, cum } = line
  const total = cum[cum.length - 1]
  if (total <= 0) return null
  const dd = Math.min(Math.max(d, 0), total)
  let i = 1
  while (i < cum.length && cum[i] < dd) i++
  if (i >= cum.length) i = cum.length - 1
  const a = pts[i - 1], b = pts[i]
  const seg = cum[i] - cum[i - 1] || 1
  const f = (dd - cum[i - 1]) / seg
  const mag = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    ux: (b.x - a.x) / mag,
    uy: (b.y - a.y) / mag,
  }
}

// Draw the streamlines + crawling chevrons into `canvas` at supersample `k`
// (canvas px = image px × k). Same alpha/width/chevron formulas as the 2D
// drawStreamlines, so the plane texture matches the 2D canvas exactly.
function drawFlowCanvas(canvas, streamlines, k, crawl) {
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(k, 0, 0, k, 0, 0)   // draw in image-px coordinates
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const line of streamlines.lines) {
    const pts = line.pts
    if (pts.length < 2) continue
    const total = line.cum[line.cum.length - 1]
    if (total <= 0) continue
    const s = Math.min(1, line.strength * 2.2)
    const alpha = 0.30 + 0.55 * s
    const w = 2 + 4 * s

    // core line — a single stroke for the whole polyline
    ctx.strokeStyle = FLOW_COLOR_CSS
    ctx.globalAlpha = alpha * 0.55
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()

    // flow chevrons — one ">>" (two nested stroked angle marks) every
    // FLOW_DASH_PX, shifted by `crawl` so they march downstream.
    // Sized/weighted BELOW the corridor stroke — direction ticks, not the star.
    const hw = 3 + 2 * s
    ctx.strokeStyle = FLOW_CHEVRON_CSS
    ctx.lineWidth = 1.2 + 0.6 * s
    ctx.globalAlpha = alpha
    const start = ((crawl % FLOW_DASH_PX) + FLOW_DASH_PX) % FLOW_DASH_PX
    for (let d = start; d < total; d += FLOW_DASH_PX) {
      const p = flowPointAtArc(line, d)
      if (!p) continue
      const nx = -p.uy, ny = p.ux   // left normal
      ctx.beginPath()
      // two ">" marks, the second set back along the tangent
      for (const off of [0, hw * 0.7]) {
        const tx = p.x - p.ux * off
        const ty = p.y - p.uy * off
        ctx.moveTo(tx - p.ux * hw + nx * hw * 0.8, ty - p.uy * hw + ny * hw * 0.8)
        ctx.lineTo(tx, ty)
        ctx.lineTo(tx - p.ux * hw - nx * hw * 0.8, ty - p.uy * hw - ny * hw * 0.8)
      }
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
}

function FlowPlane3D({ floorId, pxToM }) {
  const floors = useFloorStore((s) => s.floors)
  const floor  = floors.find((f) => f.id === floorId) ?? null
  const tracks = useTrackingStore((s) => s.tracksByFloor[floorId] ?? EMPTY)
  const occupancyMode    = useTrackingStore((s) => s.occupancyMode)
  const occupancyFromSec = useTrackingStore((s) => s.occupancyFromSec)
  const occupancyToSec   = useTrackingStore((s) => s.occupancyToSec)
  const cameras    = useCameraStore((s) => s.camerasByFloor[floorId] ?? EMPTY)
  const walls      = useWallStore((s) => s.wallsByFloor[floorId] ?? EMPTY)
  const clipToFov  = useCameraStore((s) => s.clipHeatmapToFov)

  // Same field + streamline computation as the 2D layer (cellM 1.5, FOV mask).
  const streamlines = useMemo(() => {
    if (occupancyMode !== 'flow' || !floor?.imageWidth) return null
    const maskFn = clipToFov
      ? (cols, rows, cellPx) => buildFovMaskGrid({ cameras, walls, floor, cols, rows, cellPx })
      : null
    const flow = computeFlowGrid({
      tracks,
      tFromSec: occupancyFromSec,
      tToSec: occupancyToSec,
      imageWidth: floor.imageWidth,
      imageHeight: floor.imageHeight,
      pxPerM: floor.scale ?? FALLBACK_PX_PER_M,
      cellM: 1.5,          // same coarse pitch as the 2D flow field
      maskFn,
    })
    return flow ? computeStreamlines(flow) : null
  }, [occupancyMode, occupancyFromSec, occupancyToSec, floor, tracks, clipToFov, cameras, walls])

  // Persistent offscreen canvas + texture, supersampled ×2 (capped) so the
  // lines stay crisp when the camera leans in. Redrawn per crawl tick below.
  const { canvas, texture, k } = useMemo(() => {
    if (!streamlines || !floor?.imageWidth) return { canvas: null, texture: null, k: 1 }
    const kk = Math.min(2, MAX_CANVAS_PX_FLOW / Math.max(floor.imageWidth, floor.imageHeight))
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.round(floor.imageWidth * kk))
    cv.height = Math.max(1, Math.round(floor.imageHeight * kk))
    drawFlowCanvas(cv, streamlines, kk, 0)
    return { canvas: cv, texture: makeTexture(cv), k: kk }
  }, [streamlines, floor])
  useEffect(() => () => { texture?.dispose() }, [texture])

  // Chevron crawl — throttled canvas redraw + texture re-upload. The 3D canvas
  // runs frameloop 'always' while visible, so this ticks just like the 2D rAF.
  const lastDrawRef = useRef(-1)
  useFrame(({ clock }) => {
    if (!canvas || !texture || !streamlines) return
    const t = clock.elapsedTime
    if (lastDrawRef.current >= 0 && t - lastDrawRef.current < 1 / FLOW_REDRAW_FPS) return
    lastDrawRef.current = t
    drawFlowCanvas(canvas, streamlines, k, t * FLOW_CRAWL_PX_PER_SEC)
    texture.needsUpdate = true
  })

  if (occupancyMode !== 'flow' || !texture || !floor?.imageWidth) return null
  return (
    <OverlayMesh
      texture={texture}
      wM={floor.imageWidth * pxToM}
      hM={floor.imageHeight * pxToM}
      yLift={Y_FLOW}
    />
  )
}

// Mounts all three Camera-mode overlays for one (active) floor. Each child gates
// itself on its own 2D store flag, so this can mount unconditionally in CAMERA
// mode and each overlay mirrors its 2D switch. Caller is responsible for only
// mounting in CAMERA mode on the active floor (matching the 2D layers, which
// also clear unless editorMode === CAMERA + active floor).
export default function CameraOverlay3D({ floorId, pxToM }) {
  return (
    <>
      <OccupancyPlane3D floorId={floorId} pxToM={pxToM} />
      <FlowPlane3D floorId={floorId} pxToM={pxToM} />
      <OverlapPlane3D floorId={floorId} pxToM={pxToM} />
      <BlindSpotPlane3D floorId={floorId} pxToM={pxToM} />
    </>
  )
}

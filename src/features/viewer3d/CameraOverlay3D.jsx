import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { rasterizeCoverageCounts } from '@/features/cameras/fovRasterize'
import { computeOccupancyGrid, renderOccupancyCanvas } from '@/features/cameras/occupancyGrid'
import { computeFlowGrid } from '@/features/cameras/analyticsStats'

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
//                        projects via FlowArrows3D instead of a plane.
//   FlowArrows3D      ← computeFlowGrid (same module + common params as
//                        occupancyLayer.drawFlow). Gated on occupancyMode ===
//                        'flow'. Renders one InstancedMesh of cyan cones, one
//                        per visible cell, pointing along each cell's net
//                        movement vector projected onto the floor plane.
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

// Flow-arrow styling mirrored from occupancyLayer.js exactly.
const FLOW_COLOR = '#06b6d4'          // FLOW_COLOR in occupancyLayer.js
const FLOW_MIN_COUNT_FRAC = 0.04      // hide cells with too few movement samples
const FLOW_ARROW_LEN_FRAC = 0.42      // arrow half-length = cellPx * 0.42 (2D parity)
const MAX_FLOW_INSTANCES = 4000       // sane cap on the InstancedMesh count

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

  // Reuse the occupancy grid module verbatim (same compute + colourise as
  // occupancyLayer.js). 'off' renders nothing; 'flow' (arrow vectors) has no 3D
  // raster yet, so only 'traffic' / 'dwell' project.
  const canvas = useMemo(() => {
    if (occupancyMode === 'off' || occupancyMode === 'flow') return null
    if (!floor?.imageWidth) return null
    const result = computeOccupancyGrid({
      tracks,
      tFromSec: occupancyFromSec,
      tToSec: occupancyToSec,
      imageWidth: floor.imageWidth,
      imageHeight: floor.imageHeight,
      pxPerM: floor.scale ?? FALLBACK_PX_PER_M,
      mode: occupancyMode,
    })
    if (!result) return null
    return renderOccupancyCanvas(result)
  }, [occupancyMode, occupancyFromSec, occupancyToSec, floor, tracks])

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

// 3D projection of the 2D flow map (occupancyMode === 'flow'). The 2D layer
// draws a cyan arrow per grid cell that has a clear net movement direction
// (occupancyLayer.drawFlow). Here each surviving cell becomes one instance of a
// single THREE.InstancedMesh — one cone geometry, instanceCount = visible cells
// — so the whole flow field is one draw call. Matrices are computed off-frame
// in a useMemo keyed on the SAME deps as OccupancyPlane3D's canvas memo (no
// per-frame work; only rebuilds when the flow inputs change).
//
// Reuses computeFlowGrid verbatim with the SAME common params the 2D layer
// feeds it — no re-implemented velocity math. Cell pixel centre / frac filter /
// length scaling all mirror occupancyLayer.drawFlow.
//
// px → world mapping (matches OverlayMesh / HeatmapPlane3D): the floor plane is
// rotated [-π/2,0,0] and centred at [wM/2, y, hM/2], so image pixel (px,py)
// lands at world (px*pxToM, y, py*pxToM) — world +X = image +X, world +Z =
// image +Y (downward). A pixel-space velocity (vx,vy) therefore points along
// world (vx, 0, vy) on the floor plane.
function FlowArrows3D({ floorId, pxToM }) {
  const floors = useFloorStore((s) => s.floors)
  const floor  = floors.find((f) => f.id === floorId) ?? null
  const tracks = useTrackingStore((s) => s.tracksByFloor[floorId] ?? EMPTY)
  const occupancyMode    = useTrackingStore((s) => s.occupancyMode)
  const occupancyFromSec = useTrackingStore((s) => s.occupancyFromSec)
  const occupancyToSec   = useTrackingStore((s) => s.occupancyToSec)

  // Cone geometry: apex along +Y by default. Length 1, radius 1; per-instance
  // scale stretches it to the desired arrow length / width.
  const geometry = useMemo(() => new THREE.ConeGeometry(0.5, 1, 12), [])
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: FLOW_COLOR,
      transparent: true,
      depthWrite: false,
    }),
    [],
  )
  useEffect(() => () => { geometry.dispose() }, [geometry])
  useEffect(() => () => { material.dispose() }, [material])

  // Build the per-instance matrices off-frame. Same deps as the occupancy
  // canvas memo above (occupancyMode/from/to/floor/tracks) so this only
  // recomputes when the flow inputs change, never per render frame.
  const { matrices, count } = useMemo(() => {
    if (occupancyMode !== 'flow' || !floor?.imageWidth) return { matrices: null, count: 0 }
    const flow = computeFlowGrid({
      tracks,
      tFromSec: occupancyFromSec,
      tToSec: occupancyToSec,
      imageWidth: floor.imageWidth,
      imageHeight: floor.imageHeight,
      pxPerM: floor.scale ?? FALLBACK_PX_PER_M,
    })
    if (!flow) return { matrices: null, count: 0 }

    const out = []
    const up = new THREE.Vector3(0, 1, 0)       // cone's default apex axis
    const dir = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const m = new THREE.Matrix4()

    for (const cell of flow.cells) {
      if (out.length >= MAX_FLOW_INSTANCES) break
      const frac = cell.count / (flow.maxCount || 1)
      if (frac < FLOW_MIN_COUNT_FRAC) continue   // mirror 2D drawFlow

      // Pixel centre → world floor position (px → world mapping above).
      const cxPx = (cell.cx + 0.5) * flow.cellPx
      const cyPx = (cell.cy + 0.5) * flow.cellPx
      const mag = Math.hypot(cell.vx, cell.vy)
      if (mag <= 0) continue
      const ux = cell.vx / mag
      const uy = cell.vy / mag

      // Arrow full length in metres — mirrors 2D (cellPx*0.42 was the half-len;
      // the 2D arrow spans ±len, i.e. cellPx*0.84 end-to-end). Cone length =
      // full span so the cone reads like the 2D arrow head+shaft.
      const lenM = flow.cellPx * FLOW_ARROW_LEN_FRAC * 2 * pxToM
      const widthM = flow.cellPx * 0.32 * pxToM   // cone base diameter ~ shaft+head

      // Floor-plane direction: pixel (ux,uy) → world (ux,0,uy).
      dir.set(ux, 0, uy).normalize()
      quat.setFromUnitVectors(up, dir)            // rotate cone apex onto dir
      pos.set(cxPx * pxToM, Y_FLOW, cyPx * pxToM)
      scl.set(widthM, lenM, widthM)
      m.compose(pos, quat, scl)
      out.push(m.clone())
    }
    if (out.length === 0) return { matrices: null, count: 0 }
    return { matrices: out, count: out.length }
  }, [occupancyMode, occupancyFromSec, occupancyToSec, floor, tracks, pxToM])

  const meshRef = useRef(null)
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || !matrices) return
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i])
    mesh.instanceMatrix.needsUpdate = true
  }, [matrices])

  if (occupancyMode !== 'flow' || !matrices || count === 0) return null
  // key forces a fresh InstancedMesh when the count changes — instanced buffers
  // are sized to count and can't grow in place.
  return (
    <instancedMesh
      key={count}
      ref={meshRef}
      args={[geometry, material, count]}
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
      <FlowArrows3D floorId={floorId} pxToM={pxToM} />
      <OverlapPlane3D floorId={floorId} pxToM={pxToM} />
      <BlindSpotPlane3D floorId={floorId} pxToM={pxToM} />
    </>
  )
}

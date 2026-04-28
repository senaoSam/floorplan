import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleField } from '@/features/heatmap/sampleField'
import { sampleFieldGL } from '@/features/heatmap/sampleFieldGL'
import { getModeConfig } from '@/features/heatmap/modes'
import { computeFloorElevations } from '@/features/viewer3d/floorStacking'
import { createHeatmapGL } from '@/features/heatmap/heatmapGL.js'

const EMPTY = Object.freeze([])

// 3D heatmap plane for one floor. Mirrors the 2D HeatmapLayer compute path —
// same scenario builder, same sampleFieldGL, same heatmapGL colormap — and
// pastes the resulting WebGL canvas onto a Three.js plane sitting just above
// the floor's image. Cross-floor physics (HM-F2x) carries over because we
// reuse buildScenario with the same crossFloor argument shape.
//
// MVP scope (10-5e):
//   - active floor only; non-active stacked floors don't render heatmap
//     planes. Computing every floor's heatmap on every scene update would
//     redo expensive WebGL passes whose pixels users mostly don't look at;
//     the active floor is the one being edited and naturally the focus.
//   - shares heatmap on/off + mode + opts with the 2D layer (same store).
//   - no drag-time path — 3D viewer is rarely in front during drag, and the
//     2D layer already handles the live-drag overlays.
export default function HeatmapPlane3D({ floorId, elevation }) {
  const floors = useFloorStore((s) => s.floors)
  const floor  = floors.find((f) => f.id === floorId) ?? null
  const walls  = useWallStore((s) => s.wallsByFloor[floorId] ?? EMPTY)
  const aps    = useAPStore((s) => s.apsByFloor[floorId] ?? EMPTY)
  const scopes = useScopeStore((s) => s.scopesByFloor[floorId] ?? EMPTY)
  const apsByFloor   = useAPStore((s) => s.apsByFloor)
  const wallsByFloor = useWallStore((s) => s.wallsByFloor)
  const holesByFloor = useFloorHoleStore((s) => s.floorHolesByFloor)

  const enabled     = useHeatmapStore((s) => s.enabled)
  const mode        = useHeatmapStore((s) => s.mode)
  const engine      = useHeatmapStore((s) => s.engine)
  const reflections = useHeatmapStore((s) => s.reflections)
  const diffraction = useHeatmapStore((s) => s.diffraction)
  const gridStepM   = useHeatmapStore((s) => s.gridStepM)
  const blur        = useHeatmapStore((s) => s.blur)
  const showContours= useHeatmapStore((s) => s.showContours)

  // Per-instance heatmapGL renderer. Each floor's plane owns its own GL
  // context + canvas so the active-floor swap doesn't trash other floors
  // (currently MVP renders only one, but the per-instance ownership keeps
  // the door open to all-floors mode without refactoring).
  const glRef = useRef(null)
  const [textureRev, setTextureRev] = useState(0)

  const getGL = () => {
    if (!glRef.current) {
      try { glRef.current = createHeatmapGL() }
      catch (e) { console.warn('[Heatmap3D] WebGL2 init failed:', e.message); return null }
    }
    return glRef.current
  }

  useEffect(() => () => {
    if (glRef.current) { glRef.current.dispose(); glRef.current = null }
  }, [])

  // Scenario assembly — mirrors HeatmapLayer's logic minus drag overlays and
  // padding (3D plane doesn't show iso-contours bleeding into a margin).
  const scenario = useMemo(() => {
    if (!enabled) return null
    if (!floor?.scale) return null
    const anyAp = Object.values(apsByFloor).some((arr) => arr && arr.length > 0)
    if (!anyAp) return null

    const elevations = computeFloorElevations(floors)
    const floorIndexById = new Map(floors.map((f, i) => [f.id, i]))
    const floorStack = floors.map((f) => ({
      id: f.id,
      elevationM: elevations[f.id] ?? 0,
      slabDb: f.floorSlabAttenuationDb ?? 0,
      scale: f.scale,
      holes: (holesByFloor[f.id] ?? []).map((h) => ({
        points: h.points,
        fromIdx: floorIndexById.get(h.bottomFloorId ?? f.id) ?? floorIndexById.get(f.id),
        toIdx:   floorIndexById.get(h.topFloorId    ?? f.id) ?? floorIndexById.get(f.id),
      })),
    }))

    const apsAcrossFloors = []
    for (const f of floors) {
      const floorAPs = apsByFloor[f.id] ?? []
      const floorElev = elevations[f.id] ?? 0
      for (const ap of floorAPs) {
        apsAcrossFloors.push({
          ...ap,
          posPx: { x: ap.x, y: ap.y },
          elevationM: floorElev,
          floorScale: f.scale,
        })
      }
    }

    const otherFloorWalls = []
    for (const f of floors) {
      if (f.id === floorId) continue
      const fws = wallsByFloor[f.id] ?? []
      if (fws.length === 0) continue
      otherFloorWalls.push({
        elevationM: elevations[f.id] ?? 0,
        scale: f.scale,
        walls: fws,
      })
    }

    const crossFloor = {
      activeElevationM: elevations[floorId] ?? 0,
      rxHeightM: 1.0,
      floorStack,
      apsByFloor: apsAcrossFloors,
      otherFloorWalls,
    }

    return buildScenario(floor, walls, aps, scopes, crossFloor)
  }, [enabled, floor, floorId, floors, walls, aps, scopes, apsByFloor, wallsByFloor, holesByFloor])

  // Sample + colormap the heatmap into glRef.current.canvas. Bumping
  // textureRev tells the JSX below to recreate the CanvasTexture (Three.js
  // doesn't notice canvas pixel changes without an explicit needsUpdate +
  // signal, and the cleanest signal is a fresh texture).
  useEffect(() => {
    if (!enabled || !scenario || !floor?.scale) return
    let cancelled = false
    const id = setTimeout(() => {
      const gl = getGL()
      if (!gl) return
      const wM = scenario.size.w
      const hM = scenario.size.h
      const outW = Math.max(1, Math.round(wM * floor.scale))
      const outH = Math.max(1, Math.round(hM * floor.scale))

      let field
      const opts = {
        maxReflOrder: reflections ? 1 : 0,
        enableDiffraction: diffraction,
      }
      if (engine === 'shader') {
        try {
          field = sampleFieldGL(scenario, gridStepM, opts)
        } catch (e) {
          console.warn('[Heatmap3D] shader engine failed, falling back to JS:', e.message)
          field = sampleField(scenario, gridStepM, opts)
        }
      } else {
        field = sampleField(scenario, gridStepM, opts)
      }
      if (cancelled) return

      const modeCfg = getModeConfig(mode)
      const activeField = field[modeCfg.field] ?? field.rssi
      const renderField = { rssi: activeField, nx: field.nx, ny: field.ny }
      gl.render(renderField, outW, outH, 1 / floor.scale, blur, showContours, {
        anchors: modeCfg.anchors,
      })
      setTextureRev((v) => v + 1)
    }, 0)
    return () => { cancelled = true; clearTimeout(id) }
  }, [enabled, mode, engine, scenario, reflections, diffraction,
      gridStepM, blur, showContours, floor?.scale])

  // CanvasTexture wraps gl.canvas; remake when textureRev bumps. Disposed in
  // cleanup to free the GPU upload (cheap but proper hygiene). The plane
  // mesh itself sticks around between updates so r3f doesn't tear/rebuild
  // geometry every frame.
  const texture = useMemo(() => {
    const gl = glRef.current
    if (!gl?.canvas) return null
    const tex = new THREE.CanvasTexture(gl.canvas)
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
    else tex.encoding = THREE.sRGBEncoding
    tex.needsUpdate = true
    return tex
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureRev])

  useEffect(() => () => { texture?.dispose() }, [texture])

  if (!enabled || !scenario || !floor?.scale || !texture) return null

  const wM = scenario.size.w
  const hM = scenario.size.h

  // Sit a hair above the floor image (which lives at the parent group's
  // y=elevation) so we don't z-fight with the floor texture. 0.02 m = 2 cm
  // — invisible, but enough margin against fp32 depth-buffer noise on
  // tilted views. The `elevation` prop is unused inside the mesh because
  // FloorStack mounts us inside a group already translated to elevation;
  // the prop is kept on the API for documentation and a future "all floors"
  // mode that may mount these planes outside the per-floor group.
  void elevation
  const yLift = 0.02

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[wM / 2, yLift, hM / 2]}
    >
      <planeGeometry args={[wM, hM]} />
      <meshBasicMaterial
        map={texture}
        side={THREE.DoubleSide}
        transparent
        opacity={0.7}
        depthWrite={false}
      />
    </mesh>
  )
}

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Image as KonvaImage } from 'react-konva'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleField } from '@/features/heatmap/sampleField'
import { getModeConfig } from '@/features/heatmap/modes'
import { createHeatmapGL } from '@/heatmap_sample/render/heatmapGL.js'

// Heatmap render layer. Sits between the floor image and the wall layer so
// the plan is still visible underneath and wall strokes cut across the heat
// on top.
//
// Recompute policy (per task.md HM-8): recompute on ANY change to walls / APs
// / scopes / floor.scale, including while dragging. Optimising drag freeze is
// tracked as HM-F6.
export default function HeatmapLayer({ floorId }) {
  const floors  = useFloorStore((s) => s.floors)
  const floor   = floors.find((f) => f.id === floorId) ?? null
  const walls   = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
  const aps     = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  const scopes  = useScopeStore((s) => s.scopesByFloor[floorId] ?? [])

  const enabled     = useHeatmapStore((s) => s.enabled)
  const mode        = useHeatmapStore((s) => s.mode)
  const reflections = useHeatmapStore((s) => s.reflections)
  const diffraction = useHeatmapStore((s) => s.diffraction)
  const gridStepM   = useHeatmapStore((s) => s.gridStepM)
  const blur        = useHeatmapStore((s) => s.blur)
  const showContours= useHeatmapStore((s) => s.showContours)

  // Live drag overlays — subscribe so any change retriggers compute immediately.
  const dragAP    = useDragOverlayStore((s) => s.ap)
  const dragWall  = useDragOverlayStore((s) => s.wall)
  const dragScope = useDragOverlayStore((s) => s.scope)

  const glRef = useRef(null)
  const [version, setVersion] = useState(0)

  const getGL = () => {
    if (!glRef.current) {
      try { glRef.current = createHeatmapGL() }
      catch (e) { console.warn('[Heatmap] WebGL2 init failed:', e.message); return null }
    }
    return glRef.current
  }

  useEffect(() => () => {
    if (glRef.current) { glRef.current.dispose(); glRef.current = null }
  }, [])

  const scenario = useMemo(() => {
    if (!enabled) return null
    if (!floor?.scale) return null
    if (!aps.length)   return null

    // Apply live drag overrides so the heatmap tracks the object being dragged
    // without waiting for the commit-on-dragend write into the main stores.
    const apsLive = dragAP
      ? aps.map((a) => (a.id === dragAP.id ? { ...a, x: dragAP.x, y: dragAP.y } : a))
      : aps

    const wallsLive = dragWall
      ? walls.map((w) => (w.id === dragWall.id
          ? { ...w, startX: w.startX + dragWall.dx, startY: w.startY + dragWall.dy,
                    endX:   w.endX   + dragWall.dx, endY:   w.endY   + dragWall.dy }
          : w))
      : walls

    const scopesLive = dragScope
      ? scopes.map((s) => {
          if (s.id !== dragScope.id) return s
          const pts = s.points.slice()
          for (let i = 0; i < pts.length; i += 2) {
            pts[i]     += dragScope.dx
            pts[i + 1] += dragScope.dy
          }
          return { ...s, points: pts }
        })
      : scopes

    return buildScenario(floor, wallsLive, apsLive, scopesLive)
  }, [enabled, floor, walls, aps, scopes, dragAP, dragWall, dragScope])

  useEffect(() => {
    if (!enabled || !scenario || !floor?.scale) return
    let cancelled = false
    const run = () => {
      const field = sampleField(scenario, gridStepM, {
        maxReflOrder: reflections ? 1 : 0,
        enableDiffraction: diffraction,
      })
      if (cancelled) return
      const outW = Math.max(1, Math.round(scenario.size.w * floor.scale))
      const outH = Math.max(1, Math.round(scenario.size.h * floor.scale))
      const gl = getGL()
      if (!gl) return
      // Mode selects which sampled field feeds the renderer. heatmapGL reads
      // `field.rssi` by convention, so we swap the active field into that slot.
      const modeCfg = getModeConfig(mode)
      const activeField = field[modeCfg.field] ?? field.rssi
      const renderField = { rssi: activeField, nx: field.nx, ny: field.ny }
      gl.render(renderField, outW, outH, 1 / floor.scale, blur, showContours, {
        anchors: modeCfg.anchors,
      })
      setVersion((n) => n + 1)
    }
    const id = setTimeout(run, 0)
    return () => { cancelled = true; clearTimeout(id) }
  }, [enabled, mode, scenario, reflections, diffraction, gridStepM, blur, showContours, floor?.scale])

  if (!enabled || !floor?.scale || !glRef.current) return null

  const canvas = glRef.current.canvas
  const rotation = floor.rotation || 0
  const hasCrop = floor.cropX != null && floor.cropWidth != null
  const cx = floor.imageWidth / 2
  const cy = floor.imageHeight / 2

  // Match FloorImageLayer's crop-under-rotation so the heatmap respects the
  // same visible window as the underlying plan.
  const clipFunc = hasCrop
    ? (ctx) => {
        ctx.translate(cx, cy)
        ctx.rotate((rotation * Math.PI) / 180)
        ctx.translate(-cx, -cy)
        ctx.rect(floor.cropX, floor.cropY, floor.cropWidth, floor.cropHeight)
      }
    : undefined

  return (
    <Layer listening={false} clipFunc={clipFunc}>
      <KonvaImage
        image={canvas}
        x={cx}
        y={cy}
        offsetX={cx}
        offsetY={cy}
        width={floor.imageWidth}
        height={floor.imageHeight}
        rotation={rotation}
        key={version}
      />
    </Layer>
  )
}

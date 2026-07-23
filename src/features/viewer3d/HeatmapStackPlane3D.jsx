import React, { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useHeatmapStackStore } from './heatmapStack'

// Heatmap plane for a NON-active stacked floor — thin consumer of the
// heatmapStack module's per-floor painted canvases (mirror of how
// HeatmapPlane3D consumes the 2D adapter's canvas via heatmapFrameBus).
// No propagation compute here; the stack canvases are unpadded so the
// texture maps the floor rect 1:1 (no UV crop needed).
export default function HeatmapStackPlane3D({ floorId }) {
  const floor = useFloorStore((s) => s.floors.find((f) => f.id === floorId) ?? null)
  const isVisible = useEditorStore((s) => s.viewMode === VIEW_MODE.THREE_D)
  const stackOn = useEditorStore((s) => s.heatmap3DAllFloors)
  const hmEnabled = useHeatmapStore((s) => s.enabled)
  const frame = useHeatmapStackStore((s) => s.frames[floorId] ?? null)

  const canvas = frame?.canvas ?? null
  const texture = useMemo(() => {
    if (!canvas) return null
    const tex = new THREE.CanvasTexture(canvas)
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
    else tex.encoding = THREE.sRGBEncoding
    return tex
  }, [canvas])
  useEffect(() => () => { texture?.dispose() }, [texture])

  // Same-canvas repaints bump frame.rev — re-upload the pixels.
  useEffect(() => {
    if (texture) texture.needsUpdate = true
  }, [texture, frame])

  if (!isVisible || !stackOn || !hmEnabled) return null
  if (!frame || !texture || !floor?.scale) return null

  const wM = floor.imageWidth / floor.scale
  const hM = floor.imageHeight / floor.scale
  // Same 2 cm lift as HeatmapPlane3D — clears fp32 depth noise against the
  // floor image without reading as floating.
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

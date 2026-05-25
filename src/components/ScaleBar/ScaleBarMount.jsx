import React from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useViewportStore } from '@/store/useViewportStore'
import ScaleBar from './ScaleBar'

// Reads the active floor's pxPerM + the live viewport scale from stores
// and feeds ScaleBar. Component is mounted in CanvasArea; ScaleBar itself
// renders nothing when there's no calibrated scale.
function ScaleBarMount() {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floor = useFloorStore((s) => s.floors.find((f) => f.id === activeFloorId))
  const viewportScale = useViewportStore((s) => s.scale)
  if (!floor?.scale) return null
  return <ScaleBar floorPxPerM={floor.scale} viewportScale={viewportScale} />
}

export default ScaleBarMount

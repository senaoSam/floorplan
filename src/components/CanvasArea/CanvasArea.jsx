import React from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import FloorplanSystem from '@/components/FloorplanSystem/FloorplanSystem'
import HeatmapControl from '@/components/HeatmapControl/HeatmapControl'
import CableSummaryPanel from '@/components/CableSummaryPanel/CableSummaryPanel'
import './CanvasArea.sass'

// Standalone-mode canvas pane — wraps the embeddable FloorplanSystem
// plus the floating overlay controls (HeatmapControl etc). When this
// project is embedded into the host product, the host renders
// FloorplanSystem directly and supplies its own surrounding chrome.
function CanvasArea() {
  const hasFloor = useFloorStore((s) => s.floors.length > 0)
  return (
    <div className="canvas-area">
      <div className="canvas-area__pane">
        <FloorplanSystem />
      </div>
      {hasFloor && <HeatmapControl />}
      {hasFloor && <CableSummaryPanel />}
    </div>
  )
}

export default CanvasArea

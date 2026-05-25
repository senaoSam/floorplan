import React from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import FloorplanSystem from '@/components/FloorplanSystem/FloorplanSystem'
import HeatmapControl from '@/components/HeatmapControl/HeatmapControl'
import CableSummaryPanel from '@/components/CableSummaryPanel/CableSummaryPanel'
import Toolbar from '@/components/Toolbar/Toolbar'
import LayerToggle from '@/components/LayerToggle/LayerToggle'
import './CanvasArea.sass'

// Standalone-mode canvas pane — wraps the embeddable FloorplanSystem
// plus the floating overlay controls (Toolbar at top-center, LayerToggle
// at top-left, HeatmapControl + CableSummary at bottom-left).
function CanvasArea() {
  const hasFloor = useFloorStore((s) => s.floors.length > 0)
  return (
    <div className="canvas-area">
      <div className="canvas-area__pane">
        <FloorplanSystem />
      </div>
      <Toolbar />
      <div className="canvas-area__top-left">
        <LayerToggle />
      </div>
      {hasFloor && <HeatmapControl />}
      {hasFloor && <CableSummaryPanel />}
    </div>
  )
}

export default CanvasArea

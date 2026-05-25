import React from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import FloorplanSystem from '@/components/FloorplanSystem/FloorplanSystem'
import HeatmapControl from '@/components/HeatmapControl/HeatmapControl'
import CableSummaryPanel from '@/components/CableSummaryPanel/CableSummaryPanel'
import Toolbar from '@/components/Toolbar/Toolbar'
import ActiveModeBadge from '@/components/Toolbar/ActiveModeBadge'
import LayerToggle from '@/components/LayerToggle/LayerToggle'
import RegulatorySelector from '@/components/RegulatorySelector/RegulatorySelector'
import ScaleBarMount from '@/components/ScaleBar/ScaleBarMount'
import './CanvasArea.sass'

// Standalone-mode canvas pane — wraps the embeddable FloorplanSystem
// plus the floating overlay controls.
function CanvasArea() {
  const hasFloor = useFloorStore((s) => s.floors.length > 0)
  return (
    <div className="canvas-area">
      <div className="canvas-area__pane">
        <FloorplanSystem />
      </div>
      <Toolbar />
      <ActiveModeBadge />
      <div className="canvas-area__top-left">
        <LayerToggle />
        <RegulatorySelector />
      </div>
      {hasFloor && <HeatmapControl />}
      {hasFloor && <CableSummaryPanel />}
      <ScaleBarMount />
    </div>
  )
}

export default CanvasArea

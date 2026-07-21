import React from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore, EDITOR_MODE, VIEW_MODE } from '@/store/useEditorStore'
import FloorplanSystem from '@/components/FloorplanSystem/FloorplanSystem'
import HeatmapControl from '@/components/HeatmapControl/HeatmapControl'
import CableSummaryPanel from '@/components/CableSummaryPanel/CableSummaryPanel'
import Toolbar from '@/components/Toolbar/Toolbar'
import ActiveModeBadge from '@/components/Toolbar/ActiveModeBadge'
import LayerToggle from '@/components/LayerToggle/LayerToggle'
import RegulatorySelector from '@/components/RegulatorySelector/RegulatorySelector'
import DevicePlanningPanel from '@/components/DevicePlanningPanel/DevicePlanningPanel'
import ClientPanelMount from '@/components/ClientPanel/ClientPanel'
import ClientViewMenuMount from '@/components/ClientPanel/ClientViewMenu'
import StatsDashboardMount from '@/components/StatsDashboard/StatsDashboard'
import ScaleBarMount from '@/components/ScaleBar/ScaleBarMount'
import CameraTimelineBar from '@/components/CameraTimeline/CameraTimelineBar'
import TrendPanel from '@/components/CameraTimeline/TrendPanel'
import CoveragePanel from '@/components/CameraTimeline/CoveragePanel'
import LiveViewModal from '@/components/CameraTimeline/LiveViewModal'
import CalibrationModal from '@/components/CameraTimeline/CalibrationModal'
import './CanvasArea.sass'

// Standalone-mode canvas pane — wraps the embeddable FloorplanSystem
// plus the floating overlay controls. Top-left stacks LayerToggle +
// DevicePlanningPanel in one row (oldSrc layout) with the
// RegulatorySelector dropdown below them.
function CanvasArea() {
  const hasFloor = useFloorStore((s) => s.floors.length > 0)
  // CAMERA mode is walls-only — the RF/cable floating panels (heatmap control
  // + hover readout, cable BOM, AP planning, regulatory domain) are all
  // irrelevant there and would float over a canvas that hides their subject.
  const inCameraMode = useEditorStore((s) => s.editorMode === EDITOR_MODE.CAMERA)
  // 47-26: in 3D the floating 2D overlays (corner stacks, timeline bar, scale
  // bar) sit over the 3D canvas and edit a plane the user isn't looking at.
  // Hide them; keep the toolbar + mode badge so the user can switch mode / go
  // back to 2D. StatsDashboard / ClientPanel self-gate elsewhere.
  const is3D = useEditorStore((s) => s.viewMode === VIEW_MODE.THREE_D)
  return (
    <div className="canvas-area">
      <div className="canvas-area__pane">
        <FloorplanSystem />
      </div>
      <Toolbar />
      <ActiveModeBadge />
      {/* Top-left stack: layer toggle row → regulatory → coverage report
          (CoveragePanel self-gates to CAMERA mode). Flow-stacked so a taller
          LayerToggle can never overlap the panel below it. */}
      {!is3D && (
        <div className="canvas-area__overlay canvas-area__overlay--tl">
          <div className="canvas-area__top-left-row">
            <LayerToggle />
            {!inCameraMode && <DevicePlanningPanel />}
          </div>
          {!inCameraMode && <RegulatorySelector />}
          <CoveragePanel />
        </div>
      )}
      {/* Bottom-left stack (bottom-up): heatmap control lowest, cable summary
          above it. TrendPanel starts here and can be dragged out of the flow.
          Dev widgets (demo/stress/progress) live in SidebarLeft, NOT here —
          they'll be removed for production and must not skew canvas UIUX. */}
      {!is3D && (
        <div className="canvas-area__overlay canvas-area__overlay--bl">
          <TrendPanel />
          {hasFloor && !inCameraMode && <CableSummaryPanel />}
          {hasFloor && !inCameraMode && <HeatmapControl />}
        </div>
      )}
      <ClientPanelMount />
      <ClientViewMenuMount />
      <StatsDashboardMount />
      {!is3D && <CameraTimelineBar />}
      <LiveViewModal />
      <CalibrationModal />
      {!is3D && <ScaleBarMount />}
    </div>
  )
}

export default CanvasArea

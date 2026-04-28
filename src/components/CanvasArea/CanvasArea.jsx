import React from 'react'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import Editor2D from '@/features/editor/Editor2D'
import Viewer3D from '@/features/viewer3d/Viewer3D'
import HeatmapControl from '@/components/HeatmapControl/HeatmapControl'
import './CanvasArea.sass'

function CanvasArea() {
  const { viewMode } = useEditorStore()
  // Hoisted out of Editor2D so HeatmapControl is also reachable from the
  // 3D viewer (10-5e). Same gate (need at least one floor) since the
  // control's actions on an empty workspace are meaningless.
  const hasFloor = useFloorStore((s) => s.floors.length > 0)

  return (
    <div className="canvas-area">
      {viewMode === VIEW_MODE.TWO_D ? <Editor2D /> : <Viewer3D />}
      {hasFloor && <HeatmapControl />}
    </div>
  )
}

export default CanvasArea

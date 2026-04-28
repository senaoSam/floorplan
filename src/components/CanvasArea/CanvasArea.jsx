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

  // Keep both viewers mounted and toggle visibility instead of conditionally
  // rendering. Re-mounting Editor2D on every 2D⇄3D switch caused a visible
  // flicker (default viewport → fit-to-screen) because `size` and `viewport`
  // were `useState` locals and `viewportByFloorRef` was a `useRef` — all of
  // which reset on unmount. Side effect: the 2D Konva Stage and 3D r3f Canvas
  // both keep their internal state across switches.
  const is2D = viewMode === VIEW_MODE.TWO_D
  return (
    <div className="canvas-area">
      <div className="canvas-area__pane" style={{ display: is2D ? 'block' : 'none' }}>
        <Editor2D />
      </div>
      <div className="canvas-area__pane" style={{ display: is2D ? 'none' : 'block' }}>
        <Viewer3D />
      </div>
      {hasFloor && <HeatmapControl />}
    </div>
  )
}

export default CanvasArea

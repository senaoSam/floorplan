import React from 'react'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
import './CanvasArea.sass'

// Phase 1-2 以後替換為真實的 Editor2D / Viewer3D
function CanvasArea() {
  const { viewMode } = useEditorStore()

  return (
    <div className="canvas-area">
      <div className="canvas-area__placeholder">
        {viewMode === VIEW_MODE.TWO_D
          ? '2D 畫布（Phase 1-2）'
          : '3D 視圖（Phase 6）'}
      </div>
    </div>
  )
}

export default CanvasArea

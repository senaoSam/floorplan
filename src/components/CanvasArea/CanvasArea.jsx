import React from 'react'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
import Editor2D from '@/features/editor/Editor2D'
import Viewer3D from '@/features/viewer3d/Viewer3D'
import './CanvasArea.sass'

function CanvasArea() {
  const { viewMode } = useEditorStore()

  return (
    <div className="canvas-area">
      {viewMode === VIEW_MODE.TWO_D ? <Editor2D /> : <Viewer3D />}
    </div>
  )
}

export default CanvasArea

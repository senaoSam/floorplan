import React from 'react'
import { useFloorImportStore } from '@/store/useFloorImportStore'
import './ImportLoadingOverlay.sass'

// Dims the canvas and shows the running floor import's progress. Before this
// the only sign of an import started from the sidebar "+" was a small badge
// next to the 樓層 heading, easy to miss during a multi-second CAD upload.
// CanvasArea skips it while the empty-state DropZone is up, which already
// shows its own spinner in the same spot.
function ImportLoadingOverlay() {
  const loadingMsg = useFloorImportStore((s) => s.loadingMsg)
  if (loadingMsg === null) return null
  return (
    <div className="import-loading-overlay">
      <div className="import-loading-overlay__spinner" />
      <p className="import-loading-overlay__msg">{loadingMsg}</p>
    </div>
  )
}

export default ImportLoadingOverlay

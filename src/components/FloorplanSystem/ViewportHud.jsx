import React from 'react'
import { useViewportStore } from '@/store/useViewportStore'
import { useEditorStore } from '@/store/useEditorStore'

// React-side overlay subscribing to the same Zustand stores PIXI consumes.
// Demonstrates that the store is the single source of truth — React reads
// live values without touching the PIXI scene directly.
function ViewportHud() {
  const x = useViewportStore((s) => s.x)
  const y = useViewportStore((s) => s.y)
  const scale = useViewportStore((s) => s.scale)
  const reset = useViewportStore((s) => s.reset)
  const editorMode = useEditorStore((s) => s.editorMode)

  return (
    <div className="floorplan-system__hud">
      <div className="floorplan-system__hud-line">
        <span className="floorplan-system__hud-label">phase</span>
        <span>25 · 31-1/31-2 scaffold</span>
      </div>
      <div className="floorplan-system__hud-line">
        <span className="floorplan-system__hud-label">mode</span>
        <span>{editorMode}</span>
      </div>
      <div className="floorplan-system__hud-line">
        <span className="floorplan-system__hud-label">viewport</span>
        <span>x {x.toFixed(0)} · y {y.toFixed(0)} · {(scale * 100).toFixed(0)}%</span>
      </div>
      <div className="floorplan-system__hud-line floorplan-system__hud-hint">
        wheel zoom · middle-drag or space+drag pan
      </div>
      <button type="button" className="floorplan-system__hud-btn" onClick={reset}>
        reset viewport
      </button>
    </div>
  )
}

export default ViewportHud

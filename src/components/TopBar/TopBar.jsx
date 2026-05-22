import React from 'react'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
import './TopBar.sass'

// Phase 18 top banner — only product brand + 2D/3D view switch.
// The mode buttons / history / AI Walls were moved to the floating Toolbar
// that lives inside the canvas area (see Toolbar.jsx). Keeping a slim
// banner preserves a stable home for the logo + global view toggle without
// crowding the canvas surface.
function TopBar() {
  const viewMode = useEditorStore((s) => s.viewMode)
  const setViewMode = useEditorStore((s) => s.setViewMode)

  return (
    <header className="topbar">
      <div className="topbar__brand">Floorplan</div>

      <div className="topbar__view">
        <button
          className={`topbar__view-btn${viewMode === VIEW_MODE.TWO_D ? ' topbar__view-btn--active' : ''}`}
          onClick={() => setViewMode(VIEW_MODE.TWO_D)}
        >
          2D
        </button>
        <button
          className={`topbar__view-btn${viewMode === VIEW_MODE.THREE_D ? ' topbar__view-btn--active' : ''}`}
          onClick={() => setViewMode(VIEW_MODE.THREE_D)}
        >
          3D
        </button>
      </div>
    </header>
  )
}

export default TopBar

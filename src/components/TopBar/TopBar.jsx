import React from 'react'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
import './TopBar.sass'

// Phase 18 top banner — product brand + 2D/3D view switch.
// 3D viewer not ported in Phase 25 yet; the button stays for layout
// parity but is disabled so the click is a no-op.
function TopBar() {
  const viewMode = useEditorStore((s) => s.viewMode)
  const setViewMode = useEditorStore((s) => s.setViewMode)

  return (
    <header className="topbar">
      <div className="topbar__brand">Floorplan</div>

      <div className="topbar__view">
        <button
          type="button"
          className={`topbar__view-btn${viewMode === VIEW_MODE.TWO_D ? ' topbar__view-btn--active' : ''}`}
          onClick={() => setViewMode(VIEW_MODE.TWO_D)}
        >
          2D
        </button>
        <button
          type="button"
          className="topbar__view-btn"
          disabled
          title="Viewer3D 尚未在 Phase 25 重新接上"
        >
          3D
        </button>
      </div>
    </header>
  )
}

export default TopBar

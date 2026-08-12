import React, { useState } from 'react'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
import ApiTestModal from '@/components/ApiTestModal/ApiTestModal'
import ExportMenu from '@/components/ExportMenu/ExportMenu'
import './TopBar.sass'

// Phase 18 top banner — product brand + 2D/3D view switch.
function TopBar() {
  const viewMode = useEditorStore((s) => s.viewMode)
  const setViewMode = useEditorStore((s) => s.setViewMode)
  const [apiTestOpen, setApiTestOpen] = useState(false)

  return (
    <header className="topbar">
      <div className="topbar__brand">Floorplan</div>

      <div className="topbar__actions">
        <button
          type="button"
          className={`topbar__test-btn${apiTestOpen ? ' topbar__test-btn--active' : ''}`}
          onClick={() => setApiTestOpen(true)}
          title="測試 cv+graph pipeline API"
        >
          API 測試
        </button>

        {/* 52-D1: the discoverable export entry. Both actions already existed
            but were buried (floor-row ⋯ menu / bottom of the cable-summary
            panel), so a user scanning the UI concluded there was no export. */}
        <ExportMenu />

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
            className={`topbar__view-btn${viewMode === VIEW_MODE.THREE_D ? ' topbar__view-btn--active' : ''}`}
            onClick={() => setViewMode(VIEW_MODE.THREE_D)}
          >
            3D
          </button>
        </div>
      </div>

      <ApiTestModal open={apiTestOpen} onClose={() => setApiTestOpen(false)} />
    </header>
  )
}

export default TopBar

import React from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import DemoLoader from '@/components/DemoLoader/DemoLoader'
import StressLoader from '@/components/StressLoader/StressLoader'
import './SidebarLeft.sass'

// Slim Phase 25 sidebar: floor list + demo loader only.
// Inline rename / per-floor menu / file import / align / crop / slab
// material are deferred until the supporting stores (file import,
// confirm dialog, scope / hole / cable, history) come back online.
function SidebarLeft() {
  const floors = useFloorStore((s) => s.floors)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const setActiveFloor = useFloorStore((s) => s.setActiveFloor)

  return (
    <aside className="sidebar-left">
      <div className="sidebar-left__section">
        <div className="sidebar-left__section-header">
          <span>樓層</span>
          <span className="sidebar-left__section-count">{floors.length}</span>
        </div>
        {floors.length === 0 && (
          <div className="sidebar-left__empty">尚未載入樓層</div>
        )}
        <ul className="sidebar-left__floor-list">
          {floors.map((f) => {
            const active = f.id === activeFloorId
            return (
              <li key={f.id}>
                <button
                  type="button"
                  className={`sidebar-left__floor-row${active ? ' sidebar-left__floor-row--active' : ''}`}
                  onClick={() => setActiveFloor(f.id)}
                >
                  <span className="sidebar-left__floor-name">{f.name}</span>
                  <span className="sidebar-left__floor-meta">
                    {f.imageWidth}×{f.imageHeight}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="sidebar-left__footer">
        <DemoLoader />
        <div className="sidebar-left__stress-row">
          <span className="sidebar-left__stress-label">Stress</span>
          <StressLoader />
        </div>
      </div>
    </aside>
  )
}

export default SidebarLeft

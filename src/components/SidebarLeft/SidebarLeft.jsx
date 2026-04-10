import React from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import './SidebarLeft.sass'

function SidebarLeft() {
  const { floors, activeFloorId, setActiveFloor } = useFloorStore()

  return (
    <aside className="sidebar-left">
      <section className="sidebar-left__section">
        <div className="sidebar-left__section-header">
          <span>樓層</span>
          <button className="sidebar-left__icon-btn" title="新增樓層">＋</button>
        </div>

        <ul className="sidebar-left__floor-list">
          {floors.length === 0 && (
            <li className="sidebar-left__empty">尚未匯入平面圖</li>
          )}
          {floors.map((floor) => (
            <li
              key={floor.id}
              className={`sidebar-left__floor-item${activeFloorId === floor.id ? ' sidebar-left__floor-item--active' : ''}`}
              onClick={() => setActiveFloor(floor.id)}
            >
              <span className="sidebar-left__floor-icon">▣</span>
              <span className="sidebar-left__floor-name">{floor.name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="sidebar-left__section">
        <div className="sidebar-left__section-header">
          <span>圖層</span>
        </div>
        <ul className="sidebar-left__layer-list">
          {['平面圖', '牆體', 'AP', 'Heatmap'].map((layer) => (
            <li key={layer} className="sidebar-left__layer-item">
              <span className="sidebar-left__layer-eye">👁</span>
              <span>{layer}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

export default SidebarLeft

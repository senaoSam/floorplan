import React from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import './SidebarLeft.sass'

const LAYERS = [
  { key: 'showFloorImage', label: '平面圖' },
  { key: 'showScopes',     label: '範圍' },
  { key: 'showFloorHoles', label: '挑高區域' },
  { key: 'showWalls',      label: '牆體' },
  { key: 'showAPs',        label: 'AP' },
  { key: 'showAPInfo',     label: 'AP 資訊' },
  { key: 'showHeatmap',    label: '熱力圖' },
]

function SidebarLeft() {
  const { floors, activeFloorId, setActiveFloor } = useFloorStore()
  const toggleLayer = useEditorStore((s) => s.toggleLayer)
  const layerStates = useEditorStore((s) => LAYERS.map((l) => s[l.key]))

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
          {LAYERS.map((layer, i) => (
            <li
              key={layer.key}
              className={`sidebar-left__layer-item${!layerStates[i] ? ' sidebar-left__layer-item--hidden' : ''}`}
              onClick={() => toggleLayer(layer.key)}
            >
              <span className="sidebar-left__layer-eye">{layerStates[i] ? '👁' : '🚫'}</span>
              <span>{layer.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

export default SidebarLeft

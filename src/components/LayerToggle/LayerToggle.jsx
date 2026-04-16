import React, { useState } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import './LayerToggle.sass'

const LAYERS = [
  { key: 'showFloorImage', label: '平面圖' },
  { key: 'showScopes',     label: '熱圖範圍' },
  { key: 'showFloorHoles', label: '挑高區域' },
  { key: 'showWalls',      label: '牆體' },
  { key: 'showAPs',        label: 'AP' },
  { key: 'showAPInfo',     label: 'AP 資訊' },
  { key: 'showHeatmap',    label: '熱力圖' },
]

function LayerToggle() {
  const toggleLayer = useEditorStore((s) => s.toggleLayer)
  const layerStates = useEditorStore((s) => LAYERS.map((l) => s[l.key]))
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="layer-toggle">
      <div className="layer-toggle__header" onClick={() => setCollapsed((v) => !v)}>
        <span className="layer-toggle__icon">👁</span>
        <span className="layer-toggle__title">圖層</span>
        <span className={`layer-toggle__arrow${collapsed ? ' layer-toggle__arrow--collapsed' : ''}`}>▾</span>
      </div>
      {!collapsed && (
        <ul className="layer-toggle__list">
          {LAYERS.map((layer, i) => (
            <li
              key={layer.key}
              className={`layer-toggle__item${!layerStates[i] ? ' layer-toggle__item--hidden' : ''}`}
              onClick={() => toggleLayer(layer.key)}
            >
              <span className="layer-toggle__eye">{layerStates[i] ? '👁' : '🚫'}</span>
              <span className="layer-toggle__label">{layer.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default LayerToggle

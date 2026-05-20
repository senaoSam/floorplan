import React, { useCallback, useMemo } from 'react'
import { useCableStore, DEFAULT_TRAY_MAGNET_PX } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import './APPanel.sass'

// Polyline length in canvas px → meters via floor scale.
function polylineLengthPx(points) {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

function CableTrayPanel({ floorId, trayId }) {
  const tray          = useCableStore((s) => (s.traysByFloor[floorId] ?? []).find((t) => t.id === trayId))
  const updateTray    = useCableStore((s) => s.updateTray)
  const removeTray    = useCableStore((s) => s.removeTray)
  const floor         = useFloorStore((s) => s.floors.find((f) => f.id === floorId))
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const handleNumber = useCallback((field, raw, { min = 0 } = {}) => {
    const num = parseFloat(raw)
    if (isNaN(num) || num < min) return
    updateTray(floorId, trayId, { [field]: num })
  }, [floorId, trayId, updateTray])

  const handleDelete = () => {
    removeTray(floorId, trayId)
    clearSelected()
  }

  const lengthM = useMemo(() => {
    if (!tray || !floor?.scale) return null
    return polylineLengthPx(tray.points) / floor.scale
  }, [tray, floor])

  if (!tray) return null

  const magnet = tray.magnetDistance ?? DEFAULT_TRAY_MAGNET_PX
  const magnetM = floor?.scale ? magnet / floor.scale : null

  const displayName = tray.name ?? tray.id

  return (
    <div className="ap-panel">
      <div className="ap-panel__header">
        <span className="ap-panel__title">{displayName}</span>
        <span className="ap-panel__dot" style={{ background: '#60a5fa' }} />
        <button className="panel-delete-btn" onClick={handleDelete}>刪除</button>
      </div>

      <section className="ap-panel__section">
        <p className="ap-panel__label">名稱</p>
        <input
          className="ap-panel__input"
          type="text"
          value={tray.name ?? ''}
          placeholder={tray.id}
          onChange={(e) => updateTray(floorId, trayId, { name: e.target.value })}
        />
        <p className="ap-panel__hint">自動命名 TRAY-{`{序號}`}；可手動覆寫</p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">節點數</p>
        <p className="ap-panel__hint">{tray.points.length} 個頂點</p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">長度</p>
        <p className="ap-panel__hint">
          {lengthM != null ? `${lengthM.toFixed(2)} m` : '需先校正比例尺'}
        </p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">
          磁吸範圍
          {magnetM != null && (
            <span className="ap-panel__hint-inline">（約 {magnetM.toFixed(2)} m）</span>
          )}
        </p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="1"
            step="10"
            value={magnet}
            onChange={(e) => handleNumber('magnetDistance', e.target.value, { min: 1 })}
          />
          <span className="ap-panel__unit">px</span>
        </div>
        <p className="ap-panel__hint">
          AP / Switch 落在此範圍內會吸附到此 tray 走線
        </p>
      </section>
    </div>
  )
}

export default CableTrayPanel

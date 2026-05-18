import React, { useCallback } from 'react'
import { useCableStore, DEFAULT_RISER_MAGNET_PX } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import './APPanel.sass'

// Riser editing — floorIds is the core knob: the user picks which floors the
// riser actually serves. xy is global, so editing xy here would apply across
// every floor in floorIds. We surface it read-only (drag on canvas to move).
function RiserPanel({ riserId }) {
  const riser         = useCableStore((s) => s.risers.find((r) => r.id === riserId))
  const updateRiser   = useCableStore((s) => s.updateRiser)
  const removeRiser   = useCableStore((s) => s.removeRiser)
  const floors        = useFloorStore((s) => s.floors)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const handleNumber = useCallback((field, raw, { min = 0 } = {}) => {
    const num = parseFloat(raw)
    if (isNaN(num) || num < min) return
    updateRiser(riserId, { [field]: num })
  }, [riserId, updateRiser])

  const handleDelete = () => {
    removeRiser(riserId)
    clearSelected()
  }

  const handleToggleFloor = (floorId) => {
    const current = riser.floorIds ?? []
    const next = current.includes(floorId)
      ? current.filter((id) => id !== floorId)
      : [...current, floorId]
    updateRiser(riserId, { floorIds: next })
  }

  if (!riser) return null

  const magnet = riser.magnetDistance ?? DEFAULT_RISER_MAGNET_PX
  const sortedFloors = [...floors].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0))
  const floorSet = new Set(riser.floorIds ?? [])

  return (
    <div className="ap-panel">
      <div className="ap-panel__header">
        <span className="ap-panel__title">{riser.name}</span>
        <span className="ap-panel__dot" style={{ background: '#a78bfa' }} />
        <button className="panel-delete-btn" onClick={handleDelete}>刪除</button>
      </div>

      <section className="ap-panel__section">
        <p className="ap-panel__label">位置（canvas px）</p>
        <p className="ap-panel__hint">
          x: {Math.round(riser.x)}, y: {Math.round(riser.y)}（拖曳 riser 圖示可移動，xy 跨樓層共用）
        </p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">
          跨越樓層
          <span className="ap-panel__hint-inline">（共 {floorSet.size} 層）</span>
        </p>
        <div className="ap-panel__checkbox-list">
          {sortedFloors.map((f) => (
            <label key={f.id} className="ap-panel__checkbox-row">
              <input
                type="checkbox"
                checked={floorSet.has(f.id)}
                onChange={() => handleToggleFloor(f.id)}
              />
              <span>{f.name ?? f.id}</span>
              {f.elevation != null && (
                <span className="ap-panel__hint-inline">（{f.elevation.toFixed(1)} m）</span>
              )}
            </label>
          ))}
        </div>
        {floorSet.size === 0 && (
          <p className="ap-panel__hint" style={{ color: '#ef4444' }}>
            ⚠ 沒有選擇任何樓層 → riser 在 2D 不會顯示
          </p>
        )}
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">磁吸範圍</p>
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
          Riser 是 hub：每個樓層的所有 magnet 內 tray 都會接過去（12-3b graph 用）
        </p>
      </section>
    </div>
  )
}

export default RiserPanel

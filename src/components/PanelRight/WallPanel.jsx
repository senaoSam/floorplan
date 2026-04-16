import React, { useCallback } from 'react'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { MATERIAL_LIST, OPENING_TYPES, getMaterialById } from '@/constants/materials'
import './WallPanel.sass'

function WallPanel({ floorId, wallId }) {
  // 直接訂閱 wall 資料，store 更新時才會觸發 re-render
  const wall       = useWallStore((s) => (s.wallsByFloor[floorId] ?? []).find((w) => w.id === wallId))
  const updateWall = useWallStore((s) => s.updateWall)
  const removeWall = useWallStore((s) => s.removeWall)
  const updateOpening = useWallStore((s) => s.updateOpening)
  const removeOpening = useWallStore((s) => s.removeOpening)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const handleMaterial = useCallback((mat) => {
    updateWall(floorId, wallId, { material: mat })
  }, [floorId, wallId, updateWall])

  const handleHeight = useCallback((field, value) => {
    const num = parseFloat(value)
    if (!isNaN(num) && num >= 0) updateWall(floorId, wallId, { [field]: num })
  }, [floorId, wallId, updateWall])

  const handleDelete = () => {
    removeWall(floorId, wallId)
    clearSelected()
  }

  if (!wall) return null

  const len = Math.hypot(wall.endX - wall.startX, wall.endY - wall.startY).toFixed(1)

  return (
    <div className="wall-panel">
      <div className="wall-panel__header">
        <span className="wall-panel__title">牆體屬性</span>
        <span className="wall-panel__meta">{len} px</span>
      </div>

      {/* 材質選擇 */}
      <section className="wall-panel__section">
        <p className="wall-panel__label">材質</p>
        <div className="wall-panel__materials">
          {MATERIAL_LIST.map((mat) => {
            const isActive = wall.material.id === mat.id
            return (
              <button
                key={mat.id}
                className={`wall-panel__mat-btn${isActive ? ' wall-panel__mat-btn--active' : ''}`}
                onClick={() => handleMaterial(mat)}
                title={`${mat.label}（${mat.dbLoss} dB）`}
              >
                <span
                  className="wall-panel__mat-color"
                  style={{ background: mat.color }}
                />
                <span className="wall-panel__mat-name">{mat.label}</span>
                <span className="wall-panel__mat-db">{mat.dbLoss} dB</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* 高度設定（3D 視圖開放後啟用） */}
      <section className="wall-panel__section wall-panel__section--disabled" title="3D 視圖開放後啟用">
        <p className="wall-panel__label">高度（公尺） <span className="wall-panel__coming-soon">即將推出</span></p>
        <div className="wall-panel__heights">
          <label className="wall-panel__height-field">
            <span>頂部</span>
            <input
              type="number"
              value={wall.topHeight}
              disabled
            />
            <span>m</span>
          </label>
          <label className="wall-panel__height-field">
            <span>底部</span>
            <input
              type="number"
              value={wall.bottomHeight}
              disabled
            />
            <span>m</span>
          </label>
        </div>
      </section>

      {/* 門窗 */}
      {(wall.openings ?? []).length > 0 && (
        <section className="wall-panel__section">
          <p className="wall-panel__label">門窗</p>
          <div className="wall-panel__openings">
            {wall.openings.map((op) => {
              const ot = OPENING_TYPES[op.type === 'window' ? 'WINDOW' : 'DOOR']
              const handleFracChange = (field, raw) => {
                const pct = parseInt(raw, 10)
                if (isNaN(pct)) return
                const frac = Math.max(0, Math.min(100, pct)) / 100
                const newStart = field === 'startFrac' ? frac : op.startFrac
                const newEnd   = field === 'endFrac'   ? frac : op.endFrac
                if (newStart >= newEnd) return
                // 檢查與其他 opening 是否重疊
                const others = wall.openings.filter((o) => o.id !== op.id)
                const overlaps = others.some((o) => newStart < o.endFrac && newEnd > o.startFrac)
                if (overlaps) return
                updateOpening(floorId, wallId, op.id, { [field]: frac })
              }
              const handleTypeToggle = () => {
                const newType = op.type === 'door' ? 'window' : 'door'
                const newOt = OPENING_TYPES[newType === 'window' ? 'WINDOW' : 'DOOR']
                const defaultMat = getMaterialById(newOt.defaultMaterial)
                updateOpening(floorId, wallId, op.id, { type: newType, material: defaultMat })
              }
              const handleMaterialChange = (matId) => {
                const mat = getMaterialById(matId)
                updateOpening(floorId, wallId, op.id, { material: mat })
              }
              return (
                <div key={op.id} className="wall-panel__opening-item">
                  <button
                    className="wall-panel__opening-type-btn"
                    style={{ background: ot.color }}
                    onClick={handleTypeToggle}
                    title={`點擊切換為${op.type === 'door' ? '窗' : '門'}`}
                  >
                    {ot.label}
                  </button>
                  <select
                    className="wall-panel__opening-mat-select"
                    value={op.material?.id ?? ''}
                    onChange={(e) => handleMaterialChange(e.target.value)}
                  >
                    {MATERIAL_LIST.map((mat) => (
                      <option key={mat.id} value={mat.id}>{mat.label} ({mat.dbLoss} dB)</option>
                    ))}
                  </select>
                  <div className="wall-panel__opening-inputs">
                    <input
                      className="wall-panel__opening-input"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round(op.startFrac * 100)}
                      onChange={(e) => handleFracChange('startFrac', e.target.value)}
                    />
                    <span className="wall-panel__opening-sep">~</span>
                    <input
                      className="wall-panel__opening-input"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round(op.endFrac * 100)}
                      onChange={(e) => handleFracChange('endFrac', e.target.value)}
                    />
                    <span className="wall-panel__opening-pct">%</span>
                  </div>
                  <button
                    className="wall-panel__opening-del"
                    onClick={() => removeOpening(floorId, wallId, op.id)}
                    title="刪除"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <button className="wall-panel__delete" onClick={handleDelete}>
        刪除牆體
      </button>
    </div>
  )
}

export default WallPanel

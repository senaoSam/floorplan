import React, { useCallback } from 'react'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { MATERIAL_LIST } from '@/constants/materials'
import './WallPanel.sass'

function WallPanel({ floorId, wallId }) {
  // 直接訂閱 wall 資料，store 更新時才會觸發 re-render
  const wall       = useWallStore((s) => (s.wallsByFloor[floorId] ?? []).find((w) => w.id === wallId))
  const updateWall = useWallStore((s) => s.updateWall)
  const removeWall = useWallStore((s) => s.removeWall)
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

      {/* 高度設定 */}
      <section className="wall-panel__section">
        <p className="wall-panel__label">高度（公尺）</p>
        <div className="wall-panel__heights">
          <label className="wall-panel__height-field">
            <span>頂部</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={wall.topHeight}
              onChange={(e) => handleHeight('topHeight', e.target.value)}
            />
            <span>m</span>
          </label>
          <label className="wall-panel__height-field">
            <span>底部</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={wall.bottomHeight}
              onChange={(e) => handleHeight('bottomHeight', e.target.value)}
            />
            <span>m</span>
          </label>
        </div>
      </section>

      <button className="wall-panel__delete" onClick={handleDelete}>
        刪除牆體
      </button>
    </div>
  )
}

export default WallPanel

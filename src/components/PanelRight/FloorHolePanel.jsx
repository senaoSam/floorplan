import React from 'react'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useEditorStore } from '@/store/useEditorStore'
import './FloorHolePanel.sass'

function FloorHolePanel({ floorId, holeId }) {
  const hole        = useFloorHoleStore((s) => (s.floorHolesByFloor[floorId] ?? []).find((h) => h.id === holeId))
  const removeFloorHole = useFloorHoleStore((s) => s.removeFloorHole)
  const clearSelected   = useEditorStore((s) => s.clearSelected)

  if (!hole) return null

  const handleDelete = () => {
    removeFloorHole(floorId, holeId)
    clearSelected()
  }

  return (
    <div className="floor-hole-panel">
      <div className="floor-hole-panel__header">
        <span className="floor-hole-panel__title">Floor Hole</span>
        <span className="floor-hole-panel__dot" />
        <button className="panel-delete-btn" onClick={handleDelete}>刪除</button>
      </div>

      <section className="floor-hole-panel__section">
        <p className="floor-hole-panel__label">說明</p>
        <span className="floor-hole-panel__value floor-hole-panel__value--desc">
          中庭區域，信號可跨樓層穿透
        </span>
      </section>

      <section className="floor-hole-panel__section">
        <p className="floor-hole-panel__label">頂點數</p>
        <span className="floor-hole-panel__value">{hole.points.length / 2}</span>
      </section>

    </div>
  )
}

export default FloorHolePanel

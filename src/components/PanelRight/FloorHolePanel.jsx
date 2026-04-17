import React from 'react'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import './FloorHolePanel.sass'

function FloorHolePanel({ floorId, holeId }) {
  const hole        = useFloorHoleStore((s) => (s.floorHolesByFloor[floorId] ?? []).find((h) => h.id === holeId))
  const removeFloorHole = useFloorHoleStore((s) => s.removeFloorHole)
  const updateFloorHole = useFloorHoleStore((s) => s.updateFloorHole)
  const floors          = useFloorStore((s) => s.floors)
  const clearSelected   = useEditorStore((s) => s.clearSelected)

  if (!hole) return null

  const handleDelete = () => {
    removeFloorHole(floorId, holeId)
    clearSelected()
  }

  const bottomId = hole.bottomFloorId ?? floorId
  const topId    = hole.topFloorId    ?? floorId

  const fIdx = (id) => floors.findIndex((f) => f.id === id)
  const ownIdx    = fIdx(floorId)
  const bottomIdx = fIdx(bottomId)
  const topIdx    = fIdx(topId)

  const setBottom = (id) => {
    const newBottomIdx = fIdx(id)
    // Keep ordering sane: bottom must not exceed top.
    const newTopId = newBottomIdx > topIdx ? id : topId
    updateFloorHole(floorId, holeId, { bottomFloorId: id, topFloorId: newTopId })
  }
  const setTop = (id) => {
    const newTopIdx = fIdx(id)
    const newBottomId = newTopIdx < bottomIdx ? id : bottomId
    updateFloorHole(floorId, holeId, { topFloorId: id, bottomFloorId: newBottomId })
  }

  const spanCount = Math.abs(topIdx - bottomIdx) + 1

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

      <section className="floor-hole-panel__section">
        <p className="floor-hole-panel__label">垂直延伸範圍</p>
        <div className="floor-hole-panel__span-row">
          <span className="floor-hole-panel__span-axis">底</span>
          <select
            className="floor-hole-panel__span-select"
            value={bottomId}
            onChange={(e) => setBottom(e.target.value)}
          >
            {floors.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div className="floor-hole-panel__span-row">
          <span className="floor-hole-panel__span-axis">頂</span>
          <select
            className="floor-hole-panel__span-select"
            value={topId}
            onChange={(e) => setTop(e.target.value)}
          >
            {floors.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <p className="floor-hole-panel__span-hint">
          {spanCount <= 1
            ? `僅本樓層生效`
            : `貫穿 ${spanCount} 層（此層 = ${floors[ownIdx]?.name ?? ''}）`}
        </p>
      </section>

    </div>
  )
}

export default FloorHolePanel

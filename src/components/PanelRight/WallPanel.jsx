import React from 'react'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { MATERIAL_LIST, getMaterialById } from '@/constants/materials'
import './_panel.sass'

// Slim Phase 25 wall panel — name / material / topHeight / bottomHeight
// + opening count readout. Opening inline edit (per-door / per-window
// material + frac), door/window add/remove and endpoint position edit
// land with the 31-4 wall shader + opening sub-segment work.

function WallPanel({ floorId, wallId }) {
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
  const updateWall = useWallStore((s) => s.updateWall)
  const removeWall = useWallStore((s) => s.removeWall)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const wall = walls.find((w) => w.id === wallId)
  if (!wall) return null

  const onPatch = (patch) => updateWall(floorId, wallId, patch)
  const onDelete = () => {
    removeWall(floorId, wallId)
    clearSelected()
  }

  const length = Math.hypot(wall.endX - wall.startX, wall.endY - wall.startY)
  const openings = wall.openings ?? []

  return (
    <div className="obj-panel">
      <div className="obj-panel__header">
        <span className="obj-panel__title">{wall.name ?? wallId}</span>
        <button type="button" className="obj-panel__delete" onClick={onDelete}>刪除</button>
      </div>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">識別</div>
        <label className="obj-panel__field">
          <span>名稱</span>
          <input
            type="text"
            value={wall.name ?? ''}
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </label>
      </section>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">材質</div>
        <label className="obj-panel__field">
          <span>材質</span>
          <select
            value={wall.material?.id ?? 'concrete'}
            onChange={(e) => onPatch({ material: getMaterialById(e.target.value) })}
          >
            {MATERIAL_LIST.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.dbLoss} dB)
              </option>
            ))}
          </select>
        </label>
        <div className="obj-panel__row">
          <label className="obj-panel__field">
            <span>頂部 (m)</span>
            <input
              type="number"
              step="0.1"
              value={wall.topHeight ?? 3.0}
              onChange={(e) => onPatch({ topHeight: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="obj-panel__field">
            <span>底部 (m)</span>
            <input
              type="number"
              step="0.1"
              value={wall.bottomHeight ?? 0}
              onChange={(e) => onPatch({ bottomHeight: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
      </section>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">幾何</div>
        <label className="obj-panel__field obj-panel__field--readonly">
          <span>長度 (px)</span>
          <input type="text" readOnly value={length.toFixed(1)} />
        </label>
        <label className="obj-panel__field obj-panel__field--readonly">
          <span>門窗數</span>
          <input type="text" readOnly value={openings.length} />
        </label>
      </section>
    </div>
  )
}

export default WallPanel

import React from 'react'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { MATERIAL_LIST, getMaterialById, OPENING_TYPES } from '@/constants/materials'
import { generateId } from '@/utils/id'
import './_panel.sass'

// Phase 25 wall panel — identification, material, height envelope, geometry
// readout, plus per-opening edit (type / material / startFrac / endFrac)
// and "add door / add window" buttons. Each opening is appended at the
// first free interval so it doesn't overlap an existing one.

function findFreeSlot(openings, preferredSpan = 0.15) {
  // Walk the [0, 1] interval and pick the largest free gap. The new
  // opening uses min(preferredSpan, gap*0.9), so when the wall is already
  // crowded we shrink instead of overlapping. If no gap exists at all we
  // surrender — caller should hide the "+ door/window" buttons in that
  // case, but we still return a sane (zero-width) range.
  const sorted = [...(openings ?? [])].sort((a, b) => a.startFrac - b.startFrac)
  const gaps = []
  let cursor = 0
  for (const op of sorted) {
    if (op.startFrac > cursor) gaps.push({ start: cursor, end: op.startFrac })
    cursor = Math.max(cursor, op.endFrac)
  }
  if (cursor < 1) gaps.push({ start: cursor, end: 1 })
  if (gaps.length === 0) return { startFrac: 0, endFrac: 0 }
  const biggest = gaps.reduce((acc, g) => (g.end - g.start > acc.end - acc.start ? g : acc))
  const room = biggest.end - biggest.start
  const span = Math.min(preferredSpan, room * 0.9)
  const center = (biggest.start + biggest.end) / 2
  return {
    startFrac: Math.max(0, center - span / 2),
    endFrac:   Math.min(1, center + span / 2),
  }
}

function WallPanel({ floorId, wallId }) {
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
  const updateWall = useWallStore((s) => s.updateWall)
  const removeWall = useWallStore((s) => s.removeWall)
  const addOpening = useWallStore((s) => s.addOpening)
  const updateOpening = useWallStore((s) => s.updateOpening)
  const removeOpening = useWallStore((s) => s.removeOpening)
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

  const handleAddOpening = (kind) => {
    const ot = kind === 'window' ? OPENING_TYPES.WINDOW : OPENING_TYPES.DOOR
    const { startFrac, endFrac } = findFreeSlot(openings)
    addOpening(floorId, wallId, {
      id: generateId(kind),
      type: ot.id,
      material: getMaterialById(ot.defaultMaterial),
      startFrac,
      endFrac,
    })
  }

  const handleFracChange = (op, field, raw) => {
    if (Number.isNaN(raw)) return
    const frac = Math.max(0, Math.min(100, raw)) / 100
    const newStart = field === 'startFrac' ? frac : op.startFrac
    const newEnd   = field === 'endFrac'   ? frac : op.endFrac
    if (newStart >= newEnd) return
    const others = openings.filter((o) => o.id !== op.id)
    const overlaps = others.some((o) => newStart < o.endFrac && newEnd > o.startFrac)
    if (overlaps) return
    updateOpening(floorId, wallId, op.id, { [field]: frac })
  }

  const handleTypeToggle = (op) => {
    const newType = op.type === 'door' ? 'window' : 'door'
    const ot = newType === 'window' ? OPENING_TYPES.WINDOW : OPENING_TYPES.DOOR
    updateOpening(floorId, wallId, op.id, {
      type: newType,
      material: getMaterialById(ot.defaultMaterial),
    })
  }

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
      </section>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">門窗 ({openings.length})</div>
        <div className="obj-panel__row">
          <button
            type="button"
            className="obj-panel__btn"
            onClick={() => handleAddOpening('door')}
          >
            + 門
          </button>
          <button
            type="button"
            className="obj-panel__btn"
            onClick={() => handleAddOpening('window')}
          >
            + 窗
          </button>
        </div>
        {openings.map((op) => {
          const ot = op.type === 'window' ? OPENING_TYPES.WINDOW : OPENING_TYPES.DOOR
          return (
            <div key={op.id} className="obj-panel__opening">
              <button
                type="button"
                className="obj-panel__opening-type"
                style={{ background: ot.color }}
                onClick={() => handleTypeToggle(op)}
                title={`點擊切換為${op.type === 'door' ? '窗' : '門'}`}
              >
                {ot.label}
              </button>
              <select
                value={op.material?.id ?? ''}
                onChange={(e) => updateOpening(floorId, wallId, op.id, {
                  material: getMaterialById(e.target.value),
                })}
              >
                {MATERIAL_LIST.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.dbLoss}dB)
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={Math.round(op.startFrac * 100)}
                onChange={(e) => handleFracChange(op, 'startFrac', parseFloat(e.target.value))}
              />
              <span className="obj-panel__opening-sep">~</span>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={Math.round(op.endFrac * 100)}
                onChange={(e) => handleFracChange(op, 'endFrac', parseFloat(e.target.value))}
              />
              <span className="obj-panel__opening-pct">%</span>
              <button
                type="button"
                className="obj-panel__opening-del"
                onClick={() => removeOpening(floorId, wallId, op.id)}
                title="刪除門窗"
              >
                ×
              </button>
            </div>
          )
        })}
      </section>
    </div>
  )
}

export default WallPanel

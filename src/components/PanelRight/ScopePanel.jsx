import React from 'react'
import { useScopeStore } from '@/store/useScopeStore'
import { useEditorStore } from '@/store/useEditorStore'
import './ScopePanel.sass'

const TYPE_OPTIONS = [
  { value: 'in',  label: 'In-Scope',  color: '#2ed573' },
  { value: 'out', label: 'Out-of-Scope', color: '#ff4757' },
]

function ScopePanel({ floorId, zoneId }) {
  const zone        = useScopeStore((s) => (s.scopesByFloor[floorId] ?? []).find((z) => z.id === zoneId))
  const updateScope = useScopeStore((s) => s.updateScope)
  const removeScope = useScopeStore((s) => s.removeScope)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  if (!zone) return null

  const handleDelete = () => {
    removeScope(floorId, zoneId)
    clearSelected()
  }

  const current = TYPE_OPTIONS.find((o) => o.value === zone.type) ?? TYPE_OPTIONS[0]

  return (
    <div className="scope-panel">
      <div className="scope-panel__header">
        <span className="scope-panel__title">範圍</span>
        <span className="scope-panel__dot" style={{ background: current.color }} />
        <button className="panel-delete-btn" onClick={handleDelete}>刪除</button>
      </div>

      <section className="scope-panel__section">
        <p className="scope-panel__label">類型</p>
        <div className="scope-panel__btn-group">
          {TYPE_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`scope-panel__btn${zone.type === o.value ? ' scope-panel__btn--active' : ''}`}
              style={zone.type === o.value ? { borderColor: o.color, color: o.color } : {}}
              onClick={() => updateScope(floorId, zoneId, { type: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      <section className="scope-panel__section">
        <p className="scope-panel__label">頂點數</p>
        <span className="scope-panel__value">{zone.points.length / 2}</span>
      </section>

    </div>
  )
}

export default ScopePanel

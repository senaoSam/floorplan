import React, { useCallback } from 'react'
import { useCableStore, SWITCH_KINDS, getSwitchKindColor } from '@/store/useCableStore'
import { useEditorStore } from '@/store/useEditorStore'
import './APPanel.sass'

function SwitchPanel({ floorId, swId }) {
  const sw            = useCableStore((s) => (s.switchesByFloor[floorId] ?? []).find((x) => x.id === swId))
  const updateSwitch  = useCableStore((s) => s.updateSwitch)
  const removeSwitch  = useCableStore((s) => s.removeSwitch)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const handleField = useCallback((field, value) => {
    updateSwitch(floorId, swId, { [field]: value })
  }, [floorId, swId, updateSwitch])

  const handleNumber = useCallback((field, raw, { min = 0 } = {}) => {
    const num = parseFloat(raw)
    if (isNaN(num) || num < min) return
    updateSwitch(floorId, swId, { [field]: num })
  }, [floorId, swId, updateSwitch])

  const handleKind = useCallback((kind) => {
    updateSwitch(floorId, swId, { kind })
  }, [floorId, swId, updateSwitch])

  const handleDelete = () => {
    removeSwitch(floorId, swId)
    clearSelected()
  }

  if (!sw) return null

  const color = getSwitchKindColor(sw.kind)

  return (
    <div className="ap-panel">
      <div className="ap-panel__header">
        <span className="ap-panel__title">Switch 屬性</span>
        <span className="ap-panel__dot" style={{ background: color }} />
        <button className="panel-delete-btn" onClick={handleDelete}>刪除</button>
      </div>

      {/* 類型 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">類型</p>
        <div className="ap-panel__btn-group">
          {SWITCH_KINDS.map((k) => {
            const active = sw.kind === k.value
            return (
              <button
                key={k.value}
                className={`ap-panel__btn${active ? ' ap-panel__btn--active' : ''}`}
                style={active ? { borderColor: k.color, color: k.color } : {}}
                onClick={() => handleKind(k.value)}
              >
                {k.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* 名稱 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">名稱</p>
        <input
          className="ap-panel__input"
          type="text"
          value={sw.name}
          onChange={(e) => handleField('name', e.target.value)}
        />
      </section>

      {/* 型號 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">型號</p>
        <input
          className="ap-panel__input"
          type="text"
          value={sw.model ?? ''}
          onChange={(e) => handleField('model', e.target.value)}
          placeholder="例如 POE-24-port"
        />
      </section>

      {/* Port 數 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">Port 數</p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="1"
            step="1"
            value={sw.portCount ?? 24}
            onChange={(e) => handleNumber('portCount', e.target.value, { min: 1 })}
          />
          <span className="ap-panel__unit">ports</span>
        </div>
      </section>

      {/* PoE Budget */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">PoE 預算</p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="0"
            step="10"
            value={sw.poeBudget ?? 0}
            onChange={(e) => handleNumber('poeBudget', e.target.value)}
          />
          <span className="ap-panel__unit">W（0 = 無 PoE）</span>
        </div>
      </section>

      {/* 安裝高度 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">安裝高度</p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="0"
            step="0.1"
            value={sw.mountHeight ?? 0.5}
            onChange={(e) => handleNumber('mountHeight', e.target.value)}
          />
          <span className="ap-panel__unit">m</span>
        </div>
      </section>
    </div>
  )
}

export default SwitchPanel

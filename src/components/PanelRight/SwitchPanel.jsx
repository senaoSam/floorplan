import React from 'react'
import { useCableStore, SWITCH_KINDS } from '@/store/useCableStore'
import { useEditorStore } from '@/store/useEditorStore'
import './_panel.sass'

// Slim Phase 25 SwitchPanel — kind / name / position / model / port
// count / PoE budget. uplinkTo / cableType / port-row detail / health
// metrics return when their dependencies (per-tier classification UI,
// dropdown showing all switches across floors) are reintroduced.

function SwitchPanel({ floorId, swId }) {
  const switches = useCableStore((s) => s.switchesByFloor[floorId] ?? [])
  const updateSwitch = useCableStore((s) => s.updateSwitch)
  const removeSwitch = useCableStore((s) => s.removeSwitch)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const sw = switches.find((s) => s.id === swId)
  if (!sw) return null

  const onPatch = (patch) => updateSwitch(floorId, swId, patch)
  const onDelete = () => {
    removeSwitch(floorId, swId)
    clearSelected()
  }

  return (
    <div className="obj-panel">
      <div className="obj-panel__header">
        <span className="obj-panel__title">{sw.name ?? swId}</span>
        <button type="button" className="obj-panel__delete" onClick={onDelete}>刪除</button>
      </div>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">識別</div>
        <label className="obj-panel__field">
          <span>名稱</span>
          <input
            type="text"
            value={sw.name ?? ''}
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </label>
        <label className="obj-panel__field">
          <span>類型</span>
          <select
            value={sw.kind ?? 'switch'}
            onChange={(e) => onPatch({ kind: e.target.value })}
          >
            {SWITCH_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">位置</div>
        <div className="obj-panel__row">
          <label className="obj-panel__field">
            <span>X (px)</span>
            <input
              type="number"
              step="1"
              value={Math.round(sw.x)}
              onChange={(e) => onPatch({ x: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="obj-panel__field">
            <span>Y (px)</span>
            <input
              type="number"
              step="1"
              value={Math.round(sw.y)}
              onChange={(e) => onPatch({ y: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
        <label className="obj-panel__field">
          <span>安裝高度 (m)</span>
          <input
            type="number"
            step="0.1"
            value={sw.mountHeight ?? 0.5}
            onChange={(e) => onPatch({ mountHeight: parseFloat(e.target.value) || 0 })}
          />
        </label>
      </section>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">硬體</div>
        <label className="obj-panel__field">
          <span>型號</span>
          <input
            type="text"
            value={sw.model ?? ''}
            onChange={(e) => onPatch({ model: e.target.value })}
          />
        </label>
        <div className="obj-panel__row">
          <label className="obj-panel__field">
            <span>Port 數</span>
            <input
              type="number"
              step="1"
              value={sw.portCount ?? 0}
              onChange={(e) => onPatch({ portCount: parseInt(e.target.value, 10) || 0 })}
            />
          </label>
          <label className="obj-panel__field">
            <span>PoE (W)</span>
            <input
              type="number"
              step="10"
              value={sw.poeBudget ?? 0}
              onChange={(e) => onPatch({ poeBudget: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
      </section>
    </div>
  )
}

export default SwitchPanel

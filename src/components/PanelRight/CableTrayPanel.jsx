import React from 'react'
import { useCableStore, TRAY_SYSTEMS } from '@/store/useCableStore'
import { useEditorStore } from '@/store/useEditorStore'
import './_panel.sass'

// Slim Phase 25 tray panel — name / system / magnet / vertex count.
// Tray kind / dimensions / mount preset / capacity rule / fill ratio /
// vertex inline edit return with 19-x engineering attrs + 18-x tray
// edit bundles.

function CableTrayPanel({ floorId, trayId }) {
  const trays = useCableStore((s) => s.traysByFloor[floorId] ?? [])
  const updateTray = useCableStore((s) => s.updateTray)
  const removeTray = useCableStore((s) => s.removeTray)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const tray = trays.find((t) => t.id === trayId)
  if (!tray) return null

  const onPatch = (patch) => updateTray(floorId, trayId, patch)
  const onDelete = () => {
    removeTray(floorId, trayId)
    clearSelected()
  }

  return (
    <div className="obj-panel">
      <div className="obj-panel__header">
        <span className="obj-panel__title">{tray.name ?? trayId}</span>
        <button type="button" className="obj-panel__delete" onClick={onDelete}>刪除</button>
      </div>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">識別</div>
        <label className="obj-panel__field">
          <span>名稱</span>
          <input
            type="text"
            value={tray.name ?? ''}
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </label>
        <label className="obj-panel__field">
          <span>System</span>
          <select
            value={tray.system ?? 'data'}
            onChange={(e) => onPatch({ system: e.target.value })}
          >
            {TRAY_SYSTEMS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">幾何</div>
        <label className="obj-panel__field obj-panel__field--readonly">
          <span>頂點數</span>
          <input type="text" readOnly value={(tray.points ?? []).length} />
        </label>
        <label className="obj-panel__field">
          <span>Magnet 半徑 (px)</span>
          <input
            type="number"
            step="10"
            value={tray.magnetDistance ?? 100}
            onChange={(e) => onPatch({ magnetDistance: parseFloat(e.target.value) || 0 })}
          />
        </label>
      </section>
    </div>
  )
}

export default CableTrayPanel

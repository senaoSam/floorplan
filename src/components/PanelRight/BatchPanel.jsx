import React, { useCallback } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useFloorStore } from '@/store/useFloorStore'
import { MATERIAL_LIST } from '@/constants/materials'
import './BatchPanel.sass'

const FREQ_OPTIONS = [
  { value: 2.4, label: '2.4 GHz', color: '#f39c12' },
  { value: 5,   label: '5 GHz',   color: '#4fc3f7' },
  { value: 6,   label: '6 GHz',   color: '#a855f7' },
]

const DEFAULT_CHANNEL = { 2.4: 1, 5: 36, 6: 1 }

function BatchPanel() {
  const selectedItems = useEditorStore((s) => s.selectedItems)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)

  const removeWalls      = useWallStore((s) => s.removeWalls)
  const updateWalls      = useWallStore((s) => s.updateWalls)
  const removeAPs        = useAPStore((s) => s.removeAPs)
  const updateAPs        = useAPStore((s) => s.updateAPs)
  const removeScopes     = useScopeStore((s) => s.removeScopes)
  const removeFloorHoles = useFloorHoleStore((s) => s.removeFloorHoles)

  const wallIds  = selectedItems.filter((it) => it.type === 'wall').map((it) => it.id)
  const apIds    = selectedItems.filter((it) => it.type === 'ap').map((it) => it.id)
  const scopeIds = selectedItems.filter((it) => it.type === 'scope').map((it) => it.id)
  const holeIds  = selectedItems.filter((it) => it.type === 'floor_hole').map((it) => it.id)

  const handleDeleteAll = useCallback(() => {
    if (wallIds.length)  removeWalls(activeFloorId, wallIds)
    if (apIds.length)    removeAPs(activeFloorId, apIds)
    if (scopeIds.length) removeScopes(activeFloorId, scopeIds)
    if (holeIds.length)  removeFloorHoles(activeFloorId, holeIds)
    clearSelected()
  }, [activeFloorId, wallIds, apIds, scopeIds, holeIds, removeWalls, removeAPs, removeScopes, removeFloorHoles, clearSelected])

  const handleWallMaterial = useCallback((mat) => {
    updateWalls(activeFloorId, wallIds, { material: mat })
  }, [activeFloorId, wallIds, updateWalls])

  const handleAPFrequency = useCallback((freq) => {
    updateAPs(activeFloorId, apIds, { frequency: freq, channel: DEFAULT_CHANNEL[freq] ?? 1 })
  }, [activeFloorId, apIds, updateAPs])

  const handleAPTxPower = useCallback((raw) => {
    const num = parseFloat(raw)
    if (!isNaN(num) && num >= 0) updateAPs(activeFloorId, apIds, { txPower: num })
  }, [activeFloorId, apIds, updateAPs])

  return (
    <div className="batch-panel">
      <div className="batch-panel__header">
        <span className="batch-panel__title">批次選取</span>
        <span className="batch-panel__count">{selectedItems.length} 個物件</span>
      </div>

      {/* 摘要 */}
      <section className="batch-panel__section">
        <p className="batch-panel__label">已選取</p>
        <div className="batch-panel__summary">
          {wallIds.length > 0 && <span className="batch-panel__chip batch-panel__chip--wall">{wallIds.length} 牆體</span>}
          {apIds.length > 0 && <span className="batch-panel__chip batch-panel__chip--ap">{apIds.length} AP</span>}
          {scopeIds.length > 0 && <span className="batch-panel__chip batch-panel__chip--scope">{scopeIds.length} 範圍</span>}
          {holeIds.length > 0 && <span className="batch-panel__chip batch-panel__chip--hole">{holeIds.length} 挑高</span>}
        </div>
      </section>

      {/* 牆體批次修改材質 */}
      {wallIds.length > 0 && (
        <section className="batch-panel__section">
          <p className="batch-panel__label">牆體材質（批次變更）</p>
          <div className="batch-panel__materials">
            {MATERIAL_LIST.map((mat) => (
              <button
                key={mat.id}
                className="batch-panel__mat-btn"
                onClick={() => handleWallMaterial(mat)}
                title={`${mat.label}（${mat.dbLoss} dB）`}
              >
                <span className="batch-panel__mat-color" style={{ background: mat.color }} />
                <span className="batch-panel__mat-name">{mat.label}</span>
                <span className="batch-panel__mat-db">{mat.dbLoss} dB</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* AP 批次修改頻段 / 功率 */}
      {apIds.length > 0 && (
        <>
          <section className="batch-panel__section">
            <p className="batch-panel__label">AP 頻段（批次變更）</p>
            <div className="batch-panel__btn-group">
              {FREQ_OPTIONS.map((f) => (
                <button
                  key={f.value}
                  className="batch-panel__btn"
                  style={{ borderColor: f.color, color: f.color }}
                  onClick={() => handleAPFrequency(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </section>

          <section className="batch-panel__section">
            <p className="batch-panel__label">AP 發射功率（批次變更）</p>
            <div className="batch-panel__number-row">
              <input
                className="batch-panel__input"
                type="number"
                min="0"
                max="33"
                step="1"
                placeholder="dBm"
                onBlur={(e) => handleAPTxPower(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAPTxPower(e.target.value) }}
              />
              <span className="batch-panel__unit">dBm</span>
            </div>
          </section>
        </>
      )}

      <button className="batch-panel__delete" onClick={handleDeleteAll}>
        刪除全部（{selectedItems.length}）
      </button>
    </div>
  )
}

export default BatchPanel

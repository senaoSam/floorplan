import React, { useCallback } from 'react'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'
import './APPanel.sass'

const FREQ_OPTIONS = [
  { value: 2.4, label: '2.4 GHz', color: '#f39c12' },
  { value: 5,   label: '5 GHz',   color: '#4fc3f7' },
  { value: 6,   label: '6 GHz',   color: '#a855f7' },
]

const CHANNEL_OPTIONS = {
  2.4: [1, 6, 11],
  5:   [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
  6:   [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93],
}

const DEFAULT_CHANNEL = { 2.4: 1, 5: 36, 6: 1 }

const ANTENNA_OPTIONS = [
  { value: 'omni',        label: '全向' },
  { value: 'directional', label: '定向' },
]

const MOUNT_OPTIONS = [
  { value: 'ceiling', label: '天花板' },
  { value: 'wall',    label: '牆面' },
]

function APPanel({ floorId, apId }) {
  const ap          = useAPStore((s) => (s.apsByFloor[floorId] ?? []).find((a) => a.id === apId))
  const updateAP    = useAPStore((s) => s.updateAP)
  const removeAP    = useAPStore((s) => s.removeAP)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  if (!ap) return null

  const handleField = useCallback((field, value) => {
    if (field === 'frequency') {
      updateAP(floorId, apId, { frequency: value, channel: DEFAULT_CHANNEL[value] ?? 1 })
    } else {
      updateAP(floorId, apId, { [field]: value })
    }
  }, [floorId, apId, updateAP])

  const handleNumber = useCallback((field, raw) => {
    const num = parseFloat(raw)
    if (!isNaN(num) && num >= 0) updateAP(floorId, apId, { [field]: num })
  }, [floorId, apId, updateAP])

  const handleDelete = () => {
    removeAP(floorId, apId)
    clearSelected()
  }

  return (
    <div className="ap-panel">
      <div className="ap-panel__header">
        <span className="ap-panel__title">AP 屬性</span>
        <span className="ap-panel__dot" style={{ background: FREQ_OPTIONS.find(f => f.value === ap.frequency)?.color ?? '#4fc3f7' }} />
      </div>

      {/* 名稱 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">名稱</p>
        <input
          className="ap-panel__input"
          type="text"
          value={ap.name}
          onChange={(e) => handleField('name', e.target.value)}
        />
      </section>

      {/* 頻段 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">頻段</p>
        <div className="ap-panel__btn-group">
          {FREQ_OPTIONS.map((f) => (
            <button
              key={f.value}
              className={`ap-panel__btn${ap.frequency === f.value ? ' ap-panel__btn--active' : ''}`}
              style={ap.frequency === f.value ? { borderColor: f.color, color: f.color } : {}}
              onClick={() => handleField('frequency', f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {/* 頻道 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">頻道</p>
        <select
          className="ap-panel__input ap-panel__select"
          value={ap.channel ?? DEFAULT_CHANNEL[ap.frequency] ?? 1}
          onChange={(e) => handleField('channel', Number(e.target.value))}
        >
          {(CHANNEL_OPTIONS[ap.frequency] ?? []).map((ch) => (
            <option key={ch} value={ch}>Ch {ch}</option>
          ))}
        </select>
      </section>

      {/* 發射功率 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">發射功率</p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="0"
            max="33"
            step="1"
            value={ap.txPower}
            onChange={(e) => handleNumber('txPower', e.target.value)}
          />
          <span className="ap-panel__unit">dBm</span>
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
            value={ap.z}
            onChange={(e) => handleNumber('z', e.target.value)}
          />
          <span className="ap-panel__unit">m</span>
        </div>
      </section>

      {/* 天線模式 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">天線模式</p>
        <div className="ap-panel__btn-group">
          {ANTENNA_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`ap-panel__btn${ap.antennaMode === o.value ? ' ap-panel__btn--active' : ''}`}
              onClick={() => handleField('antennaMode', o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      {/* 安裝方式 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">安裝方式</p>
        <div className="ap-panel__btn-group">
          {MOUNT_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`ap-panel__btn${ap.mountType === o.value ? ' ap-panel__btn--active' : ''}`}
              onClick={() => handleField('mountType', o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      <button className="ap-panel__delete" onClick={handleDelete}>
        刪除 AP
      </button>
    </div>
  )
}

export default APPanel

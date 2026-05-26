import React from 'react'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'
import './APPanel.sass'

const FREQ_OPTIONS = [
  { value: 2.4, label: '2.4 GHz' },
  { value: 5,   label: '5 GHz' },
  { value: 6,   label: '6 GHz' },
]

const ANTENNA_MODE_OPTIONS = [
  { value: 'omni',        label: '全向 Omni' },
  { value: 'directional', label: '指向 Directional' },
  { value: 'custom',      label: '自訂 Pattern' },
]

const MOUNT_TYPE_OPTIONS = [
  { value: 'ceiling', label: '吸頂 Ceiling' },
  { value: 'wall',    label: '壁掛 Wall' },
  { value: 'floor',   label: '地面 Floor' },
]

// Phase 25 port — identification, position, wireless, antenna pattern, and
// mount info. Pattern thumbnail + model picker (apModels list) stay
// deferred until those constants get re-imported from oldSrc.
function APPanel({ floorId, apId }) {
  const aps = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  const updateAP = useAPStore((s) => s.updateAP)
  const removeAP = useAPStore((s) => s.removeAP)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const ap = aps.find((a) => a.id === apId)
  if (!ap) return null

  const onPatch = (patch) => updateAP(floorId, apId, patch)
  const onDelete = () => {
    removeAP(floorId, apId)
    clearSelected()
  }

  return (
    <div className="ap-panel">
      <div className="ap-panel__header">
        <span className="ap-panel__title">{ap.name ?? apId}</span>
        <button type="button" className="ap-panel__delete" onClick={onDelete}>刪除</button>
      </div>

      <section className="ap-panel__section">
        <div className="ap-panel__section-title">識別</div>
        <label className="ap-panel__field">
          <span>名稱</span>
          <input
            type="text"
            value={ap.name ?? ''}
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </label>
      </section>

      <section className="ap-panel__section">
        <div className="ap-panel__section-title">位置</div>
        <div className="ap-panel__row">
          <label className="ap-panel__field">
            <span>X (px)</span>
            <input
              type="number"
              step="1"
              value={Math.round(ap.x)}
              onChange={(e) => onPatch({ x: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="ap-panel__field">
            <span>Y (px)</span>
            <input
              type="number"
              step="1"
              value={Math.round(ap.y)}
              onChange={(e) => onPatch({ y: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
        <label className="ap-panel__field">
          <span>Z (m)</span>
          <input
            type="number"
            step="0.1"
            value={ap.z ?? 2.4}
            onChange={(e) => onPatch({ z: parseFloat(e.target.value) || 0 })}
          />
        </label>
      </section>

      <section className="ap-panel__section">
        <div className="ap-panel__section-title">無線</div>
        <label className="ap-panel__field">
          <span>頻段</span>
          <select
            value={ap.frequency ?? 5}
            onChange={(e) => onPatch({ frequency: parseFloat(e.target.value) })}
          >
            {FREQ_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <div className="ap-panel__row">
          <label className="ap-panel__field">
            <span>Channel</span>
            <input
              type="number"
              step="1"
              value={ap.channel ?? 36}
              onChange={(e) => onPatch({ channel: parseInt(e.target.value, 10) || 0 })}
            />
          </label>
          <label className="ap-panel__field">
            <span>Width (MHz)</span>
            <input
              type="number"
              step="20"
              value={ap.channelWidth ?? 80}
              onChange={(e) => onPatch({ channelWidth: parseInt(e.target.value, 10) || 20 })}
            />
          </label>
        </div>
        <label className="ap-panel__field">
          <span>Tx Power (dBm)</span>
          <input
            type="number"
            step="1"
            value={ap.txPower ?? 20}
            onChange={(e) => onPatch({ txPower: parseFloat(e.target.value) || 0 })}
          />
        </label>
      </section>

      <section className="ap-panel__section">
        <div className="ap-panel__section-title">天線</div>
        <label className="ap-panel__field">
          <span>模式</span>
          <select
            value={ap.antennaMode ?? 'omni'}
            onChange={(e) => onPatch({ antennaMode: e.target.value })}
          >
            {ANTENNA_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {ap.antennaMode === 'directional' && (
          <>
            <label className="ap-panel__field">
              <span>方位 Azimuth ({Math.round(ap.azimuth ?? 0)}°)</span>
              <input
                type="range"
                min="0"
                max="359"
                step="1"
                value={ap.azimuth ?? 0}
                onChange={(e) => onPatch({ azimuth: parseFloat(e.target.value) })}
              />
            </label>
            <label className="ap-panel__field">
              <span>波束寬 Beamwidth ({Math.round(ap.beamwidth ?? 60)}°)</span>
              <input
                type="range"
                min="10"
                max="180"
                step="1"
                value={ap.beamwidth ?? 60}
                onChange={(e) => onPatch({ beamwidth: parseFloat(e.target.value) })}
              />
            </label>
          </>
        )}
      </section>

      <section className="ap-panel__section">
        <div className="ap-panel__section-title">安裝</div>
        <label className="ap-panel__field">
          <span>固定方式</span>
          <select
            value={ap.mountType ?? 'ceiling'}
            onChange={(e) => onPatch({ mountType: e.target.value })}
          >
            {MOUNT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="ap-panel__field">
          <span>安裝高度 (m)</span>
          <input
            type="number"
            step="0.1"
            min="0"
            value={ap.mountHeight ?? 2.4}
            onChange={(e) => onPatch({ mountHeight: parseFloat(e.target.value) || 0 })}
          />
        </label>
      </section>
    </div>
  )
}

export default APPanel

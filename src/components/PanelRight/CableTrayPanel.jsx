import React, { useCallback, useMemo } from 'react'
import { useCableStore, DEFAULT_TRAY, DEFAULT_TRAY_MAGNET_PX, TRAY_KINDS, TRAY_MATERIALS, TRAY_MOUNT_PRESETS, resolveTrayMountHeight } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import './APPanel.sass'

// Polyline length in canvas px → meters via floor scale.
function polylineLengthPx(points) {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

function CableTrayPanel({ floorId, trayId }) {
  const tray          = useCableStore((s) => (s.traysByFloor[floorId] ?? []).find((t) => t.id === trayId))
  const updateTray    = useCableStore((s) => s.updateTray)
  const removeTray    = useCableStore((s) => s.removeTray)
  const floor         = useFloorStore((s) => s.floors.find((f) => f.id === floorId))
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const handleNumber = useCallback((field, raw, { min = 0 } = {}) => {
    const num = parseFloat(raw)
    if (isNaN(num) || num < min) return
    updateTray(floorId, trayId, { [field]: num })
  }, [floorId, trayId, updateTray])

  const handleDelete = () => {
    removeTray(floorId, trayId)
    clearSelected()
  }

  const lengthM = useMemo(() => {
    if (!tray || !floor?.scale) return null
    return polylineLengthPx(tray.points) / floor.scale
  }, [tray, floor])

  if (!tray) return null

  const magnet = tray.magnetDistance ?? DEFAULT_TRAY_MAGNET_PX
  const magnetM = floor?.scale ? magnet / floor.scale : null

  const displayName = tray.name ?? tray.id

  return (
    <div className="ap-panel">
      <div className="ap-panel__header">
        <span className="ap-panel__title">{displayName}</span>
        <span className="ap-panel__dot" style={{ background: '#60a5fa' }} />
        <button className="panel-delete-btn" onClick={handleDelete}>刪除</button>
      </div>

      <section className="ap-panel__section">
        <p className="ap-panel__label">名稱</p>
        <input
          className="ap-panel__input"
          type="text"
          value={tray.name ?? ''}
          placeholder={tray.id}
          onChange={(e) => updateTray(floorId, trayId, { name: e.target.value })}
        />
        <p className="ap-panel__hint">自動命名 TRAY-{`{序號}`}；可手動覆寫</p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">節點數</p>
        <p className="ap-panel__hint">{tray.points.length} 個頂點</p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">
          類型
          <span className="ap-panel__coming-soon">待 19-4 啟用</span>
        </p>
        <select
          className="ap-panel__input ap-panel__select"
          value={tray.kind ?? DEFAULT_TRAY.kind}
          onChange={(e) => updateTray(floorId, trayId, { kind: e.target.value })}
        >
          {TRAY_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">
          斷面尺寸
          <span className="ap-panel__coming-soon">待 19-4 / 20-1 啟用</span>
        </p>
        <div className="ap-panel__number-row">
          <span className="ap-panel__unit" style={{ minWidth: 28 }}>寬</span>
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="1"
            step="10"
            value={tray.widthMm ?? DEFAULT_TRAY.widthMm}
            onChange={(e) => handleNumber('widthMm', e.target.value, { min: 1 })}
          />
          <span className="ap-panel__unit">mm</span>
        </div>
        <div className="ap-panel__number-row" style={{ marginTop: 6 }}>
          <span className="ap-panel__unit" style={{ minWidth: 28 }}>深</span>
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="1"
            step="10"
            value={tray.depthMm ?? DEFAULT_TRAY.depthMm}
            onChange={(e) => handleNumber('depthMm', e.target.value, { min: 1 })}
          />
          <span className="ap-panel__unit">mm</span>
        </div>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">安裝高度</p>
        <select
          className="ap-panel__input ap-panel__select"
          value={tray.mountPreset ?? DEFAULT_TRAY.mountPreset}
          onChange={(e) => updateTray(floorId, trayId, { mountPreset: e.target.value })}
        >
          {TRAY_MOUNT_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {(tray.mountPreset ?? DEFAULT_TRAY.mountPreset) === 'custom' && (
          <div className="ap-panel__number-row" style={{ marginTop: 6 }}>
            <input
              className="ap-panel__input ap-panel__input--number"
              type="number"
              min="0"
              step="0.1"
              value={tray.mountHeight ?? DEFAULT_TRAY.mountHeight}
              onChange={(e) => handleNumber('mountHeight', e.target.value, { min: 0 })}
            />
            <span className="ap-panel__unit">m</span>
          </div>
        )}
        <p className="ap-panel__hint">
          3D 視覺位於 {resolveTrayMountHeight(tray, floor).toFixed(2)} m
        </p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">
          材質
          <span className="ap-panel__coming-soon">待 20-1 啟用</span>
        </p>
        <select
          className="ap-panel__input ap-panel__select"
          value={tray.materialId ?? DEFAULT_TRAY.materialId}
          onChange={(e) => updateTray(floorId, trayId, { materialId: e.target.value })}
        >
          {TRAY_MATERIALS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">長度</p>
        <p className="ap-panel__hint">
          {lengthM != null ? `${lengthM.toFixed(2)} m` : '需先校正比例尺'}
        </p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">
          磁吸範圍
          {magnetM != null && (
            <span className="ap-panel__hint-inline">（約 {magnetM.toFixed(2)} m）</span>
          )}
        </p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="1"
            step="10"
            value={magnet}
            onChange={(e) => handleNumber('magnetDistance', e.target.value, { min: 1 })}
          />
          <span className="ap-panel__unit">px</span>
        </div>
        <p className="ap-panel__hint">
          AP / Switch 落在此範圍內會吸附到此 tray 走線
        </p>
      </section>
    </div>
  )
}

export default CableTrayPanel

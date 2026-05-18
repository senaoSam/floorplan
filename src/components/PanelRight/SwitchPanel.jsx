import React, { useCallback, useMemo } from 'react'
import { useCableStore, SWITCH_KINDS, getSwitchKindColor } from '@/store/useCableStore'
import { useAPStore } from '@/store/useAPStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import { computeRoutes } from '@/features/cable/computeRoutes'
import { getAPPoeWattage } from '@/constants/apModels'
import './APPanel.sass'

function SwitchPanel({ floorId, swId }) {
  const sw            = useCableStore((s) => (s.switchesByFloor[floorId] ?? []).find((x) => x.id === swId))
  const switches      = useCableStore((s) => s.switchesByFloor[floorId] ?? [])
  const updateSwitch  = useCableStore((s) => s.updateSwitch)
  const removeSwitch  = useCableStore((s) => s.removeSwitch)
  const aps           = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  const floor         = useFloorStore((s) => s.floors.find((f) => f.id === floorId))
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

  // Connected APs = APs whose nearest same-floor switch is this one (route
  // status === 'fallback-manhattan' since no tray graph yet). Drives the
  // port-count + PoE-budget over-capacity warnings — purely advisory, the
  // routing layer already places APs regardless of capacity (per spec §8).
  const connected = useMemo(() => {
    if (!sw) return { aps: [], totalPoe: 0 }
    const routes = computeRoutes({ floor, aps, switches })
    const connAps = []
    let totalPoe = 0
    for (const ap of aps) {
      const r = routes.get(ap.id)
      if (r && r.switchId === swId) {
        connAps.push(ap)
        totalPoe += getAPPoeWattage(ap)
      }
    }
    return { aps: connAps, totalPoe }
  }, [sw, swId, aps, switches, floor])

  if (!sw) return null

  const color      = getSwitchKindColor(sw.kind)
  const portCount  = sw.portCount ?? 24
  const poeBudget  = sw.poeBudget ?? 0
  const portOver   = connected.aps.length > portCount
  const poeOver    = poeBudget > 0 && connected.totalPoe > poeBudget

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
        <p className="ap-panel__label">
          Port 數
          <span className={`ap-panel__hint-inline${portOver ? ' ap-panel__hint-inline--warn' : ''}`}>
            （已用 {connected.aps.length} / {portCount}）
          </span>
        </p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="1"
            step="1"
            value={portCount}
            onChange={(e) => handleNumber('portCount', e.target.value, { min: 1 })}
          />
          <span className="ap-panel__unit">ports</span>
        </div>
        {portOver && (
          <p className="ap-panel__hint ap-panel__hint--warn">
            ⚠ Port 不足：已連 {connected.aps.length}，超過 {portCount}
          </p>
        )}
      </section>

      {/* PoE Budget */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">
          PoE 預算
          <span className={`ap-panel__hint-inline${poeOver ? ' ap-panel__hint-inline--warn' : ''}`}>
            （已用 {connected.totalPoe.toFixed(0)} / {poeBudget} W）
          </span>
        </p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="0"
            step="10"
            value={poeBudget}
            onChange={(e) => handleNumber('poeBudget', e.target.value)}
          />
          <span className="ap-panel__unit">W（0 = 無 PoE）</span>
        </div>
        {poeOver && (
          <p className="ap-panel__hint ap-panel__hint--warn">
            ⚠ PoE 超標：{connected.totalPoe.toFixed(0)} W &gt; {poeBudget} W
          </p>
        )}
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

      {/* 已連接 AP 清單 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">已連接 AP</p>
        {connected.aps.length === 0 ? (
          <p className="ap-panel__hint">尚無 AP 路由到本 Switch</p>
        ) : (
          <ul className="ap-panel__conn-list">
            {connected.aps.map((ap) => (
              <li key={ap.id} className="ap-panel__conn-item">
                <span className="ap-panel__conn-name">{ap.name}</span>
                <span className="ap-panel__conn-wattage">{getAPPoeWattage(ap)} W</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default SwitchPanel

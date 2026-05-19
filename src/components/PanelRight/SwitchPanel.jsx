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
  const updateSwitch  = useCableStore((s) => s.updateSwitch)
  const removeSwitch  = useCableStore((s) => s.removeSwitch)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  // Building-wide subscriptions: a cross-floor riser route can connect APs
  // on other floors to this switch, so we need every AP / tray / riser.
  const floors          = useFloorStore((s) => s.floors)
  const apsByFloor      = useAPStore((s) => s.apsByFloor)
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const traysByFloor    = useCableStore((s) => s.traysByFloor)
  const risers          = useCableStore((s) => s.risers)

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

  // Connected = APs routed to this switch + uplink/downlink ports consumed by
  // S2S links. Used for port-count + PoE warnings — advisory, doesn't gate
  // routing (spec §8).
  const connected = useMemo(() => {
    if (!sw) return { aps: [], totalPoe: 0, uplinkUsed: 0, downlinkCount: 0 }
    const { routes } = computeRoutes({ floors, apsByFloor, switchesByFloor, traysByFloor, risers })
    const connAps = []
    let totalPoe = 0
    for (const [fId, list] of Object.entries(apsByFloor)) {
      for (const ap of list ?? []) {
        const r = routes.get(ap.id)
        if (r && r.switchId === swId) {
          connAps.push({ ...ap, floorId: fId })
          totalPoe += getAPPoeWattage(ap)
        }
      }
    }
    // S2S ports: 1 uplink port on this switch if it has uplinkTo; +1 port
    // per other switch whose uplinkTo points at this one (downlinks).
    const uplinkUsed = sw.uplinkTo ? 1 : 0
    let downlinkCount = 0
    for (const list of Object.values(switchesByFloor)) {
      for (const other of list ?? []) {
        if (other.id !== swId && other.uplinkTo === swId) downlinkCount++
      }
    }
    return { aps: connAps, totalPoe, uplinkUsed, downlinkCount }
  }, [sw, swId, floors, apsByFloor, switchesByFloor, traysByFloor, risers])

  if (!sw) return null

  const color      = getSwitchKindColor(sw.kind)
  const portCount  = sw.portCount ?? 24
  const poeBudget  = sw.poeBudget ?? 0
  const portsUsed  = connected.aps.length + connected.uplinkUsed + connected.downlinkCount
  const portOver   = portsUsed > portCount
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
            （已用 {portsUsed} / {portCount}）
          </span>
        </p>
        <p className="ap-panel__hint">
          AP {connected.aps.length}
          {connected.uplinkUsed ? ` + Uplink ${connected.uplinkUsed}` : ''}
          {connected.downlinkCount ? ` + Downlink ${connected.downlinkCount}` : ''}
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
            ⚠ Port 不足：已用 {portsUsed}，超過 {portCount}
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

      {/* Uplink target — 14-1: which higher-level switch this one connects to.
          Listing every other switch keeps the model expressive (any topology),
          while the kind-based default in 14-2 will suggest the obvious pick. */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">上連 Uplink</p>
        <select
          className="ap-panel__input ap-panel__select"
          value={sw.uplinkTo ?? ''}
          onChange={(e) => handleField('uplinkTo', e.target.value || null)}
        >
          <option value="">— 頂層（無 uplink）</option>
          {Object.entries(switchesByFloor).flatMap(([fId, list]) =>
            (list ?? []).filter((s) => s.id !== swId).map((s) => {
              const f = floors.find((fl) => fl.id === fId)
              return (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.kind?.toUpperCase()}{f ? ` @ ${f.name}` : ''}）
                </option>
              )
            })
          )}
        </select>
        <p className="ap-panel__hint">指定本 switch 的 uplink target（14-2 計算 S2S 線時用）</p>
      </section>

      {/* Cable type preference */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">線材偏好</p>
        <div className="ap-panel__btn-group">
          {[
            { value: 'auto',   label: 'Auto' },
            { value: 'copper', label: 'Copper' },
            { value: 'fiber',  label: 'Fiber' },
          ].map((opt) => {
            const active = (sw.cableType ?? 'auto') === opt.value
            return (
              <button
                key={opt.value}
                className={`ap-panel__btn${active ? ' ap-panel__btn--active' : ''}`}
                onClick={() => handleField('cableType', opt.value)}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        <p className="ap-panel__hint">Auto：&lt; 90 m copper、&ge; 90 m fiber（Cat 6 規範上限）</p>
      </section>

      {/* 已連接 AP 清單 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">已連接 AP</p>
        {connected.aps.length === 0 ? (
          <p className="ap-panel__hint">尚無 AP 路由到本 Switch</p>
        ) : (
          <ul className="ap-panel__conn-list">
            {connected.aps.map((ap) => {
              const isCrossFloor = ap.floorId !== floorId
              const apFloor = isCrossFloor ? floors.find((f) => f.id === ap.floorId) : null
              return (
                <li key={ap.id} className="ap-panel__conn-item">
                  <span className="ap-panel__conn-name">
                    {ap.name}
                    {isCrossFloor && (
                      <span className="ap-panel__hint-inline">
                        ({apFloor?.name ?? ap.floorId})
                      </span>
                    )}
                  </span>
                  <span className="ap-panel__conn-wattage">{getAPPoeWattage(ap)} W</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

export default SwitchPanel

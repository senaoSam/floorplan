import React, { useCallback, useMemo } from 'react'
import { useCableStore, SWITCH_KINDS, getSwitchKindColor } from '@/store/useCableStore'
import { useAPStore } from '@/store/useAPStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import { computeRoutes } from '@/features/cable/computeRoutes'
import { getAPPoeWattage } from '@/constants/apModels'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { TextInput, NumberInput, Select, Button } from './_shared/PanelControls'
import './_shared/shared.sass'
import './SwitchPanel.sass'

const CABLE_TYPE_OPTIONS = [
  { value: 'auto',   label: 'Auto' },
  { value: 'copper', label: 'Copper' },
  { value: 'fiber',  label: 'Fiber' },
]

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
    if (isNaN(raw) || raw < min) return
    updateSwitch(floorId, swId, { [field]: raw })
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

  // Build options for the uplink-target select. Skip self; tag with floor.
  const uplinkOptions = [
    { value: '', label: '— 頂層（無 uplink）' },
    ...Object.entries(switchesByFloor).flatMap(([fId, list]) =>
      (list ?? []).filter((s) => s.id !== swId).map((s) => {
        const f = floors.find((fl) => fl.id === fId)
        return {
          value: s.id,
          label: `${s.name}（${s.kind?.toUpperCase() ?? 'SW'}${f ? ` @ ${f.name}` : ''}）`,
        }
      }),
    ),
  ]

  return (
    <PanelShell accent="switch">
      <PanelHeader
        title={sw.name}
        meta={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
            Switch 屬性
          </span>
        }
        onDelete={handleDelete}
      />

      <PanelSection title="類型">
        <div className="switch-panel__kind-row">
          {SWITCH_KINDS.map((k) => {
            const active = sw.kind === k.value
            return (
              <button
                key={k.value}
                className={`switch-panel__kind-btn${active ? ' switch-panel__kind-btn--active' : ''}`}
                style={active ? { borderColor: k.color, color: k.color } : {}}
                onClick={() => handleField('kind', k.value)}
              >
                {k.label}
              </button>
            )
          })}
        </div>
      </PanelSection>

      <PanelSection title="識別">
        <PanelField label="名稱">
          <TextInput value={sw.name} onChange={(v) => handleField('name', v)} />
        </PanelField>
        <PanelField label="型號">
          <TextInput
            value={sw.model ?? ''}
            placeholder="例如 POE-24-port"
            onChange={(v) => handleField('model', v)}
          />
        </PanelField>
      </PanelSection>

      <PanelSection title="容量">
        <PanelField
          label="Port 數"
          hint={portOver
            ? `⚠ 已用 ${portsUsed} / ${portCount}（超出）`
            : `已用 ${portsUsed} / ${portCount}`}
        >
          <NumberInput
            value={portCount}
            min={1}
            step={1}
            unit="ports"
            width={70}
            onChange={(v) => handleNumber('portCount', v, { min: 1 })}
          />
        </PanelField>
        <div className="switch-panel__breakdown">
          AP {connected.aps.length}
          {connected.uplinkUsed ? ` + Uplink ${connected.uplinkUsed}` : ''}
          {connected.downlinkCount ? ` + Downlink ${connected.downlinkCount}` : ''}
        </div>

        <PanelField
          label="PoE 預算"
          hint={poeOver
            ? `⚠ 已用 ${connected.totalPoe.toFixed(0)} W / ${poeBudget} W（超出）`
            : `已用 ${connected.totalPoe.toFixed(0)} W / ${poeBudget} W`}
        >
          <NumberInput
            value={poeBudget}
            min={0}
            step={10}
            unit="W"
            width={70}
            onChange={(v) => handleNumber('poeBudget', v)}
          />
        </PanelField>
        <div className="switch-panel__hint">PoE 預算 = 0 → 該 Switch 無 PoE 供電</div>
      </PanelSection>

      <PanelSection title="安裝高度">
        <PanelField label="高度">
          <NumberInput
            value={sw.mountHeight ?? 0.5}
            min={0}
            step={0.1}
            unit="m"
            width={70}
            onChange={(v) => handleNumber('mountHeight', v)}
          />
        </PanelField>
      </PanelSection>

      <PanelSection title="上連 Uplink">
        <Select
          value={sw.uplinkTo ?? ''}
          options={uplinkOptions}
          onChange={(v) => handleField('uplinkTo', v || null)}
        />
        <div className="switch-panel__hint">
          指定本 switch 的 uplink target（14-2 計算 S2S 線時用）
        </div>
      </PanelSection>

      <PanelSection title="線材偏好">
        <div className="switch-panel__kind-row">
          {CABLE_TYPE_OPTIONS.map((opt) => {
            const active = (sw.cableType ?? 'auto') === opt.value
            return (
              <button
                key={opt.value}
                className={`switch-panel__kind-btn${active ? ' switch-panel__kind-btn--active' : ''}`}
                onClick={() => handleField('cableType', opt.value)}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        <div className="switch-panel__hint">
          Auto：&lt; 90 m copper、&ge; 90 m fiber（Cat 6 規範上限）
        </div>
      </PanelSection>

      <PanelSection title="已連接 AP">
        {connected.aps.length === 0 ? (
          <div className="switch-panel__hint">尚無 AP 路由到本 Switch</div>
        ) : (
          <ul className="switch-panel__conn-list">
            {connected.aps.map((ap) => {
              const isCrossFloor = ap.floorId !== floorId
              const apFloor = isCrossFloor ? floors.find((f) => f.id === ap.floorId) : null
              return (
                <li key={ap.id} className="switch-panel__conn-item">
                  <span className="switch-panel__conn-name">
                    {ap.name}
                    {isCrossFloor && (
                      <span className="switch-panel__conn-floor">
                        （{apFloor?.name ?? ap.floorId}）
                      </span>
                    )}
                  </span>
                  <span className="switch-panel__conn-wattage">{getAPPoeWattage(ap)} W</span>
                </li>
              )
            })}
          </ul>
        )}
      </PanelSection>
    </PanelShell>
  )
}

export default SwitchPanel

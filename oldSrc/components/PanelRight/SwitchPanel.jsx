import React, { useCallback, useMemo } from 'react'
import {
  useCableStore,
  SWITCH_KINDS,
  getSwitchKindColor,
  classifyUplinkPair,
  UPLINK_RULES,
} from '@/store/useCableStore'
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
  const sw               = useCableStore((s) => (s.switchesByFloor[floorId] ?? []).find((x) => x.id === swId))
  const updateSwitch     = useCableStore((s) => s.updateSwitch)
  const changeSwitchKind = useCableStore((s) => s.changeSwitchKind)
  const removeSwitch     = useCableStore((s) => s.removeSwitch)
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

  // 29-3 Build uplink dropdown filtered by hierarchy rules. We list every
  // switch building-wide except self, but tag each option with its
  // classification ('main' / 'warn' / 'forbidden'). 'forbidden' targets are
  // hidden from the dropdown unless they're the *currently selected* uplinkTo
  // — in that case we surface them with a 「違規」 marker so the user can see
  // the bad data and fix it (don't silently rewrite).
  const allowsNullTop = UPLINK_RULES[sw.kind]?.null === 'main'
  const uplinkOptions = []
  if (allowsNullTop) {
    uplinkOptions.push({ value: '', label: '— 頂層（無 uplink）', warn: false })
  }
  for (const [fId, list] of Object.entries(switchesByFloor)) {
    for (const s of (list ?? [])) {
      if (s.id === swId) continue
      const f = floors.find((fl) => fl.id === fId)
      const cls = classifyUplinkPair(sw.kind, s.kind)
      const isCurrent = sw.uplinkTo === s.id
      if (cls === 'forbidden' && !isCurrent) continue
      const tag = (s.kind ?? 'switch').toUpperCase()
      const floorTag = f ? ` @ ${f.name}` : ''
      const marker = cls === 'warn' ? ' ⚠' : cls === 'forbidden' ? ' ✗' : ''
      uplinkOptions.push({
        value: s.id,
        label: `${s.name}（${tag}${floorTag}）${marker}`,
        warn: cls !== 'main',
      })
    }
  }
  // Sort: main first, then warn / forbidden. Keep "top" option (if present) first.
  uplinkOptions.sort((a, b) => {
    if (a.value === '') return -1
    if (b.value === '') return 1
    return (a.warn ? 1 : 0) - (b.warn ? 1 : 0)
  })

  // Resolve uplinkTo's target switch (across all floors). Distinguish four
  // states for the warning logic below:
  //   uplinkTo === null, null-target allowed     → user chose "top of hierarchy" (OK)
  //   uplinkTo === null, null-target forbidden   → unset uplink (e.g. IDF with no MDF picked) — "請選一個目標"
  //   uplinkTo set, target found                 → real link, classify by kind
  //   uplinkTo set, target missing               → dangling reference (target was deleted)
  const uplinkTargetSw = (() => {
    if (!sw.uplinkTo) return null
    for (const list of Object.values(switchesByFloor)) {
      const t = (list ?? []).find((x) => x.id === sw.uplinkTo)
      if (t) return t
    }
    return undefined  // sentinel: uplinkTo set but target gone
  })()
  const uplinkDangling = sw.uplinkTo != null && uplinkTargetSw === undefined
  // "Unset" = uplinkTo is null but the rules don't allow null (so the switch
  // SHOULD have a target but doesn't yet). Distinct from "forbidden current
  // target" because the user hasn't picked anything wrong — they haven't
  // picked anything at all.
  const uplinkUnset = sw.uplinkTo == null && !allowsNullTop
  const uplinkClass = uplinkDangling
    ? 'dangling'
    : uplinkUnset
      ? 'unset'
      : classifyUplinkPair(sw.kind, uplinkTargetSw?.kind ?? null)
  const uplinkWarn = uplinkClass === 'warn'
  const uplinkBad  = uplinkClass === 'forbidden'

  // 29-6 — Conditional fields by kind.
  const isCore       = !!sw.isCoreLayer || sw.kind === 'mdf' || sw.kind === 'router'
  const showPoe      = !isCore                  // MDF / Router force PoE = 0
  const showUplinkTo = sw.kind !== 'router'    // Router IS top-of-hierarchy
  const showWanLan   = sw.kind === 'router'
  const downstreamCount = (() => {
    let n = 0
    for (const list of Object.values(switchesByFloor)) {
      for (const other of list ?? []) {
        if (other.id !== swId && other.uplinkTo === swId) n++
      }
    }
    return n
  })()

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
                onClick={() => changeSwitchKind(floorId, swId, k.value)}
              >
                {k.label}
              </button>
            )
          })}
        </div>
        <div className="switch-panel__hint">
          切換 kind 會套用該類型的業界 default（port 數 / PoE / uplink 介面）。
        </div>
      </PanelSection>

      <PanelSection title="識別">
        <PanelField label="名稱">
          <TextInput value={sw.name} onChange={(v) => handleField('name', v)} />
        </PanelField>
        <PanelField label="型號">
          <TextInput
            value={sw.model ?? ''}
            placeholder="例如 Catalyst 9200-24P"
            onChange={(v) => handleField('model', v)}
          />
        </PanelField>
        <PanelField label="Uplink 介面">
          <span className="switch-panel__readonly-chip">
            {(sw.uplinkPortType ?? 'sfp+').toUpperCase()} × {sw.uplinkCount ?? 4}
          </span>
        </PanelField>
      </PanelSection>

      <PanelSection title="狀態">
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

        {showPoe ? (
          <>
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
          </>
        ) : (
          <div className="switch-panel__hint">
            {sw.kind === 'mdf' ? 'MDF（核心交換器）' : 'Router（WAN 邊界）'} 預設不供 PoE。
          </div>
        )}

        {showWanLan && (
          <>
            <PanelField label="WAN port 數">
              <NumberInput
                value={sw.wanPortCount ?? 2}
                min={0}
                step={1}
                unit="ports"
                width={70}
                onChange={(v) => handleNumber('wanPortCount', v)}
              />
            </PanelField>
            <PanelField label="LAN port 數">
              <NumberInput
                value={sw.lanPortCount ?? 4}
                min={0}
                step={1}
                unit="ports"
                width={70}
                onChange={(v) => handleNumber('lanPortCount', v)}
              />
            </PanelField>
          </>
        )}

        {(sw.kind === 'idf' || sw.kind === 'mdf' || sw.kind === 'router') && (
          <PanelField label="下游裝置">
            <span className="switch-panel__readonly-chip">
              {downstreamCount} 個 switch / IDF
            </span>
          </PanelField>
        )}
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

      {showUplinkTo && (
        <PanelSection title="上連 Uplink">
          <Select
            value={
              uplinkDangling ? '__dangling__'
              : uplinkUnset ? '__unset__'
              : (sw.uplinkTo ?? '')
            }
            options={(() => {
              if (uplinkDangling) {
                return [{ value: '__dangling__', label: '— 已刪除的目標（無效）—' }, ...uplinkOptions]
              }
              if (uplinkUnset) {
                return [{ value: '__unset__', label: '— 請選一個目標 —' }, ...uplinkOptions]
              }
              return uplinkOptions
            })()}
            onChange={(v) => {
              if (v === '__dangling__' || v === '__unset__') return
              handleField('uplinkTo', v || null)
            }}
          />
          {uplinkDangling ? (
            <div className="switch-panel__hint switch-panel__hint--warn">
              ✗ 目前上連的目標 switch 已被刪除。請改選其他目標，或
              <button
                type="button"
                className="switch-panel__inline-btn"
                onClick={() => handleField('uplinkTo', null)}
              >清除上連</button>。
            </div>
          ) : uplinkUnset ? (
            <div className="switch-panel__hint switch-panel__hint--warn">
              ⚠ 尚未指定上連目標。{sw.kind.toUpperCase()} 應該上連到
              {sw.kind === 'switch' && '一個 IDF（沒有 IDF 時可上連 MDF）'}
              {sw.kind === 'idf' && '一個 MDF'}
              {sw.kind === 'mdf' && '一個 Router 或設為頂層'}
              。
            </div>
          ) : uplinkBad ? (
            <div className="switch-panel__hint switch-panel__hint--warn">
              ✗ 不允許的階層：{sw.kind.toUpperCase()} 不該上連到目前的目標。建議改選主選類別。
            </div>
          ) : uplinkWarn ? (
            <div className="switch-panel__hint switch-panel__hint--warn">
              ⚠ 跳階上連（collapsed core / 同階對等）。技術上可行，僅推薦小場館或冗餘 pair。
            </div>
          ) : (
            <div className="switch-panel__hint">
              依業界拓撲規則過濾：access → IDF，IDF → MDF，MDF → Router/頂層。
            </div>
          )}
        </PanelSection>
      )}

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

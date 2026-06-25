import React, { useCallback, useMemo } from 'react'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import { getCachedRoutes } from '@/features/cable/routesCache'
import { AP_MODEL_LIST, DEFAULT_AP_MODEL_ID, getAPModelById } from '@/constants/apModels'
import { ANTENNA_PATTERN_LIST, DEFAULT_PATTERN_ID, getPatternById } from '@/constants/antennaPatterns'
import { channelEntries, isChannelAllowed, allowedChannels } from '@/constants/regulatoryDomains'
import { CHANNEL_WIDTHS, DEFAULT_CHANNEL_WIDTH, allowedWidthsForBand } from '@/constants/channelWidths'
import PatternPreview from './PatternPreview'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { TextInput, NumberInput, Select } from './_shared/PanelControls'
import { wrapAzimuth } from '@/utils/angle'
import './_shared/shared.sass'
import './APPanel.sass'

const FREQ_OPTIONS = [
  { value: 2.4, label: '2.4 GHz', color: '#f39c12' },
  { value: 5,   label: '5 GHz',   color: '#4fc3f7' },
  { value: 6,   label: '6 GHz',   color: '#a855f7' },
]

const DEFAULT_CHANNEL = { 2.4: 1, 5: 36, 6: 1 }

const ANTENNA_OPTIONS = [
  { value: 'omni',        label: '全向' },
  { value: 'directional', label: '定向' },
  { value: 'custom',      label: '自訂' },
]

const DEFAULT_AZIMUTH   = 0
const DEFAULT_BEAMWIDTH = 60
const MIN_BEAMWIDTH     = 10
const MAX_BEAMWIDTH     = 180

const MOUNT_OPTIONS = [
  { value: 'ceiling', label: '天花板' },
  { value: 'wall',    label: '牆面' },
]

function APPanel({ floorId, apId }) {
  const ap          = useAPStore((s) => (s.apsByFloor[floorId] ?? []).find((a) => a.id === apId))
  const updateAP    = useAPStore((s) => s.updateAP)
  const removeAP    = useAPStore((s) => s.removeAP)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  const domainId    = useEditorStore((s) => s.regulatoryDomain)
  // Building-wide subscriptions — needed for cross-floor riser routes.
  const floors          = useFloorStore((s) => s.floors)
  const apsByFloor      = useAPStore((s) => s.apsByFloor)
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const traysByFloor    = useCableStore((s) => s.traysByFloor)
  const risers          = useCableStore((s) => s.risers)

  const route = useMemo(() => {
    const { routes } = getCachedRoutes({ floors, apsByFloor, switchesByFloor, traysByFloor, risers })
    return routes.get(apId)
  }, [floors, apsByFloor, switchesByFloor, traysByFloor, risers, apId])

  const model = getAPModelById(ap?.modelId ?? DEFAULT_AP_MODEL_ID)

  // Pick the first domain-allowed channel for a band; fall back to the historical default.
  const firstAllowedChannel = useCallback((band) => {
    const allowed = allowedChannels(domainId, band)
    return allowed[0] ?? DEFAULT_CHANNEL[band] ?? 1
  }, [domainId])

  const handleModel = useCallback((modelId) => {
    const newModel = getAPModelById(modelId)
    const patch = { modelId }
    // If current frequency unsupported, switch to first supported band.
    const freq = ap.frequency
    const bandOk = newModel.supportedBands.includes(freq)
    const targetFreq = bandOk ? freq : newModel.supportedBands[0]
    if (!bandOk) {
      patch.frequency = targetFreq
      patch.channel = firstAllowedChannel(targetFreq)
      patch.channelWidth = DEFAULT_CHANNEL_WIDTH[targetFreq]
    }
    // Clamp txPower to new model's max for the target band.
    const maxTx = newModel.maxTxPower[targetFreq] ?? 23
    if (ap.txPower > maxTx) patch.txPower = maxTx
    updateAP(floorId, apId, patch)
  }, [floorId, apId, ap, updateAP, firstAllowedChannel])

  const handleField = useCallback((field, value) => {
    if (field === 'frequency') {
      if (!model.supportedBands.includes(value)) return
      const maxTx = model.maxTxPower[value] ?? 23
      const patch = {
        frequency: value,
        channel: firstAllowedChannel(value),
        channelWidth: DEFAULT_CHANNEL_WIDTH[value],
      }
      if (ap.txPower > maxTx) patch.txPower = maxTx
      updateAP(floorId, apId, patch)
    } else {
      updateAP(floorId, apId, { [field]: value })
    }
  }, [floorId, apId, ap, updateAP, model, firstAllowedChannel])

  const handleNumber = useCallback((field, num) => {
    if (isNaN(num) || num < 0) return
    if (field === 'txPower') {
      const maxTx = model.maxTxPower[ap.frequency] ?? 23
      updateAP(floorId, apId, { txPower: Math.min(num, maxTx) })
    } else {
      updateAP(floorId, apId, { [field]: num })
    }
  }, [floorId, apId, ap, updateAP, model])

  const handleAntennaMode = useCallback((mode) => {
    const patch = { antennaMode: mode }
    // Directional / custom both need an azimuth; custom also needs a patternId.
    if (mode === 'directional' || mode === 'custom') {
      if (ap.azimuth == null) patch.azimuth = DEFAULT_AZIMUTH
    }
    if (mode === 'directional' && ap.beamwidth == null) {
      patch.beamwidth = DEFAULT_BEAMWIDTH
    }
    if (mode === 'custom' && ap.patternId == null) {
      patch.patternId = DEFAULT_PATTERN_ID
    }
    updateAP(floorId, apId, patch)
  }, [floorId, apId, ap, updateAP])

  const clampBeamwidth = (v) => Math.max(MIN_BEAMWIDTH, Math.min(MAX_BEAMWIDTH, v))

  const handleDelete = () => {
    removeAP(floorId, apId)
    clearSelected()
  }

  if (!ap) return null

  const maxTxForBand = model.maxTxPower[ap.frequency] ?? 23
  const freqColor = FREQ_OPTIONS.find((f) => f.value === ap.frequency)?.color ?? '#4fc3f7'

  return (
    <PanelShell accent="ap">
      <PanelHeader
        title={ap.name}
        meta={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: freqColor }} />
            AP 屬性
          </span>
        }
        onDelete={handleDelete}
      />

      <PanelSection title="識別">
        <PanelField label="型號" hint={`最大 ${maxTxForBand} dBm`}>
          <Select
            value={ap.modelId ?? DEFAULT_AP_MODEL_ID}
            onChange={handleModel}
            options={AP_MODEL_LIST.map((m) => ({
              value: m.id,
              label: `${m.vendor} ${m.name} (${m.wifiGen})`,
            }))}
          />
        </PanelField>
        <div className="ap-panel__hint">
          支援頻段：{model.supportedBands.map((b) => `${b} GHz`).join(' / ')}
        </div>
        <PanelField label="名稱">
          <TextInput value={ap.name} onChange={(v) => handleField('name', v)} />
        </PanelField>
      </PanelSection>

      <PanelSection title="頻段">
        <div className="ap-panel__pill-row">
          {FREQ_OPTIONS.map((f) => {
            const supported = model.supportedBands.includes(f.value)
            const active = ap.frequency === f.value
            return (
              <button
                key={f.value}
                className={`ap-panel__pill${active ? ' ap-panel__pill--active' : ''}${supported ? '' : ' ap-panel__pill--disabled'}`}
                style={active ? { borderColor: f.color, color: f.color } : {}}
                onClick={() => handleField('frequency', f.value)}
                disabled={!supported}
                title={supported ? '' : `${model.vendor} ${model.name} 不支援此頻段`}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      </PanelSection>

      {/* 頻道 */}
      {(() => {
        const entries = channelEntries(domainId, ap.frequency)
        const curCh = ap.channel ?? DEFAULT_CHANNEL[ap.frequency] ?? 1
        const curAllowed = isChannelAllowed(domainId, ap.frequency, curCh)
        const chanOptions = []
        if (!curAllowed) chanOptions.push({ value: String(curCh), label: `Ch ${curCh}（不允許）` })
        for (const c of entries) {
          chanOptions.push({
            value: String(c.ch),
            label: `Ch ${c.ch}${c.dfs ? '（DFS）' : ''}${c.indoorOnly ? '（室內）' : ''}`,
          })
        }
        return (
          <PanelSection title={`頻道${!curAllowed ? '（當前國家不支援）' : ''}`}>
            <Select
              value={String(curCh)}
              onChange={(v) => handleField('channel', Number(v))}
              options={chanOptions}
            />
          </PanelSection>
        )
      })()}

      {/* 頻寬 */}
      {(() => {
        const allowedWidths = allowedWidthsForBand(ap.frequency)
        const curWidth = ap.channelWidth ?? DEFAULT_CHANNEL_WIDTH[ap.frequency] ?? 20
        return (
          <PanelSection title="頻寬">
            <div className="ap-panel__pill-row">
              {CHANNEL_WIDTHS.map((w) => {
                const supported = allowedWidths.includes(w)
                const active = curWidth === w
                return (
                  <button
                    key={w}
                    className={`ap-panel__pill${active ? ' ap-panel__pill--active' : ''}${supported ? '' : ' ap-panel__pill--disabled'}`}
                    onClick={() => supported && handleField('channelWidth', w)}
                    disabled={!supported}
                    title={supported ? '' : `${ap.frequency} GHz 不建議使用 ${w} MHz`}
                  >
                    {w}
                  </button>
                )
              })}
            </div>
            <div className="ap-panel__hint">
              Cisco 建議：2.4G 固定 20、5G 多用 20/40、6G 可開 80
            </div>
          </PanelSection>
        )
      })()}

      <PanelSection title="安裝">
        <PanelField label="發射功率" hint={`上限 ${maxTxForBand} dBm`}>
          <NumberInput
            value={ap.txPower}
            min={0}
            max={maxTxForBand}
            step={1}
            unit="dBm"
            width={70}
            onChange={(v) => handleNumber('txPower', v)}
          />
        </PanelField>
        <PanelField label="安裝高度">
          <NumberInput
            value={ap.z}
            min={0}
            step={0.1}
            unit="m"
            width={70}
            onChange={(v) => handleNumber('z', v)}
          />
        </PanelField>
        <PanelField label="安裝方式">
          <div className="ap-panel__pill-row" style={{ flex: 1 }}>
            {MOUNT_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`ap-panel__pill${ap.mountType === o.value ? ' ap-panel__pill--active' : ''}`}
                onClick={() => updateAP(floorId, apId, { mountType: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </PanelField>
      </PanelSection>

      <PanelSection title="天線模式">
        <div className="ap-panel__pill-row">
          {ANTENNA_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`ap-panel__pill${ap.antennaMode === o.value ? ' ap-panel__pill--active' : ''}`}
              onClick={() => handleAntennaMode(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>

        {(ap.antennaMode === 'directional' || ap.antennaMode === 'custom') && (() => {
          const rawAz = ap.azimuth ?? DEFAULT_AZIMUTH
          const effAz = wrapAzimuth(rawAz)
          const azChanged = effAz !== rawAz
          return (
            <>
              <PanelField
                label="方位角"
                hint={azChanged ? `實際 ${effAz}°` : '0°=右，順時針'}
              >
                <NumberInput
                  value={rawAz}
                  step={1}
                  unit="度"
                  width={70}
                  onChange={(v) => { if (!isNaN(v)) updateAP(floorId, apId, { azimuth: v }) }}
                />
              </PanelField>

              {ap.antennaMode === 'directional' && (() => {
                const rawBw = ap.beamwidth ?? DEFAULT_BEAMWIDTH
                const effBw = clampBeamwidth(rawBw)
                const bwChanged = effBw !== rawBw
                return (
                  <PanelField
                    label="波瓣寬度"
                    hint={bwChanged ? `實際 ${effBw}°` : `HPBW，${MIN_BEAMWIDTH}~${MAX_BEAMWIDTH}`}
                  >
                    <NumberInput
                      value={rawBw}
                      step={5}
                      unit="度"
                      width={70}
                      onChange={(v) => { if (!isNaN(v)) updateAP(floorId, apId, { beamwidth: v }) }}
                    />
                  </PanelField>
                )
              })()}

              {ap.antennaMode === 'custom' && (() => {
                const pattern = getPatternById(ap.patternId ?? DEFAULT_PATTERN_ID)
                return (
                  <>
                    <PanelField label="Pattern">
                      <Select
                        value={pattern.id}
                        onChange={(v) => updateAP(floorId, apId, { patternId: v })}
                        options={ANTENNA_PATTERN_LIST.map((p) => ({ value: p.id, label: p.label }))}
                      />
                    </PanelField>
                    <div className="ap-panel__hint">{pattern.description}</div>
                    <div className="ap-panel__pattern-preview">
                      <PatternPreview pattern={pattern} color={freqColor} azimuth={effAz} />
                    </div>
                  </>
                )
              })()}
            </>
          )
        })()}
      </PanelSection>

      {route && (
        <PanelSection title="狀態 / 線纜">
          {route.routeStatus === 'unroutable' ? (
            <div className="ap-panel__hint" style={{ color: '#ef4444' }}>
              ⚠ 同樓層沒有 Switch，AP 無法接線
            </div>
          ) : (
            <>
              <PanelField label="目標 Switch">
                {(() => {
                  for (const list of Object.values(switchesByFloor)) {
                    const sw = (list ?? []).find((s) => s.id === route.switchId)
                    if (sw) return sw.name
                  }
                  return '—'
                })()}
              </PanelField>
              <PanelField
                label="線長"
                hint={route.cableM != null ? `Z drop ${route.zDropM.toFixed(2)} m，含 20% slack` : null}
              >
                {route.cableM != null ? `${route.cableM.toFixed(2)} m` : '需先校正比例尺'}
              </PanelField>
              <PanelField label="狀態">
                {route.routeStatus === 'tray' ? '沿 Cable Tray' : 'fallback Manhattan'}
              </PanelField>
            </>
          )}
        </PanelSection>
      )}
    </PanelShell>
  )
}

export default APPanel

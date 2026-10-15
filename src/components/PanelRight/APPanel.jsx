import React, { useCallback, useMemo, useRef } from 'react'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useFloorStore, MAX_FLOOR_HEIGHT_M, DEFAULT_FLOOR_HEIGHT_M } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import { getCachedRoutes } from '@/features/cable/routesCache'
import { AP_MODEL_LIST, DEFAULT_AP_MODEL_ID, getAPModelById } from '@/constants/apModels'
import { ANTENNA_PATTERN_LIST, DEFAULT_PATTERN_ID, getPatternById, buildDirectionalPattern } from '@/constants/antennaPatterns'
import { channelEntries, isChannelAllowed, getDomain } from '@/constants/regulatoryDomains'
import { resolveApRadiation } from '@/features/heatmap/apRadiation'
import { assignNewRadioChannels } from '@/features/heatmap/channelNeighbors'
import { CHANNEL_WIDTHS, DEFAULT_CHANNEL_WIDTH, allowedWidthsForBand } from '@/constants/channelWidths'
import { apRadios, radiosForModel, patchRadio, radioView, highestEnabledBand, DEFAULT_CHANNEL_BY_BAND } from '@/utils/apRadios'
import PatternPreview3D from './PatternPreview3D'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { TextInput, NumberInput, Select, Checkbox } from './_shared/PanelControls'
import { wrapAzimuth } from '@/utils/angle'
import { tiltPatchForModeChange, tiltPatchForMountChange } from '@/utils/apMount'
import './_shared/shared.sass'
import './APPanel.sass'

const FREQ_OPTIONS = [
  { value: 2.4, label: '2.4 GHz', color: '#f39c12' },
  { value: 5,   label: '5 GHz',   color: '#4fc3f7' },
  { value: 6,   label: '6 GHz',   color: '#a855f7' },
]
const bandColor = (band) => FREQ_OPTIONS.find((f) => f.value === band)?.color ?? '#4fc3f7'
const NO_RADIO_COLOR = '#9aa3ad'

const ANTENNA_OPTIONS = [
  { value: 'omni',        label: '全向' },
  { value: 'directional', label: '定向' },
  { value: 'custom',      label: '自訂' },
]

const DEFAULT_AZIMUTH   = 0
const DEFAULT_BEAMWIDTH = 60
const MIN_BEAMWIDTH     = 10
const MAX_BEAMWIDTH     = 180
const DEFAULT_TILT      = 0
const MIN_TILT          = -90
const MAX_TILT          = 90
const clampTilt = (v) => Math.max(MIN_TILT, Math.min(MAX_TILT, v))

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

  // 52-B4: an AP can sit at most at its own floor's ceiling.
  const maxMountHeight = useMemo(() => {
    const f = floors.find((x) => x.id === floorId)
    return Math.min(f?.floorHeight ?? DEFAULT_FLOOR_HEIGHT_M, MAX_FLOOR_HEIGHT_M)
  }, [floors, floorId])

  const route = useMemo(() => {
    const { routes } = getCachedRoutes({ floors, apsByFloor, switchesByFloor, traysByFloor, risers })
    return routes.get(apId)
  }, [floors, apsByFloor, switchesByFloor, traysByFloor, risers, apId])

  const model = getAPModelById(ap?.modelId ?? DEFAULT_AP_MODEL_ID)

  // 58-15: TX floor per band = min(0, lowest TX seen while this AP is
  // selected). It only moves down, so a stray keystroke or spinner step
  // above a negative auto-power value can still be undone.
  const txFloorRef = useRef({ apId: null, byBand: {} })
  if (txFloorRef.current.apId !== apId) txFloorRef.current = { apId, byBand: {} }
  const txFloor = (band, cur) => {
    const f = Math.min(0, cur ?? 0, txFloorRef.current.byBand[band] ?? 0)
    txFloorRef.current.byBand[band] = f
    return f
  }

  // 58: a model change rebuilds the radio list -- kept bands keep their
  // settings (TX clamped to the new model), new bands get defaults.
  // 58-9: radios of newly supported bands get channels like a placed AP's.
  const handleModel = useCallback((modelId) => {
    let radios = radiosForModel(modelId, apRadios(ap), domainId)
    if (useEditorStore.getState().autoChannelOnPlace) {
      const prev = useAPStore.getState().apsByFloor[floorId] ?? []
      const next = prev.map((a) => (a.id === apId ? { ...a, modelId, radios } : a))
      radios = assignNewRadioChannels(floorId, next, prev, domainId).find((a) => a.id === apId)?.radios ?? radios
    }
    updateAP(floorId, apId, { modelId, radios })
  }, [floorId, apId, ap, updateAP, domainId])

  const handleField = useCallback((field, value) => {
    updateAP(floorId, apId, { [field]: value })
  }, [floorId, apId, updateAP])

  // 58: per-radio edits.
  const handleRadio = useCallback((band, patch) => {
    updateAP(floorId, apId, { radios: patchRadio(ap, band, patch) })
  }, [floorId, apId, ap, updateAP])

  const handleRadioTx = useCallback((band, num) => {
    if (isNaN(num)) return
    // 53-G10 (P3-21): clamp instead of rejecting so the displayed value and
    // the stored value always agree. 58-15: the floor is min(0, current) so a
    // negative TX set by auto power (high-gain antenna) stays editable.
    const curTx = apRadios(ap).find((r) => r.band === band)?.txPower
    const minTx = txFloor(band, curTx)
    if (num < minTx) num = minTx
    const maxTx = model.maxTxPower[band] ?? 23
    const txPower = Math.min(num, maxTx)
    // A clamp back to the stored value is a no-op -- no store write, so no
    // empty undo step (the controlled input re-shows the stored value).
    if (txPower === curTx) return
    handleRadio(band, { txPower })
  }, [ap, model, handleRadio])

  const handleNumber = useCallback((field, num) => {
    if (isNaN(num)) return
    if (num < 0) num = 0
    if (field === 'z') {
      // 52-B4: the `max` prop is only a native attribute — typing bypasses it.
      // Bound by THIS floor's ceiling: an AP mounted above its own ceiling is
      // what made computeRoutes emit a kilometre-long drop into the BOM.
      updateAP(floorId, apId, { z: Math.min(num, maxMountHeight) })
    } else {
      updateAP(floorId, apId, { [field]: num })
    }
  }, [floorId, apId, updateAP, maxMountHeight])

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
    Object.assign(patch, tiltPatchForModeChange(ap, mode))   // 57-27
    updateAP(floorId, apId, patch)
  }, [floorId, apId, ap, updateAP])

  const clampBeamwidth = (v) => Math.max(MIN_BEAMWIDTH, Math.min(MAX_BEAMWIDTH, v))

  const handleDelete = () => {
    removeAP(floorId, apId)
    clearSelected()
  }

  if (!ap) return null

  const fmtDb = (v) => (Math.round(v * 10) / 10).toString()
  // 58-10: every radio off -> the 2D marker's grey (apsLayer FALLBACK_COLOR).
  const noRadio = highestEnabledBand(ap) == null
  const freqColor = noRadio ? NO_RADIO_COLOR : bandColor(highestEnabledBand(ap))
  const shaped = ap.antennaMode === 'directional' || ap.antennaMode === 'custom'

  return (
    <PanelShell accent="ap">
      <PanelHeader
        title={ap.name}
        meta={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: freqColor }} />
            AP 屬性{noRadio && ' · 無射頻'}
          </span>
        }
        onDelete={handleDelete}
      />

      <PanelSection title="識別">
        <PanelField label="型號">
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
          {/* 52-D9: an all-whitespace name left the AP with no identity —
              blank on the canvas label, blank in the panel header, and
              unidentifiable in the exported report. Revert on blur rather than
              block typing, so clearing the field to retype still works. */}
          <TextInput
            value={ap.name}
            onChange={(v) => handleField('name', v)}
            onBlur={() => {
              if (!ap.name || !ap.name.trim()) {
                updateAP(floorId, apId, { name: useAPStore.getState().nextAPName() })
              }
            }}
          />
        </PanelField>
      </PanelSection>

      {/* 58-14: 安裝 + 天線 (device fields) come before the radio sections, so
          the 峰值增益 rows that 天線模式 reveals appear below its control. */}
      <PanelSection title="安裝">
        <PanelField label="安裝高度">
          {/* 52-B4: cap at this floor's ceiling — an AP mounted at 999999 m
              feeds the same absurd cable-length estimate into the BOM that the
              floor height did. */}
          <NumberInput
            value={ap.z}
            min={0}
            max={maxMountHeight}
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
                onClick={() => updateAP(floorId, apId, { mountType: o.value, ...tiltPatchForMountChange(ap, o.value) })}
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

        {shaped && (() => {
          const rawAz = ap.azimuth ?? DEFAULT_AZIMUTH
          const effAz = wrapAzimuth(rawAz)
          const azChanged = effAz !== rawAz
          const rawTilt = ap.tilt ?? DEFAULT_TILT
          const effTilt = clampTilt(rawTilt)
          const tiltChanged = effTilt !== rawTilt
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

              <PanelField
                label="俯仰角"
                hint={tiltChanged ? `實際 ${effTilt}°` : '+上仰，−下俯'}
              >
                <NumberInput
                  value={rawTilt}
                  step={1}
                  unit="度"
                  width={70}
                  onChange={(v) => { if (!isNaN(v)) updateAP(floorId, apId, { tilt: clampTilt(v) }) }}
                />
              </PanelField>

              {ap.antennaMode === 'directional' && (() => {
                const rawBw = ap.beamwidth ?? DEFAULT_BEAMWIDTH
                const effBw = clampBeamwidth(rawBw)
                const bwChanged = effBw !== rawBw
                const pattern = buildDirectionalPattern(effBw)
                return (
                  <>
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
                    <div className="ap-panel__pattern-preview">
                      <PatternPreview3D
                        pattern={pattern}
                        color={freqColor}
                        azimuth={effAz}
                        tilt={effTilt}
                        onAzimuthChange={(deg) => updateAP(floorId, apId, { azimuth: deg })}
                        onTiltChange={(deg) => updateAP(floorId, apId, { tilt: clampTilt(deg) })}
                      />
                    </div>
                    <div className="ap-panel__hint">左右拖曳＝方位角、上下拖曳＝俯仰角（放開才套用）；Shift+上下＝觀察視角</div>
                  </>
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
                      <PatternPreview3D
                        pattern={pattern}
                        color={freqColor}
                        azimuth={effAz}
                        tilt={effTilt}
                        onAzimuthChange={(deg) => updateAP(floorId, apId, { azimuth: deg })}
                        onTiltChange={(deg) => updateAP(floorId, apId, { tilt: clampTilt(deg) })}
                      />
                    </div>
                    <div className="ap-panel__hint">左右拖曳＝方位角、上下拖曳＝俯仰角（放開才套用）；Shift+上下＝觀察視角</div>
                  </>
                )
              })()}
            </>
          )
        })()}
      </PanelSection>

      {/* 58: one section per radio of the model. */}
      {apRadios(ap).map((r, i, radios) => {
        const band = r.band
        const maxTx = model.maxTxPower[band] ?? 23
        // 57-23: peak gain + EIRP-capped TX, exactly what the heatmap uses.
        const rad = resolveApRadiation(radioView(ap, r), domainId)
        const entries = channelEntries(domainId, band)
        const curCh = r.channel ?? DEFAULT_CHANNEL_BY_BAND[band] ?? 1
        const curAllowed = isChannelAllowed(domainId, band, curCh)
        const chanOptions = []
        if (!curAllowed) chanOptions.push({ value: String(curCh), label: `Ch ${curCh}（不允許）` })
        for (const c of entries) {
          chanOptions.push({
            value: String(c.ch),
            label: `Ch ${c.ch}${c.dfs ? '（DFS）' : ''}${c.indoorOnly ? '（室內）' : ''}`,
          })
        }
        const allowedWidths = allowedWidthsForBand(band)
        const curWidth = r.channelWidth ?? DEFAULT_CHANNEL_WIDTH[band] ?? 20
        return (
          <PanelSection key={band} title={`${band}G 射頻`}>
            <PanelField label="啟用">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: bandColor(band) }} />
                <Checkbox checked={!!r.enabled} onChange={(v) => handleRadio(band, { enabled: v })} />
                {!r.enabled && <span className="ap-panel__hint">已關閉</span>}
              </span>
            </PanelField>
            {/* 58-14: an off radio keeps a one-line summary of the settings it
                comes back with. */}
            {!r.enabled && (
              <div className="ap-panel__hint">
                保留設定：CH {curCh}/{curWidth} · {r.txPower ?? '—'} dBm
              </div>
            )}
            {r.enabled && (
              <>
                <PanelField label={`頻道${!curAllowed ? '（當前國家不支援）' : ''}`}>
                  <Select
                    value={String(curCh)}
                    onChange={(v) => handleRadio(band, { channel: Number(v) })}
                    options={chanOptions}
                  />
                </PanelField>
                <PanelField label="頻寬">
                  <div className="ap-panel__pill-row" style={{ flex: 1 }}>
                    {CHANNEL_WIDTHS.map((w) => {
                      const supported = allowedWidths.includes(w)
                      const active = curWidth === w
                      return (
                        <button
                          key={w}
                          className={`ap-panel__pill${active ? ' ap-panel__pill--active' : ''}${supported ? '' : ' ap-panel__pill--disabled'}`}
                          onClick={() => supported && handleRadio(band, { channelWidth: w })}
                          disabled={!supported}
                          title={supported ? '' : `${band} GHz 不建議使用 ${w} MHz`}
                        >
                          {w}
                        </button>
                      )
                    })}
                  </div>
                </PanelField>
                <PanelField label="發射功率" hint={`上限 ${maxTx} dBm`}>
                  <NumberInput
                    value={r.txPower}
                    min={txFloor(band, r.txPower)}
                    max={maxTx}
                    step={1}
                    unit="dBm"
                    width={70}
                    onChange={(v) => handleRadioTx(band, v)}
                  />
                </PanelField>
                {shaped && (
                  <PanelField
                    label="峰值增益"
                    hint={`空白＝依方向圖自動 ${fmtDb(rad.autoPeakGainDbi)} dBi`}
                  >
                    <NumberInput
                      value={Number.isFinite(r.antennaPeakGainDbi) ? r.antennaPeakGainDbi : null}
                      placeholder={fmtDb(rad.autoPeakGainDbi)}
                      step={0.5}
                      unit="dBi"
                      width={70}
                      onChange={(v) => handleRadio(band, { antennaPeakGainDbi: isNaN(v) ? null : v })}
                    />
                  </PanelField>
                )}
                <div className="ap-panel__hint">
                  EIRP {fmtDb(rad.eirpDbm)} dBm
                  {rad.eirpLimitDbm != null && `（${getDomain(domainId).label}上限 ${fmtDb(rad.eirpLimitDbm)} dBm）`}
                </div>
                {rad.capped && (
                  <div className="ap-panel__hint" style={{ color: '#ef4444' }}>
                    ⚠ 超過法規 EIRP 上限，實際發射功率降為 {fmtDb(rad.txDbm)} dBm
                  </div>
                )}
              </>
            )}
            {/* 58-14: inside the last radio section so it takes the section's padding. */}
            {i === radios.length - 1 && (
              <div className="ap-panel__hint">
                Cisco 建議頻寬：2.4G 固定 20、5G 多用 20/40、6G 可開 80
              </div>
            )}
          </PanelSection>
        )
      })}

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
                hint={route.cableM != null ? `含垂直落線 ${route.zDropM.toFixed(2)} m 與 20% 預留餘量` : null}
              >
                {route.cableM != null ? `${route.cableM.toFixed(2)} m` : '需先校正比例尺'}
              </PanelField>
              <PanelField label="狀態">
                {route.routeStatus === 'tray' ? '沿線槽' : '直角走線（未沿線槽）'}
              </PanelField>
            </>
          )}
        </PanelSection>
      )}
    </PanelShell>
  )
}

export default APPanel

import React, { useCallback } from 'react'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'
import { AP_MODEL_LIST, DEFAULT_AP_MODEL_ID, getAPModelById } from '@/constants/apModels'
import { ANTENNA_PATTERN_LIST, DEFAULT_PATTERN_ID, getPatternById } from '@/constants/antennaPatterns'
import { channelEntries, isChannelAllowed, allowedChannels } from '@/constants/regulatoryDomains'
import { CHANNEL_WIDTHS, DEFAULT_CHANNEL_WIDTH, allowedWidthsForBand } from '@/constants/channelWidths'
import PatternPreview from './PatternPreview'
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

  const handleNumber = useCallback((field, raw) => {
    const num = parseFloat(raw)
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

  const handlePattern = useCallback((patternId) => {
    updateAP(floorId, apId, { patternId })
  }, [floorId, apId, updateAP])

  // Store raw user input; wrapping/clamping happens only for display and downstream use.
  const handleAzimuth = useCallback((raw) => {
    const num = parseFloat(raw)
    if (isNaN(num)) return
    updateAP(floorId, apId, { azimuth: num })
  }, [floorId, apId, updateAP])

  const handleBeamwidth = useCallback((raw) => {
    const num = parseFloat(raw)
    if (isNaN(num)) return
    updateAP(floorId, apId, { beamwidth: num })
  }, [floorId, apId, updateAP])

  const wrapAzimuth = (v) => (((v % 360) + 360) % 360)
  const clampBeamwidth = (v) => Math.max(MIN_BEAMWIDTH, Math.min(MAX_BEAMWIDTH, v))

  const handleDelete = () => {
    removeAP(floorId, apId)
    clearSelected()
  }

  if (!ap) return null

  const maxTxForBand = model.maxTxPower[ap.frequency] ?? 23

  return (
    <div className="ap-panel">
      <div className="ap-panel__header">
        <span className="ap-panel__title">AP 屬性</span>
        <span className="ap-panel__dot" style={{ background: FREQ_OPTIONS.find(f => f.value === ap.frequency)?.color ?? '#4fc3f7' }} />
        <button className="panel-delete-btn" onClick={handleDelete}>刪除</button>
      </div>

      {/* 型號 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">型號</p>
        <select
          className="ap-panel__input ap-panel__select"
          value={ap.modelId ?? DEFAULT_AP_MODEL_ID}
          onChange={(e) => handleModel(e.target.value)}
        >
          {AP_MODEL_LIST.map((m) => (
            <option key={m.id} value={m.id}>
              {m.vendor} {m.name} ({m.wifiGen})
            </option>
          ))}
        </select>
        <p className="ap-panel__hint">
          支援：{model.supportedBands.map((b) => `${b} GHz`).join(' / ')}　最大 {maxTxForBand} dBm
        </p>
      </section>

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
          {FREQ_OPTIONS.map((f) => {
            const supported = model.supportedBands.includes(f.value)
            const active = ap.frequency === f.value
            return (
              <button
                key={f.value}
                className={`ap-panel__btn${active ? ' ap-panel__btn--active' : ''}${supported ? '' : ' ap-panel__btn--disabled'}`}
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
      </section>

      {/* 頻道 */}
      {(() => {
        const entries = channelEntries(domainId, ap.frequency)
        const curCh = ap.channel ?? DEFAULT_CHANNEL[ap.frequency] ?? 1
        const curAllowed = isChannelAllowed(domainId, ap.frequency, curCh)
        return (
          <section className="ap-panel__section">
            <p className="ap-panel__label">
              頻道
              {!curAllowed && (
                <span className="ap-panel__hint-inline">（當前國家不支援）</span>
              )}
            </p>
            <select
              className="ap-panel__input ap-panel__select"
              value={curCh}
              onChange={(e) => handleField('channel', Number(e.target.value))}
            >
              {!curAllowed && (
                <option key={`cur-${curCh}`} value={curCh}>Ch {curCh}（不允許）</option>
              )}
              {entries.map((c) => (
                <option key={c.ch} value={c.ch}>
                  Ch {c.ch}
                  {c.dfs ? '（DFS）' : ''}
                  {c.indoorOnly ? '（室內）' : ''}
                </option>
              ))}
            </select>
          </section>
        )
      })()}

      {/* 頻寬 */}
      {(() => {
        const allowedWidths = allowedWidthsForBand(ap.frequency)
        const curWidth = ap.channelWidth ?? DEFAULT_CHANNEL_WIDTH[ap.frequency] ?? 20
        return (
          <section className="ap-panel__section">
            <p className="ap-panel__label">頻寬</p>
            <div className="ap-panel__btn-group">
              {CHANNEL_WIDTHS.map((w) => {
                const supported = allowedWidths.includes(w)
                const active = curWidth === w
                return (
                  <button
                    key={w}
                    className={`ap-panel__btn${active ? ' ap-panel__btn--active' : ''}${supported ? '' : ' ap-panel__btn--disabled'}`}
                    onClick={() => supported && handleField('channelWidth', w)}
                    disabled={!supported}
                    title={supported ? '' : `${ap.frequency} GHz 不建議使用 ${w} MHz`}
                  >
                    {w}
                  </button>
                )
              })}
            </div>
            <p className="ap-panel__hint">
              Cisco 建議：2.4G 固定 20、5G 多用 20/40、6G 可開 80
            </p>
          </section>
        )
      })()}

      {/* 發射功率 */}
      <section className="ap-panel__section">
        <p className="ap-panel__label">發射功率</p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            min="0"
            max={maxTxForBand}
            step="1"
            value={ap.txPower}
            onChange={(e) => handleNumber('txPower', e.target.value)}
          />
          <span className="ap-panel__unit">dBm（上限 {maxTxForBand}）</span>
        </div>
      </section>

      {/* 安裝高度 — 影響 3D 視覺與未來的樓板 / 穿透計算 */}
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

      {/* 安裝方式（3D 視圖開放後啟用） */}
      <section className="ap-panel__section ap-panel__section--disabled" title="3D 視圖開放後啟用">
        <p className="ap-panel__label">安裝方式 <span className="ap-panel__coming-soon">即將推出</span></p>
        <div className="ap-panel__btn-group">
          {MOUNT_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`ap-panel__btn${ap.mountType === o.value ? ' ap-panel__btn--active' : ''}`}
              disabled
            >
              {o.label}
            </button>
          ))}
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
              <p className="ap-panel__label" style={{ marginTop: 10 }}>
                方位角{azChanged ? (
                  <span className="ap-panel__hint-inline">（實際 {effAz}°）</span>
                ) : (
                  <span className="ap-panel__hint-inline">（0°=右，順時針）</span>
                )}
              </p>
              <div className="ap-panel__number-row">
                <input
                  className="ap-panel__input ap-panel__input--number"
                  type="number"
                  step="1"
                  value={rawAz}
                  onChange={(e) => handleAzimuth(e.target.value)}
                />
                <span className="ap-panel__unit">度</span>
              </div>

              {ap.antennaMode === 'directional' && (() => {
                const rawBw = ap.beamwidth ?? DEFAULT_BEAMWIDTH
                const effBw = clampBeamwidth(rawBw)
                const bwChanged = effBw !== rawBw
                return (
                  <>
                    <p className="ap-panel__label" style={{ marginTop: 10 }}>
                      波瓣寬度{bwChanged ? (
                        <span className="ap-panel__hint-inline">（實際 {effBw}°）</span>
                      ) : (
                        <span className="ap-panel__hint-inline">（HPBW，{MIN_BEAMWIDTH}~{MAX_BEAMWIDTH}）</span>
                      )}
                    </p>
                    <div className="ap-panel__number-row">
                      <input
                        className="ap-panel__input ap-panel__input--number"
                        type="number"
                        step="5"
                        value={rawBw}
                        onChange={(e) => handleBeamwidth(e.target.value)}
                      />
                      <span className="ap-panel__unit">度</span>
                    </div>
                  </>
                )
              })()}

              {ap.antennaMode === 'custom' && (() => {
                const pattern = getPatternById(ap.patternId ?? DEFAULT_PATTERN_ID)
                const color = FREQ_OPTIONS.find((f) => f.value === ap.frequency)?.color ?? '#4fc3f7'
                return (
                  <>
                    <p className="ap-panel__label" style={{ marginTop: 10 }}>Pattern</p>
                    <select
                      className="ap-panel__input ap-panel__select"
                      value={pattern.id}
                      onChange={(e) => handlePattern(e.target.value)}
                    >
                      {ANTENNA_PATTERN_LIST.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                    <p className="ap-panel__hint">{pattern.description}</p>
                    <div className="ap-panel__pattern-preview">
                      <PatternPreview pattern={pattern} color={color} azimuth={effAz} />
                    </div>
                  </>
                )
              })()}
            </>
          )
        })()}
      </section>

    </div>
  )
}

export default APPanel

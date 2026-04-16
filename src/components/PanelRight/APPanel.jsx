import React, { useCallback } from 'react'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'
import { AP_MODEL_LIST, DEFAULT_AP_MODEL_ID, getAPModelById } from '@/constants/apModels'
import { ANTENNA_PATTERN_LIST, DEFAULT_PATTERN_ID, getPatternById } from '@/constants/antennaPatterns'
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
  { value: 'custom',      label: '自訂' },
]

const DEFAULT_AZIMUTH   = 0
const DEFAULT_BEAMWIDTH = 60
const MIN_BEAMWIDTH     = 10
const MAX_BEAMWIDTH     = 180

// Polar preview of a custom antenna pattern. 36 dB samples → normalized radius.
// Orientation: index 0 points right (+x), matching our azimuth convention.
function PatternPreview({ pattern, color, azimuth = 0 }) {
  const size = 96
  const cx = size / 2
  const cy = size / 2
  const maxR = 38
  const minDb = -30
  const samples = pattern.samples
  const n = samples.length
  const pts = []
  for (let i = 0; i < n; i++) {
    const db = Math.max(samples[i], minDb)
    const r = ((db - minDb) / -minDb) * maxR
    const angDeg = i * (360 / n) + azimuth
    const ang = angDeg * Math.PI / 180
    pts.push(`${(cx + r * Math.cos(ang)).toFixed(2)},${(cy + r * Math.sin(ang)).toFixed(2)}`)
  }
  return (
    <svg width={size} height={size} className="ap-panel__pattern-svg">
      {/* -10/-20 dB rings */}
      {[(1/3) * maxR, (2/3) * maxR, maxR].map((r, i) => (
        <circle key={r} cx={cx} cy={cy} r={r} fill="none"
          stroke={i === 2 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'}
          strokeDasharray={i === 2 ? '' : '2 3'} strokeWidth="1" />
      ))}
      {/* crosshair */}
      <line x1={cx - maxR} y1={cy} x2={cx + maxR} y2={cy} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <line x1={cx} y1={cy - maxR} x2={cx} y2={cy + maxR} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      {/* pattern polygon */}
      <polygon points={pts.join(' ')} fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.5" />
      {/* bore-sight arrow */}
      <line
        x1={cx} y1={cy}
        x2={cx + maxR * Math.cos(azimuth * Math.PI / 180)}
        y2={cy + maxR * Math.sin(azimuth * Math.PI / 180)}
        stroke={color} strokeWidth="1.5" strokeDasharray="3 2"
      />
    </svg>
  )
}

const MOUNT_OPTIONS = [
  { value: 'ceiling', label: '天花板' },
  { value: 'wall',    label: '牆面' },
]

function APPanel({ floorId, apId }) {
  const ap          = useAPStore((s) => (s.apsByFloor[floorId] ?? []).find((a) => a.id === apId))
  const updateAP    = useAPStore((s) => s.updateAP)
  const removeAP    = useAPStore((s) => s.removeAP)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const model = getAPModelById(ap?.modelId ?? DEFAULT_AP_MODEL_ID)

  const handleModel = useCallback((modelId) => {
    const newModel = getAPModelById(modelId)
    const patch = { modelId }
    // If current frequency unsupported, switch to first supported band.
    const freq = ap.frequency
    const bandOk = newModel.supportedBands.includes(freq)
    const targetFreq = bandOk ? freq : newModel.supportedBands[0]
    if (!bandOk) {
      patch.frequency = targetFreq
      patch.channel = DEFAULT_CHANNEL[targetFreq] ?? 1
    }
    // Clamp txPower to new model's max for the target band.
    const maxTx = newModel.maxTxPower[targetFreq] ?? 23
    if (ap.txPower > maxTx) patch.txPower = maxTx
    updateAP(floorId, apId, patch)
  }, [floorId, apId, ap, updateAP])

  const handleField = useCallback((field, value) => {
    if (field === 'frequency') {
      if (!model.supportedBands.includes(value)) return
      const maxTx = model.maxTxPower[value] ?? 23
      const patch = { frequency: value, channel: DEFAULT_CHANNEL[value] ?? 1 }
      if (ap.txPower > maxTx) patch.txPower = maxTx
      updateAP(floorId, apId, patch)
    } else {
      updateAP(floorId, apId, { [field]: value })
    }
  }, [floorId, apId, ap, updateAP, model])

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
            max={maxTxForBand}
            step="1"
            value={ap.txPower}
            onChange={(e) => handleNumber('txPower', e.target.value)}
          />
          <span className="ap-panel__unit">dBm（上限 {maxTxForBand}）</span>
        </div>
      </section>

      {/* 安裝高度（3D 視圖開放後啟用） */}
      <section className="ap-panel__section ap-panel__section--disabled" title="3D 視圖開放後啟用">
        <p className="ap-panel__label">安裝高度 <span className="ap-panel__coming-soon">即將推出</span></p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number"
            type="number"
            value={ap.z}
            disabled
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

      <button className="ap-panel__delete" onClick={handleDelete}>
        刪除 AP
      </button>
    </div>
  )
}

export default APPanel

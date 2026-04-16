import React, { useCallback } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useFloorStore } from '@/store/useFloorStore'
import { MATERIAL_LIST } from '@/constants/materials'
import { AP_MODEL_LIST, getAPModelById } from '@/constants/apModels'
import { ANTENNA_PATTERN_LIST, getPatternById, DEFAULT_PATTERN_ID } from '@/constants/antennaPatterns'
import { allowedChannels, channelEntries } from '@/constants/regulatoryDomains'
import PatternPreview from './PatternPreview'
import './BatchPanel.sass'

const FREQ_OPTIONS = [
  { value: 2.4, label: '2.4 GHz', color: '#f39c12' },
  { value: 5,   label: '5 GHz',   color: '#4fc3f7' },
  { value: 6,   label: '6 GHz',   color: '#a855f7' },
]

const ANTENNA_OPTIONS = [
  { value: 'omni',        label: '全向' },
  { value: 'directional', label: '定向' },
  { value: 'custom',      label: '自訂' },
]

const MOUNT_OPTIONS = [
  { value: 'ceiling', label: '天花板' },
  { value: 'wall',    label: '牆面' },
]

const DEFAULT_CHANNEL = { 2.4: 1, 5: 36, 6: 1 }
const MIXED = '__mixed__'
const MIN_BEAMWIDTH = 10
const MAX_BEAMWIDTH = 180

const wrapAzimuth = (v) => (((v % 360) + 360) % 360)
const clampBeamwidth = (v) => Math.max(MIN_BEAMWIDTH, Math.min(MAX_BEAMWIDTH, v))

// If all items share the same value for `field`, return that value; otherwise MIXED.
function uniformValue(items, field) {
  if (items.length === 0) return null
  const first = items[0][field]
  return items.every((it) => it[field] === first) ? first : MIXED
}

function BatchPanel() {
  const selectedItems = useEditorStore((s) => s.selectedItems)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  const domainId      = useEditorStore((s) => s.regulatoryDomain)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)

  const removeWalls      = useWallStore((s) => s.removeWalls)
  const updateWalls      = useWallStore((s) => s.updateWalls)
  const aps              = useAPStore((s) => s.apsByFloor[activeFloorId] ?? [])
  const removeAPs        = useAPStore((s) => s.removeAPs)
  const updateAPs        = useAPStore((s) => s.updateAPs)
  const scopes           = useScopeStore((s) => s.scopesByFloor[activeFloorId] ?? [])
  const removeScopes     = useScopeStore((s) => s.removeScopes)
  const updateScopes     = useScopeStore((s) => s.updateScopes)
  const removeFloorHoles = useFloorHoleStore((s) => s.removeFloorHoles)

  const wallIds  = selectedItems.filter((it) => it.type === 'wall').map((it) => it.id)
  const apIds    = selectedItems.filter((it) => it.type === 'ap').map((it) => it.id)
  const scopeIds = selectedItems.filter((it) => it.type === 'scope').map((it) => it.id)
  const holeIds  = selectedItems.filter((it) => it.type === 'floor_hole').map((it) => it.id)

  // Only expose per-type editing when the selection is homogeneous —
  // mixed selections only keep the summary + delete to avoid accidental cross-type edits.
  const typesPresent = [wallIds.length > 0, apIds.length > 0, scopeIds.length > 0, holeIds.length > 0].filter(Boolean).length
  const isHomogeneous = typesPresent === 1
  const showWallFields  = isHomogeneous && wallIds.length > 0
  const showAPFields    = isHomogeneous && apIds.length > 0
  const showScopeFields = isHomogeneous && scopeIds.length > 0

  // Resolve selected objects for "mixed value" detection in dropdowns.
  const selectedAPs = aps.filter((a) => apIds.includes(a.id))
  const apFreq     = uniformValue(selectedAPs, 'frequency')
  const apChannel  = uniformValue(selectedAPs, 'channel')
  const apMode     = uniformValue(selectedAPs, 'antennaMode')
  const apModel    = uniformValue(selectedAPs, 'modelId')
  const apTxPower  = uniformValue(selectedAPs, 'txPower')
  const apAzimuth  = uniformValue(selectedAPs, 'azimuth')
  const apBeam     = uniformValue(selectedAPs, 'beamwidth')
  const apPattern  = uniformValue(selectedAPs, 'patternId')

  const selectedScopes = scopes.filter((z) => scopeIds.includes(z.id))
  const scopeType      = uniformValue(selectedScopes, 'type')

  const handleDeleteAll = useCallback(() => {
    if (wallIds.length)  removeWalls(activeFloorId, wallIds)
    if (apIds.length)    removeAPs(activeFloorId, apIds)
    if (scopeIds.length) removeScopes(activeFloorId, scopeIds)
    if (holeIds.length)  removeFloorHoles(activeFloorId, holeIds)
    clearSelected()
  }, [activeFloorId, wallIds, apIds, scopeIds, holeIds, removeWalls, removeAPs, removeScopes, removeFloorHoles, clearSelected])

  const handleWallMaterial = useCallback((mat) => {
    updateWalls(activeFloorId, wallIds, { material: mat })
  }, [activeFloorId, wallIds, updateWalls])

  const handleScopeType = useCallback((type) => {
    updateScopes(activeFloorId, scopeIds, { type })
  }, [activeFloorId, scopeIds, updateScopes])

  const handleAPFrequency = useCallback((freq) => {
    const allowed = allowedChannels(domainId, freq)
    const ch = allowed[0] ?? DEFAULT_CHANNEL[freq] ?? 1
    updateAPs(activeFloorId, apIds, { frequency: freq, channel: ch })
  }, [activeFloorId, apIds, updateAPs, domainId])

  const handleAPChannel = useCallback((raw) => {
    if (raw === MIXED || raw === '') return
    updateAPs(activeFloorId, apIds, { channel: Number(raw) })
  }, [activeFloorId, apIds, updateAPs])

  const handleAPAntennaMode = useCallback((mode) => {
    // Patch per-AP with mode-specific defaults if missing.
    selectedAPs.forEach((a) => {
      const patch = { antennaMode: mode }
      if ((mode === 'directional' || mode === 'custom') && a.azimuth == null) patch.azimuth = 0
      if (mode === 'directional' && a.beamwidth == null) patch.beamwidth = 60
      if (mode === 'custom' && a.patternId == null) patch.patternId = 'patch'
      updateAPs(activeFloorId, [a.id], patch)
    })
  }, [activeFloorId, selectedAPs, updateAPs])

  const handleAPModel = useCallback((modelId) => {
    if (modelId === MIXED || modelId === '') return
    const newModel = getAPModelById(modelId)
    // Per-AP patch: clamp txPower to the new model's max for each AP's band,
    // and switch band+channel when the AP's current band isn't supported.
    selectedAPs.forEach((a) => {
      const patch = { modelId }
      const bandOk = newModel.supportedBands.includes(a.frequency)
      const targetFreq = bandOk ? a.frequency : newModel.supportedBands[0]
      if (!bandOk) {
        patch.frequency = targetFreq
        const allowed = allowedChannels(domainId, targetFreq)
        patch.channel = allowed[0] ?? DEFAULT_CHANNEL[targetFreq] ?? 1
      }
      const maxTx = newModel.maxTxPower[targetFreq] ?? 23
      if (a.txPower > maxTx) patch.txPower = maxTx
      updateAPs(activeFloorId, [a.id], patch)
    })
  }, [activeFloorId, selectedAPs, updateAPs, domainId])

  const handleAPTxPower = useCallback((raw) => {
    const num = parseFloat(raw)
    if (!isNaN(num) && num >= 0) updateAPs(activeFloorId, apIds, { txPower: num })
  }, [activeFloorId, apIds, updateAPs])

  const handleAPAzimuth = useCallback((raw) => {
    const num = parseFloat(raw)
    if (isNaN(num)) return
    updateAPs(activeFloorId, apIds, { azimuth: num })
  }, [activeFloorId, apIds, updateAPs])

  const handleAPBeamwidth = useCallback((raw) => {
    const num = parseFloat(raw)
    if (isNaN(num)) return
    updateAPs(activeFloorId, apIds, { beamwidth: num })
  }, [activeFloorId, apIds, updateAPs])

  const handleAPPattern = useCallback((patternId) => {
    if (patternId === MIXED || patternId === '') return
    updateAPs(activeFloorId, apIds, { patternId })
  }, [activeFloorId, apIds, updateAPs])

  // Channel section: disabled when APs span multiple bands (they share one dropdown).
  const channelEntriesForBand = apFreq && apFreq !== MIXED
    ? channelEntries(domainId, apFreq)
    : []

  return (
    <div className="batch-panel">
      <div className="batch-panel__header">
        <span className="batch-panel__title">批次選取</span>
        <span className="batch-panel__count">{selectedItems.length} 個物件</span>
        <button className="panel-delete-btn" onClick={handleDeleteAll}>刪除</button>
      </div>

      {/* 摘要 */}
      <section className="batch-panel__section">
        <p className="batch-panel__label">已選取</p>
        <div className="batch-panel__summary">
          {wallIds.length > 0 && <span className="batch-panel__chip batch-panel__chip--wall">{wallIds.length} 牆體</span>}
          {apIds.length > 0 && <span className="batch-panel__chip batch-panel__chip--ap">{apIds.length} AP</span>}
          {scopeIds.length > 0 && <span className="batch-panel__chip batch-panel__chip--scope">{scopeIds.length} 熱圖範圍</span>}
          {holeIds.length > 0 && <span className="batch-panel__chip batch-panel__chip--hole">{holeIds.length} 中庭</span>}
        </div>
      </section>

      {/* 混合類型：不提供批次欄位，避免跨類型誤改 */}
      {!isHomogeneous && (
        <section className="batch-panel__section">
          <p className="batch-panel__hint-block">
            混合類型選取：僅支援刪除。若需批次編輯屬性，請只選同一類物件。
          </p>
        </section>
      )}

      {/* 牆體批次修改材質 */}
      {showWallFields && (
        <>
          <section className="batch-panel__section">
            <p className="batch-panel__label">牆體材質（批次變更）</p>
            <div className="batch-panel__materials">
              {MATERIAL_LIST.map((mat) => (
                <button
                  key={mat.id}
                  className="batch-panel__mat-btn"
                  onClick={() => handleWallMaterial(mat)}
                  title={`${mat.label}（${mat.dbLoss} dB）`}
                >
                  <span className="batch-panel__mat-color" style={{ background: mat.color }} />
                  <span className="batch-panel__mat-name">{mat.label}</span>
                  <span className="batch-panel__mat-db">{mat.dbLoss} dB</span>
                </button>
              ))}
            </div>
          </section>

          {/* 牆體高度（3D 視圖開放後啟用，與 WallPanel 一致） */}
          <section className="batch-panel__section batch-panel__section--disabled" title="3D 視圖開放後啟用">
            <p className="batch-panel__label">
              牆體高度（批次變更）
              <span className="batch-panel__coming-soon">即將推出</span>
            </p>
            <div className="batch-panel__height-row">
              <label className="batch-panel__height-field">
                <span>頂部</span>
                <input type="number" disabled />
                <span>m</span>
              </label>
              <label className="batch-panel__height-field">
                <span>底部</span>
                <input type="number" disabled />
                <span>m</span>
              </label>
            </div>
          </section>
        </>
      )}

      {/* AP 批次 */}
      {showAPFields && (
        <>
          {/* 型號 */}
          {(() => {
            const currentModel = apModel && apModel !== MIXED ? getAPModelById(apModel) : null
            return (
              <section className="batch-panel__section">
                <p className="batch-panel__label">AP 型號（批次變更）</p>
                <select
                  className="batch-panel__input batch-panel__select"
                  value={apModel === MIXED ? MIXED : (apModel ?? '')}
                  onChange={(e) => handleAPModel(e.target.value)}
                >
                  {apModel === MIXED && <option value={MIXED}>— 多個值 —</option>}
                  {AP_MODEL_LIST.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.vendor} {m.name}（{m.supportedBands.map((b) => `${b}G`).join('/')}）
                    </option>
                  ))}
                </select>
                {currentModel && (
                  <p className="batch-panel__hint-block">
                    支援：{currentModel.supportedBands.map((b) => `${b} GHz`).join(' / ')}
                  </p>
                )}
                {apModel === MIXED && (
                  <p className="batch-panel__hint-block">切換型號時，若原頻段不支援會自動改為首個支援頻段，並 clamp 發射功率</p>
                )}
              </section>
            )
          })()}

          {/* 頻段 */}
          <section className="batch-panel__section">
            <p className="batch-panel__label">AP 頻段（批次變更）</p>
            <div className="batch-panel__btn-group">
              {FREQ_OPTIONS.map((f) => {
                const active = apFreq === f.value
                return (
                  <button
                    key={f.value}
                    className={`batch-panel__btn${active ? ' batch-panel__btn--active' : ''}`}
                    style={active ? { borderColor: f.color, color: f.color } : {}}
                    onClick={() => handleAPFrequency(f.value)}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          </section>

          {/* 頻道 */}
          <section className="batch-panel__section">
            <p className="batch-panel__label">
              AP 頻道（批次變更）
              {apFreq === MIXED && <span className="batch-panel__hint">所選 AP 頻段不一致，請先統一</span>}
            </p>
            <select
              className="batch-panel__input batch-panel__select"
              value={apChannel === MIXED ? MIXED : (apChannel ?? '')}
              onChange={(e) => handleAPChannel(e.target.value)}
              disabled={apFreq === MIXED}
            >
              {apChannel === MIXED && <option value={MIXED}>— 多個值 —</option>}
              {channelEntriesForBand.map((c) => (
                <option key={c.ch} value={c.ch}>
                  Ch {c.ch}{c.dfs ? '（DFS）' : ''}{c.indoorOnly ? '（室內）' : ''}
                </option>
              ))}
            </select>
          </section>

          {/* 發射功率 */}
          <section className="batch-panel__section">
            <p className="batch-panel__label">
              AP 發射功率（批次變更）
              {apTxPower === MIXED && <span className="batch-panel__hint">多個值</span>}
            </p>
            <div className="batch-panel__number-row">
              <input
                className="batch-panel__input"
                type="number"
                min="0"
                max="33"
                step="1"
                defaultValue={apTxPower === MIXED ? '' : (apTxPower ?? '')}
                key={`tx-${apTxPower}`}
                placeholder={apTxPower === MIXED ? '多個值，Enter 套用' : ''}
                onBlur={(e) => e.target.value !== '' && handleAPTxPower(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value !== '') handleAPTxPower(e.target.value) }}
              />
              <span className="batch-panel__unit">dBm</span>
            </div>
          </section>

          {/* 安裝高度（3D 視圖開放後啟用） */}
          <section className="batch-panel__section batch-panel__section--disabled" title="3D 視圖開放後啟用">
            <p className="batch-panel__label">
              安裝高度（批次變更）
              <span className="batch-panel__coming-soon">即將推出</span>
            </p>
            <div className="batch-panel__number-row">
              <input className="batch-panel__input" type="number" disabled />
              <span className="batch-panel__unit">m</span>
            </div>
          </section>

          {/* 安裝方式（3D 視圖開放後啟用） */}
          <section className="batch-panel__section batch-panel__section--disabled" title="3D 視圖開放後啟用">
            <p className="batch-panel__label">
              安裝方式（批次變更）
              <span className="batch-panel__coming-soon">即將推出</span>
            </p>
            <div className="batch-panel__btn-group">
              {MOUNT_OPTIONS.map((o) => (
                <button key={o.value} className="batch-panel__btn" disabled>
                  {o.label}
                </button>
              ))}
            </div>
          </section>

          {/* 天線模式 */}
          <section className="batch-panel__section">
            <p className="batch-panel__label">
              天線模式（批次變更）
              {apMode === MIXED && <span className="batch-panel__hint">多個值</span>}
            </p>
            <div className="batch-panel__btn-group">
              {ANTENNA_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`batch-panel__btn${apMode === o.value ? ' batch-panel__btn--active' : ''}`}
                  onClick={() => handleAPAntennaMode(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {/* 細項：只有當所有 AP 都是相同的 directional / custom 模式時才開放。
                跨模式批次的意義不大，強行顯示容易誤操作。 */}
            {(apMode === 'directional' || apMode === 'custom') && (() => {
              // Raw uniform value or null when mixed; compute effective value for hint display.
              const rawAz = apAzimuth === MIXED ? null : (apAzimuth ?? 0)
              const effAz = rawAz == null ? null : wrapAzimuth(rawAz)
              const azChanged = rawAz != null && effAz !== rawAz
              const rawBw = apBeam === MIXED ? null : (apBeam ?? 60)
              const effBw = rawBw == null ? null : clampBeamwidth(rawBw)
              const bwChanged = rawBw != null && effBw !== rawBw
              return (
                <>
                  <p className="batch-panel__label" style={{ marginTop: 10 }}>
                    方位角
                    {apAzimuth === MIXED ? (
                      <span className="batch-panel__hint">多個值</span>
                    ) : azChanged ? (
                      <span className="batch-panel__hint">（實際 {effAz}°）</span>
                    ) : (
                      <span className="batch-panel__hint">（0°=右，順時針）</span>
                    )}
                  </p>
                  <div className="batch-panel__number-row">
                    <input
                      className="batch-panel__input"
                      type="number"
                      step="1"
                      defaultValue={apAzimuth === MIXED ? '' : (apAzimuth ?? 0)}
                      key={`az-${apAzimuth}`}
                      placeholder={apAzimuth === MIXED ? '多個值，Enter 套用' : ''}
                      onBlur={(e) => e.target.value !== '' && handleAPAzimuth(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value !== '') handleAPAzimuth(e.target.value) }}
                    />
                    <span className="batch-panel__unit">度</span>
                  </div>

                  {apMode === 'directional' && (
                    <>
                      <p className="batch-panel__label" style={{ marginTop: 10 }}>
                        波瓣寬度
                        {apBeam === MIXED ? (
                          <span className="batch-panel__hint">多個值</span>
                        ) : bwChanged ? (
                          <span className="batch-panel__hint">（實際 {effBw}°）</span>
                        ) : (
                          <span className="batch-panel__hint">（HPBW，{MIN_BEAMWIDTH}~{MAX_BEAMWIDTH}）</span>
                        )}
                      </p>
                      <div className="batch-panel__number-row">
                        <input
                          className="batch-panel__input"
                          type="number"
                          step="5"
                          defaultValue={apBeam === MIXED ? '' : (apBeam ?? 60)}
                          key={`bw-${apBeam}`}
                          placeholder={apBeam === MIXED ? '多個值，Enter 套用' : ''}
                          onBlur={(e) => e.target.value !== '' && handleAPBeamwidth(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value !== '') handleAPBeamwidth(e.target.value) }}
                        />
                        <span className="batch-panel__unit">度</span>
                      </div>
                    </>
                  )}

                  {apMode === 'custom' && (() => {
                    const previewPatternId = apPattern === MIXED ? null : (apPattern ?? DEFAULT_PATTERN_ID)
                    const previewPattern = previewPatternId ? getPatternById(previewPatternId) : null
                    // Use first AP's band color when uniform, else neutral.
                    const freqColor = apFreq === 2.4 ? '#f39c12'
                      : apFreq === 5 ? '#4fc3f7'
                      : apFreq === 6 ? '#a855f7'
                      : '#4fc3f7'
                    const previewAz = apAzimuth === MIXED ? 0 : wrapAzimuth(apAzimuth ?? 0)
                    return (
                      <>
                        <p className="batch-panel__label" style={{ marginTop: 10 }}>
                          Pattern{apPattern === MIXED && <span className="batch-panel__hint">多個值</span>}
                        </p>
                        <select
                          className="batch-panel__input batch-panel__select"
                          value={apPattern === MIXED ? MIXED : (apPattern ?? '')}
                          onChange={(e) => handleAPPattern(e.target.value)}
                        >
                          {apPattern === MIXED && <option value={MIXED}>— 多個值 —</option>}
                          {ANTENNA_PATTERN_LIST.map((p) => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                          ))}
                        </select>
                        {previewPattern && (
                          <>
                            <p className="batch-panel__hint-block">{previewPattern.description}</p>
                            <div className="batch-panel__pattern-preview">
                              <PatternPreview pattern={previewPattern} color={freqColor} azimuth={previewAz} />
                            </div>
                          </>
                        )}
                      </>
                    )
                  })()}
                </>
              )
            })()}
          </section>
        </>
      )}

      {/* Scope 批次：類型（In / Out） */}
      {showScopeFields && (
        <section className="batch-panel__section">
          <p className="batch-panel__label">
            類型（批次變更）
            {scopeType === MIXED && <span className="batch-panel__hint">多個值</span>}
          </p>
          <div className="batch-panel__btn-group">
            {[
              { value: 'in',  label: 'In-Scope',  color: '#2ed573' },
              { value: 'out', label: 'Out-of-Scope', color: '#ff4757' },
            ].map((o) => {
              const active = scopeType === o.value
              return (
                <button
                  key={o.value}
                  className={`batch-panel__btn${active ? ' batch-panel__btn--active' : ''}`}
                  style={active ? { borderColor: o.color, color: o.color } : {}}
                  onClick={() => handleScopeType(o.value)}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </section>
      )}

    </div>
  )
}

export default BatchPanel

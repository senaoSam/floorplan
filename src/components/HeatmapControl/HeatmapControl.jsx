import React, { useState, useMemo } from 'react'
import { useHeatmapStore, bandFilterAllowed } from '@/store/useHeatmapStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useHoverReadoutStore } from '@/store/useHoverReadoutStore'
import { useAPStore } from '@/store/useAPStore'
import { useFloorStore } from '@/store/useFloorStore'
import { showUiToast } from '@/store/useUiToastStore'
import { BANDS, hasEnabledBand, hasLiveBand } from '@/utils/apRadios'
import { HEATMAP_MODE_LIST, HEATMAP_MODE_CONFIG, getModeConfig } from '@/features/heatmap/modes'
import FormulaNote from '@/components/FormulaNote/FormulaNote'
import Icon from '@/components/Icon/Icon'
import HeatmapLegend from './HeatmapLegend'
import CursorTip from './CursorTip'
import { BAND_MAP_NO_SIGNAL_DBM } from '@/features/heatmap/bandMap'
import './HeatmapControl.sass'

// 58-7: band chips. Colours are the AP band colours (apsLayer FREQ_COLOR).
const BAND_COLOR = { 2.4: '#f39c12', 5: '#4fc3f7', 6: '#a855f7' }
const ALL_BANDS_TITLE = '每一點取所有頻段中最強的射頻。預設功率下多半是 2.4 GHz，不等於手機實際連的頻段（手機優先 5/6 GHz，見 Client View）。計算量約為單一頻段的 2～3 倍。'
// Mode glossary for the info icon beside the mode menu.
const MODE_HELP = HEATMAP_MODE_LIST.map((m) => `${m.label}（${m.plain}）：${m.plainHelp}`).join('\n')
// 58-12
const BAND_MAP_CHIP_TITLE = '頻段地圖已包含所有頻段；要看單一頻段請切回其他模式'

// 58-7: strongest radio per band at the hovered point, from the probe's
// per-radio RSSI (scenario entries carry `frequency`). Low band first.
function strongestPerBand(hover) {
  const best = new Map()
  for (let i = 0; i < hover.perAp.length; i++) {
    const v = hover.perAp[i]
    const ap = hover.apList[i]
    if (!ap || !isFinite(v)) continue
    const cur = best.get(ap.frequency)
    if (!cur || v > cur.dbm) best.set(ap.frequency, { band: ap.frequency, ap, dbm: v })
  }
  return [...best.values()].sort((a, b) => a.band - b.band)
}

// Pick the hover value that corresponds to the active visualisation mode.
function hoverValueForMode(hover, mode) {
  if (!hover) return undefined
  switch (mode) {
    case 'sinr': return hover.sinrDb
    case 'snr':  return hover.snrDb
    case 'cci':  return hover.cciDbm
    case 'rssi':
    default:     return hover.rssiDbm
  }
}

function HeatmapControl() {
  const enabled      = useHeatmapStore((s) => s.enabled)
  const setEnabled   = useHeatmapStore((s) => s.setEnabled)
  const mode         = useHeatmapStore((s) => s.mode)
  const setMode      = useHeatmapStore((s) => s.setMode)
  const bandFilter   = useHeatmapStore((s) => s.bandFilter)
  const setBandFilter = useHeatmapStore((s) => s.setBandFilter)
  const reflections  = useHeatmapStore((s) => s.reflections)
  const setReflections = useHeatmapStore((s) => s.setReflections)
  const diffraction  = useHeatmapStore((s) => s.diffraction)
  const setDiffraction = useHeatmapStore((s) => s.setDiffraction)
  const gridStepM    = useHeatmapStore((s) => s.gridStepM)
  const setGridStepM = useHeatmapStore((s) => s.setGridStepM)
  const blur         = useHeatmapStore((s) => s.blur)
  const setBlur      = useHeatmapStore((s) => s.setBlur)
  const showContours = useHeatmapStore((s) => s.showContours)
  const setShowContours = useHeatmapStore((s) => s.setShowContours)
  const engine       = useHeatmapStore((s) => s.engine)
  const setEngine    = useHeatmapStore((s) => s.setEngine)
  const dragMode     = useHeatmapStore((s) => s.dragMode)
  const setDragMode  = useHeatmapStore((s) => s.setDragMode)
  // 任務 4: when the active scene's wall×AP exceeds the downgrade threshold,
  // heatmapAdapter forces reflections/diffraction off for the whole compute.
  const simplifiedLargeScene = useHeatmapStore((s) => s.simplifiedLargeScene)
  const budgetQuality = useHeatmapStore((s) => s.budgetQuality)
  // Frozen while drawing walls — the field shown is from before the draw.
  const drawWallFrozen = useHeatmapStore((s) => s.drawWallFrozen)
  // Frozen while aligning floors — drag-align writes the floor store every
  // pointermove, which would otherwise recompute + ripple continuously.
  const alignFrozen = useHeatmapStore((s) => s.alignFrozen)
  // 47-22: enabled but the active floor has no scale → nothing can render.
  const scaleMissing = useHeatmapStore((s) => s.scaleMissing)
  const glUnavailable = useHeatmapStore((s) => s.glUnavailable)
  // Phase 48: other floors excluded from cross-floor computation (no scale).
  const crossFloorExcluded = useHeatmapStore((s) => s.crossFloorExcluded)
  const setEditorMode = useEditorStore((s) => s.setEditorMode)
  const hover        = useHoverReadoutStore((s) => s.reading)
  const apsByFloor   = useAPStore((s) => s.apsByFloor)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)

  // 58-7: devices with each band enabled -- on this floor (chip badge) and
  // in the whole building (a band nobody has disables its chip).
  // 58-15 (C5): enabled and allowed by the domain, like the heatmap.
  const domainId = useEditorStore((s) => s.regulatoryDomain)
  const bandCounts = useMemo(() => {
    const floor = {}
    const building = {}
    const enabled = {}   // enabled, allowed or not (for the chip's reason)
    for (const band of BANDS) {
      floor[band] = (apsByFloor[activeFloorId] ?? []).filter((a) => hasLiveBand(a, band, domainId)).length
      building[band] = Object.values(apsByFloor).reduce(
        (n, list) => n + (list ?? []).filter((a) => hasLiveBand(a, band, domainId)).length, 0)
      enabled[band] = Object.values(apsByFloor).reduce(
        (n, list) => n + (list ?? []).filter((a) => hasEnabledBand(a, band)).length, 0)
    }
    return { floor, building, enabled }
  }, [apsByFloor, activeFloorId, domainId])

  const [panelOpen, setPanelOpen] = useState(false)
  const [formulaOpen, setFormulaOpen] = useState(false)

  const hoverValue = hoverValueForMode(hover, mode)
  const activeCfg  = getModeConfig(mode)

  const formatReading = (v, unit) => isFinite(v) ? `${v.toFixed(1)} ${unit}` : '—'

  // 58-7: 最強 ('all') is RSSI-only; leaving RSSI on it falls back to the
  // last single band (the store does the switch).
  const onModeChange = (v) => {
    const st = useHeatmapStore.getState()
    // 58-12: the band map switches bands itself (to all, and back on leaving).
    if (v !== 'band' && st.mode !== 'band' && !bandFilterAllowed(v, st.bandFilter)) {
      showUiToast(`${getModeConfig(v).label} 只能看單一頻段，已改以 ${st.lastSingleBand} GHz 顯示`)
    }
    setMode(v)
  }
  const allBandsAllowed = bandFilterAllowed(mode, 'all')
  // 58-7: hover rows -- one per band (one under a single-band filter); the
  // strongest drives the colour under 最強.
  const bandRows = hover ? strongestPerBand(hover) : []
  // 58-12: on the band map the colour follows the band a phone joins.
  const isBandMap = !!activeCfg.bandMap
  const hoverBandMap = isBandMap ? hover?.bandMap ?? null : null
  const drivingBand = isBandMap
    ? hoverBandMap?.band ?? null
    : bandRows.length > 1
      ? bandRows.reduce((a, b) => (b.dbm > a.dbm ? b : a)).band
      : null
  // The rows come from a direct-path probe; say so when the painted field
  // includes reflection / diffraction.
  const directOnlyNote = (reflections || diffraction) && !simplifiedLargeScene && budgetQuality !== 'direct'

  return (
    <div className="heatmap-control">
      {/* Drawing walls freezes the heatmap (each segment commits immediately,
          so recomputing per segment would stutter). Tell the user the field is
          a snapshot from before drawing and will refresh on exit. Top-level so
          it's visible even with the settings panel collapsed. */}
      {enabled && drawWallFrozen && (
        <div className="heatmap-control__notice">
          <Icon name="snowflake" size={12} inline style={{ marginRight: 4 }} />畫牆中：熱圖已暫停更新（畫完離開畫牆模式後自動重新計算）
        </div>
      )}
      {enabled && alignFrozen && (
        <div className="heatmap-control__notice">
          <Icon name="snowflake" size={12} inline style={{ marginRight: 4 }} />對齊樓層中：熱圖已暫停更新（完成對齊後自動重新計算）
        </div>
      )}
      {/* Phase 48: floors whose scale is uncalibrated can't be positioned in
          meters — they're excluded from the cross-floor field, not silently
          mis-placed. */}
      {enabled && crossFloorExcluded.length > 0 && (
        <div className="heatmap-control__notice">
          <Icon name="warning" size={12} inline style={{ marginRight: 4 }} />{crossFloorExcluded.join('、')} 尚未校正比例尺，未納入跨樓層計算
        </div>
      )}
      {/* 47-22: heatmap is on but there's no scale — it can't render. Tell the
          user why and offer a one-click jump into the scale-drawing mode, so
          the enabled toggle isn't paired with a mysteriously blank canvas. */}
      {enabled && scaleMissing && (
        <div className="heatmap-control__notice heatmap-control__notice--action">
          <span><Icon name="warning" size={12} inline style={{ marginRight: 4 }} />尚未設定比例尺，熱圖無法計算</span>
          <button
            type="button"
            className="heatmap-control__notice-btn"
            onClick={() => setEditorMode(EDITOR_MODE.DRAW_SCALE)}
          >
            設定比例尺
          </button>
        </div>
      )}
      {/* 52-C3: WebGL2 unavailable — same reasoning as the scale notice above.
          Without this the toggle reads "on" while nothing ever draws. */}
      {enabled && glUnavailable && (
        <div className="heatmap-control__notice">
          <Icon name="warning" size={12} inline style={{ marginRight: 4 }} />這個瀏覽器／裝置無法使用 WebGL2，熱圖無法繪製
        </div>
      )}
      {/* Readout beside the cursor (CursorTip). Shows all four metrics so
          the user can compare without flipping modes. */}
      {enabled && hover && (
        <CursorTip className="heatmap-control__readout">
          {/* 52-D3: hovering a row now explains the acronym in place. */}
          {/* 58-12: the band map reads the band a phone joins here and each
              band's painted RSSI (no SINR / CCI on this map). */}
          {isBandMap ? hoverBandMap && (
            <>
              <div className="heatmap-control__readout-row" title={activeCfg.plainHelp}>
                <b>手機會連</b>
                <span>
                  {hoverBandMap.band == null ? '無服務'
                    : `${hoverBandMap.band} GHz · ${formatReading(hoverBandMap.rssiDbm, 'dBm')}${hoverBandMap.good ? '' : '（未達目標）'}`}
                </span>
              </div>
              {[2.4, 5, 6].map((b) => (
                <div key={b} className="heatmap-control__readout-row">
                  <b>
                    <span className="heatmap-control__band-dot" style={{ background: BAND_COLOR[b] }} />
                    {b} GHz
                  </b>
                  <span>{formatReading(hoverBandMap.rssiByBand[b] > BAND_MAP_NO_SIGNAL_DBM ? hoverBandMap.rssiByBand[b] : -Infinity, 'dBm')}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="heatmap-control__readout-row" title={HEATMAP_MODE_CONFIG.rssi.plainHelp}>
                <b>RSSI</b> <span>{formatReading(hover.rssiDbm, 'dBm')}</span>
              </div>
              <div className="heatmap-control__readout-row" title={HEATMAP_MODE_CONFIG.sinr.plainHelp}>
                <b>SINR</b> <span>{formatReading(hover.sinrDb, 'dB')}</span>
              </div>
              <div className="heatmap-control__readout-row" title={HEATMAP_MODE_CONFIG.snr.plainHelp}>
                <b>SNR</b> <span>{formatReading(hover.snrDb, 'dB')}</span>
              </div>
              <div className="heatmap-control__readout-row" title={HEATMAP_MODE_CONFIG.cci.plainHelp}>
                <b>CCI</b> <span>{formatReading(hover.cciDbm, 'dBm')}</span>
              </div>
            </>
          )}
          <div className="heatmap-control__readout-row heatmap-control__readout-pos">
            ({hover.at.x.toFixed(2)}, {hover.at.y.toFixed(2)}) m
          </div>
          {!isBandMap && bandRows.map((r) => (
            <div
              key={r.band}
              className="heatmap-control__readout-row"
              title={drivingBand === r.band ? '此點熱圖顏色依這個射頻' : undefined}
            >
              <b>
                <span className="heatmap-control__band-dot" style={{ background: BAND_COLOR[r.band] }} />
                {r.band} {r.ap.name ?? '—'}
              </b>
              <span>
                {r.dbm.toFixed(1)} dBm · ch {r.ap.channel ?? '—'}/{r.ap.channelWidth ?? '—'}
                {drivingBand === r.band && <Icon name="arrowLeft" size={11} inline style={{ marginLeft: 4 }} />}
              </span>
            </div>
          ))}
          {!isBandMap && bandRows.length > 0 && directOnlyNote && (
            <div className="heatmap-control__readout-note">（直射估算，不含反射/繞射）</div>
          )}
        </CursorTip>
      )}

      {/* Color legend — only while heatmap is enabled; pointer follows hover
          value for the active mode. */}
      {enabled && (
        <HeatmapLegend mode={mode} hoverValue={hoverValue} bandFilter={bandFilter}
          hoverBand={hoverBandMap ? hoverBandMap.band : undefined}
          bandCounts={bandCounts}
          multipath={(reflections || diffraction) && !simplifiedLargeScene && budgetQuality !== 'direct'} />
      )}

      <div className="heatmap-control__row">
        {/* Toggle idiom (ui-spec §2.3-3): fixed label, state shown by the
            filled --active style — same pattern as the timeline chips. */}
        <button
          type="button"
          className={`heatmap-control__btn${enabled ? ' heatmap-control__btn--active' : ''}`}
          onClick={() => setEnabled(!enabled)}
          title={enabled ? '關閉熱圖' : '開啟熱圖'}
        >
          <span className="heatmap-control__dot" />
          <span>熱圖</span>
        </button>
        {enabled && (
          <>
            <select
              className="heatmap-control__mode"
              value={mode}
              onChange={(e) => onModeChange(e.target.value)}
              title={`${activeCfg.plain}：${activeCfg.plainHelp}`}
            >
              {/* 52-D3: each option carries its plain name, and the hovered
                  option explains itself — a bare "SINR" told the user nothing. */}
              {HEATMAP_MODE_LIST.map((m) => (
                <option key={m.id} value={m.id} title={m.plainHelp}>
                  {m.label}（{m.plain}）
                </option>
              ))}
            </select>
            {/* What each metric means -- the readout rows used to explain
                themselves on hover, but the readout now follows the cursor
                and never takes the pointer (CursorTip). */}
            <span className="heatmap-control__mode-help" title={MODE_HELP}>
              <Icon name="info" size={14} />
            </span>
            {/* 58-7: band chips. Filled = viewed band; the badge counts this
                floor's devices with the band on. A band absent here stays
                clickable (other floors still bleed through); one absent from
                the whole building is disabled -- unless it is the viewed band
                (default 5 / auto-place preview), which stays readable. */}
            <div className="heatmap-control__bands" role="radiogroup" aria-label="熱圖頻段">
              {BANDS.map((band) => {
                const value = String(band)
                const onFloor = bandCounts.floor[band]
                const inBuilding = bandCounts.building[band]
                const checked = bandFilter === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    className={`heatmap-control__band${checked ? ' heatmap-control__band--on' : ''}${onFloor === 0 ? ' heatmap-control__band--empty' : ''}`}
                    style={{ '--band-color': BAND_COLOR[band] }}
                    disabled={isBandMap || (inBuilding === 0 && !checked)}
                    onClick={() => setBandFilter(value)}
                    title={isBandMap ? BAND_MAP_CHIP_TITLE : inBuilding === 0 ? (bandCounts.enabled[band] > 0 ? `整棟的 ${value} GHz 射頻在此國家都不可用` : `整棟沒有開啟的 ${value} GHz 射頻`)
                      : onFloor === 0 ? `本層無 ${value} GHz 射頻，只會看到其他樓層的滲透`
                      : `只用 ${value} GHz 射頻計算熱圖`}
                  >
                    {value}<span className="heatmap-control__band-count">·{onFloor}</span>
                  </button>
                )
              })}
              <button
                type="button"
                role="radio"
                aria-checked={bandFilter === 'all'}
                className={`heatmap-control__band heatmap-control__band--all${bandFilter === 'all' ? ' heatmap-control__band--on' : ''}`}
                disabled={!allBandsAllowed || isBandMap}
                onClick={() => setBandFilter('all')}
                title={isBandMap ? BAND_MAP_CHIP_TITLE : allBandsAllowed ? ALL_BANDS_TITLE : `「最強」只適用 RSSI；${activeCfg.label} 請選單一頻段`}
              >
                最強
              </button>
            </div>
            <button
              type="button"
              className="heatmap-control__more"
              onClick={() => setPanelOpen((v) => !v)}
              title="熱圖設定"
            >
              <Icon name={panelOpen ? 'chevronDown' : 'chevronRight'} size={11} /> 設定
            </button>
          </>
        )}
      </div>

      {enabled && panelOpen && (
        <div className="heatmap-control__panel">
          <label className="heatmap-control__line">
            <span>引擎</span>
            <select
              className="heatmap-control__select"
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              title="精確：完整物理（含反射／繞射，較慢）。快速：GPU 加速，適合大場景即時預覽。"
            >
              <option value="js">精確（完整物理）</option>
              <option value="shader">快速（GPU 加速）</option>
            </select>
          </label>
          <label className="heatmap-control__line">
            <span>拖曳模式</span>
            <select
              className="heatmap-control__select"
              value={dragMode}
              onChange={(e) => setDragMode(e.target.value)}
              title="Live = 拖曳即時重算（降畫質）；Solo = 拖 AP 只重算被拖那一顆，拖牆/Scope 凍結（Hamina 風格）"
            >
              <option value="live">Live (即時重算)</option>
              <option value="solo">Solo (單 AP / 凍結)</option>
            </select>
          </label>
          <label className="heatmap-control__line">
            <input type="checkbox" checked={reflections} onChange={(e) => setReflections(e.target.checked)} />
            <span>反射 (1st-order, image source)</span>
          </label>
          <label className="heatmap-control__line">
            <input type="checkbox" checked={diffraction} onChange={(e) => setDiffraction(e.target.checked)} />
            <span>繞射 (UTD / knife edge)</span>
          </label>
          {/* 任務 4: large scenes auto-disable refl/diff for performance. The
              checkboxes above still reflect the user's preference, but the
              actual compute ignores them until the scene shrinks below the
              threshold — tell the user so the simplified field isn't a
              surprise. */}
          {simplifiedLargeScene && (
            <div className="heatmap-control__notice">
              <Icon name="zap" size={12} inline style={{ marginRight: 4 }} />大場景已簡化：暫時關閉反射 / 繞射以維持效能（縮小場景後自動恢復）
            </div>
          )}
          {/* 57-39: the fine render ran over its 5 s budget and stepped down. */}
          {!simplifiedLargeScene && budgetQuality && (
            <div className="heatmap-control__notice">
              <Icon name="zap" size={12} inline style={{ marginRight: 4 }} />
              {budgetQuality === 'noDiffraction'
                ? '計算量過大：已關閉繞射以維持效能（修改牆面或設定後重試）'
                : '計算量過大：已關閉反射 / 繞射以維持效能（修改牆面或設定後重試）'}
            </div>
          )}
          <label className="heatmap-control__line">
            <span>網格精度: {gridStepM.toFixed(2)} m</span>
            <input
              type="range" min="0.2" max="0.8" step="0.05"
              value={gridStepM}
              onChange={(e) => setGridStepM(parseFloat(e.target.value))}
            />
          </label>
          <label className="heatmap-control__line">
            <span>平滑 (blur): {blur} px</span>
            <input
              type="range" min="0" max="24" step="1"
              value={blur}
              onChange={(e) => setBlur(parseInt(e.target.value, 10))}
            />
          </label>
          <label className="heatmap-control__line">
            <input type="checkbox" checked={showContours} onChange={(e) => setShowContours(e.target.checked)} />
            <span>訊號等高線</span>
          </label>
          <button
            type="button"
            className="heatmap-control__formula-btn"
            onClick={() => setFormulaOpen((v) => !v)}
          >
            <Icon name={formulaOpen ? 'chevronDown' : 'chevronRight'} size={11} /> 公式說明
          </button>
          {formulaOpen && <FormulaNote />}
        </div>
      )}
    </div>
  )
}

export default HeatmapControl

import React, { useEffect, useState, useRef } from 'react'
import { useEditorStore, HEATMAP_MODE, ENVIRONMENT_PRESETS } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import './HeatmapControl.sass'

const HEATMAP_OPTIONS = [
  { mode: HEATMAP_MODE.RSSI,            label: 'RSSI 訊號強度' },
  { mode: HEATMAP_MODE.SNR,             label: 'SNR 訊號噪聲比' },
  { mode: HEATMAP_MODE.SINR,            label: 'SINR 訊號干擾比' },
  { mode: HEATMAP_MODE.CHANNEL_OVERLAP, label: '頻道重疊' },
  { mode: HEATMAP_MODE.AP_COUNT,        label: '可用 AP 數' },
  { mode: HEATMAP_MODE.DATA_RATE,       label: '預估速率' },
]

const ENV_OPTIONS = Object.entries(ENVIRONMENT_PRESETS).map(([key, val]) => ({
  key,
  label: val.label,
  hint: val.hint,
  n: val.n,        // { 2.4, 5, 6 } per-band
}))

// 三頻段是否都等同 preset（容差 0.05）
const matchesPreset = (ple, presetN) =>
  Math.abs(ple[2.4] - presetN[2.4]) < 0.05 &&
  Math.abs(ple[5]   - presetN[5])   < 0.05 &&
  Math.abs(ple[6]   - presetN[6])   < 0.05

// 顯示用：把三頻段 n 化為簡短字串
const formatN = (presetN) =>
  presetN[2.4] === presetN[5] && presetN[5] === presetN[6]
    ? `${presetN[2.4]}`
    : `${presetN[2.4]}/${presetN[5]}/${presetN[6]}`

// Render-order hint: inside the stack, items at the top of JSX appear at the top visually.
// Because the stack uses `flex-direction: column`, first child = top. The toggle button sits last.
function HeatmapControl({ legends }) {
  const showHeatmap       = useEditorStore((s) => s.showHeatmap)
  const heatmapMode       = useEditorStore((s) => s.heatmapMode)
  const pleByBand         = useEditorStore((s) => s.pleByBand)
  const toggleHeatmap     = useEditorStore((s) => s.toggleHeatmap)
  const setHeatmapMode    = useEditorStore((s) => s.setHeatmapMode)
  const applyEnvPreset    = useEditorStore((s) => s.applyEnvironmentPreset)
  const floorScale        = useFloorStore((s) => s.floors.find((f) => f.id === s.activeFloorId)?.scale ?? null)
  const hasScale = !!floorScale

  const envKey = ENV_OPTIONS.find((x) => matchesPreset(pleByBand, x.n))?.key || 'OFFICE'
  const legend = legends?.[heatmapMode]
  const currentMode = HEATMAP_OPTIONS.find((o) => o.mode === heatmapMode) ?? HEATMAP_OPTIONS[0]

  const [modeOpen, setModeOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(-1)  // keyboard-highlighted index; -1 = none
  const modeRef = useRef(null)
  const headerRef = useRef(null)

  const [envOpen, setEnvOpen] = useState(false)
  const envRef = useRef(null)
  const currentEnv = ENV_OPTIONS.find((x) => x.key === envKey) ?? ENV_OPTIONS[1]

  useEffect(() => {
    if (!envOpen) return
    const onDown = (e) => {
      if (envRef.current && !envRef.current.contains(e.target)) setEnvOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [envOpen])

  const currentIdx = HEATMAP_OPTIONS.findIndex((o) => o.mode === heatmapMode)

  // Auto-open the mode picker when the heatmap is enabled so users immediately
  // see the available modes; collapse it when the heatmap is turned off.
  const prevShowRef = useRef(showHeatmap)
  useEffect(() => {
    if (!prevShowRef.current && showHeatmap) setModeOpen(true)
    if (prevShowRef.current && !showHeatmap) setModeOpen(false)
    prevShowRef.current = showHeatmap
  }, [showHeatmap])

  // Reset keyboard cursor to the current mode each time the list opens.
  useEffect(() => {
    if (modeOpen) setFocusIdx(currentIdx >= 0 ? currentIdx : 0)
    else setFocusIdx(-1)
  }, [modeOpen, currentIdx])

  // Close when clicking outside.
  useEffect(() => {
    if (!modeOpen) return
    const onDown = (e) => {
      if (modeRef.current && !modeRef.current.contains(e.target)) setModeOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [modeOpen])

  const handleHeaderKey = (e) => {
    // Closed: arrows step the mode in place (native-select behavior, clamped at ends).
    // Open: Enter/Space/Escape handled here; arrows are handled by the list below.
    if (!modeOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = Math.min(currentIdx + 1, HEATMAP_OPTIONS.length - 1)
        if (next !== currentIdx) setHeatmapMode(HEATMAP_OPTIONS[next].mode)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const next = Math.max(currentIdx - 1, 0)
        if (next !== currentIdx) setHeatmapMode(HEATMAP_OPTIONS[next].mode)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setModeOpen(true)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setModeOpen(false)
    }
  }

  const handleListKey = (e) => {
    if (!modeOpen) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIdx((i) => Math.min(i + 1, HEATMAP_OPTIONS.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setFocusIdx(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setFocusIdx(HEATMAP_OPTIONS.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (focusIdx >= 0) {
        setHeatmapMode(HEATMAP_OPTIONS[focusIdx].mode)
        setModeOpen(false)
        headerRef.current?.focus()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setModeOpen(false)
      headerRef.current?.focus()
    } else if (e.key === 'Tab') {
      setModeOpen(false)
    }
  }

  return (
    <div className="heatmap-control">
      {showHeatmap && legend && (
        <div className="heatmap-control__legend">
          <div
            className="heatmap-control__mode"
            ref={modeRef}
            onKeyDown={modeOpen ? handleListKey : undefined}
          >
            <button
              type="button"
              ref={headerRef}
              className={`heatmap-control__mode-header${modeOpen ? ' heatmap-control__mode-header--open' : ''}`}
              onClick={() => setModeOpen((v) => !v)}
              onKeyDown={handleHeaderKey}
              aria-haspopup="listbox"
              aria-expanded={modeOpen}
            >
              <span className="heatmap-control__mode-label">{currentMode.label}</span>
              <span className={`heatmap-control__mode-arrow${modeOpen ? ' heatmap-control__mode-arrow--open' : ''}`}>▾</span>
            </button>
            {modeOpen && (
              <ul
                className="heatmap-control__mode-list"
                role="listbox"
                tabIndex={-1}
              >
                {HEATMAP_OPTIONS.map((opt, i) => {
                  const isActive  = opt.mode === heatmapMode
                  const isFocused = i === focusIdx
                  return (
                    <li
                      key={opt.mode}
                      role="option"
                      aria-selected={isActive}
                      className={`heatmap-control__mode-item${isActive ? ' heatmap-control__mode-item--active' : ''}${isFocused ? ' heatmap-control__mode-item--focused' : ''}`}
                      onMouseEnter={() => setFocusIdx(i)}
                      onClick={() => { setHeatmapMode(opt.mode); setModeOpen(false); headerRef.current?.focus() }}
                    >
                      {opt.label}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          {legend.items.map((item) => (
            <div key={item.label} className="heatmap-control__legend-item">
              <span className="heatmap-control__swatch" style={{ background: item.color }} />
              <span className="heatmap-control__legend-label">{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {showHeatmap && (
        <div className="heatmap-control__env" ref={envRef}>
          <button
            type="button"
            className={`heatmap-control__env-header${envOpen ? ' heatmap-control__env-header--open' : ''}`}
            onClick={() => setEnvOpen((v) => !v)}
            title="環境類型（影響訊號衰減計算）"
          >
            <span className="heatmap-control__env-text">
              <span className="heatmap-control__env-label">{currentEnv.label}</span>
              <span className="heatmap-control__env-meta">
                {currentEnv.hint} <span className="heatmap-control__env-n">n={formatN(currentEnv.n)}</span>
              </span>
            </span>
            <span className={`heatmap-control__env-arrow${envOpen ? ' heatmap-control__env-arrow--open' : ''}`}>▾</span>
          </button>
          {envOpen && (
            <ul className="heatmap-control__env-list" role="listbox">
              {ENV_OPTIONS.map((opt) => {
                const isActive = opt.key === envKey
                return (
                  <li
                    key={opt.key}
                    role="option"
                    aria-selected={isActive}
                    className={`heatmap-control__env-item${isActive ? ' heatmap-control__env-item--active' : ''}`}
                    onClick={() => {
                      applyEnvPreset(opt.key)
                      setEnvOpen(false)
                    }}
                  >
                    <span className="heatmap-control__env-label">{opt.label}</span>
                    <span className="heatmap-control__env-meta">
                      {opt.hint} <span className="heatmap-control__env-n">n={formatN(opt.n)}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <button
        className={`heatmap-control__toggle${showHeatmap ? ' heatmap-control__toggle--active' : ''}`}
        onClick={toggleHeatmap}
        disabled={!hasScale}
        title={hasScale ? '切換熱圖' : '熱圖需要實際距離來計算訊號衰減，請先在「比例尺」工具標出已知長度'}
      >
        {hasScale ? (showHeatmap ? '關閉熱圖' : '開啟熱圖') : '熱圖需先設比例尺'}
      </button>
    </div>
  )
}

export default HeatmapControl

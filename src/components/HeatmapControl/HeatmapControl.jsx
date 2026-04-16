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
  n: val.n,
}))

// Render-order hint: inside the stack, items at the top of JSX appear at the top visually.
// Because the stack uses `flex-direction: column`, first child = top. The toggle button sits last.
function HeatmapControl({ legends }) {
  const showHeatmap       = useEditorStore((s) => s.showHeatmap)
  const heatmapMode       = useEditorStore((s) => s.heatmapMode)
  const pathLossExponent  = useEditorStore((s) => s.pathLossExponent)
  const toggleHeatmap     = useEditorStore((s) => s.toggleHeatmap)
  const setHeatmapMode    = useEditorStore((s) => s.setHeatmapMode)
  const setPathLossExp    = useEditorStore((s) => s.setPathLossExponent)
  const floorScale        = useFloorStore((s) => s.scale)
  const hasScale = !!floorScale

  const envKey = ENV_OPTIONS.find((x) => Math.abs(x.n - pathLossExponent) < 0.05)?.key || 'OFFICE'
  const legend = legends?.[heatmapMode]
  const currentMode = HEATMAP_OPTIONS.find((o) => o.mode === heatmapMode) ?? HEATMAP_OPTIONS[0]

  const [modeOpen, setModeOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(-1)  // keyboard-highlighted index; -1 = none
  const modeRef = useRef(null)
  const headerRef = useRef(null)

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
        <select
          className="heatmap-control__env-select"
          value={envKey}
          onChange={(e) => {
            const preset = ENVIRONMENT_PRESETS[e.target.value]
            if (preset) setPathLossExp(preset.n)
          }}
          title="環境類型（路徑損耗指數）"
        >
          {ENV_OPTIONS.map((x) => (
            <option key={x.key} value={x.key}>{x.label} (n={x.n})</option>
          ))}
        </select>
      )}

      <button
        className={`heatmap-control__toggle${showHeatmap ? ' heatmap-control__toggle--active' : ''}`}
        onClick={toggleHeatmap}
        disabled={!hasScale}
        title={hasScale ? '切換熱圖' : '請先設定比例尺才能顯示熱圖'}
      >
        {hasScale ? (showHeatmap ? '關閉熱圖' : '開啟熱圖') : '需先設定比例尺'}
      </button>
    </div>
  )
}

export default HeatmapControl

import React, { useState, useEffect, useRef } from 'react'
import './ScaleDialog.sass'

// Modal asking for the real-world distance between two clicked points.
// Caller passes the pixel distance + a callback that receives px-per-m.
// Esc cancels, Enter confirms.
function ScaleDialog({ pixelDistance, onConfirm, onCancel }) {
  const [meters, setMeters] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = () => {
    const m = parseFloat(meters)
    if (!isFinite(m) || m <= 0) return
    const pxPerM = pixelDistance / m
    onConfirm?.(pxPerM)
  }

  return (
    <div className="scale-dialog-backdrop" onMouseDown={onCancel}>
      <div className="scale-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="scale-dialog__title">設定比例尺</div>
        <div className="scale-dialog__hint">
          兩點之間的螢幕距離為 {pixelDistance.toFixed(1)} px。請輸入這段距離的實際公尺數：
        </div>
        <div className="scale-dialog__row">
          <input
            ref={inputRef}
            type="number"
            step="0.1"
            min="0"
            value={meters}
            placeholder="公尺"
            onChange={(e) => setMeters(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          />
          <span>m</span>
        </div>
        <div className="scale-dialog__actions">
          <button type="button" className="scale-dialog__btn" onClick={onCancel}>取消</button>
          <button
            type="button"
            className="scale-dialog__btn scale-dialog__btn--primary"
            onClick={submit}
            disabled={!meters || !(parseFloat(meters) > 0)}
          >
            設定
          </button>
        </div>
      </div>
    </div>
  )
}

export default ScaleDialog

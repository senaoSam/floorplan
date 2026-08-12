import React, { useState, useEffect, useRef } from 'react'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
import { MIN_PX_PER_M, MAX_PX_PER_M } from '@/store/useFloorStore'
import './ScaleDialog.sass'

// Modal asking for the real-world distance between two clicked points.
// Visual + interaction ports oldSrc ScaleDialog.jsx 1:1 — title / hint
// copy / placeholder / unit label / live "px/m" result preview / button
// labels all match. Caller passes pixelDist + onConfirm receives the
// entered metres (caller computes pxPerM).
// Esc / backdrop click cancels; Enter confirms.
function ScaleDialog({ pixelDist, onConfirm, onCancel }) {
  const [meters, setMeters] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 52-A2: the store clamps px/m, but a silently-clamped value would leave the
  // plan measuring something other than what was typed. Refuse out-of-range
  // input here and say why (min="0.01" alone is bypassed by the Enter path).
  //
  // The bound is on px/m, but the user typed metres — quoting the px/m limits
  // back at them invites reading "5000" as the metres they just entered. State
  // the limit in the unit of the input box instead: a small px/m means a large
  // distance, so the bounds swap sides.
  const parsed = parseFloat(meters)
  const pxPerM = parsed > 0 ? pixelDist / parsed : null
  const maxMeters = pixelDist / MIN_PX_PER_M
  const minMeters = pixelDist / MAX_PX_PER_M
  const tooFar   = pxPerM != null && pxPerM < MIN_PX_PER_M
  const tooClose = pxPerM != null && pxPerM > MAX_PX_PER_M
  const outOfRange = tooFar || tooClose
  const canConfirm = pxPerM != null && !outOfRange

  // Round for display so the stated limit is one the user can actually enter
  // (floor the max / ceil the min — never advertise a value that still fails).
  const fmt = (m) => (m >= 10 ? Math.round(m).toLocaleString() : m.toFixed(2))
  const limitHint = tooFar
    ? `這段 ${pixelDist} px 最多只能是 ${fmt(Math.floor(maxMeters))} 公尺`
    : `這段 ${pixelDist} px 至少要有 ${fmt(Math.ceil(minMeters * 100) / 100)} 公尺`

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm(parsed)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter')  handleConfirm()
    if (e.key === 'Escape') onCancel()
  }

  const dismiss = useOverlayDismiss(onCancel)

  return (
    <div className="scale-dialog-overlay" {...dismiss}>
      <div className="scale-dialog">
        <p className="scale-dialog__title">設定比例尺</p>
        <p className="scale-dialog__px">量測長度：{pixelDist} px</p>
        <div className="scale-dialog__row">
          <input
            ref={inputRef}
            className="scale-dialog__input"
            type="number"
            min="0.01"
            step="0.1"
            placeholder="實際距離"
            value={meters}
            onChange={(e) => setMeters(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="scale-dialog__unit">公尺</span>
        </div>
        {pxPerM != null && (
          <p className={`scale-dialog__result${outOfRange ? ' scale-dialog__result--invalid' : ''}`}>
            {outOfRange
              ? `這個距離不合理 — ${limitHint}`
              : `比例尺：${pxPerM.toFixed(2)} px/m`}
          </p>
        )}
        <div className="scale-dialog__actions">
          <button className="scale-dialog__btn scale-dialog__btn--cancel" onClick={onCancel}>
            取消
          </button>
          <button
            className="scale-dialog__btn scale-dialog__btn--confirm"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            確認
          </button>
        </div>
      </div>
    </div>
  )
}

export default ScaleDialog

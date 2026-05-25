import React, { useState, useEffect, useRef } from 'react'
import './ScaleDialog.sass'

function ScaleDialog({ pixelDist, onConfirm, onCancel }) {
  const [meters, setMeters] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleConfirm = () => {
    const m = parseFloat(meters)
    if (!m || m <= 0) return
    onConfirm(m)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter')  handleConfirm()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="scale-dialog-overlay" onClick={onCancel}>
      <div className="scale-dialog" onClick={(e) => e.stopPropagation()}>
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
        {meters && parseFloat(meters) > 0 && (
          <p className="scale-dialog__result">
            比例尺：{(pixelDist / parseFloat(meters)).toFixed(2)} px/m
          </p>
        )}
        <div className="scale-dialog__actions">
          <button className="scale-dialog__btn scale-dialog__btn--cancel" onClick={onCancel}>
            取消
          </button>
          <button
            className="scale-dialog__btn scale-dialog__btn--confirm"
            onClick={handleConfirm}
            disabled={!meters || parseFloat(meters) <= 0}
          >
            確認
          </button>
        </div>
      </div>
    </div>
  )
}

export default ScaleDialog

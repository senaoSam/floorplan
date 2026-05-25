import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import './Tooltip.sass'

// Lightweight hover tooltip. Wraps a single child element and shows `label`
// in a small overlay positioned above (or below if overflow) the child after
// a configurable delay. Built for the Phase 18 icon-only toolbar where the
// native `title=""` 1-second delay was too slow.
//
// Usage:
//   <Tooltip label="畫牆"><button>...</button></Tooltip>
//
// `delay` defaults to 250ms — fast enough not to feel laggy, slow enough that
// a finger sweeping across buttons doesn't trigger a flash on each one.
function Tooltip({ label, children, delay = 250, side = 'bottom' }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState(null)
  const wrapperRef = useRef(null)
  const timerRef = useRef(0)

  const showLater = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      // Resolve position relative to viewport so the tooltip can use position:fixed
      // and stay readable even when ancestors have overflow:hidden.
      const el = wrapperRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos({
        x: rect.left + rect.width / 2,
        y: side === 'bottom' ? rect.bottom + 6 : rect.top - 6,
      })
      setVisible(true)
    }, delay)
  }, [delay, side])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = 0
    setVisible(false)
  }, [])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  // Portal the tooltip into <body> so its position:fixed coords resolve
  // against the viewport. If we rendered it inside the host span, any
  // ancestor with `transform: …` (e.g. the floating Toolbar's
  // `translateX(-50%)`) would create a new containing block for fixed
  // descendants — the tooltip would land relative to the toolbar instead
  // of the viewport, and you'd see "tooltip far from icon" misalignment.
  return (
    <span
      ref={wrapperRef}
      className="tooltip-host"
      onMouseEnter={showLater}
      onMouseLeave={hide}
      onMouseDown={hide}
    >
      {children}
      {visible && pos && ReactDOM.createPortal(
        <span
          className={`tooltip tooltip--${side}`}
          style={{ left: pos.x, top: pos.y }}
          role="tooltip"
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  )
}

export default Tooltip

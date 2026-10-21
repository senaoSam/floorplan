import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Heatmap hover readout beside the cursor (it used to sit in the bottom-left
// stack, where it grew over the plan and caught the pointer -- AP-01 on the
// demo could not be hovered or dragged). Fixed to the viewport, never takes
// the pointer, right-down of the cursor and flipped left / up near an edge
// (same placement as the 3D readout, Viewer3D DeviceHoverReadout).
const OFFSET_PX = 14

// Last pointer position, kept by one window listener so a tip that mounts
// mid-move is placed at once (the readout appears after the move that made
// it).
let lastPointer = null
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => { lastPointer = { x: e.clientX, y: e.clientY } }, { passive: true, capture: true })
}

function place(el) {
  if (!el || !lastPointer) return
  const w = el.offsetWidth
  const h = el.offsetHeight
  let x = lastPointer.x + OFFSET_PX
  let y = lastPointer.y + OFFSET_PX
  if (x + w > window.innerWidth) x = lastPointer.x - w - OFFSET_PX
  if (y + h > window.innerHeight) y = lastPointer.y - h - OFFSET_PX
  el.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`
  el.style.visibility = 'visible'
}

function CursorTip({ className, children }) {
  const ref = useRef(null)

  useEffect(() => {
    const onMove = () => place(ref.current)
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  // The content (and so the size) changes with the reading.
  useLayoutEffect(() => { place(ref.current) })

  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{ position: 'fixed', left: 0, top: 0, zIndex: 1000, pointerEvents: 'none', visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}

export default CursorTip

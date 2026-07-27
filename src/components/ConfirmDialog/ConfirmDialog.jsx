import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
import './ConfirmDialog.sass'

// Generic confirm modal. Render conditionally at the call site (open={true}).
// Props:
//   title           - heading text
//   message         - body text (string or node)
//   confirmLabel    - default '確認'
//   cancelLabel     - default '取消'
//   danger          - when true, paint confirm button red (destructive action)
//   onConfirm / onCancel — required callbacks
function ConfirmDialog({ title, message, confirmLabel = '確認', cancelLabel = '取消', danger = false, onConfirm, onCancel }) {
  const confirmBtnRef = useRef(null)

  // Focus the confirm button on open so Enter/Space fires it.
  useEffect(() => {
    confirmBtnRef.current?.focus()
  }, [])

  // Escape cancels; Enter confirms (when focus isn't on the cancel button).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel?.() }
      if (e.key === 'Enter')  { e.preventDefault(); onConfirm?.() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  const dismiss = useOverlayDismiss(onCancel)

  // Portal to <body> so the fixed-position overlay is centred on the VIEWPORT,
  // not on whatever ancestor it's declared in. Toolbar.jsx (a caller) lives
  // inside .toolbar-floating which has transform: translateX(-50%) — a CSS
  // transform makes position:fixed resolve against that transformed box, which
  // pushed the dialog off-centre and squashed it to the toolbar's narrow width
  // (the reported "位置不對 + 文字破版"). The portal escapes that containing block.
  return createPortal(
    <div className="confirm-dialog-overlay" {...dismiss}>
      <div className="confirm-dialog">
        {title && <p className="confirm-dialog__title">{title}</p>}
        {message && <p className="confirm-dialog__message">{message}</p>}
        <div className="confirm-dialog__actions">
          <button
            className="confirm-dialog__btn confirm-dialog__btn--cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            className={`confirm-dialog__btn ${danger ? 'confirm-dialog__btn--danger' : 'confirm-dialog__btn--confirm'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default ConfirmDialog

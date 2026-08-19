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
  const dialogRef = useRef(null)
  const confirmBtnRef = useRef(null)
  const cancelBtnRef = useRef(null)

  // 53-G10: focus the CANCEL button, not confirm. This dialog is only used for
  // destructive actions (`danger` paints confirm red), and opening a delete
  // prompt with the delete button pre-armed means a stray Enter/Space destroys
  // data. The safe choice is the default; confirming is one Tab away.
  useEffect(() => {
    cancelBtnRef.current?.focus()
  }, [])

  // Escape cancels; Enter confirms — but only while focus is INSIDE the dialog.
  //
  // 53-G10: previously this listened on `document` with no focus trap, so Tab
  // walked straight out to the topbar (verified: focus landed on API 測試 /
  // 匯出 / 2D / 3D / ＋ while the modal was still up) and Enter then fired the
  // dialog's confirm anyway — focus said "add floor", the keystroke deleted 5
  // walls. Trap Tab inside the dialog and ignore keys from outside it, so the
  // focused control and the action taken can no longer disagree.
  useEffect(() => {
    const onKey = (e) => {
      const dialog = dialogRef.current
      if (!dialog) return

      if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); return }

      if (e.key === 'Tab') {
        // Cancel and confirm are the only focusables — cycle between them.
        const focusables = [cancelBtnRef.current, confirmBtnRef.current].filter(Boolean)
        if (focusables.length === 0) return
        e.preventDefault()
        const idx = focusables.indexOf(document.activeElement)
        const next = e.shiftKey
          ? (idx <= 0 ? focusables.length - 1 : idx - 1)
          : (idx === -1 || idx === focusables.length - 1 ? 0 : idx + 1)
        focusables[next].focus()
        return
      }

      if (e.key === 'Enter') {
        // Only act on Enter that belongs to this dialog. If focus somehow sits
        // outside, pull it back rather than firing a destructive action whose
        // target the user can't see.
        if (!dialog.contains(document.activeElement)) {
          e.preventDefault()
          cancelBtnRef.current?.focus()
          return
        }
        // Route Enter to whichever button is focused. Handled explicitly rather
        // than left to the browser's native button activation, because this
        // listener is on `document` and consuming the event here would otherwise
        // swallow the click that native activation depends on.
        e.preventDefault()
        if (document.activeElement === cancelBtnRef.current) onCancel?.()
        else onConfirm?.()
        return
      }
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
      <div className="confirm-dialog" ref={dialogRef} role="dialog" aria-modal="true">
        {title && <p className="confirm-dialog__title">{title}</p>}
        {message && <p className="confirm-dialog__message">{message}</p>}
        <div className="confirm-dialog__actions">
          <button
            ref={cancelBtnRef}
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

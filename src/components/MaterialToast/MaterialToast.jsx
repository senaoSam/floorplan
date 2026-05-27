import React from 'react'
import { useMaterialToastStore } from '@/store/useMaterialToastStore'
import './MaterialToast.sass'

// Mounted once near the canvas root; reads from useMaterialToastStore.
// Visual port of oldSrc Editor2D 1643-1648 (.editor-2d__material-toast).

function MaterialToast() {
  const toast = useMaterialToastStore((s) => s.toast)
  if (!toast) return null
  return (
    <div className="material-toast" key={`${toast.key}-${toast._ts}`}>
      <span className="material-toast__dot" style={{ background: toast.color }} />
      <span className="material-toast__key">{toast.key}</span>
      <span className="material-toast__label">{toast.label}</span>
    </div>
  )
}

export default MaterialToast

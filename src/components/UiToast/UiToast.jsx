import React from 'react'
import { useUiToastStore } from '@/store/useUiToastStore'
import './UiToast.sass'

// Global notification toast — mounted once in App. Bottom-center, above the
// camera timeline bar so it never hides the controls it talks about.
function UiToast() {
  const toast = useUiToastStore((s) => s.toast)
  if (!toast) return null
  return (
    <div className="ui-toast" key={toast._ts}>
      {toast.text}
    </div>
  )
}

export default UiToast

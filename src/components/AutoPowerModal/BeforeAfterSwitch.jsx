import React from 'react'
import { useRadioPreviewStore } from '@/store/useRadioPreviewStore'

// Before / after switch for a planning dialog's heatmap preview
// (useRadioPreview): the field without or with the plan.
function BeforeAfterSwitch() {
  const showBefore = useRadioPreviewStore((s) => s.showBefore)
  const setShowBefore = useRadioPreviewStore((s) => s.setShowBefore)
  return (
    <div className="auto-power-modal__compare">
      <span>熱圖</span>
      <span className="auto-power-modal__seg" role="group" aria-label="熱圖顯示套用前或套用後">
        <button
          type="button"
          className={`auto-power-modal__seg-btn${showBefore ? ' auto-power-modal__seg-btn--active' : ''}`}
          aria-pressed={showBefore}
          onClick={() => setShowBefore(true)}
        >套用前</button>
        <button
          type="button"
          className={`auto-power-modal__seg-btn${!showBefore ? ' auto-power-modal__seg-btn--active' : ''}`}
          aria-pressed={!showBefore}
          onClick={() => setShowBefore(false)}
        >套用後</button>
      </span>
    </div>
  )
}

export default BeforeAfterSwitch

import React from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import './PanelRight.sass'

// Skeleton — selection-driven panels return one by one when the
// supporting stores arrive (wall / AP / switch / tray / scope / hole /
// floor_image / floor_align). For now we mount the slide-in shell so
// the layout matches oldSrc.
function PanelRight() {
  const selectedId = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const selectedItems = useEditorStore((s) => s.selectedItems)

  const isBatch = selectedItems.length > 1
  const hasSelection = !!selectedId || isBatch
  const isOpen = hasSelection

  return (
    <aside className={`panel-right${isOpen ? ' panel-right--open' : ''}`}>
      <div className="panel-right__placeholder">
        {hasSelection ? (
          <div>
            <div className="panel-right__placeholder-title">
              {isBatch ? '批次選取' : selectedType ?? '已選取'}
            </div>
            <div className="panel-right__placeholder-hint">
              對應屬性面板將在 Phase 25 後段隨各 Layer 互動補回
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

export default PanelRight

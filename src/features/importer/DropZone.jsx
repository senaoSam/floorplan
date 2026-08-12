import React, { useRef, useState, useCallback } from 'react'
import { useFloorImport } from './useFloorImport'
import './DropZone.sass'

// 52-D5: this component had the right copy all along but was never mounted —
// dead code since the Phase 25 port, which is why a first-time user faced a
// blank canvas with no hint. CanvasArea now renders it whenever there is no
// floor. It also still referenced `useWarmupStore`, a store deleted somewhere
// along the way; being unmounted, nothing ever surfaced the broken import.
function DropZone() {
  const fileInputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const { processFile, loadingMsg, isLoading } = useFloorImport()

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    processFile(e.dataTransfer.files?.[0])
  }, [processFile])

  const handleDragOver  = useCallback((e) => { e.preventDefault(); setIsDragging(true) }, [])
  const handleDragLeave = useCallback(() => setIsDragging(false), [])
  const handleFileChange = useCallback((e) => {
    processFile(e.target.files?.[0])
    e.target.value = ''
  }, [processFile])

  const busy = isLoading

  return (
    <div
      className={`drop-zone${isDragging ? ' drop-zone--dragging' : ''}${busy ? ' drop-zone--loading' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => !busy && fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.pdf"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      {busy ? (
        <div className="drop-zone__spinner" />
      ) : (
        <div className="drop-zone__icon">🗺</div>
      )}
      <p className="drop-zone__title">
        {isLoading ? loadingMsg : '拖曳平面圖至此'}
      </p>
      {!busy && (
        <>
          <p className="drop-zone__sub">或點擊選擇檔案</p>
          <p className="drop-zone__hint">支援 PNG、JPG、PDF（多頁自動拆樓層）</p>
        </>
      )}
    </div>
  )
}

export default DropZone

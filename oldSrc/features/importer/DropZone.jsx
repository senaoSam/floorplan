import React, { useRef, useState, useCallback } from 'react'
import { useFloorImport } from './useFloorImport'
import { useWarmupStore } from '@/store/useWarmupStore'
import './DropZone.sass'

function DropZone() {
  const fileInputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const { processFile, loadingMsg, isLoading } = useFloorImport()
  const warmingUp = useWarmupStore((s) => s.warmingUp)

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    if (warmingUp) return
    processFile(e.dataTransfer.files?.[0])
  }, [processFile, warmingUp])

  const handleDragOver  = useCallback((e) => { e.preventDefault(); if (!warmingUp) setIsDragging(true) }, [warmingUp])
  const handleDragLeave = useCallback(() => setIsDragging(false), [])
  const handleFileChange = useCallback((e) => {
    processFile(e.target.files?.[0])
    e.target.value = ''
  }, [processFile])

  const busy = isLoading || warmingUp

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
        {warmingUp ? '初始化熱力圖引擎…' : isLoading ? loadingMsg : '拖曳平面圖至此'}
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

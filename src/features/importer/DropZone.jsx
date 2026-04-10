import React, { useRef, useState, useCallback } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { renderPdfPageToBlob } from '@/utils/pdfUtils'
import './DropZone.sass'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

function DropZone() {
  const fileInputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const importImageFloor = useFloorStore((s) => s.importImageFloor)

  const processFile = useCallback(async (file) => {
    if (!file) return

    setIsLoading(true)

    try {
      if (IMAGE_TYPES.includes(file.type)) {
        // PNG / JPG
        const img = new window.Image()
        img.onload = () => {
          importImageFloor(file, img.naturalWidth, img.naturalHeight)
          setIsLoading(false)
        }
        img.src = URL.createObjectURL(file)

      } else if (file.type === 'application/pdf') {
        // PDF：渲染第一頁為圖片
        const arrayBuffer = await file.arrayBuffer()
        const { blob, width, height } = await renderPdfPageToBlob(arrayBuffer, 1)
        importImageFloor(blob, width, height)
        setIsLoading(false)

      } else {
        setIsLoading(false)
      }
    } catch (err) {
      console.error('匯入失敗', err)
      setIsLoading(false)
    }
  }, [importImageFloor])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    processFile(e.dataTransfer.files?.[0])
  }, [processFile])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  const handleFileChange = useCallback((e) => {
    processFile(e.target.files?.[0])
    e.target.value = ''
  }, [processFile])

  return (
    <div
      className={`drop-zone${isDragging ? ' drop-zone--dragging' : ''}${isLoading ? ' drop-zone--loading' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => !isLoading && fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.pdf"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <div className="drop-zone__icon">{isLoading ? '⏳' : '🗺'}</div>
      <p className="drop-zone__title">
        {isLoading ? '載入中…' : '拖曳平面圖至此'}
      </p>
      {!isLoading && (
        <>
          <p className="drop-zone__sub">或點擊選擇檔案</p>
          <p className="drop-zone__hint">支援 PNG、JPG、PDF</p>
        </>
      )}
    </div>
  )
}

export default DropZone

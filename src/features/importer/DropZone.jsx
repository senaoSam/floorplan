import React, { useRef, useState, useCallback } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { renderPdfPageToBlob, renderAllPdfPages } from '@/utils/pdfUtils'
import './DropZone.sass'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

function DropZone() {
  const fileInputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState(null)

  const importImageFloor    = useFloorStore((s) => s.importImageFloor)
  const importMultipleFloors = useFloorStore((s) => s.importMultipleFloors)

  const processFile = useCallback(async (file) => {
    if (!file) return

    try {
      if (IMAGE_TYPES.includes(file.type)) {
        setLoadingMsg('載入圖片中…')
        const img = new window.Image()
        img.onload = () => {
          importImageFloor(file, img.naturalWidth, img.naturalHeight)
          setLoadingMsg(null)
        }
        img.src = URL.createObjectURL(file)

      } else if (file.type === 'application/pdf') {
        setLoadingMsg('解析 PDF…')
        const arrayBuffer = await file.arrayBuffer()

        // 先快速取得頁數
        const { pageCount } = await renderPdfPageToBlob(arrayBuffer.slice(0), 1)

        if (pageCount === 1) {
          const { blob, width, height } = await renderPdfPageToBlob(arrayBuffer, 1)
          importImageFloor(blob, width, height)
        } else {
          setLoadingMsg(`渲染 PDF（共 ${pageCount} 頁）…`)
          const { pages } = await renderAllPdfPages(arrayBuffer)
          importMultipleFloors(pages)
        }
        setLoadingMsg(null)
      }
    } catch (err) {
      console.error('匯入失敗', err)
      setLoadingMsg(null)
    }
  }, [importImageFloor, importMultipleFloors])

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

  const isLoading = loadingMsg !== null

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
        {isLoading ? loadingMsg : '拖曳平面圖至此'}
      </p>
      {!isLoading && (
        <>
          <p className="drop-zone__sub">或點擊選擇檔案</p>
          <p className="drop-zone__hint">支援 PNG、JPG、PDF（多頁自動拆樓層）</p>
        </>
      )}
    </div>
  )
}

export default DropZone

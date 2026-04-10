import React, { useRef, useState, useCallback } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import './DropZone.sass'

const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg']

function DropZone() {
  const fileInputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const importImageFloor = useFloorStore((s) => s.importImageFloor)

  const processFile = useCallback((file) => {
    if (!file || !ACCEPTED.includes(file.type)) return

    const img = new window.Image()
    img.onload = () => {
      importImageFloor(file, img.naturalWidth, img.naturalHeight)
    }
    img.src = URL.createObjectURL(file)
  }, [importImageFloor])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    processFile(file)
  }, [processFile])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleFileChange = useCallback((e) => {
    processFile(e.target.files?.[0])
    e.target.value = ''
  }, [processFile])

  return (
    <div
      className={`drop-zone${isDragging ? ' drop-zone--dragging' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <div className="drop-zone__icon">🗺</div>
      <p className="drop-zone__title">拖曳平面圖至此</p>
      <p className="drop-zone__sub">或點擊選擇檔案</p>
      <p className="drop-zone__hint">支援 PNG、JPG（PDF 即將支援）</p>
    </div>
  )
}

export default DropZone

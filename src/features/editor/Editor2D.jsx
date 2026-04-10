import React, { useRef, useState, useEffect, useCallback } from 'react'
import { Stage, Layer, Rect } from 'react-konva'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import FloorImageLayer from './layers/FloorImageLayer'
import DropZone from '@/features/importer/DropZone'
import './Editor2D.sass'

const SCALE_BY = 1.08
const SCALE_MIN = 0.05
const SCALE_MAX = 20
const FIT_PADDING = 0.85  // 圖片最多佔畫布的 85%

function Editor2D() {
  const containerRef = useRef(null)
  const stageRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 })

  const { editorMode } = useEditorStore()
  const isPanMode = editorMode === EDITOR_MODE.PAN

  const floors = useFloorStore((s) => s.floors)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const getActiveFloor = useFloorStore((s) => s.getActiveFloor)
  const activeFloor = getActiveFloor()
  const hasFloor = floors.length > 0

  // 監聽容器尺寸
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSize({ width, height })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // 匯入新樓層後自動 fit-to-screen
  useEffect(() => {
    if (!activeFloor?.imageUrl || size.width === 0) return

    const scaleX = (size.width * FIT_PADDING) / activeFloor.imageWidth
    const scaleY = (size.height * FIT_PADDING) / activeFloor.imageHeight
    const scale = Math.min(scaleX, scaleY)

    const x = (size.width - activeFloor.imageWidth * scale) / 2
    const y = (size.height - activeFloor.imageHeight * scale) / 2

    setViewport({ x, y, scale })
  }, [activeFloorId])  // 只在切換樓層時觸發

  // 滾輪縮放
  const handleWheel = useCallback((e) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    const oldScale = viewport.scale
    const pointer = stage.getPointerPosition()

    const mousePointTo = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale,
    }

    const direction = e.evt.deltaY < 0 ? 1 : -1
    const newScale = Math.min(
      SCALE_MAX,
      Math.max(SCALE_MIN, direction > 0 ? oldScale * SCALE_BY : oldScale / SCALE_BY)
    )

    setViewport({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })
  }, [viewport])

  const handleDragEnd = useCallback((e) => {
    const stage = e.target
    setViewport((prev) => ({
      ...prev,
      x: stage.x(),
      y: stage.y(),
    }))
  }, [])

  // 中鍵拖曳平移
  const handleMouseDown = useCallback((e) => {
    if (e.evt.button === 1) {
      e.evt.preventDefault()
      stageRef.current.draggable(true)
    }
  }, [])

  const handleMouseUp = useCallback((e) => {
    if (e.evt.button === 1 && !isPanMode) {
      stageRef.current.draggable(false)
    }
  }, [isPanMode])

  return (
    <div ref={containerRef} className="editor-2d">
      {!hasFloor && <DropZone />}

      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          draggable={isPanMode}
          onWheel={handleWheel}
          onDragEnd={handleDragEnd}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        >
          <Layer>
            <Rect
              x={-50000}
              y={-50000}
              width={100000}
              height={100000}
              fill="#1e1e2e"
            />
          </Layer>

          {activeFloor && <FloorImageLayer floor={activeFloor} />}
        </Stage>
      )}
    </div>
  )
}

export default Editor2D

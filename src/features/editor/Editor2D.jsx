import React, { useRef, useState, useEffect, useCallback } from 'react'
import { Stage, Layer, Rect } from 'react-konva'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import FloorImageLayer from './layers/FloorImageLayer'
import ScaleLayer from './layers/ScaleLayer'
import ScaleDialog from './ScaleDialog'
import DropZone from '@/features/importer/DropZone'
import './Editor2D.sass'

const SCALE_BY = 1.08
const SCALE_MIN = 0.05
const SCALE_MAX = 20
const FIT_PADDING = 0.85

function Editor2D() {
  const containerRef = useRef(null)
  const stageRef     = useRef(null)
  const [size, setSize]       = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 })

  // 比例尺繪製狀態
  const [scalePt1, setScalePt1]       = useState(null)
  const [scalePt2, setScalePt2]       = useState(null)
  const [mousePos, setMousePos]       = useState(null)
  const [showScaleDialog, setShowScaleDialog] = useState(false)

  const { editorMode, setEditorMode } = useEditorStore()
  const isPanMode       = editorMode === EDITOR_MODE.PAN
  const isScaleMode     = editorMode === EDITOR_MODE.DRAW_SCALE

  const floors         = useFloorStore((s) => s.floors)
  const activeFloorId  = useFloorStore((s) => s.activeFloorId)
  const getActiveFloor = useFloorStore((s) => s.getActiveFloor)
  const setScale       = useFloorStore((s) => s.setScale)
  const activeFloor    = getActiveFloor()

  // 取得 canvas 座標（把 screen 座標反轉回 stage local 座標）
  const toCanvasPos = useCallback((screenPos) => ({
    x: (screenPos.x - viewport.x) / viewport.scale,
    y: (screenPos.y - viewport.y) / viewport.scale,
  }), [viewport])

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

  // 切換樓層時 fit-to-screen
  useEffect(() => {
    if (!activeFloor?.imageUrl || size.width === 0) return
    const scaleX = (size.width  * FIT_PADDING) / activeFloor.imageWidth
    const scaleY = (size.height * FIT_PADDING) / activeFloor.imageHeight
    const scale  = Math.min(scaleX, scaleY)
    setViewport({
      scale,
      x: (size.width  - activeFloor.imageWidth  * scale) / 2,
      y: (size.height - activeFloor.imageHeight * scale) / 2,
    })
  }, [activeFloorId])

  // ── 滾輪縮放 ──────────────────────────────────────────
  const handleWheel = useCallback((e) => {
    e.evt.preventDefault()
    const stage    = stageRef.current
    const oldScale = viewport.scale
    const pointer  = stage.getPointerPosition()
    const mousePointTo = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale,
    }
    const dir      = e.evt.deltaY < 0 ? 1 : -1
    const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN,
      dir > 0 ? oldScale * SCALE_BY : oldScale / SCALE_BY
    ))
    setViewport({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })
  }, [viewport])

  const handleDragEnd = useCallback((e) => {
    const stage = e.target
    setViewport((prev) => ({ ...prev, x: stage.x(), y: stage.y() }))
  }, [])

  // ── 中鍵平移 ──────────────────────────────────────────
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

  // ── 比例尺模式：滑鼠移動 ──────────────────────────────
  const handleMouseMove = useCallback((e) => {
    if (!isScaleMode || showScaleDialog) return
    const pos = stageRef.current.getPointerPosition()
    setMousePos(toCanvasPos(pos))
  }, [isScaleMode, showScaleDialog, toCanvasPos])

  // ── 比例尺模式：點擊 ──────────────────────────────────
  const handleStageClick = useCallback((e) => {
    if (!isScaleMode || showScaleDialog) return
    if (e.evt.button !== 0) return

    const pos = toCanvasPos(stageRef.current.getPointerPosition())

    if (!scalePt1) {
      setScalePt1(pos)
    } else {
      setScalePt2(pos)
      setShowScaleDialog(true)
    }
  }, [isScaleMode, showScaleDialog, scalePt1, toCanvasPos])

  // ── 比例尺確認 ────────────────────────────────────────
  const handleScaleConfirm = useCallback((meters) => {
    const dist = Math.hypot(scalePt2.x - scalePt1.x, scalePt2.y - scalePt1.y)
    setScale(dist / meters)
    resetScale()
    setEditorMode(EDITOR_MODE.SELECT)
  }, [scalePt1, scalePt2, setScale, setEditorMode])

  const resetScale = () => {
    setScalePt1(null)
    setScalePt2(null)
    setMousePos(null)
    setShowScaleDialog(false)
  }

  const handleScaleCancel = () => {
    resetScale()
    setEditorMode(EDITOR_MODE.SELECT)
  }

  // 離開比例尺模式時清除
  useEffect(() => {
    if (!isScaleMode) resetScale()
  }, [isScaleMode])

  const pixelDist = scalePt1 && scalePt2
    ? Math.round(Math.hypot(scalePt2.x - scalePt1.x, scalePt2.y - scalePt1.y))
    : 0

  const stageCursor = isScaleMode ? 'crosshair' : isPanMode ? 'grab' : 'default'

  return (
    <div ref={containerRef} className="editor-2d" style={{ cursor: stageCursor }}>
      {floors.length === 0 && <DropZone />}

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
          onMouseMove={handleMouseMove}
          onClick={handleStageClick}
        >
          {/* 底色 */}
          <Layer>
            <Rect x={-50000} y={-50000} width={100000} height={100000} fill="#1e1e2e" />
          </Layer>

          {/* 平面圖 */}
          {activeFloor && <FloorImageLayer floor={activeFloor} />}

          {/* 比例尺量測線 */}
          {isScaleMode && (
            <ScaleLayer pt1={scalePt1} pt2={scalePt2} mousePos={mousePos} />
          )}
        </Stage>
      )}

      {/* 比例尺輸入 Dialog */}
      {showScaleDialog && (
        <ScaleDialog
          pixelDist={pixelDist}
          onConfirm={handleScaleConfirm}
          onCancel={handleScaleCancel}
        />
      )}
    </div>
  )
}

export default Editor2D

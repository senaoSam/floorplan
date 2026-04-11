import React, { useRef, useState, useEffect, useCallback } from 'react'
import { Stage, Layer, Rect } from 'react-konva'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { MATERIALS } from '@/constants/materials'
import { generateId } from '@/utils/id'
import FloorImageLayer from './layers/FloorImageLayer'
import WallLayer from './layers/WallLayer'
import APLayer from './layers/APLayer'
import ScopeLayer from './layers/ScopeLayer'
import FloorHoleLayer from './layers/FloorHoleLayer'
import ScaleLayer from './layers/ScaleLayer'
import ScaleDialog from './ScaleDialog'
import DropZone from '@/features/importer/DropZone'
import './Editor2D.sass'

const SCALE_BY    = 1.08
const SCALE_MIN   = 0.05
const SCALE_MAX   = 20
const FIT_PADDING = 0.85
const SNAP_PX     = 12   // screen pixels for first-point snap

function Editor2D() {
  const containerRef = useRef(null)
  const stageRef     = useRef(null)
  const [size, setSize]         = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 })
  const [mousePos, setMousePos] = useState(null)

  // ── 比例尺狀態 ─────────────────────────────────────────
  const [scalePt1, setScalePt1]               = useState(null)
  const [scalePt2, setScalePt2]               = useState(null)
  const [showScaleDialog, setShowScaleDialog] = useState(false)

  // ── 牆體繪製狀態 ───────────────────────────────────────
  const [wallDrawStart, setWallDrawStart] = useState(null)

  // ── 範圍區域繪製狀態 ───────────────────────────────────
  const [scopePoints, setScopePoints] = useState([])  // [{x,y}, ...]

  // ── Floor Hole 繪製狀態 ────────────────────────────────
  const [floorHolePoints, setFloorHolePoints] = useState([])  // [{x,y}, ...]

  const { editorMode, setEditorMode, selectedId, selectedType, setSelected, clearSelected } = useEditorStore()
  const isPanMode   = editorMode === EDITOR_MODE.PAN
  const isScaleMode = editorMode === EDITOR_MODE.DRAW_SCALE
  const isWallMode  = editorMode === EDITOR_MODE.DRAW_WALL
  const isAPMode    = editorMode === EDITOR_MODE.PLACE_AP
  const isScopeMode     = editorMode === EDITOR_MODE.DRAW_SCOPE
  const isFloorHoleMode = editorMode === EDITOR_MODE.DRAW_FLOOR_HOLE

  const floors         = useFloorStore((s) => s.floors)
  const activeFloorId  = useFloorStore((s) => s.activeFloorId)
  const getActiveFloor = useFloorStore((s) => s.getActiveFloor)
  const setScale       = useFloorStore((s) => s.setScale)
  const activeFloor    = getActiveFloor()

  const addWall = useWallStore((s) => s.addWall)

  const addAP   = useAPStore((s) => s.addAP)
  const apCount = useAPStore((s) => (s.apsByFloor[activeFloorId] ?? []).length)

  const addScope = useScopeStore((s) => s.addScope)

  const addFloorHole = useFloorHoleStore((s) => s.addFloorHole)

  // ── 座標轉換 ───────────────────────────────────────────
  const toCanvasPos = useCallback((screenPos) => ({
    x: (screenPos.x - viewport.x) / viewport.scale,
    y: (screenPos.y - viewport.y) / viewport.scale,
  }), [viewport])

  // ── 容器尺寸監聽 ───────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSize({ width, height })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // ── 切換樓層 fit-to-screen ─────────────────────────────
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

  // ── 鍵盤事件 ───────────────────────────────────────────
  const removeWall  = useWallStore((s) => s.removeWall)
  const removeAP    = useAPStore((s) => s.removeAP)
  const removeScope     = useScopeStore((s) => s.removeScope)
  const removeFloorHole = useFloorHoleStore((s) => s.removeFloorHole)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setWallDrawStart(null)
        setScopePoints([])
        setFloorHolePoints([])
        resetScale()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = e.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if (selectedId && selectedType === 'wall') {
          removeWall(activeFloorId, selectedId)
          clearSelected()
        }
        if (selectedId && selectedType === 'ap') {
          removeAP(activeFloorId, selectedId)
          clearSelected()
        }
        if (selectedId && selectedType === 'scope') {
          removeScope(activeFloorId, selectedId)
          clearSelected()
        }
        if (selectedId && selectedType === 'floor_hole') {
          removeFloorHole(activeFloorId, selectedId)
          clearSelected()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, selectedType, activeFloorId, removeWall, removeAP, removeScope, removeFloorHole, clearSelected])

  // ── 切換模式時清除繪製狀態 ────────────────────────────
  useEffect(() => {
    setWallDrawStart(null)
    setScopePoints([])
    setFloorHolePoints([])
    if (!isScaleMode) resetScale()
  }, [editorMode])

  // ── 滾輪縮放 ───────────────────────────────────────────
  const handleWheel = useCallback((e) => {
    e.evt.preventDefault()
    const stage    = stageRef.current
    const oldScale = viewport.scale
    const pointer  = stage.getPointerPosition()
    const to = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale,
    }
    const dir      = e.evt.deltaY < 0 ? 1 : -1
    const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN,
      dir > 0 ? oldScale * SCALE_BY : oldScale / SCALE_BY
    ))
    setViewport({ scale: newScale, x: pointer.x - to.x * newScale, y: pointer.y - to.y * newScale })
  }, [viewport])

  const handleDragEnd = useCallback((e) => {
    const s = e.target
    setViewport((prev) => ({ ...prev, x: s.x(), y: s.y() }))
  }, [])

  // ── 中鍵：防止預設行為（開新分頁等）────────────────────
  const handleMouseDown = useCallback((e) => {
    if (e.evt.button === 1) e.evt.preventDefault()
  }, [])

  // ── 滑鼠移動：更新 ghost 線 ────────────────────────────
  const handleMouseMove = useCallback(() => {
    const pos = stageRef.current?.getPointerPosition()
    if (pos) setMousePos(toCanvasPos(pos))
  }, [toCanvasPos])

  // ── 點擊：分流到各模式 ─────────────────────────────────
  const handleStageClick = useCallback((e) => {
    if (e.evt.button !== 0) return

    const pos = toCanvasPos(stageRef.current.getPointerPosition())

    // 比例尺
    if (isScaleMode && !showScaleDialog) {
      if (!scalePt1) { setScalePt1(pos) }
      else           { setScalePt2(pos); setShowScaleDialog(true) }
      return
    }

    // 牆體
    if (isWallMode) {
      if (!wallDrawStart) {
        setWallDrawStart(pos)
      } else {
        addWall(activeFloorId, {
          id: generateId('wall'),
          startX: wallDrawStart.x, startY: wallDrawStart.y,
          endX: pos.x,             endY: pos.y,
          material: MATERIALS.CONCRETE,
          topHeight: 3.0,
          bottomHeight: 0,
        })
        setWallDrawStart(pos)
      }
      return
    }

    // AP 放置
    if (isAPMode) {
      addAP(activeFloorId, {
        id: generateId('ap'),
        x: pos.x, y: pos.y,
        z: 2.4,
        txPower: 20,
        frequency: 5,
        antennaMode: 'omni',
        mountType: 'ceiling',
        name: `AP-${String(apCount + 1).padStart(2, '0')}`,
        color: '#4fc3f7',
      })
      return
    }

    // 範圍區域
    if (isScopeMode) {
      setScopePoints((prev) => {
        // 吸附第一點：距離 < SNAP_PX / scale → 閉合多邊形
        if (prev.length >= 3) {
          const snapDist = SNAP_PX / viewport.scale
          const dx = pos.x - prev[0].x
          const dy = pos.y - prev[0].y
          if (Math.hypot(dx, dy) < snapDist) {
            addScope(activeFloorId, {
              id: generateId('scope'),
              points: prev.flatMap((p) => [p.x, p.y]),
              type: 'in',
            })
            return []
          }
        }
        return [...prev, pos]
      })
      return
    }

    // Floor Hole
    if (isFloorHoleMode) {
      setFloorHolePoints((prev) => {
        if (prev.length >= 3) {
          const snapDist = SNAP_PX / viewport.scale
          const dx = pos.x - prev[0].x
          const dy = pos.y - prev[0].y
          if (Math.hypot(dx, dy) < snapDist) {
            addFloorHole(activeFloorId, {
              id: generateId('hole'),
              points: prev.flatMap((p) => [p.x, p.y]),
            })
            return []
          }
        }
        return [...prev, pos]
      })
      return
    }

    // 其他模式點擊空白 → 取消選取
    clearSelected()
  }, [
    isScaleMode, showScaleDialog, scalePt1,
    isWallMode, wallDrawStart, activeFloorId,
    isAPMode, apCount,
    isScopeMode, viewport.scale, addScope,
    isFloorHoleMode, addFloorHole,
    toCanvasPos, addWall, addAP, clearSelected,
  ])

  // ── 右鍵：停止繪製 ─────────────────────────────────────
  const handleContextMenu = useCallback((e) => {
    e.evt.preventDefault()
    if (isWallMode) setWallDrawStart(null)
    if (isScopeMode) setScopePoints([])
    if (isFloorHoleMode) setFloorHolePoints([])
  }, [isWallMode, isScopeMode, isFloorHoleMode])

  // ── 比例尺 helpers ─────────────────────────────────────
  const resetScale = () => {
    setScalePt1(null); setScalePt2(null); setShowScaleDialog(false)
  }

  const handleScaleConfirm = useCallback((meters) => {
    const dist = Math.hypot(scalePt2.x - scalePt1.x, scalePt2.y - scalePt1.y)
    setScale(dist / meters)
    resetScale()
    setEditorMode(EDITOR_MODE.SELECT)
  }, [scalePt1, scalePt2, setScale, setEditorMode])

  const handleScaleCancel = () => { resetScale(); setEditorMode(EDITOR_MODE.SELECT) }

  const pixelDist = scalePt1 && scalePt2
    ? Math.round(Math.hypot(scalePt2.x - scalePt1.x, scalePt2.y - scalePt1.y)) : 0

  const stageCursor =
    isScaleMode || isWallMode || isScopeMode || isFloorHoleMode ? 'crosshair' :
    isPanMode                                                    ? 'grab'      : 'default'

  return (
    <div ref={containerRef} className="editor-2d" style={{ cursor: stageCursor }}>
      {floors.length === 0 && <DropZone />}

      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}  height={size.height}
          x={viewport.x}      y={viewport.y}
          scaleX={viewport.scale} scaleY={viewport.scale}
          draggable
          onWheel={handleWheel}
          onDragEnd={handleDragEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onClick={handleStageClick}
          onContextMenu={handleContextMenu}
        >
          <Layer>
            <Rect x={-50000} y={-50000} width={100000} height={100000} fill="#1e1e2e" />
          </Layer>

          {activeFloor && <FloorImageLayer floor={activeFloor} />}

          {activeFloorId && (
            <ScopeLayer
              floorId={activeFloorId}
              drawingPoints={isScopeMode ? scopePoints : []}
              mousePos={mousePos}
              snapRadius={SNAP_PX / viewport.scale}
              selectedScopeId={selectedType === 'scope' ? selectedId : null}
              onScopeClick={(id) => setSelected(id, 'scope')}
            />
          )}

          {activeFloorId && (
            <FloorHoleLayer
              floorId={activeFloorId}
              drawingPoints={isFloorHoleMode ? floorHolePoints : []}
              mousePos={mousePos}
              snapRadius={SNAP_PX / viewport.scale}
              selectedHoleId={selectedType === 'floor_hole' ? selectedId : null}
              onHoleClick={(id) => setSelected(id, 'floor_hole')}
            />
          )}

          {activeFloorId && (
            <WallLayer
              floorId={activeFloorId}
              drawStart={isWallMode ? wallDrawStart : null}
              mousePos={mousePos}
              selectedWallId={selectedType === 'wall' ? selectedId : null}
              onWallClick={(id) => setSelected(id, 'wall')}
            />
          )}

          {activeFloorId && (
            <APLayer
              floorId={activeFloorId}
              selectedAPId={selectedType === 'ap' ? selectedId : null}
              onAPClick={(id) => setSelected(id, 'ap')}
            />
          )}

          {isScaleMode && (
            <ScaleLayer pt1={scalePt1} pt2={scalePt2} mousePos={mousePos} />
          )}
        </Stage>
      )}

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

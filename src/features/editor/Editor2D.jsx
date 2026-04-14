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
import HeatmapWebGL from './HeatmapWebGL'
import ScaleDialog from './ScaleDialog'
import LayerToggle from '@/components/LayerToggle/LayerToggle'
import DropZone from '@/features/importer/DropZone'
import './Editor2D.sass'

const SCALE_BY    = 1.08
const SCALE_MIN   = 0.05
const SCALE_MAX   = 20
const FIT_PADDING = 0.85
const SNAP_PX     = 12   // screen pixels for first-point snap

function Editor2D() {
  const containerRef  = useRef(null)
  const stageRef      = useRef(null)
  const draggingAPRef          = useRef(null)   // { id, x, y } AP 拖移中暫存位置
  const draggingWallRef        = useRef(null)   // { id, dx, dy } 牆體拖移中暫存偏移
  const draggingScopeRef       = useRef(null)   // { id, dx, dy } Scope 拖移中暫存偏移
  const rightDragPendingRef    = useRef(null)   // { node, startX, startY } 右鍵等待拖曳
  const suppressContextMenuRef = useRef(false)  // 右鍵拖曳發生後略過下一次 contextMenu
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

  const { editorMode, setEditorMode, selectedId, selectedType, setSelected, clearSelected, togglePanelCollapsed,
          showFloorImage, showScopes, showFloorHoles, showWalls, showAPs } = useEditorStore()
  const isSelectMode    = editorMode === EDITOR_MODE.SELECT
  const isPanMode       = editorMode === EDITOR_MODE.PAN
  const isScaleMode     = editorMode === EDITOR_MODE.DRAW_SCALE
  const isWallMode      = editorMode === EDITOR_MODE.DRAW_WALL
  const isAPMode        = editorMode === EDITOR_MODE.PLACE_AP
  const isScopeMode     = editorMode === EDITOR_MODE.DRAW_SCOPE
  const isFloorHoleMode = editorMode === EDITOR_MODE.DRAW_FLOOR_HOLE

  const floors         = useFloorStore((s) => s.floors)
  const activeFloorId  = useFloorStore((s) => s.activeFloorId)
  const getActiveFloor = useFloorStore((s) => s.getActiveFloor)
  const setScale       = useFloorStore((s) => s.setScale)
  const activeFloor    = getActiveFloor()

  const addWall = useWallStore((s) => s.addWall)

  const addAP     = useAPStore((s) => s.addAP)
  const nextAPName = useAPStore((s) => s.nextAPName)

  const addScope = useScopeStore((s) => s.addScope)

  const addFloorHole = useFloorHoleStore((s) => s.addFloorHole)

  // ── 座標轉換 ───────────────────────────────────────────
  const toCanvasPos = useCallback((screenPos) => ({
    x: (screenPos.x - viewport.x) / viewport.scale,
    y: (screenPos.y - viewport.y) / viewport.scale,
  }), [viewport])

  // ── 容器尺寸監聽（rAF 批次，避免 Panel 動畫期間多次 resize 抖動）
  useEffect(() => {
    if (!containerRef.current) return
    let rafId = null
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => { setSize({ width, height }) })
    })
    observer.observe(containerRef.current)
    return () => { observer.disconnect(); if (rafId) cancelAnimationFrame(rafId) }
  }, [])

  // ── 切換樓層 fit-to-screen ─────────────────────────────
  useEffect(() => {
    // 切換樓層時清除繪製中狀態
    setScalePt1(null); setScalePt2(null); setShowScaleDialog(false)
    setWallDrawStart(null); setScopePoints([]); setFloorHolePoints([])

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

  const handleMouseUp = useCallback((e) => {
    if (e.evt.button === 2) rightDragPendingRef.current = null
  }, [])

  const handleRightMouseDown = useCallback((node) => {
    const pos = stageRef.current?.getPointerPosition()
    if (pos) rightDragPendingRef.current = { node, startX: pos.x, startY: pos.y }
  }, [])

  // ── 牆體端點吸附 ──────────────────────────────────────
  const snapToWallEndpoint = useCallback((pos) => {
    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    const snapDist = SNAP_PX / viewport.scale
    for (const w of walls) {
      for (const ep of [{ x: w.startX, y: w.startY }, { x: w.endX, y: w.endY }]) {
        if (Math.hypot(pos.x - ep.x, pos.y - ep.y) < snapDist) return ep
      }
    }
    return pos
  }, [activeFloorId, viewport.scale])

  // ── 滑鼠移動：右鍵拖曳閾值判斷 / 更新 ghost 線 ─────────
  const handleMouseMove = useCallback(() => {
    const pos = stageRef.current?.getPointerPosition()
    if (!pos) return

    // 右鍵按住：超過 5px 才啟動拖曳
    if (rightDragPendingRef.current) {
      const { node, startX, startY } = rightDragPendingRef.current
      if (Math.hypot(pos.x - startX, pos.y - startY) > 5) {
        suppressContextMenuRef.current = true
        rightDragPendingRef.current = null
        node.startDrag()
      }
      return
    }

    const canvasPos = toCanvasPos(pos)
    setMousePos(isWallMode ? snapToWallEndpoint(canvasPos) : canvasPos)
  }, [toCanvasPos, isWallMode, snapToWallEndpoint])

  // ── 點擊：分流到各模式 ─────────────────────────────────
  const handleStageClick = useCallback((e) => {
    if (e.evt.button !== 0) return

    const rawPos = toCanvasPos(stageRef.current.getPointerPosition())
    const pos = isWallMode ? snapToWallEndpoint(rawPos) : rawPos

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
        channel: 36,
        antennaMode: 'omni',
        mountType: 'ceiling',
        name: nextAPName(),
        color: '#4fc3f7',
      })
      return
    }

    // 範圍區域
    if (isScopeMode) {
      // 吸附第一點：距離 < SNAP_PX / scale → 閉合多邊形
      if (scopePoints.length >= 3) {
        const snapDist = SNAP_PX / viewport.scale
        const dx = pos.x - scopePoints[0].x
        const dy = pos.y - scopePoints[0].y
        if (Math.hypot(dx, dy) < snapDist) {
          addScope(activeFloorId, {
            id: generateId('scope'),
            points: scopePoints.flatMap((p) => [p.x, p.y]),
            type: 'in',
          })
          setScopePoints([])
          return
        }
      }
      setScopePoints((prev) => [...prev, pos])
      return
    }

    // Floor Hole
    if (isFloorHoleMode) {
      if (floorHolePoints.length >= 3) {
        const snapDist = SNAP_PX / viewport.scale
        const dx = pos.x - floorHolePoints[0].x
        const dy = pos.y - floorHolePoints[0].y
        if (Math.hypot(dx, dy) < snapDist) {
          addFloorHole(activeFloorId, {
            id: generateId('hole'),
            points: floorHolePoints.flatMap((p) => [p.x, p.y]),
          })
          setFloorHolePoints([])
          return
        }
      }
      setFloorHolePoints((prev) => [...prev, pos])
      return
    }

    // 其他模式點擊空白 → 取消選取
    clearSelected()
  }, [
    isScaleMode, showScaleDialog, scalePt1,
    isWallMode, wallDrawStart, activeFloorId, snapToWallEndpoint,
    isAPMode, nextAPName,
    isScopeMode, scopePoints, viewport.scale, addScope,
    isFloorHoleMode, floorHolePoints, addFloorHole,
    toCanvasPos, addWall, addAP, clearSelected,
  ])

  // ── 右鍵：有繪製進行中 → 停止繪製；否則 → 切換 Panel 收合 ──
  const handleContextMenu = useCallback((e) => {
    e.evt.preventDefault()
    if (suppressContextMenuRef.current) { suppressContextMenuRef.current = false; return }
    if (isWallMode && wallDrawStart)           { setWallDrawStart(null); return }
    if (isScopeMode && scopePoints.length > 0) { setScopePoints([]);     return }
    if (isFloorHoleMode && floorHolePoints.length > 0) { setFloorHolePoints([]); return }
    togglePanelCollapsed()
  }, [isWallMode, wallDrawStart, isScopeMode, scopePoints, isFloorHoleMode, floorHolePoints, togglePanelCollapsed])

  // ── 比例尺 helpers ─────────────────────────────────────
  const resetScale = () => {
    setScalePt1(null); setScalePt2(null); setShowScaleDialog(false)
  }

  const handleScaleConfirm = useCallback((meters) => {
    if (!scalePt1 || !scalePt2) return
    const dist = Math.hypot(scalePt2.x - scalePt1.x, scalePt2.y - scalePt1.y)
    if (dist < 1) return
    setScale(dist / meters)
    resetScale()
    setEditorMode(EDITOR_MODE.SELECT)
  }, [scalePt1, scalePt2, setScale, setEditorMode])

  const handleScaleCancel = () => { resetScale(); setEditorMode(EDITOR_MODE.SELECT) }

  const pixelDist = scalePt1 && scalePt2
    ? Math.round(Math.hypot(scalePt2.x - scalePt1.x, scalePt2.y - scalePt1.y)) : 0

  const svgCursor = (svg, size = 32, hotX = 16, hotY = 16) =>
    `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, crosshair`

  const cursorAP = svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<circle cx="16" cy="16" r="14" fill="none" stroke="white" stroke-width="1.5" opacity="0.8"/>` +
    `<line x1="16" y1="4" x2="16" y2="28" stroke="white" stroke-width="1" opacity="0.4"/>` +
    `<line x1="4" y1="16" x2="28" y2="16" stroke="white" stroke-width="1" opacity="0.4"/>` +
    `<path d="M16 8 Q10 12 10 17 Q10 20 13 21.5" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M16 8 Q22 12 22 17 Q22 20 19 21.5" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="16" cy="8" r="2.5" fill="#4fc3f7"/>` +
    `<line x1="16" y1="2" x2="16" y2="6" stroke="#4fc3f7" stroke-width="1.5"/>` +
    `</svg>`,
    32, 16, 16,
  )

  const cursorWall = svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<line x1="16" y1="2" x2="16" y2="30" stroke="white" stroke-width="1" opacity="0.3"/>` +
    `<line x1="2" y1="16" x2="30" y2="16" stroke="white" stroke-width="1" opacity="0.3"/>` +
    `<rect x="6" y="10" width="8" height="5" rx="0.5" fill="none" stroke="#ff9800" stroke-width="1.5"/>` +
    `<rect x="14" y="10" width="8" height="5" rx="0.5" fill="none" stroke="#ff9800" stroke-width="1.5"/>` +
    `<rect x="10" y="15" width="8" height="5" rx="0.5" fill="none" stroke="#ff9800" stroke-width="1.5"/>` +
    `<rect x="18" y="15" width="8" height="5" rx="0.5" fill="none" stroke="#ff9800" stroke-width="1.5"/>` +
    `</svg>`,
    32, 16, 16,
  )

  const cursorScale = svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<line x1="16" y1="2" x2="16" y2="30" stroke="white" stroke-width="1" opacity="0.3"/>` +
    `<line x1="2" y1="16" x2="30" y2="16" stroke="white" stroke-width="1" opacity="0.3"/>` +
    `<line x1="6" y1="20" x2="26" y2="20" stroke="#f1c40f" stroke-width="2" stroke-linecap="round"/>` +
    `<line x1="6" y1="17" x2="6" y2="23" stroke="#f1c40f" stroke-width="1.5"/>` +
    `<line x1="26" y1="17" x2="26" y2="23" stroke="#f1c40f" stroke-width="1.5"/>` +
    `<line x1="12" y1="18.5" x2="12" y2="21.5" stroke="#f1c40f" stroke-width="1" opacity="0.6"/>` +
    `<line x1="16" y1="18.5" x2="16" y2="21.5" stroke="#f1c40f" stroke-width="1" opacity="0.6"/>` +
    `<line x1="20" y1="18.5" x2="20" y2="21.5" stroke="#f1c40f" stroke-width="1" opacity="0.6"/>` +
    `</svg>`,
    32, 16, 16,
  )

  // ── 游標管理 ───────────────────────────────────────────
  const [hoverCursor, setHoverCursor] = useState(null) // 'move' | 'grab' | 'crosshair' | 'pointer' | null

  const toolCursor =
    isScaleMode     ? cursorScale :
    isWallMode      ? cursorWall  :
    isAPMode        ? cursorAP    :
    isScopeMode || isFloorHoleMode ? 'crosshair' :
    isPanMode                      ? 'grab'      : 'default'

  const stageCursor = hoverCursor || toolCursor

  // Force cursor on Konva canvas — Konva internally resets style.cursor
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const canvases = container.querySelectorAll('canvas')
    if (canvases.length === 0) return
    const applyCursor = () => {
      canvases.forEach((c) => c.style.setProperty('cursor', stageCursor, 'important'))
    }
    applyCursor()
    let skip = false
    const observer = new MutationObserver(() => {
      if (skip) return
      skip = true
      applyCursor()
      skip = false
    })
    canvases.forEach((c) => observer.observe(c, { attributes: true, attributeFilter: ['style'] }))
    return () => observer.disconnect()
  }, [stageCursor])

  const modeHintMap = {
    [EDITOR_MODE.SELECT]:          null,
    [EDITOR_MODE.PAN]:             { label: '平移模式', hint: '拖曳畫布移動視角' },
    [EDITOR_MODE.DRAW_SCALE]:      { label: '比例尺模式', hint: '點擊兩點設定比例' },
    [EDITOR_MODE.DRAW_WALL]:       { label: '畫牆模式', hint: '左鍵點擊設定端點，右鍵或 Esc 結束' },
    [EDITOR_MODE.PLACE_AP]:        { label: '放置 AP 模式', hint: '左鍵點擊放置 AP' },
    [EDITOR_MODE.DRAW_SCOPE]:      { label: '範圍模式', hint: '左鍵點擊設定端點，靠近起點閉合區域；右鍵或 Esc 取消' },
    [EDITOR_MODE.DRAW_FLOOR_HOLE]: { label: '挑高模式', hint: '左鍵點擊設定端點，靠近起點閉合區域；右鍵或 Esc 取消' },
  }
  const modeHint = modeHintMap[editorMode]

  return (
    <div ref={containerRef} className="editor-2d" style={{ cursor: stageCursor }}>
      {modeHint && (
        <div className="editor-2d__mode-hint">
          <span className="editor-2d__mode-hint-label">{modeHint.label}</span>
          <span className="editor-2d__mode-hint-desc">{modeHint.hint}</span>
        </div>
      )}
      {floors.length === 0 && <DropZone />}

      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}  height={size.height}
          x={viewport.x}      y={viewport.y}
          scaleX={viewport.scale} scaleY={viewport.scale}
          draggable={!hoverCursor}
          onWheel={handleWheel}
          onDragEnd={handleDragEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleStageClick}
          onContextMenu={handleContextMenu}
        >
          <Layer>
            <Rect x={-50000} y={-50000} width={100000} height={100000} fill="#1e1e2e" />
          </Layer>

          {activeFloor && showFloorImage && <FloorImageLayer floor={activeFloor} />}

          {/* 所有向量元素合併為單一 Layer，內部用 Group 區隔 */}
          <Layer>
            {activeFloorId && showScopes && (
              <ScopeLayer
                floorId={activeFloorId}
                drawingPoints={isScopeMode ? scopePoints : []}
                mousePos={mousePos}
                snapRadius={SNAP_PX / viewport.scale}
                selectedScopeId={selectedType === 'scope' ? selectedId : null}
                onScopeClick={(id) => setSelected(id, 'scope')}
                isSelectMode={isSelectMode}
                isDrawingActive={isWallMode || isScopeMode || isFloorHoleMode || isScaleMode}
                onScopeDragMove={(id, dx, dy) => { draggingScopeRef.current = { id, dx, dy } }}
                onScopeDragEnd={() => { draggingScopeRef.current = null }}
                onRightMouseDown={handleRightMouseDown}
                onDelete={(id) => { removeScope(activeFloorId, id); clearSelected() }}
                viewportScale={viewport.scale}
                setHoverCursor={setHoverCursor}
              />
            )}

            {activeFloorId && showFloorHoles && (
              <FloorHoleLayer
                floorId={activeFloorId}
                drawingPoints={isFloorHoleMode ? floorHolePoints : []}
                mousePos={mousePos}
                snapRadius={SNAP_PX / viewport.scale}
                selectedHoleId={selectedType === 'floor_hole' ? selectedId : null}
                onHoleClick={(id) => setSelected(id, 'floor_hole')}
                isSelectMode={isSelectMode}
                isDrawingActive={isWallMode || isScopeMode || isFloorHoleMode || isScaleMode}
                onRightMouseDown={handleRightMouseDown}
                onDelete={(id) => { removeFloorHole(activeFloorId, id); clearSelected() }}
                viewportScale={viewport.scale}
                setHoverCursor={setHoverCursor}
              />
            )}

            {activeFloorId && showWalls && (
              <WallLayer
                floorId={activeFloorId}
                drawStart={isWallMode ? wallDrawStart : null}
                mousePos={mousePos}
                selectedWallId={selectedType === 'wall' ? selectedId : null}
                onWallClick={(id) => setSelected(id, 'wall')}
                onWallDragMove={(id, dx, dy) => { draggingWallRef.current = { id, dx, dy } }}
                onWallDragEnd={() => { draggingWallRef.current = null }}
                isDrawMode={isWallMode}
                isDrawingActive={isWallMode || isScopeMode || isFloorHoleMode || isScaleMode}
                snapRadius={SNAP_PX / viewport.scale}
                onRightMouseDown={handleRightMouseDown}
                onDelete={(id) => { removeWall(activeFloorId, id); clearSelected() }}
                viewportScale={viewport.scale}
                setHoverCursor={setHoverCursor}
                onExtendFromEndpoint={(pt) => {
                  clearSelected()
                  setEditorMode(EDITOR_MODE.DRAW_WALL)
                  setWallDrawStart(pt)
                }}
              />
            )}

            {activeFloorId && showAPs && (
              <APLayer
                floorId={activeFloorId}
                selectedAPId={selectedType === 'ap' ? selectedId : null}
                onAPClick={(id) => setSelected(id, 'ap')}
                onAPDragMove={(id, x, y) => { draggingAPRef.current = { id, x, y } }}
                onAPDragEnd={() => { draggingAPRef.current = null }}
                isDrawingActive={isWallMode || isScopeMode || isFloorHoleMode || isScaleMode}
                onRightMouseDown={handleRightMouseDown}
                viewportScale={viewport.scale}
                onDelete={(id) => { removeAP(activeFloorId, id); clearSelected() }}
                setHoverCursor={setHoverCursor}
              />
            )}

            {isScaleMode && (
              <ScaleLayer pt1={scalePt1} pt2={scalePt2} mousePos={mousePos} />
            )}
          </Layer>
        </Stage>
      )}

      {floors.length > 0 && <LayerToggle />}

      <HeatmapWebGL
        width={size.width}
        height={size.height}
        stageRef={stageRef}
        draggingAPRef={draggingAPRef}
        draggingWallRef={draggingWallRef}
        draggingScopeRef={draggingScopeRef}
      />

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

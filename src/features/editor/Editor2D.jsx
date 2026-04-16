import React, { useRef, useState, useEffect, useCallback } from 'react'
import { Stage, Layer, Rect } from 'react-konva'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { MATERIALS, MATERIAL_LIST, OPENING_TYPES, getMaterialById } from '@/constants/materials'
import { DEFAULT_AP_MODEL_ID } from '@/constants/apModels'
import { generateId } from '@/utils/id'
import FloorImageLayer from './layers/FloorImageLayer'
import WallLayer from './layers/WallLayer'
import APLayer from './layers/APLayer'
import ScopeLayer from './layers/ScopeLayer'
import FloorHoleLayer from './layers/FloorHoleLayer'
import ScaleLayer from './layers/ScaleLayer'
import CropLayer from './layers/CropLayer'
import HeatmapWebGL from './HeatmapWebGL'
import ScaleDialog from './ScaleDialog'
import LayerToggle from '@/components/LayerToggle/LayerToggle'
import RegulatorySelector from '@/components/RegulatorySelector/RegulatorySelector'
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
  const marqueeRef             = useRef(null)   // { startX, startY } canvas coords — 框選起點
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

  // ── 門窗繪製狀態 ──────────────────────────────────────
  const [dwWallId, setDwWallId]     = useState(null)   // 目標牆體 ID
  const [dwStartFrac, setDwStartFrac] = useState(null) // 第一點 fraction (0~1)
  const [dwOpeningType, setDwOpeningType] = useState('door') // 'door' | 'window'

  // ── 裁切繪製狀態 ──────────────────────────────────────
  const [cropStart, setCropStart] = useState(null)   // {x,y}

  // ── 框選狀態 ──────────────────────────────────────────
  const [marquee, setMarquee] = useState(null)       // { startX, startY, endX, endY } canvas coords
  const marqueeRectRef        = useRef(null)          // 同步副本，避免 useCallback 閉包取到舊值

  // ── 牆體材質快捷鍵 ────────────────────────────────────
  const [wallMaterial, setWallMaterial] = useState(MATERIALS.CONCRETE)
  const [materialToast, setMaterialToast] = useState(null) // { label, color, key }

  const { editorMode, setEditorMode, selectedId, selectedType, setSelected, clearSelected, togglePanelCollapsed,
          selectedItems, setSelectedItems, toggleSelectedItem,
          showFloorImage, showScopes, showFloorHoles, showWalls, showAPs } = useEditorStore()
  const isSelectMode    = editorMode === EDITOR_MODE.SELECT
  const isMarqueeMode   = editorMode === EDITOR_MODE.MARQUEE_SELECT
  const isDoorWindowMode = editorMode === EDITOR_MODE.DOOR_WINDOW
  const isPanMode       = editorMode === EDITOR_MODE.PAN
  const isScaleMode     = editorMode === EDITOR_MODE.DRAW_SCALE
  const isWallMode      = editorMode === EDITOR_MODE.DRAW_WALL
  const isAPMode        = editorMode === EDITOR_MODE.PLACE_AP
  const isScopeMode     = editorMode === EDITOR_MODE.DRAW_SCOPE
  const isFloorHoleMode = editorMode === EDITOR_MODE.DRAW_FLOOR_HOLE
  const isCropMode      = editorMode === EDITOR_MODE.CROP_IMAGE

  const floors         = useFloorStore((s) => s.floors)
  const activeFloorId  = useFloorStore((s) => s.activeFloorId)
  const getActiveFloor = useFloorStore((s) => s.getActiveFloor)
  const updateFloor    = useFloorStore((s) => s.updateFloor)
  const setScale       = useFloorStore((s) => s.setScale)
  const activeFloor    = getActiveFloor()

  const addWall    = useWallStore((s) => s.addWall)
  const addOpening = useWallStore((s) => s.addOpening)

  const addAP     = useAPStore((s) => s.addAP)
  const nextAPName = useAPStore((s) => s.nextAPName)

  const addScope = useScopeStore((s) => s.addScope)

  const addFloorHole = useFloorHoleStore((s) => s.addFloorHole)

  // ── 座標轉換 ───────────────────────────────────────────
  const toCanvasPos = useCallback((screenPos) => ({
    x: (screenPos.x - viewport.x) / viewport.scale,
    y: (screenPos.y - viewport.y) / viewport.scale,
  }), [viewport])

  // canvas座標 → 圖片像素座標（反轉旋轉）
  const toImagePos = useCallback((canvasPos) => {
    if (!activeFloor) return canvasPos
    const rot = activeFloor.rotation || 0
    if (rot === 0) return canvasPos
    const cx = activeFloor.imageWidth / 2
    const cy = activeFloor.imageHeight / 2
    const rad = (-rot * Math.PI) / 180
    const dx = canvasPos.x - cx
    const dy = canvasPos.y - cy
    return {
      x: dx * Math.cos(rad) - dy * Math.sin(rad) + cx,
      y: dx * Math.sin(rad) + dy * Math.cos(rad) + cy,
    }
  }, [activeFloor])

  // ── 投影點到牆體線段 → 回傳 fraction (0~1) ──────────────
  const projectToWall = useCallback((pos, wall) => {
    const dx = wall.endX - wall.startX
    const dy = wall.endY - wall.startY
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-6) return 0
    const t = ((pos.x - wall.startX) * dx + (pos.y - wall.startY) * dy) / lenSq
    return Math.max(0, Math.min(1, t))
  }, [])

  // ── 找最近的牆體（螢幕距離 < threshold）──────────────────
  const findNearestWall = useCallback((canvasPos) => {
    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    const threshold = 15 / viewport.scale
    let best = null, bestDist = threshold
    for (const w of walls) {
      const dx = w.endX - w.startX, dy = w.endY - w.startY
      const lenSq = dx * dx + dy * dy
      if (lenSq < 1e-6) continue
      const t = Math.max(0, Math.min(1, ((canvasPos.x - w.startX) * dx + (canvasPos.y - w.startY) * dy) / lenSq))
      const px = w.startX + t * dx, py = w.startY + t * dy
      const dist = Math.hypot(canvasPos.x - px, canvasPos.y - py)
      if (dist < bestDist) { best = w; bestDist = dist }
    }
    return best
  }, [activeFloorId, viewport.scale])

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
    setCropStart(null)

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
  const removeWalls = useWallStore((s) => s.removeWalls)
  const updateWall  = useWallStore((s) => s.updateWall)
  const removeAP    = useAPStore((s) => s.removeAP)
  const removeAPs   = useAPStore((s) => s.removeAPs)
  const removeScope     = useScopeStore((s) => s.removeScope)
  const removeScopes    = useScopeStore((s) => s.removeScopes)
  const removeFloorHole = useFloorHoleStore((s) => s.removeFloorHole)
  const removeFloorHoles = useFloorHoleStore((s) => s.removeFloorHoles)

  // ── 材質快捷鍵 toast 自動消失 ─────────────────────────
  useEffect(() => {
    if (!materialToast) return
    const t = setTimeout(() => setMaterialToast(null), 1500)
    return () => clearTimeout(t)
  }, [materialToast])

  useEffect(() => {
    // Undo/Redo 後：若原選取物件仍存在，保留 selection；否則清除以避免面板顯示無效內容。
    const clearSelectedIfMissing = () => {
      const { selectedId: sid, selectedType: stype } = useEditorStore.getState()
      if (!sid || !stype) return
      const fid = useFloorStore.getState().activeFloorId
      if (!fid) return
      const exists = (() => {
        switch (stype) {
          case 'wall':       return (useWallStore.getState().wallsByFloor[fid] ?? []).some((w) => w.id === sid)
          case 'ap':         return (useAPStore.getState().apsByFloor[fid] ?? []).some((a) => a.id === sid)
          case 'scope':      return (useScopeStore.getState().scopesByFloor[fid] ?? []).some((s) => s.id === sid)
          case 'floor_hole': return (useFloorHoleStore.getState().floorHolesByFloor[fid] ?? []).some((h) => h.id === sid)
          case 'floor_image':return true
          default:           return false
        }
      })()
      if (!exists) clearSelected()
    }

    const onKey = (e) => {
      // ── Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y：Undo / Redo ──
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault()
          if (e.shiftKey) {
            useHistoryStore.getState().redo()
          } else {
            useHistoryStore.getState().undo()
          }
          clearSelectedIfMissing()
          return
        }
        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault()
          useHistoryStore.getState().redo()
          clearSelectedIfMissing()
          return
        }
      }

      if (e.key === 'Escape') {
        setWallDrawStart(null)
        setScopePoints([])
        setFloorHolePoints([])
        setCropStart(null)
        setDwWallId(null)
        setDwStartFrac(null)
        resetScale()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = e.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return

        // 批次選取刪除
        const items = useEditorStore.getState().selectedItems
        if (items.length > 1) {
          const wallIds = items.filter((it) => it.type === 'wall').map((it) => it.id)
          const apIds   = items.filter((it) => it.type === 'ap').map((it) => it.id)
          const scopeIds = items.filter((it) => it.type === 'scope').map((it) => it.id)
          const holeIds  = items.filter((it) => it.type === 'floor_hole').map((it) => it.id)
          if (wallIds.length)  removeWalls(activeFloorId, wallIds)
          if (apIds.length)    removeAPs(activeFloorId, apIds)
          if (scopeIds.length) removeScopes(activeFloorId, scopeIds)
          if (holeIds.length)  removeFloorHoles(activeFloorId, holeIds)
          clearSelected()
          return
        }

        // 單選刪除
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

      // ── D / W：門窗模式下切換門/窗 ─────────────────────
      if (isDoorWindowMode) {
        const tag = e.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if (e.key === 'd' || e.key === 'D') {
          setDwOpeningType('door')
          setMaterialToast({ label: '門', color: '#8B5E3C', key: 'D' })
        }
        if (e.key === 'w' || e.key === 'W') {
          setDwOpeningType('window')
          setMaterialToast({ label: '窗', color: '#5DADE2', key: 'W' })
        }
      }

      // ── 數字鍵 1~6：切換牆體材質 ─────────────────────
      const keyNum = parseInt(e.key, 10)
      if (keyNum >= 1 && keyNum <= 6) {
        const tag = e.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        const mat = MATERIAL_LIST[keyNum - 1]
        if (!mat) return
        // 畫牆模式 → 切換預設材質
        if (isWallMode) {
          setWallMaterial(mat)
          setMaterialToast({ label: mat.label, color: mat.color, key: keyNum })
        }
        // 已選取牆體 → 更新該牆材質
        if (selectedId && selectedType === 'wall') {
          updateWall(activeFloorId, selectedId, { material: mat })
          setMaterialToast({ label: mat.label, color: mat.color, key: keyNum })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, selectedType, activeFloorId, isWallMode, isDoorWindowMode, removeWall, removeWalls, updateWall, removeAP, removeAPs, removeScope, removeScopes, removeFloorHole, removeFloorHoles, clearSelected])

  // ── 切換模式時清除繪製狀態 ────────────────────────────
  useEffect(() => {
    setWallDrawStart(null)
    setScopePoints([])
    setFloorHolePoints([])
    setCropStart(null)
    setDwWallId(null)
    setDwStartFrac(null)
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

  // ── 框選相交判定 helpers ────────────────────────────────
  const collectMarqueeHits = useCallback((rect) => {
    const minX = Math.min(rect.startX, rect.endX)
    const minY = Math.min(rect.startY, rect.endY)
    const maxX = Math.max(rect.startX, rect.endX)
    const maxY = Math.max(rect.startY, rect.endY)

    // 線段 vs 矩形相交（Cohen-Sutherland 簡易版）
    const segIntersectsRect = (x1, y1, x2, y2) => {
      // 如果任一端點在矩形內 → 相交
      if ((x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY) ||
          (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY)) return true
      // 檢查線段是否穿過矩形的四條邊
      const edges = [
        [minX, minY, maxX, minY], [maxX, minY, maxX, maxY],
        [maxX, maxY, minX, maxY], [minX, maxY, minX, minY],
      ]
      for (const [ex1, ey1, ex2, ey2] of edges) {
        if (segmentsIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2)) return true
      }
      return false
    }

    const segmentsIntersect = (ax, ay, bx, by, cx, cy, dx, dy) => {
      const cross = (ux, uy, vx, vy) => ux * vy - uy * vx
      const dAB = { x: bx - ax, y: by - ay }
      const dCD = { x: dx - cx, y: dy - cy }
      const denom = cross(dAB.x, dAB.y, dCD.x, dCD.y)
      if (Math.abs(denom) < 1e-10) return false
      const t = cross(cx - ax, cy - ay, dCD.x, dCD.y) / denom
      const u = cross(cx - ax, cy - ay, dAB.x, dAB.y) / denom
      return t >= 0 && t <= 1 && u >= 0 && u <= 1
    }

    // 多邊形 vs 矩形：任一頂點在矩形內 或 任一邊與矩形相交
    const polyIntersectsRect = (flatPoints) => {
      const n = flatPoints.length / 2
      for (let i = 0; i < n; i++) {
        const px = flatPoints[i * 2], py = flatPoints[i * 2 + 1]
        if (px >= minX && px <= maxX && py >= minY && py <= maxY) return true
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        if (segIntersectsRect(flatPoints[i*2], flatPoints[i*2+1], flatPoints[j*2], flatPoints[j*2+1])) return true
      }
      // 矩形完全在多邊形內 — 用射線法檢查矩形角點
      return pointInPolygon(minX, minY, flatPoints)
    }

    const pointInPolygon = (px, py, flatPts) => {
      const n = flatPts.length / 2
      let inside = false
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = flatPts[i*2], yi = flatPts[i*2+1]
        const xj = flatPts[j*2], yj = flatPts[j*2+1]
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
          inside = !inside
        }
      }
      return inside
    }

    const hits = []

    // 牆體
    if (showWalls) {
      const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
      for (const w of walls) {
        if (segIntersectsRect(w.startX, w.startY, w.endX, w.endY)) {
          hits.push({ id: w.id, type: 'wall' })
        }
      }
    }

    // AP（中心點在矩形內）
    if (showAPs) {
      const aps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
      for (const ap of aps) {
        if (ap.x >= minX && ap.x <= maxX && ap.y >= minY && ap.y <= maxY) {
          hits.push({ id: ap.id, type: 'ap' })
        }
      }
    }

    // Scope zones
    if (showScopes) {
      const zones = useScopeStore.getState().scopesByFloor[activeFloorId] ?? []
      for (const z of zones) {
        if (polyIntersectsRect(z.points)) hits.push({ id: z.id, type: 'scope' })
      }
    }

    // Floor Holes
    if (showFloorHoles) {
      const holes = useFloorHoleStore.getState().floorHolesByFloor[activeFloorId] ?? []
      for (const h of holes) {
        if (polyIntersectsRect(h.points)) hits.push({ id: h.id, type: 'floor_hole' })
      }
    }

    return hits
  }, [activeFloorId, showWalls, showAPs, showScopes, showFloorHoles])

  // ── 中鍵：防止預設行為（開新分頁等）/ 左鍵：框選起點 ────
  const handleMouseDown = useCallback((e) => {
    if (e.evt.button === 1) e.evt.preventDefault()
    // 左鍵 + 框選模式 → 記錄框選起點
    if (e.evt.button === 0 && isMarqueeMode) {
      const pos = toCanvasPos(stageRef.current.getPointerPosition())
      marqueeRef.current = { startX: pos.x, startY: pos.y }
    }
  }, [isMarqueeMode, toCanvasPos])

  const handleMouseUp = useCallback((e) => {
    if (e.evt.button === 2) rightDragPendingRef.current = null

    // 框選結束
    if (e.evt.button === 0 && marqueeRef.current) {
      const rect = marqueeRectRef.current
      if (rect) {
        const hits = collectMarqueeHits(rect)
        if (hits.length > 0) {
          setSelectedItems(hits)
        } else {
          clearSelected()
        }
      }
      marqueeRef.current = null
      marqueeRectRef.current = null
      setMarquee(null)
    }
  }, [collectMarqueeHits, setSelectedItems, clearSelected])

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

  // ── 滑鼠移動：右鍵拖曳閾值判斷 / 框選 / 更新 ghost 線 ──
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

    // 框選拖曳
    if (marqueeRef.current) {
      const canvasPos = toCanvasPos(pos)
      const { startX, startY } = marqueeRef.current
      // 超過 5 canvas px 才開始顯示框選矩形
      if (Math.hypot(canvasPos.x - startX, canvasPos.y - startY) > 5 / viewport.scale) {
        const rect = { startX, startY, endX: canvasPos.x, endY: canvasPos.y }
        marqueeRectRef.current = rect
        setMarquee(rect)
      }
      return
    }

    const canvasPos = toCanvasPos(pos)
    setMousePos(isWallMode ? snapToWallEndpoint(canvasPos) : canvasPos)
  }, [toCanvasPos, isWallMode, snapToWallEndpoint, viewport.scale])

  // ── 點擊：分流到各模式 ─────────────────────────────────
  const handleStageClick = useCallback((e) => {
    if (e.evt.button !== 0) return

    // 框選模式下點擊不處理（交由 mouseDown/mouseUp 處理）
    if (isMarqueeMode) { return }

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
          material: wallMaterial,
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
        azimuth: 0,
        beamwidth: 60,
        patternId: null,
        mountType: 'ceiling',
        modelId: DEFAULT_AP_MODEL_ID,
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

    // 裁切模式
    if (isCropMode) {
      const imgPos = toImagePos(pos)
      if (!cropStart) {
        setCropStart(imgPos)
      } else {
        // 完成裁切 → 儲存 + 切回選取模式並打開面板
        const x = Math.min(cropStart.x, imgPos.x)
        const y = Math.min(cropStart.y, imgPos.y)
        const w = Math.abs(imgPos.x - cropStart.x)
        const h = Math.abs(imgPos.y - cropStart.y)
        if (w > 2 && h > 2) {
          updateFloor(activeFloorId, { cropX: x, cropY: y, cropWidth: w, cropHeight: h })
        }
        setCropStart(null)
        setEditorMode(EDITOR_MODE.SELECT)
        setSelected(activeFloorId, 'floor_image')
      }
      return
    }

    // 門窗模式
    if (isDoorWindowMode) {
      const wall = findNearestWall(pos)
      if (!wall) {
        // 點空白處 → 取消進行中的繪製
        setDwWallId(null); setDwStartFrac(null)
        return
      }
      const frac = projectToWall(pos, wall)
      if (!dwWallId || dwWallId !== wall.id) {
        // 第一次點擊（或切換到不同牆）→ 記錄起點
        setDwWallId(wall.id)
        setDwStartFrac(frac)
      } else {
        // 第二次點擊同一面牆 → 建立 opening
        const f1 = Math.min(dwStartFrac, frac)
        const f2 = Math.max(dwStartFrac, frac)
        if (f2 - f1 > 0.01) {
          // 檢查是否與既有 opening 重疊
          const existing = wall.openings ?? []
          const overlaps = existing.some((o) => f1 < o.endFrac && f2 > o.startFrac)
          if (!overlaps) {
            const ot = OPENING_TYPES[dwOpeningType === 'window' ? 'WINDOW' : 'DOOR']
            const defaultMat = getMaterialById(ot.defaultMaterial)
            addOpening(activeFloorId, wall.id, {
              id: generateId('opening'),
              type: dwOpeningType,
              startFrac: f1,
              endFrac: f2,
              material: defaultMat,
              topHeight: 2.1,
              bottomHeight: 0,
            })
          }
        }
        setDwWallId(null); setDwStartFrac(null)
      }
      return
    }

    // 其他模式點擊空白 → 取消選取
    clearSelected()
  }, [
    isMarqueeMode, isDoorWindowMode,
    isScaleMode, showScaleDialog, scalePt1,
    isWallMode, wallDrawStart, activeFloorId, snapToWallEndpoint,
    isAPMode, nextAPName,
    isScopeMode, scopePoints, viewport.scale, addScope,
    isFloorHoleMode, floorHolePoints, addFloorHole,
    isCropMode, cropStart, updateFloor, toImagePos, setSelected,
    toCanvasPos, addWall, addAP, addOpening, clearSelected,
    findNearestWall, projectToWall, dwWallId, dwStartFrac, dwOpeningType,
  ])

  // ── 右鍵：有繪製進行中 → 停止繪製；否則 → 切換 Panel 收合 ──
  const handleContextMenu = useCallback((e) => {
    e.evt.preventDefault()
    if (suppressContextMenuRef.current) { suppressContextMenuRef.current = false; return }
    if (isWallMode && wallDrawStart)           { setWallDrawStart(null); return }
    if (isScopeMode && scopePoints.length > 0) { setScopePoints([]);     return }
    if (isFloorHoleMode && floorHolePoints.length > 0) { setFloorHolePoints([]); return }
    if (isCropMode && cropStart) { setCropStart(null); return }
    if (isDoorWindowMode && dwWallId) { setDwWallId(null); setDwStartFrac(null); return }
    togglePanelCollapsed()
  }, [isWallMode, wallDrawStart, isScopeMode, scopePoints, isFloorHoleMode, floorHolePoints, isCropMode, cropStart, isDoorWindowMode, dwWallId, togglePanelCollapsed])

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
    isDoorWindowMode                   ? 'crosshair' :
    isMarqueeMode                      ? 'crosshair' :
    isCropMode                         ? 'crosshair' :
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
    [EDITOR_MODE.MARQUEE_SELECT]:  { label: '框選模式', hint: '左鍵拖曳框選多物件；Ctrl+Click 追加選取' },
    [EDITOR_MODE.PAN]:             { label: '平移模式', hint: '拖曳畫布移動視角' },
    [EDITOR_MODE.DRAW_SCALE]:      { label: '比例尺模式', hint: '點擊兩點設定比例' },
    [EDITOR_MODE.DRAW_WALL]:       { label: '畫牆模式', hint: '左鍵點擊設定端點，右鍵或 Esc 結束｜數字鍵 1~6 切換材質' },
    [EDITOR_MODE.DOOR_WINDOW]:     { label: '門窗模式', hint: '點擊牆體兩點設定門/窗位置；D 切換門、W 切換窗；右鍵或 Esc 取消' },
    [EDITOR_MODE.PLACE_AP]:        { label: '放置 AP 模式', hint: '左鍵點擊放置 AP' },
    [EDITOR_MODE.DRAW_SCOPE]:      { label: '熱圖範圍模式', hint: '左鍵點擊設定端點，靠近起點閉合區域；右鍵或 Esc 取消' },
    [EDITOR_MODE.DRAW_FLOOR_HOLE]: { label: '中庭模式', hint: '左鍵點擊設定端點，靠近起點閉合區域；右鍵或 Esc 取消' },
    [EDITOR_MODE.CROP_IMAGE]:      { label: '裁切模式', hint: '左鍵點擊兩點定義裁切區域；右鍵或 Esc 取消' },
  }
  const modeHint = modeHintMap[editorMode]

  return (
    <div ref={containerRef} className="editor-2d" style={{ cursor: stageCursor }}>
      {modeHint && (
        <div className="editor-2d__mode-hint">
          <span className="editor-2d__mode-hint-label">{modeHint.label}</span>
          {isWallMode && (
            <span className="editor-2d__mode-hint-material">
              <span className="editor-2d__mode-hint-mat-dot" style={{ background: wallMaterial.color }} />
              {wallMaterial.label}
            </span>
          )}
          {isDoorWindowMode && (
            <span className="editor-2d__mode-hint-material">
              <span className="editor-2d__mode-hint-mat-dot" style={{ background: dwOpeningType === 'door' ? '#8B5E3C' : '#5DADE2' }} />
              {dwOpeningType === 'door' ? '門' : '窗'}
            </span>
          )}
          <span className="editor-2d__mode-hint-desc">{modeHint.hint}</span>
        </div>
      )}

      {materialToast && (
        <div className="editor-2d__material-toast" key={materialToast.key + '-' + Date.now()}>
          <span className="editor-2d__material-toast-dot" style={{ background: materialToast.color }} />
          <span className="editor-2d__material-toast-key">{materialToast.key}</span>
          <span className="editor-2d__material-toast-label">{materialToast.label}</span>
        </div>
      )}
      {floors.length === 0 && <DropZone />}

      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}  height={size.height}
          x={viewport.x}      y={viewport.y}
          scaleX={viewport.scale} scaleY={viewport.scale}
          draggable={!hoverCursor && !marquee && !isMarqueeMode}
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

          {activeFloor && showFloorImage && (
            <FloorImageLayer
              floor={activeFloor}
              isSelectMode={isSelectMode}
              onFloorImageClick={() => setSelected(activeFloorId, 'floor_image')}
            />
          )}

          {/* 所有向量元素合併為單一 Layer，內部用 Group 區隔 */}
          <Layer>
            {activeFloorId && showScopes && (
              <ScopeLayer
                floorId={activeFloorId}
                drawingPoints={isScopeMode ? scopePoints : []}
                mousePos={mousePos}
                snapRadius={SNAP_PX / viewport.scale}
                selectedScopeId={selectedType === 'scope' ? selectedId : null}
                selectedItems={selectedItems}
                onScopeClick={(id, e) => {
                  if (e?.evt?.ctrlKey || e?.evt?.metaKey) { toggleSelectedItem(id, 'scope'); return }
                  setSelected(id, 'scope')
                }}
                isSelectMode={isSelectMode}
                isDrawingActive={isWallMode || isScopeMode || isFloorHoleMode || isScaleMode || isCropMode}
                onScopeDragMove={(id, dx, dy) => { draggingScopeRef.current = { id, dx, dy } }}
                onScopeDragEnd={() => { draggingScopeRef.current = null }}
                onRightMouseDown={handleRightMouseDown}
                onDelete={(id) => { removeScope(activeFloorId, id); clearSelected() }}
                viewportScale={viewport.scale}
                setHoverCursor={setHoverCursor}
                dimmed={isDoorWindowMode}
              />
            )}

            {activeFloorId && showFloorHoles && (
              <FloorHoleLayer
                floorId={activeFloorId}
                drawingPoints={isFloorHoleMode ? floorHolePoints : []}
                mousePos={mousePos}
                snapRadius={SNAP_PX / viewport.scale}
                selectedHoleId={selectedType === 'floor_hole' ? selectedId : null}
                selectedItems={selectedItems}
                onHoleClick={(id, e) => {
                  if (e?.evt?.ctrlKey || e?.evt?.metaKey) { toggleSelectedItem(id, 'floor_hole'); return }
                  setSelected(id, 'floor_hole')
                }}
                isSelectMode={isSelectMode}
                isDrawingActive={isWallMode || isScopeMode || isFloorHoleMode || isScaleMode || isCropMode}
                onRightMouseDown={handleRightMouseDown}
                onDelete={(id) => { removeFloorHole(activeFloorId, id); clearSelected() }}
                viewportScale={viewport.scale}
                setHoverCursor={setHoverCursor}
                dimmed={isDoorWindowMode}
              />
            )}

            {activeFloorId && showWalls && (
              <WallLayer
                floorId={activeFloorId}
                drawStart={isWallMode ? wallDrawStart : null}
                mousePos={mousePos}
                selectedWallId={selectedType === 'wall' ? selectedId : null}
                selectedItems={selectedItems}
                onWallClick={(id, e) => {
                  if (e?.evt?.ctrlKey || e?.evt?.metaKey) { toggleSelectedItem(id, 'wall'); return }
                  setSelected(id, 'wall')
                }}
                onWallDragMove={(id, dx, dy) => { draggingWallRef.current = { id, dx, dy } }}
                onWallDragEnd={() => { draggingWallRef.current = null }}
                isDrawMode={isWallMode}
                isDrawingActive={isWallMode || isScopeMode || isFloorHoleMode || isScaleMode || isCropMode}
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
                isDoorWindowMode={isDoorWindowMode}
                dwWallId={dwWallId}
                dwStartFrac={dwStartFrac}
                dwOpeningType={dwOpeningType}
              />
            )}

            {activeFloorId && showAPs && (
              <APLayer
                floorId={activeFloorId}
                selectedAPId={selectedType === 'ap' ? selectedId : null}
                selectedItems={selectedItems}
                onAPClick={(id, e) => {
                  if (e?.evt?.ctrlKey || e?.evt?.metaKey) { toggleSelectedItem(id, 'ap'); return }
                  setSelected(id, 'ap')
                }}
                onAPDragMove={(id, x, y) => { draggingAPRef.current = { id, x, y } }}
                onAPDragEnd={() => { draggingAPRef.current = null }}
                isDrawingActive={isWallMode || isScopeMode || isFloorHoleMode || isScaleMode || isCropMode}
                onRightMouseDown={handleRightMouseDown}
                viewportScale={viewport.scale}
                onDelete={(id) => { removeAP(activeFloorId, id); clearSelected() }}
                setHoverCursor={setHoverCursor}
                dimmed={isDoorWindowMode}
              />
            )}

            {isScaleMode && (
              <ScaleLayer pt1={scalePt1} pt2={scalePt2} mousePos={mousePos} />
            )}

            {activeFloor && (isCropMode || activeFloor.cropX != null) && (
              <CropLayer
                floor={activeFloor}
                cropStart={cropStart}
                mousePos={mousePos ? toImagePos(mousePos) : null}
                isCropMode={isCropMode}
                isFloorImageSelected={isSelectMode && selectedType === 'floor_image'}
                viewportScale={viewport.scale}
                onCropChange={(patch) => updateFloor(activeFloorId, patch)}
              />
            )}

            {/* 框選矩形 */}
            {marquee && (
              <Rect
                x={Math.min(marquee.startX, marquee.endX)}
                y={Math.min(marquee.startY, marquee.endY)}
                width={Math.abs(marquee.endX - marquee.startX)}
                height={Math.abs(marquee.endY - marquee.startY)}
                fill="rgba(0, 229, 255, 0.08)"
                stroke="#00e5ff"
                strokeWidth={1.5 / viewport.scale}
                dash={[6 / viewport.scale, 3 / viewport.scale]}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      )}

      {floors.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <LayerToggle />
          <RegulatorySelector />
        </div>
      )}

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

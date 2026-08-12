import React, { useState, useRef, useEffect } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useCableStore } from '@/store/useCableStore'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
import { showUiToast } from '@/store/useUiToastStore'
import { capturePlanPng, triggerImageDownload } from '@/features/exportPng/exportPlanView'
import { getSceneRefs } from '@/render/sceneRegistry'
import './ExportMenu.sass'

// 52-D1: the single visible home for "get my work out of here".
//
// Both exports already existed and worked, but neither was findable: the PNG
// sat in a floor row's hover-only ⋯ menu right next to the red 刪除樓層, and
// the 7-page PDF was at the bottom of the 線纜總結 panel, behind a collapsed
// section the user had to scroll past BOM tables to reach. Neither is in the
// DOM until opened, so scanning the page — the thing a normal user does —
// cannot find them. The tester's verdict was "there is no export", and after
// being shown otherwise: "I would never think to look for the report under
// cable summary."
//
// The originals are deliberately left in place. This is an additional, obvious
// entry, not a relocation — Phase 51-B already reasoned that the PDF belongs
// with the building-wide cable summary, and people who learned that path
// should keep it.

const stamp = () => new Date().toISOString().slice(0, 10)
const safeName = (s) => (s ?? 'plan').replace(/[^\w\-一-龥]+/g, '_')

function ExportMenu() {
  const [open, setOpen] = useState(false)
  const [pdfStatus, setPdfStatus] = useState(null)
  const rootRef = useRef(null)

  const floors = useFloorStore((s) => s.floors)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const setActiveFloor = useFloorStore((s) => s.setActiveFloor)
  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? null

  // Close on outside click / Esc, like the other floating menus.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // capturePlanPng bakes the 2D plan scene, so in 3D the user would be looking
  // at a perspective view and receive a top-down plan instead — byte-identical
  // to the 2D export (verified). Rather than hand over something that isn't
  // what's on screen, disable it and say why.
  const is3D = useEditorStore((s) => s.viewMode === VIEW_MODE.THREE_D)
  const hasImage = !!(activeFloor?.imageUrl && activeFloor.imageWidth && activeFloor.imageHeight)
  const canPng = hasImage && !is3D
  const canPdf = floors.length > 0

  const exportPng = () => {
    setOpen(false)
    if (!canPng) return
    const refs = getSceneRefs()
    if (!refs) {
      showUiToast('畫布尚未載入完成，請稍候再試一次匯出')
      return
    }
    const png = capturePlanPng({
      app: refs.app, world: refs.world,
      imageWidth: activeFloor.imageWidth,
      imageHeight: activeFloor.imageHeight,
      pixelRatio: 2,
    })
    if (!png) {
      showUiToast('匯出 PNG 失敗，請稍候再試')
      return
    }
    triggerImageDownload(png, `floorplan-${safeName(activeFloor.name)}-${stamp()}.png`)
  }

  const exportPdf = async () => {
    if (pdfStatus || !canPdf) return
    setOpen(false)
    setPdfStatus('準備中...')
    try {
      const { buildPlanningPdf, triggerPdfDownload } =
        await import('@/features/cable/exportPlanningPdf')
      const cable = useCableStore.getState()
      const blob = await buildPlanningPdf({
        floors: useFloorStore.getState().floors,
        apsByFloor: useAPStore.getState().apsByFloor,
        wallsByFloor: useWallStore.getState().wallsByFloor,
        scopesByFloor: useScopeStore.getState().scopesByFloor,
        switchesByFloor: cable.switchesByFloor,
        traysByFloor: cable.traysByFloor,
        risers: cable.risers,
        wasteFactor: cable.wasteFactor,
        capacityProfile: cable.capacityProfile,
        customCapacity: cable.customCapacity,
        regulatoryDomain: useEditorStore.getState().regulatoryDomain,
        setActiveFloor,
        getActiveFloorId: () => useFloorStore.getState().activeFloorId,
        onProgress: setPdfStatus,
      })
      triggerPdfDownload(blob, `floorplan-report-${stamp()}.pdf`)
      setPdfStatus(null)
    } catch (err) {
      console.error('PDF export failed:', err)
      showUiToast('規劃報告匯出失敗，請看 console')
      setPdfStatus(null)
    }
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        type="button"
        className={`export-menu__btn${open ? ' export-menu__btn--active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={!!pdfStatus}
        title="匯出目前規劃（PNG 平面圖 / PDF 規劃報告）"
      >
        {pdfStatus ?? '匯出'}
      </button>

      {open && (
        <div className="export-menu__dropdown" role="menu">
          <button
            type="button"
            className="export-menu__item"
            role="menuitem"
            disabled={!canPng}
            onClick={exportPng}
            title={canPng
              ? '匯出目前樓層的平面圖（含牆 / AP / 熱圖）為 PNG'
              : is3D ? '匯出的是 2D 平面圖，請先切回 2D' : '需先匯入底圖'}
          >
            <span className="export-menu__item-label">🖼 目前樓層 PNG</span>
            <span className="export-menu__item-hint">
              {!hasImage ? '尚未匯入平面圖'
                : is3D ? '僅能在 2D 檢視下匯出'
                : `${activeFloor.name}，含牆／AP／熱圖`}
            </span>
          </button>

          <button
            type="button"
            className="export-menu__item"
            role="menuitem"
            disabled={!canPdf}
            onClick={exportPdf}
            title="輸出多頁 PDF：封面 / RF 涵蓋率與達標判定 / 每層平面圖快照 / AP 線纜表 / 線槽 BOM / 警告"
          >
            <span className="export-menu__item-label">📄 規劃報告 PDF</span>
            <span className="export-menu__item-hint">
              涵蓋率、每層平面圖、AP 線纜表、線槽 BOM
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

export default ExportMenu

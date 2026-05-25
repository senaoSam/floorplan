import React, { useEffect, useRef } from 'react'
import { initScene } from '@/render/scene'
import { bindViewport } from '@/render/viewport'
import { attachFloorImageLayer } from '@/features/floorImage/floorImageLayer'
import { attachWallsLayer } from '@/features/walls/wallsLayer'
import { attachAPsLayer } from '@/features/aps/apsLayer'
import { attachSwitchesLayer } from '@/features/switches/switchesLayer'
import { attachTraysLayer } from '@/features/trays/traysLayer'
import { attachCablesLayer } from '@/features/cables/cablesLayer'
import { attachSelectionOverlay } from '@/features/selection/selectionOverlayLayer'
import { attachHoverOverlay } from '@/features/selection/hoverOverlayLayer'
import { attachHeatmapLayer } from '@/render/heatmapAdapter'
import { useViewportStore } from '@/store/useViewportStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useHoverStore } from '@/store/useHoverStore'
import './FloorplanSystem.sass'

// Integration boundary the host product will mount. Owns the PIXI scene
// lifecycle + all layer adapters. External chrome (TopBar / SidebarLeft /
// PanelRight / floating control panels) lives outside this component.
function FloorplanSystem(/* { buildingData, onSave } */) {
  const containerRef = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let scene = null
    let detachViewport = null
    let detachFloorImage = null
    let detachWalls = null
    let detachAPs = null
    let detachSwitches = null
    let detachTrays = null
    let detachCables = null
    let detachHeatmap = null
    let detachSelection = null
    let detachHover = null
    let cancelled = false

    initScene({ container: el }).then((s) => {
      if (cancelled) {
        s.destroy()
        return
      }
      scene = s
      detachViewport = bindViewport({
        app: s.app,
        canvas: s.app.canvas,
        scene: s,
        world: s.world,
        store: useViewportStore,
        onBackgroundClick: () => useEditorStore.getState().clearSelected(),
        onMarqueeCommit: (rect) => {
          const fid = useFloorStore.getState().activeFloorId
          if (!fid) return
          const aps = useAPStore.getState().apsByFloor[fid] ?? []
          const inside = aps.filter((ap) =>
            ap.x >= rect.minX && ap.x <= rect.maxX &&
            ap.y >= rect.minY && ap.y <= rect.maxY,
          )
          useEditorStore.getState().setSelectedItems(
            inside.map((ap) => ({ id: ap.id, type: 'ap' })),
          )
        },
      })
      detachFloorImage = attachFloorImageLayer({
        scene: s,
        useFloorStore,
        useViewportStore,
      })
      detachWalls = attachWallsLayer({
        scene: s,
        useFloorStore,
        useWallStore,
      })
      detachAPs = attachAPsLayer({
        scene: s,
        useFloorStore,
        useAPStore,
      })
      detachSwitches = attachSwitchesLayer({
        scene: s,
        useFloorStore,
        useCableStore,
      })
      detachTrays = attachTraysLayer({
        scene: s,
        useFloorStore,
        useCableStore,
      })
      detachCables = attachCablesLayer({
        scene: s,
        useFloorStore,
        useAPStore,
        useCableStore,
      })
      detachHeatmap = attachHeatmapLayer({
        scene: s,
        useFloorStore,
        useWallStore,
        useAPStore,
        useHeatmapStore,
      })
      detachSelection = attachSelectionOverlay({
        scene: s,
        useFloorStore,
        useAPStore,
        useWallStore,
        useCableStore,
        useEditorStore,
        useDragOverlayStore,
      })
      detachHover = attachHoverOverlay({
        scene: s,
        useFloorStore,
        useAPStore,
        useWallStore,
        useCableStore,
        useEditorStore,
        useHoverStore,
      })
      if (import.meta.env.DEV) {
        window.__pixiApp = s.app
        window.__scene = s
        window.__stores = {
          editor: useEditorStore,
          floor: useFloorStore,
          ap: useAPStore,
          wall: useWallStore,
          cable: useCableStore,
          heatmap: useHeatmapStore,
          viewport: useViewportStore,
          drag: useDragOverlayStore,
          hover: useHoverStore,
        }
      }
    })

    const onKeyDown = (e) => {
      // Don't fire while typing in inputs/textareas (e.g. AP name field).
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Escape') {
        const s = useEditorStore.getState()
        // Esc closes the context menu first if open, otherwise clears
        // selection. Matches the ObjectContextMenu's own Esc handler.
        if (s.contextMenu) {
          s.closeContextMenu()
        } else {
          s.clearSelected()
        }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const s = useEditorStore.getState()
        const fid = useFloorStore.getState().activeFloorId
        if (!fid) return

        // Batch (marquee multi-select) takes priority over single selection.
        if (s.selectedItems.length > 1) {
          const apIds = s.selectedItems.filter((it) => it.type === 'ap').map((it) => it.id)
          if (apIds.length > 0) useAPStore.getState().removeAPs(fid, apIds)
          s.clearSelected()
          return
        }

        if (!s.selectedId) return
        if (s.selectedType === 'ap') {
          useAPStore.getState().removeAP(fid, s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'wall') {
          useWallStore.getState().removeWall(fid, s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'switch') {
          useCableStore.getState().removeSwitch(fid, s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'cable_tray') {
          useCableStore.getState().removeTray(fid, s.selectedId)
          s.clearSelected()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      if (detachHover) detachHover()
      if (detachSelection) detachSelection()
      if (detachHeatmap) detachHeatmap()
      if (detachCables) detachCables()
      if (detachTrays) detachTrays()
      if (detachSwitches) detachSwitches()
      if (detachAPs) detachAPs()
      if (detachWalls) detachWalls()
      if (detachFloorImage) detachFloorImage()
      if (detachViewport) detachViewport()
      if (scene) scene.destroy()
      if (import.meta.env.DEV) {
        delete window.__pixiApp
        delete window.__scene
      }
    }
  }, [])

  return (
    <div className="floorplan-system">
      <div ref={containerRef} className="floorplan-system__canvas" />
    </div>
  )
}

export default FloorplanSystem

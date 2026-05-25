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
import { attachHeatmapLayer } from '@/render/heatmapAdapter'
import { useViewportStore } from '@/store/useViewportStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
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
        world: s.world,
        store: useViewportStore,
        onBackgroundClick: () => useEditorStore.getState().clearSelected(),
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
      if (import.meta.env.DEV) {
        window.__pixiApp = s.app
        window.__scene = s
      }
    })

    const onKeyDown = (e) => {
      // Don't fire while typing in inputs/textareas (e.g. AP name field).
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Escape') {
        useEditorStore.getState().clearSelected()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedId, selectedType, clearSelected } = useEditorStore.getState()
        if (!selectedId) return
        const fid = useFloorStore.getState().activeFloorId
        if (!fid) return
        if (selectedType === 'ap') {
          useAPStore.getState().removeAP(fid, selectedId)
          clearSelected()
        } else if (selectedType === 'wall') {
          useWallStore.getState().removeWall(fid, selectedId)
          clearSelected()
        } else if (selectedType === 'switch') {
          useCableStore.getState().removeSwitch(fid, selectedId)
          clearSelected()
        } else if (selectedType === 'cable_tray') {
          useCableStore.getState().removeTray(fid, selectedId)
          clearSelected()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
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

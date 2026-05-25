import React, { useEffect, useRef } from 'react'
import { initScene } from '@/render/scene'
import { bindViewport } from '@/render/viewport'
import { attachFloorImageLayer } from '@/features/floorImage/floorImageLayer'
import { attachWallsLayer } from '@/features/walls/wallsLayer'
import { attachAPsLayer } from '@/features/aps/apsLayer'
import { attachSwitchesLayer } from '@/features/switches/switchesLayer'
import { attachTraysLayer } from '@/features/trays/traysLayer'
import { attachCablesLayer } from '@/features/cables/cablesLayer'
import { attachHeatmapLayer } from '@/render/heatmapAdapter'
import { useViewportStore } from '@/store/useViewportStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
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
    let cancelled = false

    initScene({ container: el }).then((s) => {
      if (cancelled) {
        s.destroy()
        return
      }
      scene = s
      detachViewport = bindViewport({
        canvas: s.app.canvas,
        world: s.world,
        store: useViewportStore,
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
      if (import.meta.env.DEV) {
        window.__pixiApp = s.app
        window.__scene = s
      }
    })

    return () => {
      cancelled = true
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

import React, { useEffect, useRef } from 'react'
import { initScene } from '@/render/scene'
import { bindViewport } from '@/render/viewport'
import { attachFloorImageLayer } from '@/features/floorImage/floorImageLayer'
import { attachWallsLayer } from '@/features/walls/wallsLayer'
import { attachAPsLayer } from '@/features/aps/apsLayer'
import { attachHeatmapLayer } from '@/render/heatmapAdapter'
import { useViewportStore } from '@/store/useViewportStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import ViewportHud from './ViewportHud'
import DemoLoader from '@/components/DemoLoader/DemoLoader'
import HeatmapControl from '@/components/HeatmapControl/HeatmapControl'
import './FloorplanSystem.sass'

// Integration boundary the host product will mount. Props are accepted for
// the future contract but not wired yet.
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
      <ViewportHud />
      <DemoLoader />
      <HeatmapControl />
    </div>
  )
}

export default FloorplanSystem

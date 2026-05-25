import React, { useEffect, useRef } from 'react'
import { initScene } from '@/render/scene'
import { bindViewport } from '@/render/viewport'
import { attachFloorImageLayer } from '@/features/floorImage/floorImageLayer'
import { useViewportStore } from '@/store/useViewportStore'
import { useFloorStore } from '@/store/useFloorStore'
import ViewportHud from './ViewportHud'
import DemoLoader from '@/components/DemoLoader/DemoLoader'
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
      if (import.meta.env.DEV) {
        window.__pixiApp = s.app
        window.__scene = s
      }
    })

    return () => {
      cancelled = true
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
    </div>
  )
}

export default FloorplanSystem

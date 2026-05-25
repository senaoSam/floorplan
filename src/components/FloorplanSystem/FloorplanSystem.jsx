import React, { useEffect, useRef } from 'react'
import { Graphics } from 'pixi.js'
import { initScene } from '@/render/scene'
import { bindViewport } from '@/render/viewport'
import { useViewportStore } from '@/store/useViewportStore'
import { useEditorStore } from '@/store/useEditorStore'
import ViewportHud from './ViewportHud'
import './FloorplanSystem.sass'

// Integration boundary the host product will mount. Props are accepted for
// the future contract but not wired yet — 31-1/31-2 just brings up the PIXI
// scene + viewport + store wiring.
function FloorplanSystem(/* { buildingData, onSave } */) {
  const containerRef = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let scene = null
    let detachViewport = null
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
      addScaffoldGrid(s)
      if (import.meta.env.DEV) {
        window.__pixiApp = s.app
        window.__scene = s
      }
    })

    return () => {
      cancelled = true
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
    </div>
  )
}

// Temporary visual scaffold so 31-1/31-2 viewport pan/zoom is verifiable in
// the browser. Removed once real layers (floor image, walls, …) populate.
function addScaffoldGrid(scene) {
  const g = new Graphics()
  const step = 100
  const extent = 2000

  for (let i = -extent; i <= extent; i += step) {
    g.moveTo(i, -extent).lineTo(i, extent)
    g.moveTo(-extent, i).lineTo(extent, i)
  }
  g.stroke({ width: 1, color: 0x223040, alpha: 1 })

  g.moveTo(-extent, 0).lineTo(extent, 0)
  g.stroke({ width: 2, color: 0x4a5e75, alpha: 1 })
  g.moveTo(0, -extent).lineTo(0, extent)
  g.stroke({ width: 2, color: 0x4a5e75, alpha: 1 })

  g.circle(0, 0, 6).fill(0xf39c12)

  scene.layers.floorImage.addChild(g)
}

export default FloorplanSystem

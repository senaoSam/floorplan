import { Sprite, Texture } from 'pixi.js'
import { useFloorStore } from '@/store/useFloorStore'
import { getGapMarker, subscribeGapMarker } from '@/features/cameras/gapMarkerBus'

// Wi-Fi blind-area flash. The camera CoveragePanel's "locate biggest gap"
// briefly switches on its blind-spot overlay next to the amber ring; the
// heatmap has no such overlay, so the planning panel hands planQuality's blind
// mask to the gap marker and this layer shades those cells for as long as the
// marker lives (gapMarkerLayer clears it after its lifetime).
//
// Same shade as the camera blind-spot overlay so the two read as one cue. The
// mask is one texel per quality sample, stretched with smoothing, so a coarse
// 1 m grid still lands as a soft-edged area rather than blocks.

const SHADE_COLOR = 'rgba(15, 23, 42, 0.52)'
const MAX_CANVAS_PX = 1400   // cap the offscreen resolution on huge floors (as blindSpotLayer)

export function attachBlindShadeLayer({ scene }) {
  const layer = scene.layers.blindShade
  let sprite = null
  let shownMask = null

  const clearSprite = () => {
    if (!sprite) return
    layer.removeChild(sprite)
    sprite.destroy({ texture: true })
    sprite = null
    shownMask = null
  }

  const build = (mask, floor) => {
    const { cells, nx, ny, originXPx, originYPx, stepPx } = mask
    // One texel per sample …
    const grid = document.createElement('canvas')
    grid.width = Math.max(1, nx)
    grid.height = Math.max(1, ny)
    const gctx = grid.getContext('2d')
    gctx.fillStyle = SHADE_COLOR
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (cells[j * nx + i]) gctx.fillRect(i, j, 1, 1)
      }
    }
    // … stretched (smoothed) onto an image-sized canvas, which also clips the
    // half-cell the edge samples would otherwise spill past the floor plan.
    const k = Math.min(1, MAX_CANVAS_PX / Math.max(floor.imageWidth, floor.imageHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(floor.imageWidth * k))
    canvas.height = Math.max(1, Math.round(floor.imageHeight * k))
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    // Texel (i, j) is centred on the sample at (originXPx + i*stepPx, ...).
    ctx.drawImage(grid,
      (originXPx - stepPx / 2) * k, (originYPx - stepPx / 2) * k,
      nx * stepPx * k, ny * stepPx * k)
    sprite = new Sprite(Texture.from(canvas))
    sprite.eventMode = 'none'
    sprite.width = floor.imageWidth
    sprite.height = floor.imageHeight
    layer.addChild(sprite)
    shownMask = mask
  }

  const sync = () => {
    const m = getGapMarker()
    const mask = m?.source === 'heatmap' ? m.blindMask : null
    // Only on the floor the mask was sampled on — same guard as the ring.
    const { floors, activeFloorId } = useFloorStore.getState()
    const onFloor = mask && (!m.floorId || m.floorId === activeFloorId)
    const floor = onFloor ? floors.find((f) => f.id === activeFloorId) : null
    if (!floor?.imageWidth) {
      if (sprite) { clearSprite(); scene.requestRender() }
      return
    }
    if (mask === shownMask) return
    clearSprite()
    build(mask, floor)
    scene.requestRender()
  }

  const unsubMarker = subscribeGapMarker(sync)
  const unsubFloor = useFloorStore.subscribe(sync)
  sync()

  return () => {
    unsubMarker()
    unsubFloor()
    clearSprite()
  }
}

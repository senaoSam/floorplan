import { Assets, Sprite, Graphics } from 'pixi.js'

// Floor image adapter — subscribes to useFloorStore and mounts the active
// floor's image as a PIXI.Sprite into scene.layers.floorImage. On floor swap
// the previous sprite is removed and the new one fitted into the viewport.
//
// The sprite is `eventMode='none'` (pure visual backdrop) — it must not
// claim pointer events, otherwise PIXI's hit-test stops here and draw
// modes (DRAW_SCOPE / DRAW_CABLE_TRAY / etc.) can't get their background
// click to the stage handler. No right-click menu either — floor image
// is not deletable from canvas; the floor record's other panels own that.
export function attachFloorImageLayer({ scene, useFloorStore, useViewportStore }) {
  const layer = scene.layers.floorImage
  let currentSprite = null
  let currentMask = null   // Graphics rect used as sprite.mask when floor has cropX/Y/W/H
  let currentFloorId = null
  let currentImageUrl = null
  let pendingLoadKey = null

  const clearMask = () => {
    if (!currentMask) return
    layer.removeChild(currentMask)
    currentMask.destroy()
    currentMask = null
    if (currentSprite) currentSprite.mask = null
  }

  const clearSprite = () => {
    clearMask()
    if (!currentSprite) return
    layer.removeChild(currentSprite)
    currentSprite.destroy({ children: true, texture: false })
    currentSprite = null
    currentFloorId = null
    currentImageUrl = null
  }

  // Refresh the crop mask from the floor record. Called whenever the
  // floor's cropX/Y/W/H change (via useFloorStore.subscribe) so the
  // sprite reflects the new crop without rebuilding.
  const applyCrop = (floor) => {
    if (!currentSprite || !floor) return
    const hasCrop =
      floor.cropX != null && floor.cropY != null &&
      floor.cropWidth != null && floor.cropHeight != null &&
      floor.cropWidth > 0 && floor.cropHeight > 0
    if (!hasCrop) {
      clearMask()
      return
    }
    if (!currentMask) {
      currentMask = new Graphics()
      currentMask.eventMode = 'none'
      layer.addChild(currentMask)
      currentSprite.mask = currentMask
    }
    currentMask.clear()
    currentMask.rect(floor.cropX, floor.cropY, floor.cropWidth, floor.cropHeight)
      .fill({ color: 0xffffff, alpha: 1 })
  }

  const fitViewportTo = (imageWidth, imageHeight) => {
    const canvas = scene.app.canvas
    const cw = canvas.clientWidth || canvas.width
    const ch = canvas.clientHeight || canvas.height
    const padding = 32
    const sx = (cw - padding * 2) / imageWidth
    const sy = (ch - padding * 2) / imageHeight
    const scale = Math.max(useViewportStore.getState().minScale, Math.min(sx, sy))
    useViewportStore.getState().setViewport({
      scale,
      x: (cw - imageWidth * scale) / 2,
      y: (ch - imageHeight * scale) / 2,
    })
  }

  const update = async () => {
    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)

    if (!floor) {
      clearSprite()
      return
    }

    if (floor.id === currentFloorId && floor.imageUrl === currentImageUrl) {
      // Same floor, same texture — only crop may have changed.
      applyCrop(floor)
      return
    }

    // Track this load so a fast floor-swap can drop a stale result.
    const loadKey = `${floor.id}::${floor.imageUrl}`
    pendingLoadKey = loadKey

    try {
      const texture = await Assets.load(floor.imageUrl)
      if (pendingLoadKey !== loadKey) return

      clearSprite()
      const sprite = new Sprite(texture)
      sprite.eventMode = 'none' // floor image is pure backdrop; never intercept clicks
      sprite.x = 0
      sprite.y = 0
      sprite.width = floor.imageWidth
      sprite.height = floor.imageHeight
      layer.addChild(sprite)
      currentSprite = sprite
      currentFloorId = floor.id
      currentImageUrl = floor.imageUrl

      applyCrop(floor)
      fitViewportTo(floor.imageWidth, floor.imageHeight)
    } catch (err) {
      console.error('[floorImageLayer] failed to load', floor.imageUrl, err)
    }
  }

  const unsubscribe = useFloorStore.subscribe(update)
  update()

  return () => {
    pendingLoadKey = null
    unsubscribe()
    clearSprite()
  }
}

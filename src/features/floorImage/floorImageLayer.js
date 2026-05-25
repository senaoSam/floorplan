import { Assets, Sprite } from 'pixi.js'

// Floor image adapter — subscribes to useFloorStore and mounts the active
// floor's image as a PIXI.Sprite into scene.layers.floorImage. On floor swap
// the previous sprite is removed and the new one fitted into the viewport.
//
// Demonstrates the canonical store-subscribe → diff → mutate-PixiJS pattern
// each layer will follow.
export function attachFloorImageLayer({ scene, useFloorStore, useViewportStore }) {
  const layer = scene.layers.floorImage
  let currentSprite = null
  let currentFloorId = null
  let currentImageUrl = null
  let pendingLoadKey = null

  const clearSprite = () => {
    if (!currentSprite) return
    layer.removeChild(currentSprite)
    currentSprite.destroy({ children: true, texture: false })
    currentSprite = null
    currentFloorId = null
    currentImageUrl = null
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
      sprite.x = 0
      sprite.y = 0
      sprite.width = floor.imageWidth
      sprite.height = floor.imageHeight
      layer.addChild(sprite)
      currentSprite = sprite
      currentFloorId = floor.id
      currentImageUrl = floor.imageUrl

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

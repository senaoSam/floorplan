import { Sprite, Texture, Graphics } from 'pixi.js'
import { getModeCapability } from '@/render/modeCapabilities'

// Load an image URL via HTMLImageElement and wrap as PIXI.Texture. We
// avoid PIXI's Assets.load() because v8's resolver uses URL extension to
// pick a parser — blob URLs (from file upload / PDF import) have none, so
// the texture parser returns null and `.texture` access throws. The
// HTMLImageElement path matches what oldSrc FloorImageLayer used with
// Konva and handles blob / data / http URLs uniformly.
const loadTextureFromUrl = (url) =>
  new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload  = () => resolve(Texture.from(img))
    img.onerror = (e) => reject(e instanceof Error ? e : new Error(`image load failed: ${url}`))
    img.src = url
  })

// Floor image adapter — subscribes to useFloorStore and mounts the active
// floor's image as a PIXI.Sprite into scene.layers.floorImage.
//
// Interaction (oldSrc FloorImageLayer parity, Bundle 30):
//   * LMB in SELECT mode → setSelected(floorId, 'floor_image'), which
//     opens FloorImagePanel on the right side (Bundle 31). Other modes
//     (draw / place) leave the click unconsumed so the stage handler
//     can route it to the draw / place pipeline — drawing on top of
//     the image still works.
//   * RMB → openContextMenu({ targetType: 'floor_image' }) so the user
//     can remove the image / etc. via ContextMenuMount.
//
// Rotation + opacity + crop are sourced from the floor record:
//   * rotation: sprite.rotation in radians (oldSrc degrees → /180*π).
//     Sprite pivots on image centre (imageWidth/2, imageHeight/2) so the
//     rotation feels like rotating the page, not orbiting from corner.
//   * opacity:  sprite.alpha (default 1)
//   * cropX/Y/Width/Height: applyCrop() pins a Graphics rect as sprite.mask
export function attachFloorImageLayer({ scene, useFloorStore, useViewportStore, useEditorStore }) {
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

  // Apply rotation + opacity from the floor record (oldSrc parity).
  // Rotation in PIXI is radians; floor.rotation is degrees so we
  // convert. Sprite is pivot-centred via anchor(0.5, 0.5), so rotation
  // spins around the image centre as expected.
  const applyVisualProps = (floor) => {
    if (!currentSprite || !floor) return
    const deg = floor.rotation ?? 0
    currentSprite.rotation = (deg * Math.PI) / 180
    currentSprite.alpha = floor.opacity ?? 1
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
      // Same floor, same texture — only crop / rotation / opacity may
      // have changed.
      applyVisualProps(floor)
      applyCrop(floor)
      return
    }

    // Track this load so a fast floor-swap can drop a stale result.
    const loadKey = `${floor.id}::${floor.imageUrl}`
    pendingLoadKey = loadKey

    try {
      const texture = await loadTextureFromUrl(floor.imageUrl)
      if (pendingLoadKey !== loadKey) return

      clearSprite()
      const sprite = new Sprite(texture)
      // Pivot on image centre so rotation feels like rotating the
      // page itself (oldSrc Konva Image uses offsetX=cx, offsetY=cy).
      sprite.anchor.set(0.5, 0.5)
      sprite.x = floor.imageWidth / 2
      sprite.y = floor.imageHeight / 2
      sprite.width = floor.imageWidth
      sprite.height = floor.imageHeight
      // Bundle 30: interactive so SELECT-mode LMB can select the floor
      // image. Non-SELECT modes return early WITHOUT stopPropagation, so
      // the click bubbles to stage and draw/place still works on top of
      // the image.
      sprite.eventMode = 'static'
      sprite.on('pointerdown', (e) => {
        const editor = useEditorStore?.getState?.()
        if (!editor) return
        if (e.button === 2) {
          e.stopPropagation()
          editor.openContextMenu({
            targetType: 'floor_image',
            targetId: floor.id,
            screenX: e.originalEvent?.clientX ?? 0,
            screenY: e.originalEvent?.clientY ?? 0,
          })
          return
        }
        if ((e.button ?? 0) !== 0) return
        const cap = getModeCapability(editor.editorMode)
        if (!cap.allowSelectClick.meta) return
        e.stopPropagation()
        editor.setSelected(floor.id, 'floor_image')
      })
      layer.addChild(sprite)
      currentSprite = sprite
      currentFloorId = floor.id
      currentImageUrl = floor.imageUrl

      applyVisualProps(floor)
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

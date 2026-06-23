import { Sprite, Texture } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii } from './fovPolygon'
import { FALLBACK_PX_PER_M } from './camerasLayer'
import { deviceStatus, DEVICE_STATUS } from './deviceStatus'

// Overlap overlay (planning aid): tints the floor by how many cameras can see
// each spot — single coverage (one camera; a failure there becomes a blind
// spot) vs redundant coverage (≥2 cameras). Complements the blind-spot overlay
// (which shades the 0-camera area). Toggled from the camera timeline bar.
//
// Built on an offscreen canvas: each online camera's wall-clipped FOV polygon
// is rasterised once and read back to accumulate a per-pixel overlap count,
// then the count buffer is colourised into an RGBA image (amber = 1 camera,
// teal = ≥2). Sits in the cameraFov layer, under the walls layer.

const MAX_CANVAS_PX = 1100
const SINGLE_RGB = [245, 158, 11]   // amber — single coverage
const MULTI_RGB = [20, 184, 166]    // teal — redundant (≥2)
const SINGLE_ALPHA = 90             // 0..255
const MULTI_ALPHA = 105

export function attachOverlapLayer({
  scene,
  useFloorStore,
  useWallStore,
  useCameraStore,
}) {
  const layer = scene.layers.cameraFov
  let sprite = null

  const isCameraMode = () => useEditorStore.getState().editorMode === EDITOR_MODE.CAMERA

  const clearSprite = () => {
    if (!sprite) return
    layer.removeChild(sprite)
    sprite.destroy({ texture: true })
    sprite = null
  }

  const rebuild = () => {
    const cs = useCameraStore.getState()
    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)
    if (!isCameraMode() || !cs.showOverlap || !floor?.imageWidth) {
      clearSprite()
      scene.requestRender()
      return
    }
    const cameras = cs.camerasByFloor[activeFloorId] ?? []
    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    const scale = floor.scale ?? FALLBACK_PX_PER_M
    const segs = buildBlockingSegments(walls)

    const k = Math.min(1, MAX_CANVAS_PX / Math.max(floor.imageWidth, floor.imageHeight))
    const cw = Math.max(1, Math.round(floor.imageWidth * k))
    const ch = Math.max(1, Math.round(floor.imageHeight * k))
    const total = cw * ch
    const counts = new Uint8Array(total)

    const scratch = document.createElement('canvas')
    scratch.width = cw
    scratch.height = ch
    const sctx = scratch.getContext('2d', { willReadFrequently: true })

    for (const cam of cameras) {
      if (deviceStatus(cam) === DEVICE_STATUS.OFFLINE) continue
      const { minRangePx, rangePx } = cameraCoverageRadii(cam, scale)
      const poly = computeFovPolygon({
        cx: cam.x, cy: cam.y,
        azimuthDeg: cam.azimuth ?? 0,
        fovDeg: cam.fovDeg ?? 90,
        rangePx, minRangePx,
        segments: segs,
      })
      if (!poly || poly.length < 6) continue
      sctx.clearRect(0, 0, cw, ch)
      sctx.fillStyle = '#fff'
      sctx.beginPath()
      sctx.moveTo(poly[0] * k, poly[1] * k)
      for (let i = 2; i < poly.length; i += 2) sctx.lineTo(poly[i] * k, poly[i + 1] * k)
      sctx.closePath()
      sctx.fill()
      const d = sctx.getImageData(0, 0, cw, ch).data
      for (let p = 0, px = 0; p < d.length; p += 4, px++) {
        if (d[p + 3] > 40 && counts[px] < 255) counts[px] += 1
      }
    }

    // Colourise the count buffer into the output image.
    const out = document.createElement('canvas')
    out.width = cw
    out.height = ch
    const octx = out.getContext('2d')
    const img = octx.createImageData(cw, ch)
    for (let px = 0, p = 0; px < total; px++, p += 4) {
      const c = counts[px]
      if (c === 0) continue   // leave 0-camera area transparent (blind layer owns it)
      const [r, g, b] = c >= 2 ? MULTI_RGB : SINGLE_RGB
      img.data[p] = r
      img.data[p + 1] = g
      img.data[p + 2] = b
      img.data[p + 3] = c >= 2 ? MULTI_ALPHA : SINGLE_ALPHA
    }
    octx.putImageData(img, 0, 0)

    clearSprite()
    sprite = new Sprite(Texture.from(out))
    sprite.eventMode = 'none'
    sprite.width = floor.imageWidth
    sprite.height = floor.imageHeight
    layer.addChild(sprite)
    scene.requestRender()
  }

  let prev = snapshot()
  function snapshot() {
    const cs = useCameraStore.getState()
    const fid = useFloorStore.getState().activeFloorId
    return {
      cams: cs.camerasByFloor[fid],
      walls: useWallStore.getState().wallsByFloor[fid],
      show: cs.showOverlap,
      fid,
      inCamera: isCameraMode(),
    }
  }
  const onChange = () => {
    const cur = snapshot()
    if (cur.cams === prev.cams && cur.walls === prev.walls && cur.show === prev.show
      && cur.fid === prev.fid && cur.inCamera === prev.inCamera) return
    prev = cur
    rebuild()
  }

  const unsubCamera = useCameraStore.subscribe(onChange)
  const unsubWall = useWallStore.subscribe(onChange)
  const unsubFloor = useFloorStore.subscribe(onChange)
  const unsubEditor = useEditorStore.subscribe(onChange)
  rebuild()

  return () => {
    unsubCamera()
    unsubWall()
    unsubFloor()
    unsubEditor()
    clearSprite()
  }
}

import { Sprite, Texture } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii } from './fovPolygon'
import { getPxPerM } from '@/store/useFloorStore'
import { deviceStatus, DEVICE_STATUS } from './deviceStatus'

// Blind-spot overlay (Phase 34-5 ①): shades every part of the floor that NO
// camera can see — the union of all wall-clipped FOV polygons punched out of
// a dark sheet. The punching is done on an offscreen 2D canvas with
// destination-out (PIXI Graphics has no even-odd/boolean fill), then wrapped
// in a sprite at the top of the cameraFov layer: the dark sheet covers the
// floor image + occupancy heatmap, the transparent holes let the green FOV
// cones show through, and the walls layer above stays crisp.

const SHADE_COLOR = 'rgba(15, 23, 42, 0.52)'
const MAX_CANVAS_PX = 1400   // cap the offscreen resolution on huge floors

export function attachBlindSpotLayer({
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
    if (!isCameraMode() || !cs.showBlindSpots || !floor?.imageWidth) {
      clearSprite()
      scene.requestRender()
      return
    }
    const cameras = cs.camerasByFloor[activeFloorId] ?? []
    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    const scale = getPxPerM(floor)
    const segs = buildBlockingSegments(walls)

    const k = Math.min(1, MAX_CANVAS_PX / Math.max(floor.imageWidth, floor.imageHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(floor.imageWidth * k))
    canvas.height = Math.max(1, Math.round(floor.imageHeight * k))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = SHADE_COLOR
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#000'
    for (const cam of cameras) {
      // Offline cameras aren't recording → they cover nothing (count as blind).
      if (deviceStatus(cam) === DEVICE_STATUS.OFFLINE) continue
      const { minRangePx, rangePx } = cameraCoverageRadii(cam, scale)
      const poly = computeFovPolygon({
        cx: cam.x, cy: cam.y,
        azimuthDeg: cam.azimuth ?? 0,
        fovDeg: cam.fovDeg ?? 90,
        rangePx,
        minRangePx,
        segments: segs,
      })
      if (!poly) continue
      ctx.beginPath()
      ctx.moveTo(poly[0] * k, poly[1] * k)
      for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i] * k, poly[i + 1] * k)
      ctx.closePath()
      ctx.fill()
    }

    clearSprite()
    sprite = new Sprite(Texture.from(canvas))
    sprite.eventMode = 'none'
    sprite.width = floor.imageWidth
    sprite.height = floor.imageHeight
    layer.addChild(sprite)   // top of cameraFov — under the walls layer
    scene.requestRender()
  }

  // Diff inputs by hand — camera store changes on draft-point moves etc. too,
  // but rebuilding is cheap enough (per change, not per frame) to keep simple:
  // only skip when nothing relevant changed.
  let prev = snapshot()
  function snapshot() {
    const cs = useCameraStore.getState()
    const fs = useFloorStore.getState()
    const fid = fs.activeFloorId
    const floor = fs.floors.find((f) => f.id === fid)
    return {
      cams: cs.camerasByFloor[fid],
      walls: useWallStore.getState().wallsByFloor[fid],
      show: cs.showBlindSpots,
      fid,
      inCamera: isCameraMode(),
      // 53-G8: the mask is built in metres via floor.scale and sized to the
      // image, but neither was tracked — recalibrating the scale left the
      // mask frozen at the old one (verified: halving px/m left the covered
      // area byte-identical at 61529 px when the true value was 113991).
      scale: floor?.scale,
      imgW: floor?.imageWidth,
      imgH: floor?.imageHeight,
    }
  }
  const onChange = () => {
    const cur = snapshot()
    if (cur.cams === prev.cams && cur.walls === prev.walls && cur.show === prev.show
      && cur.fid === prev.fid && cur.inCamera === prev.inCamera
      && cur.scale === prev.scale && cur.imgW === prev.imgW && cur.imgH === prev.imgH) return
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

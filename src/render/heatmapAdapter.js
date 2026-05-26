import { Sprite, Texture } from 'pixi.js'
import { createHeatmapGL } from '@/features/heatmap/heatmapGL'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleFieldGL } from '@/features/heatmap/sampleFieldGL'
import { sampleField } from '@/features/heatmap/sampleField'
import { getModeConfig } from '@/features/heatmap/modes'

// Heatmap adapter — keeps the existing raw WebGL2 heatmap engine intact and
// wraps its offscreen canvas as a PIXI.Sprite mounted in scene.layers.heatmap.
//
// MVP scope (31-3b):
//   * single-floor only (no cross-floor APs / floor holes / slab attenuation)
//   * no drag-LOD path (no drag overlay store yet)
//   * no scope mask (no useScopeStore yet)
//   * no padding margin (edge artefacts possible — added back when needed)
//   * fingerprint skip omitted; recompute fires on any of the four watched
//     stores updating. Worth roughly one shader pass per store mutation in
//     idle, which fits within the 50–300 AP scenes we have today.
//
// The shader → JS fallback mirrors oldSrc HeatmapLayer.
export function attachHeatmapLayer({
  scene,
  useFloorStore,
  useWallStore,
  useAPStore,
  useHeatmapStore,
}) {
  const layer = scene.layers.heatmap
  let gl = null
  let sprite = null
  let texture = null

  const ensureSprite = () => {
    if (sprite) return sprite
    if (!gl) {
      try {
        gl = createHeatmapGL()
      } catch (e) {
        console.warn('[heatmap] WebGL2 init failed:', e.message)
        return null
      }
    }
    texture = Texture.from(gl.canvas)
    sprite = new Sprite(texture)
    sprite.eventMode = 'none' // heatmap is pure visual overlay; never intercept clicks
    sprite.x = 0
    sprite.y = 0
    sprite.visible = false
    layer.addChild(sprite)
    return sprite
  }

  const hide = () => {
    if (sprite) sprite.visible = false
  }

  const compute = () => {
    const hm = useHeatmapStore.getState()
    if (!hm.enabled) {
      hide()
      return
    }

    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)
    if (!floor || !floor.scale) {
      hide()
      return
    }

    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    const aps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
    if (aps.length === 0) {
      hide()
      return
    }

    const scenario = buildScenario(floor, walls, aps, [], null)
    if (!scenario) {
      hide()
      return
    }

    const s = ensureSprite()
    if (!s) return

    const padding = { left: 0, right: 0, top: 0, bottom: 0 }
    const opts = {
      maxReflOrder: hm.reflections ? 1 : 0,
      enableDiffraction: hm.diffraction,
      padding,
    }

    let field
    if (hm.engine === 'shader') {
      try {
        field = sampleFieldGL(scenario, hm.gridStepM, opts)
      } catch (e) {
        console.warn('[heatmap] shader engine failed, falling back to JS:', e.message)
        field = sampleField(scenario, hm.gridStepM, opts)
      }
    } else {
      field = sampleField(scenario, hm.gridStepM, opts)
    }

    const modeCfg = getModeConfig(hm.mode)
    const activeField = field[modeCfg.field] ?? field.rssi
    const renderField = { rssi: activeField, nx: field.nx, ny: field.ny }

    const outW = Math.max(1, Math.round(scenario.size.w * floor.scale))
    const outH = Math.max(1, Math.round(scenario.size.h * floor.scale))

    gl.render(renderField, outW, outH, 1 / floor.scale, hm.blur, hm.showContours, {
      anchors: modeCfg.anchors,
    })

    // PIXI v8 CanvasSource caches its dimensions at create-time; resize so
    // the GPU texture upload reuploads at the new resolution after heatmapGL
    // mutates canvas.width/height in-place.
    if (texture.source.width !== gl.canvas.width || texture.source.height !== gl.canvas.height) {
      texture.source.resize(gl.canvas.width, gl.canvas.height)
    }
    texture.source.update()

    s.scale.set(floor.imageWidth / gl.canvas.width, floor.imageHeight / gl.canvas.height)
    s.visible = true
  }

  const unsubHM = useHeatmapStore.subscribe(compute)
  const unsubFloor = useFloorStore.subscribe(compute)
  const unsubWall = useWallStore.subscribe(compute)
  const unsubAP = useAPStore.subscribe(compute)
  compute()

  return () => {
    unsubHM()
    unsubFloor()
    unsubWall()
    unsubAP()
    if (sprite) {
      layer.removeChild(sprite)
      sprite.destroy()
      sprite = null
    }
    if (texture) {
      texture.destroy()
      texture = null
    }
    if (gl) {
      gl.dispose()
      gl = null
    }
  }
}

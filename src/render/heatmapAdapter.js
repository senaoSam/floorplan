import { Sprite, Texture, Graphics } from 'pixi.js'
import { createHeatmapGL } from '@/features/heatmap/heatmapGL'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleFieldGL } from '@/features/heatmap/sampleFieldGL'
import { sampleField } from '@/features/heatmap/sampleField'
import { getModeConfig } from '@/features/heatmap/modes'
import { computeFloorElevations } from '@/utils/floorStacking'

// Heatmap adapter — keeps the existing raw WebGL2 heatmap engine intact and
// wraps its offscreen canvas as a PIXI.Sprite mounted in scene.layers.heatmap.
//
// Functional parity with oldSrc HeatmapLayer:
//   ✓ scope mask (in-/out-scope sample exclusion via buildScenario)
//   ✓ cross-floor propagation (other floors' APs + slab attenuation +
//     floor-hole bypass via floorStack)
//   ✓ padding margin (PAD_M / EDGE_TOL_M heuristic, ported below)
//   ✓ hover readout (driven by heatmapHoverBinder + useHoverReadoutStore)
//
// Performance optimisations still deferred — drag-LOD / solo mode /
// fingerprint skip. They land later as a separate perf pass; the 50-300
// AP scenes we have today don't need them.
//
// The shader → JS fallback mirrors oldSrc HeatmapLayer.

// Padding (metres) added to each side of the sampling grid when that
// side ISN'T already framed by a wall. Without padding, APs sitting
// close to the floor plan edge behave as if a wall ran along the edge
// (because the sampler stops there) — RSSI bleeds into a sharp drop.
// EDGE_TOL_M: any wall segment whose extent lies within this tolerance
// of an edge counts as "framing" that edge, in which case no padding is
// added there.
const PAD_M = 12
const EDGE_TOL_M = 0.5

function computePadding(scenario) {
  const { w, h } = scenario.size
  let onLeft = false, onRight = false, onTop = false, onBottom = false
  for (const seg of scenario.walls ?? []) {
    const minX = Math.min(seg.a.x, seg.b.x)
    const maxX = Math.max(seg.a.x, seg.b.x)
    const minY = Math.min(seg.a.y, seg.b.y)
    const maxY = Math.max(seg.a.y, seg.b.y)
    if (maxX <= EDGE_TOL_M)      onLeft   = true
    if (minX >= w - EDGE_TOL_M)  onRight  = true
    if (maxY <= EDGE_TOL_M)      onTop    = true
    if (minY >= h - EDGE_TOL_M)  onBottom = true
  }
  return {
    left:   onLeft   ? 0 : PAD_M,
    right:  onRight  ? 0 : PAD_M,
    top:    onTop    ? 0 : PAD_M,
    bottom: onBottom ? 0 : PAD_M,
  }
}
export function attachHeatmapLayer({
  scene,
  useFloorStore,
  useWallStore,
  useAPStore,
  useScopeStore,
  useFloorHoleStore,
  useHeatmapStore,
}) {
  const layer = scene.layers.heatmap
  let gl = null
  let sprite = null
  let texture = null
  // The padded sample grid extends past the floor image extent. Without
  // a clip the padded region bleeds into the canvas background outside
  // the floor plan, which looked wrong to the user. mask is a Graphics
  // rect anchored at (0,0)→(imgW,imgH) world coords; sprite.mask =
  // maskG clips the sprite to that rect (oldSrc HeatmapLayer used a
  // Konva clipFunc for the same effect).
  let maskG = null

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
    maskG = new Graphics()
    maskG.eventMode = 'none'
    layer.addChild(maskG)
    layer.addChild(sprite)
    sprite.mask = maskG
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
    // Cross-floor: even when the ACTIVE floor has no APs, other floors'
    // APs can still cast attenuated signal through the slab. Check the
    // building-wide AP count, not just the active floor's.
    const apsByFloorAll = useAPStore.getState().apsByFloor ?? {}
    const totalApCount = Object.values(apsByFloorAll).reduce((n, list) => n + (list?.length ?? 0), 0)
    if (totalApCount === 0) {
      hide()
      return
    }
    // Scope mask: scopes on the active floor are passed through to
    // buildScenario which assembles a scopeMaskFn that sampleField /
    // sampleFieldGL apply per-sample. in-scopes restrict the visible
    // heatmap to their interior; out-scopes always exclude theirs.
    const scopes = useScopeStore
      ? (useScopeStore.getState().scopesByFloor?.[activeFloorId] ?? [])
      : []

    // Cross-floor propagation (oldSrc HeatmapLayer.jsx 200-263 1:1):
    //   * APs from every floor land in apsByFloor[] with their floor's
    //     elevation, so heatmapGL can compute the vertical leg via
    //     elevation delta + slab attenuation + floor-hole bypass.
    //   * Other floors' walls go into otherFloorWalls (wall-penetration
    //     loss only; no diffraction across floors).
    //   * floorStack carries slab attenuation per floor + the hole list
    //     (vertical range) that lets samples skip slabs at hole columns.
    let crossFloor = null
    const allFloors = floors
    if (allFloors.length > 1 && useFloorHoleStore) {
      const elevations = computeFloorElevations(allFloors)
      const floorIndexById = new Map(allFloors.map((f, i) => [f.id, i]))
      const holesByFloor = useFloorHoleStore.getState().floorHolesByFloor ?? {}
      const apsByFloor   = useAPStore.getState().apsByFloor ?? {}
      const wallsByFloor = useWallStore.getState().wallsByFloor ?? {}
      const floorStack = allFloors.map((f) => ({
        id: f.id,
        elevationM: elevations[f.id] ?? 0,
        slabDb: f.floorSlabAttenuationDb ?? 0,
        scale: f.scale,
        holes: (holesByFloor[f.id] ?? []).map((h) => ({
          points: h.points,
          fromIdx: floorIndexById.get(h.bottomFloorId ?? f.id) ?? floorIndexById.get(f.id),
          toIdx:   floorIndexById.get(h.topFloorId    ?? f.id) ?? floorIndexById.get(f.id),
        })),
      }))
      const apsAcrossFloors = []
      for (const f of allFloors) {
        const floorAPs = apsByFloor[f.id] ?? []
        const floorElev = elevations[f.id] ?? 0
        for (const ap of floorAPs) {
          apsAcrossFloors.push({
            ...ap,
            posPx: { x: ap.x, y: ap.y },
            elevationM: floorElev,
            floorScale: f.scale,
          })
        }
      }
      const otherFloorWalls = []
      for (const f of allFloors) {
        if (f.id === activeFloorId) continue
        const fws = wallsByFloor[f.id] ?? []
        if (fws.length === 0) continue
        otherFloorWalls.push({
          elevationM: elevations[f.id] ?? 0,
          scale: f.scale,
          walls: fws,
        })
      }
      crossFloor = {
        activeElevationM: elevations[activeFloorId] ?? 0,
        rxHeightM: 1.0,
        floorStack,
        apsByFloor: apsAcrossFloors,
        otherFloorWalls,
      }
    }

    const scenario = buildScenario(floor, walls, aps, scopes, crossFloor)
    if (!scenario) {
      hide()
      return
    }

    const s = ensureSprite()
    if (!s) return

    const padding = computePadding(scenario)
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

    // The padded region IS sampled (so the kernel resolves correctly at
    // the floor-plan edge) but spills past the image extent — sprite
    // position + size compensate so the floor-rect-aligned portion lines
    // up perfectly with the floor image, and the padding bleeds into the
    // dark canvas background outside it.
    const totalWm = scenario.size.w + padding.left + padding.right
    const totalHm = scenario.size.h + padding.top  + padding.bottom
    const outW = Math.max(1, Math.round(totalWm * floor.scale))
    const outH = Math.max(1, Math.round(totalHm * floor.scale))

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

    // Anchor sprite top-left at (-padLpx, -padTpx) so the unpadded
    // floor-plan rect (scenario.size.w × h) aligns with (0,0)→(imgW,imgH)
    // in world space. Mirrors oldSrc KonvaImage offsetX/offsetY trick.
    const padLpx = padding.left * floor.scale
    const padTpx = padding.top  * floor.scale
    const fullW  = totalWm * floor.scale
    const fullH  = totalHm * floor.scale
    s.x = -padLpx
    s.y = -padTpx
    s.scale.set(fullW / gl.canvas.width, fullH / gl.canvas.height)
    s.visible = true
    // Clip the padded sprite to the floor image rect so the padding
    // sample region — which we WANT for kernel correctness near edges
    // — never bleeds visually past the floor extent.
    if (maskG) {
      maskG.clear()
      maskG.rect(0, 0, floor.imageWidth, floor.imageHeight)
        .fill({ color: 0xffffff, alpha: 1 })
    }
  }

  const unsubHM = useHeatmapStore.subscribe(compute)
  const unsubFloor = useFloorStore.subscribe(compute)
  const unsubWall = useWallStore.subscribe(compute)
  const unsubAP = useAPStore.subscribe(compute)
  const unsubScope = useScopeStore ? useScopeStore.subscribe(compute) : () => {}
  const unsubHole  = useFloorHoleStore ? useFloorHoleStore.subscribe(compute) : () => {}
  compute()

  return () => {
    unsubHM()
    unsubFloor()
    unsubWall()
    unsubAP()
    unsubScope()
    unsubHole()
    if (maskG) {
      if (sprite) sprite.mask = null
      layer.removeChild(maskG)
      maskG.destroy()
      maskG = null
    }
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

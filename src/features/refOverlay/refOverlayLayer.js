import { Container, Graphics, Sprite, Texture, ColorMatrixFilter } from 'pixi.js'
import { EDITOR_MODE } from '@/store/useEditorStore'
import { getFloorColor } from '@/utils/floorColor'

// Render translucent tinted overlays of reference floors during
// ALIGN_FLOOR mode. Each ref floor gets a single Container under
// scene.refOverlay with its own align transform applied; inside the
// container the floor's image, walls, scopes, floor-holes, and APs are
// drawn in the floor's tint colour (utils/floorColor) at alignRefOpacity.
//
// Ported from oldSrc:
//   - FloorImageLayer (refs use translucent + tinted sprite, no interaction)
//   - RefWallLayer (tinted line per wall)
//   - RefVectorLayer (tinted scope dashed polygon, floor-hole solid polygon,
//     AP ring + dot)
//
// Outside ALIGN_FLOOR mode the layer is hidden and child containers
// destroyed — no work on the hot path of normal editing.
//
// ⚠ [REF-OVERLAY-TYPE] adding a new overlayed object type → also update
// AlignFloorPanel legend.

const loadTextureFromUrl = (url) =>
  new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload  = () => resolve(Texture.from(img))
    img.onerror = (e) => reject(e instanceof Error ? e : new Error(`image load failed: ${url}`))
    img.src = url
  })

const hexToInt = (hex) => {
  if (typeof hex !== 'string') return 0xffffff
  const v = hex.startsWith('#') ? hex.slice(1) : hex
  return parseInt(v, 16) || 0xffffff
}

export function attachRefOverlayLayer({
  scene,
  useFloorStore,
  useEditorStore,
  useWallStore,
  useAPStore,
  useScopeStore,
  useFloorHoleStore,
}) {
  const root = scene.refOverlay

  // floorId → { container, walls, vectors, sprite }
  const built = new Map()

  const destroyEntry = (entry) => {
    if (!entry) return
    root.removeChild(entry.container)
    entry.container.destroy({ children: true, texture: false })
  }

  const clearAll = () => {
    for (const entry of built.values()) destroyEntry(entry)
    built.clear()
  }

  // `k` is the px/m density compensation: alignment is defined in meter
  // space (utils/floorAlign), so a ref floor whose image has a different
  // px/m calibration must be scaled by scaleActive/scaleRef to appear at
  // true relative size on the active floor's px canvas. Either scale
  // missing → k = 1 (raw-px fallback; AlignFloorPanel shows a warning).
  // The whole meter-space map projected onto the active canvas is exactly
  // k × (the floor's own px-space align formula), so k folds into the
  // container's position and scale.
  const applyAlignTransform = (container, floor, k) => {
    const cx = (floor.imageWidth ?? 0) / 2
    const cy = (floor.imageHeight ?? 0) / 2
    const ox = floor.alignOffsetX ?? 0
    const oy = floor.alignOffsetY ?? 0
    const sc = floor.alignScale ?? 1
    const rt = ((floor.alignRotation ?? 0) * Math.PI) / 180
    container.pivot.set(cx, cy)
    container.position.set((cx + ox) * k, (cy + oy) * k)
    container.rotation = rt
    container.scale.set(sc * k, sc * k)
  }

  // Build the tinted sprite + walls/scopes/holes/APs graphics for one
  // ref floor. Sprite loads async; the entry is registered immediately
  // so vector overlays render even before the texture lands.
  const buildEntry = (floor, color, opacity, k) => {
    const container = new Container()
    container.eventMode = 'none'
    container.alpha = opacity
    applyAlignTransform(container, floor, k)
    root.addChild(container)

    // Tint filter — ColorMatrixFilter to recolor the greyscale-ish floor
    // image into the floor's distinct hue.
    const tintFilter = new ColorMatrixFilter()
    const colorInt = hexToInt(color)
    const r = ((colorInt >> 16) & 0xff) / 255
    const g = ((colorInt >>  8) & 0xff) / 255
    const b = (colorInt         & 0xff) / 255
    // Luma-preserve tint matrix — preserves the line/density structure
    // of the floor plan while shifting the hue toward the floor colour.
    tintFilter.matrix = [
      r * 0.6, r * 0.3, r * 0.1, 0, 0,
      g * 0.6, g * 0.3, g * 0.1, 0, 0,
      b * 0.6, b * 0.3, b * 0.1, 0, 0,
      0,       0,       0,       1, 0,
    ]

    const sprite = new Sprite()
    sprite.eventMode = 'none'
    sprite.anchor.set(0.5, 0.5)
    sprite.x = (floor.imageWidth ?? 0) / 2
    sprite.y = (floor.imageHeight ?? 0) / 2
    sprite.width = floor.imageWidth ?? 0
    sprite.height = floor.imageHeight ?? 0
    sprite.visible = false
    sprite.filters = [tintFilter]
    container.addChild(sprite)

    if (floor.imageUrl) {
      loadTextureFromUrl(floor.imageUrl).then((tex) => {
        if (sprite.destroyed) return
        sprite.texture = tex
        sprite.visible = true
      }).catch((err) => {
        // Tolerate missing/broken images — vector overlays still render.
        console.warn('[refOverlay] image load failed for floor', floor.id, err)
      })
    }

    const walls = new Graphics()
    walls.eventMode = 'none'
    container.addChild(walls)

    const vectors = new Graphics()
    vectors.eventMode = 'none'
    container.addChild(vectors)

    return { container, sprite, walls, vectors, color, opacity, floorId: floor.id }
  }

  // Draw tinted walls for one ref floor — solid stroke width 2 in floor
  // colour, matches oldSrc RefWallLayer.
  const drawWalls = (entry, wallsList) => {
    const g = entry.walls
    g.clear()
    const color = hexToInt(entry.color)
    for (const w of wallsList) {
      g.moveTo(w.startX, w.startY).lineTo(w.endX, w.endY)
        .stroke({ width: 2, color, alpha: 1, cap: 'round' })
    }
  }

  // Scopes (dashed polygon), floor-holes (solid polygon), APs (ring + dot)
  // — mirrors oldSrc RefVectorLayer line-by-line.
  const drawVectors = (entry, scopes, holes, aps) => {
    const g = entry.vectors
    g.clear()
    const color = hexToInt(entry.color)

    for (const sc of scopes) {
      drawPolygon(g, sc.points, color, /* dashed */ true)
    }
    for (const h of holes) {
      drawPolygon(g, h.points, color, /* dashed */ false)
    }
    for (const ap of aps) {
      g.circle(ap.x, ap.y, 8).stroke({ width: 1.5, color, alpha: 1 })
      g.circle(ap.x, ap.y, 2.5).fill({ color, alpha: 1 })
    }
  }

  // Scope.points / FloorHole.points in oldSrc are flat [x0,y0,x1,y1,...]
  // arrays. Treat objects either way for safety.
  const polyToPairs = (pts) => {
    if (!Array.isArray(pts) || pts.length === 0) return []
    if (typeof pts[0] === 'number') {
      const out = []
      for (let i = 0; i + 1 < pts.length; i += 2) out.push({ x: pts[i], y: pts[i + 1] })
      return out
    }
    return pts
  }

  const drawPolygon = (g, points, color, dashed) => {
    const pairs = polyToPairs(points)
    if (pairs.length < 2) return
    if (!dashed) {
      g.moveTo(pairs[0].x, pairs[0].y)
      for (let i = 1; i < pairs.length; i++) g.lineTo(pairs[i].x, pairs[i].y)
      g.lineTo(pairs[0].x, pairs[0].y)
        .stroke({ width: 1.5, color, alpha: 1 })
      return
    }
    // Dashed closed polygon — draw each edge as a 6/4 dashed segment.
    const drawDashed = (ax, ay, bx, by) => {
      const len = Math.hypot(bx - ax, by - ay)
      if (len < 1e-9) return
      const ux = (bx - ax) / len, uy = (by - ay) / len
      const on = 6, off = 4
      let cur = 0, phaseOn = true, remain = on
      while (cur < len) {
        const step = Math.min(len - cur, remain)
        if (phaseOn) {
          g.moveTo(ax + ux * cur, ay + uy * cur)
           .lineTo(ax + ux * (cur + step), ay + uy * (cur + step))
           .stroke({ width: 1.5, color, alpha: 1 })
        }
        cur += step; remain -= step
        if (remain <= 1e-9) { phaseOn = !phaseOn; remain = phaseOn ? on : off }
      }
    }
    for (let i = 0; i < pairs.length; i++) {
      const a = pairs[i], b = pairs[(i + 1) % pairs.length]
      drawDashed(a.x, a.y, b.x, b.y)
    }
  }

  // Rebuild everything from current store snapshots — cheap because
  // ALIGN_FLOOR is a discrete mode the user dwells in, not a hot path.
  const rebuild = () => {
    const editor = useEditorStore.getState()
    const inAlign = editor.editorMode === EDITOR_MODE.ALIGN_FLOOR
    root.visible = inAlign
    if (!inAlign) {
      clearAll()
      return
    }

    const { floors, activeFloorId } = useFloorStore.getState()
    const activeFloor = floors.find((f) => f.id === activeFloorId)
    const refIds = editor.alignRefFloors ?? []
    const opacity = editor.alignRefOpacity ?? 0.3

    // Drop entries whose floor is no longer referenced.
    for (const fid of Array.from(built.keys())) {
      if (fid === activeFloorId || !refIds.includes(fid)) {
        destroyEntry(built.get(fid))
        built.delete(fid)
      }
    }

    // Create / refresh entries for every ref floor.
    for (const fid of refIds) {
      if (fid === activeFloorId) continue
      const floor = floors.find((f) => f.id === fid)
      if (!floor) continue
      const idx = floors.findIndex((f) => f.id === fid)
      const color = getFloorColor(idx)

      const k = (activeFloor?.scale && floor.scale)
        ? activeFloor.scale / floor.scale
        : 1

      let entry = built.get(fid)
      if (!entry) {
        entry = buildEntry(floor, color, opacity, k)
        built.set(fid, entry)
      } else {
        // Floor record (transform / image / colour palette / scale) may
        // have changed since last build — keep the live container in sync.
        entry.color = color
        entry.opacity = opacity
        entry.container.alpha = opacity
        applyAlignTransform(entry.container, floor, k)
      }

      const wallsList = useWallStore.getState().wallsByFloor?.[fid] ?? []
      const scopes    = useScopeStore.getState().scopesByFloor?.[fid] ?? []
      const holes     = useFloorHoleStore.getState().floorHolesByFloor?.[fid] ?? []
      const aps       = useAPStore.getState().apsByFloor?.[fid] ?? []
      drawWalls(entry, wallsList)
      drawVectors(entry, scopes, holes, aps)
    }
  }

  const unsubEditor = useEditorStore.subscribe(rebuild)
  const unsubFloor  = useFloorStore.subscribe(rebuild)
  const unsubWall   = useWallStore.subscribe(rebuild)
  const unsubAP     = useAPStore.subscribe(rebuild)
  const unsubScope  = useScopeStore.subscribe(rebuild)
  const unsubHole   = useFloorHoleStore.subscribe(rebuild)
  rebuild()

  return () => {
    unsubEditor(); unsubFloor(); unsubWall(); unsubAP(); unsubScope(); unsubHole()
    clearAll()
  }
}

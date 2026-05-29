import { Container, Graphics, Circle } from 'pixi.js'
import { useViewportStore } from '@/store/useViewportStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useDraftStore } from '@/store/useDraftStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { EDITOR_MODE } from '@/store/useEditorStore'
import { generateId } from '@/utils/id'
import { snapToWallForTray, parallelWallLock } from '@/features/draft/traySnap'

// Edit handles for the selected (or hovered) wall + selected tray.
// Rendered on scene.layers.handles so they sit above object layers but
// below labels.
//
// Wall endpoint handle visuals match oldSrc EndpointHandle:
//   - Circle radius 7, fill #fff, stroke #e74c3c, strokeWidth 2.5
//   - cursor crosshair
//   - drag rewrites the endpoint; uses tray's wall-snap chain
//     (endpoint 14 px → segment foot 10 px, via snapToWallForTray)
//   - double-click → enter DRAW_WALL with first point preset to endpoint
//   - shown when wall is selected OR hovered (for discoverability)
//
// Tray vertex handles: white fill + system-cyan stroke (lighter so they
// don't compete with the white tray-selected border).

const HANDLE_RADIUS = 7          // oldSrc 7 * inverseScale
const HANDLE_STROKE_WIDTH = 2.5  // oldSrc 2.5 * inverseScale
const HANDLE_HIT_PAD = 2
const WALL_HANDLE_FILL = '#ffffff'
const WALL_HANDLE_STROKE = '#e74c3c'
// Tray vertex handles — oldSrc CableTrayLayer VertexHandle 187-194:
//   radius 6 → 8 on hover, strokeWidth 2 → 2.4 on hover.
const TRAY_HANDLE_RADIUS = 6
const TRAY_HANDLE_RADIUS_HOVER = 8
const TRAY_HANDLE_STROKE_WIDTH = 2
const TRAY_HANDLE_FILL = '#ffffff'
const TRAY_HANDLE_STROKE = '#0e7490'

// Crop adjust visuals — oldSrc CropLayer.jsx 4-8.
const CROP_HANDLE_RADIUS = 8
const CROP_HANDLE_STROKE_WIDTH = 2
const CROP_HANDLE_FILL = '#ffffff'
const CROP_BORDER_COLOR = 0x00e5ff
const CROP_MASK_COLOR = 0x000000
const CROP_MASK_ALPHA = 0.55

function makeHandleDot(x, y, fill, stroke, radius, strokeWidth) {
  const c = new Container()
  c.eventMode = 'static'
  c.cursor = 'crosshair'
  c.hitArea = new Circle(0, 0, radius + HANDLE_HIT_PAD)
  c.position.set(x, y)
  const g = new Graphics()
  g.circle(0, 0, radius)
    .fill({ color: fill, alpha: 1 })
    .stroke({ width: strokeWidth, color: stroke, alpha: 1 })
  c.addChild(g)
  return c
}

export function attachHandlesLayer({
  scene,
  useFloorStore,
  useWallStore,
  useCableStore,
  useEditorStore,
}) {
  const layer = scene.layers.handles
  layer.eventMode = 'passive'

  const root = new Container()
  layer.addChild(root)

  // True while a handle drag is in flight. While true, rebuild() bails
  // so the dragged Container isn't destroyed by an unrelated store
  // change (hover hopping onto a wall, AP / SW drag overlay updates,
  // viewport zoom, etc.). On dragend we explicitly rebuild() so the
  // handles re-render at the committed positions.
  let isDragging = false

  // Containers that should resize inversely with viewport zoom so they
  // stay screen-sized. Crop-adjust rotation Containers do NOT belong
  // here (their children are in image coords and would be doubly scaled).
  const inverseScaleNodes = new Set()
  // Closure that re-renders the crop overlay (border + optional mask /
  // thirds) at the current viewport scale. Set by buildCropAdjustHandles,
  // cleared by rebuild(). Used by the viewport subscription so dashed
  // border stroke widths stay constant in screen px during pan / zoom.
  let cropRedrawOnViewport = null

  const targetWall = () => {
    const editor = useEditorStore.getState()
    const hover = useHoverStore.getState()
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return null
    // Hide handles outside SELECT — user follow-up: DRAW_WALL is a draw
    // mode, no selection / no handle interaction. Endpoint extension
    // happens via snap-to-endpoint when placing draft points.
    if (editor.editorMode !== EDITOR_MODE.SELECT) return null
    const walls = useWallStore.getState().wallsByFloor[fid] ?? []
    // Prefer selected wall; fall back to hovered wall so the handles act
    // as a hover affordance ("you can grab this endpoint") before any
    // click has happened — matches oldSrc isSelected || isHovered.
    if (editor.selectedType === 'wall' && editor.selectedId) {
      const w = walls.find((w) => w.id === editor.selectedId)
      if (w) return w
    }
    if (hover.type === 'wall' && hover.id) {
      const w = walls.find((w) => w.id === hover.id)
      if (w) return w
    }
    return null
  }

  const rebuild = () => {
    if (isDragging) return
    while (root.children.length > 0) {
      const c = root.children[0]
      root.removeChild(c)
      c.destroy({ children: true })
    }
    inverseScaleNodes.clear()
    cropRedrawOnViewport = null

    const wall = targetWall()
    if (wall) {
      const startHandle = makeHandleDot(
        wall.startX, wall.startY,
        WALL_HANDLE_FILL, WALL_HANDLE_STROKE,
        HANDLE_RADIUS, HANDLE_STROKE_WIDTH,
      )
      const endHandle = makeHandleDot(
        wall.endX, wall.endY,
        WALL_HANDLE_FILL, WALL_HANDLE_STROKE,
        HANDLE_RADIUS, HANDLE_STROKE_WIDTH,
      )
      bindWallEndpointDrag(startHandle, wall, 'start')
      bindWallEndpointDrag(endHandle, wall, 'end')
      root.addChild(startHandle)
      root.addChild(endHandle)
      inverseScaleNodes.add(startHandle)
      inverseScaleNodes.add(endHandle)
      return
    }

    const floor = targetFloorForCrop()
    if (floor) {
      buildCropAdjustHandles(floor)
      return
    }

    const { selectedId, selectedType } = useEditorStore.getState()
    if (!selectedId) return
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return

    if (selectedType === 'cable_tray') {
      const tray = (useCableStore.getState().traysByFloor[fid] ?? []).find((t) => t.id === selectedId)
      if (!tray) return
      tray.points.forEach((p, idx) => {
        const h = makeHandleDot(
          p.x, p.y,
          TRAY_HANDLE_FILL, TRAY_HANDLE_STROKE,
          TRAY_HANDLE_RADIUS, TRAY_HANDLE_STROKE_WIDTH,
        )
        h.cursor = 'move'
        bindTrayVertexDrag(h, tray, idx)
        // Hover expansion — oldSrc VertexHandle 190-193 grows radius
        // 6→8 px when hovered. We implement that via a per-handle scale
        // multiplier read by applyInverseScale.
        h._hoverScaleMul = TRAY_HANDLE_RADIUS_HOVER / TRAY_HANDLE_RADIUS
        h.on('pointerover', () => { h._hovered = true; applyInverseScale() })
        h.on('pointerout',  () => { h._hovered = false; applyInverseScale() })
        root.addChild(h)
        inverseScaleNodes.add(h)
      })
    }
  }

  // Selected floor_image (with a saved crop) in SELECT mode → show 4
  // corner handles + dashed cyan border (oldSrc CropLayer's "adjust"
  // path). Returns null otherwise.
  const targetFloorForCrop = () => {
    const editor = useEditorStore.getState()
    if (editor.editorMode !== EDITOR_MODE.SELECT) return null
    if (editor.selectedType !== 'floor_image') return null
    const floors = useFloorStore.getState().floors
    const f = floors.find((x) => x.id === editor.selectedId)
    if (!f) return null
    if (f.cropX == null || f.cropY == null) return null
    if (!(f.cropWidth > 0) || !(f.cropHeight > 0)) return null
    return f
  }

  // Builds the rotation Container holding the crop border + body-drag
  // hit area + 4 corner handles. Container is pivoted on image centre so
  // it rotates with the sprite (matches floorImageLayer's sprite.rotation).
  //
  // Q2 — divergence from oldSrc: mask + rule-of-thirds stay visible in
  // idle adjust mode (oldSrc only showed mask while drawing / dragging).
  // Without this the user couldn't easily tell the crop had been applied;
  // they saw a thin dashed border buried among walls / APs and asked
  // "now what?". Persistent mask makes the cropped area obvious.
  //
  // Q3 — divergence from oldSrc: a body Container with hitArea covering
  // the rect interior lets the user drag the whole crop frame as one,
  // not just resize via corners. Added BEFORE handles so the corner
  // handles' hitAreas win the z-order overlap.
  function buildCropAdjustHandles(floor) {
    const imgW = floor.imageWidth
    const imgH = floor.imageHeight
    const cx = imgW / 2
    const cy = imgH / 2
    const rotRad = ((floor.rotation ?? 0) * Math.PI) / 180

    const rot = new Container()
    rot.eventMode = 'passive'
    rot.position.set(cx, cy)
    rot.pivot.set(cx, cy)
    rot.rotation = rotRad
    root.addChild(rot)

    const overlayG = new Graphics()
    overlayG.eventMode = 'none'
    rot.addChild(overlayG)

    const initialRect = {
      x: floor.cropX, y: floor.cropY,
      w: floor.cropWidth, h: floor.cropHeight,
    }

    // Body drag hit area — frame-shaped (border ribbon only, NOT the
    // interior) so clicks inside the crop pass through to walls / APs
    // below. PIXI v8 hitArea accepts any { contains(x,y) }, so we synth
    // a "rect minus inner rect" via two bounds checks. Width tracks
    // viewport zoom so the grab ribbon stays ~CROP_BODY_GRAB_PX screen-px
    // thick regardless of scale.
    const CROP_BODY_GRAB_PX = 8
    const body = new Container()
    body.eventMode = 'static'
    body.cursor = 'move'
    body.hitArea = {
      contains: (lx, ly) => {
        const r = readCropRect(floor.id) ?? initialRect
        if (!r) return false
        const vpScale = useViewportStore.getState().scale || 1
        const pad = CROP_BODY_GRAB_PX / vpScale
        const inOuter = lx >= r.x - pad && lx <= r.x + r.w + pad
                     && ly >= r.y - pad && ly <= r.y + r.h + pad
        if (!inOuter) return false
        const inInner = lx > r.x + pad && lx < r.x + r.w - pad
                     && ly > r.y + pad && ly < r.y + r.h - pad
        return !inInner
      },
    }
    rot.addChild(body)

    const handles = {}
    for (const key of ['tl', 'tr', 'bl', 'br']) {
      const h = makeHandleDot(
        0, 0,
        CROP_HANDLE_FILL, CROP_BORDER_COLOR,
        CROP_HANDLE_RADIUS, CROP_HANDLE_STROKE_WIDTH,
      )
      handles[key] = h
      rot.addChild(h)
      inverseScaleNodes.add(h)
    }
    positionCropHandles(handles, initialRect)

    // Redraw closure — captures overlayG + floor.id so it can pull the
    // freshest rect from useFloorStore each tick (covers viewport zoom
    // while the rect lives in the store).
    const redrawCropOverlay = (rectOverride, showMaskGuides) => {
      const fresh = rectOverride ?? readCropRect(floor.id)
      if (!fresh) return
      drawCropOverlay(overlayG, imgW, imgH, fresh, showMaskGuides)
      // body.hitArea is a contains-fn closure that reads the freshest
      // rect from useFloorStore on every hit-test, so no update needed
      // here — it always tracks the current crop extents.
    }
    // Q2 — show mask + guides ALWAYS in adjust mode (not just during
    // drag). User explicitly asked for a persistent visual cue of "this
    // is your cropped area".
    cropRedrawOnViewport = () => redrawCropOverlay(null, true)
    redrawCropOverlay(initialRect, true)

    for (const key of Object.keys(handles)) {
      bindCropHandleDrag(handles[key], floor.id, key, handles, redrawCropOverlay)
    }
    bindCropBodyDrag(body, floor.id, handles, redrawCropOverlay)
  }

  const readCropRect = (floorId) => {
    const f = useFloorStore.getState().floors.find((x) => x.id === floorId)
    if (!f || f.cropX == null) return null
    return { x: f.cropX, y: f.cropY, w: f.cropWidth, h: f.cropHeight }
  }

  const positionCropHandles = (handles, rect) => {
    handles.tl.position.set(rect.x,          rect.y)
    handles.tr.position.set(rect.x + rect.w, rect.y)
    handles.bl.position.set(rect.x,          rect.y + rect.h)
    handles.br.position.set(rect.x + rect.w, rect.y + rect.h)
  }

  // Draw dashed cyan border + (optionally) dark mask outside crop +
  // rule-of-thirds. All widths use 1/scale so they stay constant in
  // screen px. Matches oldSrc CropLayer.
  function drawCropOverlay(g, imgW, imgH, rect, showMaskGuides) {
    g.clear()
    const inv = 1 / (useViewportStore.getState().scale || 1)
    if (showMaskGuides) {
      g.rect(0, 0, imgW, Math.max(0, rect.y))
        .fill({ color: CROP_MASK_COLOR, alpha: CROP_MASK_ALPHA })
      g.rect(0, rect.y + rect.h, imgW, Math.max(0, imgH - rect.y - rect.h))
        .fill({ color: CROP_MASK_COLOR, alpha: CROP_MASK_ALPHA })
      g.rect(0, rect.y, Math.max(0, rect.x), rect.h)
        .fill({ color: CROP_MASK_COLOR, alpha: CROP_MASK_ALPHA })
      g.rect(rect.x + rect.w, rect.y, Math.max(0, imgW - rect.x - rect.w), rect.h)
        .fill({ color: CROP_MASK_COLOR, alpha: CROP_MASK_ALPHA })
      for (const frac of [1 / 3, 2 / 3]) {
        g.moveTo(rect.x + rect.w * frac, rect.y)
         .lineTo(rect.x + rect.w * frac, rect.y + rect.h)
         .stroke({ width: 0.5 * inv, color: CROP_BORDER_COLOR, alpha: 0.4 })
        g.moveTo(rect.x, rect.y + rect.h * frac)
         .lineTo(rect.x + rect.w, rect.y + rect.h * frac)
         .stroke({ width: 0.5 * inv, color: CROP_BORDER_COLOR, alpha: 0.4 })
      }
    }
    const w = 2 * inv, on = 8 * inv, off = 4 * inv
    drawDashedLine(g, rect.x,          rect.y,          rect.x + rect.w, rect.y,          w, on, off)
    drawDashedLine(g, rect.x + rect.w, rect.y,          rect.x + rect.w, rect.y + rect.h, w, on, off)
    drawDashedLine(g, rect.x + rect.w, rect.y + rect.h, rect.x,          rect.y + rect.h, w, on, off)
    drawDashedLine(g, rect.x,          rect.y + rect.h, rect.x,          rect.y,          w, on, off)
  }

  function drawDashedLine(g, ax, ay, bx, by, width, on, off) {
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1e-9) return
    const ux = (bx - ax) / len, uy = (by - ay) / len
    let cur = 0, phaseOn = true, remain = on
    while (cur < len) {
      const step = Math.min(len - cur, remain)
      if (phaseOn) {
        g.moveTo(ax + ux * cur, ay + uy * cur)
         .lineTo(ax + ux * (cur + step), ay + uy * (cur + step))
         .stroke({ width, color: CROP_BORDER_COLOR, alpha: 1 })
      }
      cur += step; remain -= step
      if (remain <= 1e-9) { phaseOn = !phaseOn; remain = phaseOn ? on : off }
    }
  }

  // Crop handle drag — rot.toLocal(global) gives unrotated image-coord
  // pos, which is exactly the space cropX/Y/W/H live in. Writes to
  // useFloorStore on every move so the sprite mask (in floorImageLayer)
  // follows the drag live; isDragging blocks our own rebuild from
  // tearing down the dragged handle.
  const bindCropHandleDrag = (handle, floorId, corner, handles, redrawCropOverlay) => {
    handle.on('pointerdown', (e) => {
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      isDragging = true
      const stage = scene.app.stage
      const rot = handle.parent
      const startLocal = rot.toLocal(e.global)
      const f0 = useFloorStore.getState().floors.find((x) => x.id === floorId)
      if (!f0) { isDragging = false; return }
      const original = {
        x: f0.cropX, y: f0.cropY,
        w: f0.cropWidth, h: f0.cropHeight,
      }

      const onMove = (ev) => {
        if (handle.destroyed || !handle.position) return
        const lp = rot.toLocal(ev.global)
        const dx = lp.x - startLocal.x
        const dy = lp.y - startLocal.y
        let x1 = original.x, y1 = original.y
        let x2 = original.x + original.w, y2 = original.y + original.h
        if (corner === 'tl') { x1 = original.x + dx;             y1 = original.y + dy }
        if (corner === 'tr') { x2 = original.x + original.w + dx; y1 = original.y + dy }
        if (corner === 'bl') { x1 = original.x + dx;             y2 = original.y + original.h + dy }
        if (corner === 'br') { x2 = original.x + original.w + dx; y2 = original.y + original.h + dy }
        const rx = Math.min(x1, x2), ry = Math.min(y1, y2)
        const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1)
        if (rw < 2 || rh < 2) return
        const rect = { x: rx, y: ry, w: rw, h: rh }
        positionCropHandles(handles, rect)
        redrawCropOverlay(rect, true)
        useFloorStore.getState().updateFloor(floorId, {
          cropX: rect.x, cropY: rect.y, cropWidth: rect.w, cropHeight: rect.h,
        })
      }
      const onUp = () => {
        stage.off('pointermove', onMove)
        stage.off('pointerup', onUp)
        stage.off('pointerupoutside', onUp)
        isDragging = false
        rebuild()
        applyInverseScale()
      }
      stage.on('pointermove', onMove)
      stage.on('pointerup', onUp)
      stage.on('pointerupoutside', onUp)
    })
  }

  // Q3 — body drag for the crop rect (oldSrc had no body drag, corners
  // only). Translates all four corners by the pointermove delta in
  // image-space; width / height preserved. Mirrors bindCropHandleDrag's
  // toLocal-based delta pattern so it works correctly when the floor is
  // rotated.
  const bindCropBodyDrag = (body, floorId, handles, redrawCropOverlay) => {
    body.on('pointerdown', (e) => {
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      isDragging = true
      const stage = scene.app.stage
      const rot = body.parent
      const startLocal = rot.toLocal(e.global)
      const f0 = useFloorStore.getState().floors.find((x) => x.id === floorId)
      if (!f0) { isDragging = false; return }
      const original = {
        x: f0.cropX, y: f0.cropY,
        w: f0.cropWidth, h: f0.cropHeight,
      }

      const onMove = (ev) => {
        if (body.destroyed) return
        const lp = rot.toLocal(ev.global)
        const dx = lp.x - startLocal.x
        const dy = lp.y - startLocal.y
        const rect = {
          x: original.x + dx,
          y: original.y + dy,
          w: original.w,
          h: original.h,
        }
        positionCropHandles(handles, rect)
        redrawCropOverlay(rect, true)
        useFloorStore.getState().updateFloor(floorId, {
          cropX: rect.x, cropY: rect.y, cropWidth: rect.w, cropHeight: rect.h,
        })
      }
      const onUp = () => {
        stage.off('pointermove', onMove)
        stage.off('pointerup', onUp)
        stage.off('pointerupoutside', onUp)
        isDragging = false
        rebuild()
        applyInverseScale()
      }
      stage.on('pointermove', onMove)
      stage.on('pointerup', onUp)
      stage.on('pointerupoutside', onUp)
    })
  }

  const bindWallEndpointDrag = (handle, wall, end) => {
    let dragMoved = false

    handle.on('pointerdown', (e) => {
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      dragMoved = false
      isDragging = true
      // Signal "wall endpoint drag in flight" so isAnyDragging() bails
      // every layer's pointerover (hover suppressed during the drag).
      useDragOverlayStore.getState().setWallEndpoint({ wallId: wall.id, end })
      const stage = scene.app.stage
      const startWorld = scene.world.toLocal(e.global)
      const original = { x: wall[end + 'X'], y: wall[end + 'Y'] }
      const otherEnd = end === 'start' ? 'end' : 'start'
      const anchor = { x: wall[otherEnd + 'X'], y: wall[otherEnd + 'Y'] }
      const fid = useFloorStore.getState().activeFloorId

      const onMove = (ev) => {
        if (handle.destroyed || !handle.position) return
        const wp = scene.world.toLocal(ev.global)
        const raw = {
          x: original.x + (wp.x - startWorld.x),
          y: original.y + (wp.y - startWorld.y),
        }
        const moveMag = Math.hypot(raw.x - original.x, raw.y - original.y)
        if (moveMag > 0.5) dragMoved = true
        const scale = useViewportStore.getState().scale || 1
        const walls = useWallStore.getState().wallsByFloor[fid] ?? []
        // Snap chain mirrors DRAW_WALL / DRAW_CABLE_TRAY (snapTrayPoint):
        //   (1) wall endpoint 14 screen-px
        //   (2) wall segment foot 10 screen-px
        //   (3) parallel / perpendicular intent lock against nearest wall
        //       (6°, 180 px) — anchor is the OTHER (static) endpoint of
        //       this wall, so dragging detects "I want this wall parallel
        //       / perpendicular to that nearby wall" the same way the
        //       draw flow does between clicks.
        // Exclude self so the dragged endpoint doesn't snap to its own wall.
        const wallsExclSelf = walls.filter((w) => w.id !== wall.id)
        const hit = snapToWallForTray(raw, wallsExclSelf, scale)
        let snapped, hintKind, hintRef, hintLockedAngle
        if (hit) {
          snapped = hit.pos
          hintKind = hit.kind
          hintRef = hit.wall
        } else {
          const par = parallelWallLock(raw, anchor, wallsExclSelf, scale, {
            angleToleranceRad: (3 * Math.PI) / 180,
          })
          if (par) {
            snapped = par.pos
            hintKind = 'parallelWall'
            hintRef = par.refWall
            hintLockedAngle = par.lockedAngle
          } else {
            snapped = raw
            hintKind = null
          }
        }
        handle.position.set(snapped.x, snapped.y)
        useWallStore.getState().updateWall(fid, wall.id, {
          [end + 'X']: snapped.x,
          [end + 'Y']: snapped.y,
        })
        // draftStore.snapHint drives draftOverlayLayer's visual halo —
        // cyan ring for wallEndpoint, orange square for wallSegment,
        // purple guide line for parallelWall.
        const draftSt = useDraftStore.getState()
        const cur = draftSt.snapHint
        if (hintKind) {
          const same = cur && cur.kind === hintKind &&
            cur.pos && cur.pos.x === snapped.x && cur.pos.y === snapped.y
          if (!same) {
            const next = { kind: hintKind, pos: { x: snapped.x, y: snapped.y } }
            if (hintKind === 'parallelWall') {
              next.ref = hintRef
              next.lockedAngle = hintLockedAngle
            } else if (hintKind === 'wallSegment') {
              next.ref = hintRef
            }
            draftSt.setSnapHint(next)
          }
        } else if (cur && (cur.kind === 'wallEndpoint' || cur.kind === 'wallSegment' || cur.kind === 'parallelWall')) {
          draftSt.setSnapHint(null)
        }
      }
      const onUp = () => {
        stage.off('pointermove', onMove)
        stage.off('pointerup', onUp)
        stage.off('pointerupoutside', onUp)
        isDragging = false
        useDragOverlayStore.getState().setWallEndpoint(null)
        const draftSt = useDraftStore.getState()
        if (draftSt.snapHint && (draftSt.snapHint.kind === 'wallEndpoint' || draftSt.snapHint.kind === 'wallSegment' || draftSt.snapHint.kind === 'parallelWall')) {
          draftSt.setSnapHint(null)
        }
        rebuild()
        applyInverseScale()
      }
      stage.on('pointermove', onMove)
      stage.on('pointerup', onUp)
      stage.on('pointerupoutside', onUp)
    })

    // Double-click → extend a new wall from this endpoint. PIXI doesn't
    // emit `dblclick`; we detect it via two `click` events within 350 ms.
    let lastClickAt = 0
    handle.on('click', (e) => {
      if ((e.button ?? 0) !== 0) return
      if (dragMoved) return
      const now = performance.now()
      const isDbl = now - lastClickAt < 350
      lastClickAt = now
      if (!isDbl) return
      e.stopPropagation()
      const endpoint = end === 'start'
        ? { x: wall.startX, y: wall.startY }
        : { x: wall.endX,   y: wall.endY   }
      const editor = useEditorStore.getState()
      editor.clearSelected?.()
      editor.setEditorMode(EDITOR_MODE.DRAW_WALL)
      useDraftStore.getState().beginDraft(EDITOR_MODE.DRAW_WALL, endpoint)
    })
  }

  const bindTrayVertexDrag = (handle, tray, vertexIdx) => {
    handle.on('pointerdown', (e) => {
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      isDragging = true
      const stage = scene.app.stage
      const startWorld = scene.world.toLocal(e.global)
      const original = { x: tray.points[vertexIdx].x, y: tray.points[vertexIdx].y }
      const fid = useFloorStore.getState().activeFloorId
      const trayId = tray.id

      // Tracked snap target across onMove / onUp. Either:
      //   { kind: 'vertex', trayId, vertexIdx, x, y } — snapped to another
      //     tray's vertex (24 screen-px, oldSrc snapVertexDrag).
      //   { kind: 'segment', trayId, segIdx, foot } — snapped onto another
      //     tray's segment (14 screen-px). Triggers auto-split on dragend.
      //   null — free.
      let snapResult = null

      const onMove = (ev) => {
        if (handle.destroyed || !handle.position) return
        const wp = scene.world.toLocal(ev.global)
        const rawX = original.x + (wp.x - startWorld.x)
        const rawY = original.y + (wp.y - startWorld.y)
        const scale = useViewportStore.getState().scale || 1
        const vertexDist = 24 / scale
        const segmentDist = 14 / scale
        const trays = useCableStore.getState().traysByFloor[fid] ?? []

        // Pass 1: vertex snap (highest priority).
        let vertexHit = null
        let bestVD = vertexDist
        for (const t of trays) {
          for (let i = 0; i < t.points.length; i++) {
            if (t.id === trayId && i === vertexIdx) continue
            const v = t.points[i]
            const d = Math.hypot(rawX - v.x, rawY - v.y)
            if (d < bestVD) {
              bestVD = d
              vertexHit = { trayId: t.id, vertexIdx: i, x: v.x, y: v.y }
            }
          }
        }
        // Pass 2: segment snap (only on a different tray, no vertex hit).
        let segmentHit = null
        if (!vertexHit) {
          let bestSD = segmentDist
          for (const t of trays) {
            if (t.id === trayId) continue
            for (let i = 0; i < t.points.length - 1; i++) {
              const a = t.points[i], b = t.points[i + 1]
              const dx = b.x - a.x, dy = b.y - a.y
              const lenSq = dx * dx + dy * dy
              if (lenSq < 1e-6) continue
              const tt = ((rawX - a.x) * dx + (rawY - a.y) * dy) / lenSq
              if (tt < 0 || tt > 1) continue
              const fx = a.x + tt * dx, fy = a.y + tt * dy
              const d = Math.hypot(rawX - fx, rawY - fy)
              if (d < bestSD) {
                bestSD = d
                segmentHit = { trayId: t.id, segIdx: i, foot: { x: fx, y: fy } }
              }
            }
          }
        }

        let nx = rawX, ny = rawY
        if (vertexHit) {
          nx = vertexHit.x
          ny = vertexHit.y
          snapResult = { kind: 'vertex', ...vertexHit }
        } else if (segmentHit) {
          nx = segmentHit.foot.x
          ny = segmentHit.foot.y
          snapResult = { kind: 'segment', ...segmentHit }
        } else {
          snapResult = null
        }

        handle.position.set(nx, ny)
        useDragOverlayStore.getState().setTrayVertex({
          trayId, vertexIdx, x: nx, y: ny,
        })

        // draftStore.snapHint drives draftOverlayLayer's visual halo —
        // green ring for vertex, orange square for segment.
        const draftSt = useDraftStore.getState()
        const wantKind = vertexHit ? 'trayVertex' : segmentHit ? 'traySegment' : null
        const wantPos = vertexHit
          ? { x: vertexHit.x, y: vertexHit.y }
          : segmentHit
            ? { x: segmentHit.foot.x, y: segmentHit.foot.y }
            : null
        const cur = draftSt.snapHint
        const sameHint = cur && wantKind && cur.kind === wantKind &&
          cur.pos && cur.pos.x === wantPos.x && cur.pos.y === wantPos.y
        if (wantKind && !sameHint) {
          draftSt.setSnapHint({ kind: wantKind, pos: wantPos })
        } else if (!wantKind && (cur?.kind === 'trayVertex' || cur?.kind === 'traySegment')) {
          draftSt.setSnapHint(null)
        }
      }
      const onUp = () => {
        stage.off('pointermove', onMove)
        stage.off('pointerup', onUp)
        stage.off('pointerupoutside', onUp)

        const overlay = useDragOverlayStore.getState().trayVertex
        const cable = useCableStore.getState()
        const sourceFresh = cable.traysByFloor[fid]?.find((t) => t.id === trayId)

        // Build the source tray's post-commit points (vertex moved to the
        // final snapped / raw xy). Use this array — NOT a re-read of the
        // store after updateTray — for downstream merge / split logic;
        // useCableStore.getState() taken above is a frozen snapshot, so a
        // subsequent updateTray() doesn't refresh `cable.traysByFloor`.
        // Reading the stale snapshot was the root cause of the merged
        // tray drawing a zig-zag back through the source's old position.
        const nextSourcePoints = (sourceFresh && overlay && overlay.trayId === trayId && overlay.vertexIdx === vertexIdx)
          ? sourceFresh.points.map((p, i) =>
              i === vertexIdx ? { x: overlay.x, y: overlay.y } : p,
            )
          : sourceFresh?.points

        // Vertex-to-vertex snap on ENDPOINT-to-ENDPOINT pair (different
        // trays) → merge into one continuous tray (user request "snap吸
        // 過去後放開, 要自動幫她合併線段"). Source tray keeps its id; the
        // target tray is removed. The plain commit is INCLUDED in the
        // merged points so we only call updateTray once for the source.
        let didMerge = false
        if (snapResult && snapResult.kind === 'vertex' && sourceFresh && nextSourcePoints) {
          const targetFresh = cable.traysByFloor[fid]?.find((t) => t.id === snapResult.trayId)
          if (targetFresh && trayId !== snapResult.trayId) {
            const srcLen = nextSourcePoints.length
            const tgtLen = targetFresh.points.length
            const srcIsEnd = vertexIdx === 0 || vertexIdx === srcLen - 1
            const tgtIsEnd = snapResult.vertexIdx === 0 || snapResult.vertexIdx === tgtLen - 1
            if (srcIsEnd && tgtIsEnd) {
              const srcOriented = vertexIdx === srcLen - 1
                ? nextSourcePoints
                : [...nextSourcePoints].reverse()
              const tgtOriented = snapResult.vertexIdx === 0
                ? targetFresh.points
                : [...targetFresh.points].reverse()
              // Skip duplicate merge xy on the target side.
              const merged = [...srcOriented, ...tgtOriented.slice(1)]
              cable.updateTray(fid, trayId, { points: merged })
              cable.removeTray(fid, snapResult.trayId)
              didMerge = true
            }
          }
        }

        // Plain commit when we DIDN'T merge — covers no-snap, interior-
        // vertex collisions, and the segment-snap path below.
        if (!didMerge && sourceFresh && nextSourcePoints) {
          cable.updateTray(fid, trayId, { points: nextSourcePoints })
        }

        // Segment snap → split the target tray at the foot. The source
        // tray's vertex (already at foot xy after the commit above) plus
        // the two halves of the split target share the exact xy, so the
        // graph builder coincidence-merges them and the network stays
        // connected.
        if (snapResult && snapResult.kind === 'segment' && snapResult.trayId !== trayId) {
          const target = cable.traysByFloor[fid]?.find((t) => t.id === snapResult.trayId)
          if (target) {
            const floors = useFloorStore.getState().floors
            const floor = floors.find((f) => f.id === fid)
            const ptsA = [...target.points.slice(0, snapResult.segIdx + 1), { ...snapResult.foot }]
            const ptsB = [{ ...snapResult.foot }, ...target.points.slice(snapResult.segIdx + 1)]
            cable.removeTray(fid, target.id)
            cable.addTray(fid, { ...target, id: generateId('tray'), name: cable.nextTrayName({ floor }), points: ptsA })
            cable.addTray(fid, { ...target, id: generateId('tray'), name: cable.nextTrayName({ floor }), points: ptsB })
          }
        }

        useDragOverlayStore.getState().setTrayVertex(null)
        const draftSt = useDraftStore.getState()
        if (draftSt.snapHint && (draftSt.snapHint.kind === 'trayVertex' || draftSt.snapHint.kind === 'traySegment')) {
          draftSt.setSnapHint(null)
        }
        isDragging = false
        // Rebuild now so the handle dots re-render at the committed
        // canonical positions (and any pending hover-driven swap to
        // wall handles takes effect if applicable).
        rebuild()
        applyInverseScale()
      }
      stage.on('pointermove', onMove)
      stage.on('pointerup', onUp)
      stage.on('pointerupoutside', onUp)
    })
  }

  // Screen-space handle sizing — only the explicitly-tracked handles get
  // inverse-scaled. Crop-adjust rotation Containers are excluded so their
  // children (in image coords) aren't doubly scaled. Tray vertex handles
  // additionally apply a hover-multiplier (8/6 ≈ 1.33) so the dot grows
  // under the cursor (oldSrc VertexHandle).
  const applyInverseScale = () => {
    const inv = 1 / (useViewportStore.getState().scale || 1)
    for (const node of inverseScaleNodes) {
      if (node.destroyed) continue
      const mul = (node._hovered && node._hoverScaleMul) ? node._hoverScaleMul : 1
      node.scale.set(inv * mul)
    }
  }

  const unsubEditor = useEditorStore.subscribe(() => { rebuild(); applyInverseScale() })
  const unsubFloor = useFloorStore.subscribe(() => { rebuild(); applyInverseScale() })
  const unsubWall = useWallStore.subscribe(() => { rebuild(); applyInverseScale() })
  const unsubCable = useCableStore.subscribe(() => { rebuild(); applyInverseScale() })
  const unsubHover = useHoverStore.subscribe(() => { rebuild(); applyInverseScale() })
  const unsubViewport = useViewportStore.subscribe(() => {
    applyInverseScale()
    // Crop border / thirds stroke widths are baked into Graphics — redraw
    // so they stay at constant screen px on pan / zoom.
    if (cropRedrawOnViewport) cropRedrawOnViewport()
  })
  rebuild()
  applyInverseScale()

  return () => {
    unsubEditor()
    unsubFloor()
    unsubWall()
    unsubCable()
    unsubHover()
    unsubViewport()
    layer.removeChild(root)
    root.destroy({ children: true })
  }
}

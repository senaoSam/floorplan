import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { EDITOR_MODE } from '@/store/useEditorStore'
import { useViewportStore } from '@/store/useViewportStore'
import { getTraySystem, DEFAULT_TRAY } from '@/store/useCableStore'
import { useWallStore } from '@/store/useWallStore'
import { OPENING_TYPES } from '@/constants/materials'

const SCALE_COLOR = '#f1c40f'
// Reused TextStyle for "{px} px" label — matches oldSrc ScaleLayer (fontSize
// 11 yellow, on a black 68×18 rounded box drawn separately).
const SCALE_LABEL_STYLE = new TextStyle({
  fill: SCALE_COLOR,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  align: 'center',
})

// Draws the in-progress draft for DRAW_WALL / DRAW_SCOPE / DRAW_FLOOR_HOLE
// / DRAW_CABLE_TRAY / DRAW_SCALE on scene.layers.overlays. Per-mode visuals
// ported 1:1 from oldSrc:
//
//   DRAW_WALL        → cyan  #00e5ff stroked line + dashed ghost + black
//                      halo + cyan endpoint markers (oldSrc WallLayer
//                      drawStart / snapEndpoint blocks)
//   DRAW_SCOPE       → green #2ed573 (oldSrc ScopeLayer DrawingPreview)
//   DRAW_FLOOR_HOLE  → purple #a855f7 (oldSrc FloorHoleLayer DrawingPreview)
//   DRAW_CABLE_TRAY  → tray system colour + magnet halo + vertex-snap halo
//                      (oldSrc DraftTray + snapHit)
//   DRAW_SCALE       → yellow #f1c40f
//
// Every stroke has a black halo underneath so the draft stays readable
// on both light floor plans and dark backgrounds.

const COLOR_BY_MODE = {
  [EDITOR_MODE.DRAW_WALL]:        '#00e5ff',
  [EDITOR_MODE.DRAW_SCOPE]:       '#2ed573',
  [EDITOR_MODE.DRAW_FLOOR_HOLE]:  '#a855f7',
  [EDITOR_MODE.DRAW_CABLE_TRAY]:  '#818cf8',  // overridden per system below
  [EDITOR_MODE.DRAW_SCALE]:       '#f1c40f',
}
const DEFAULT_COLOR = '#fbbf24'
const HALO_COLOR    = '#000000'
const HALO_ALPHA    = 0.5

const MAGNET_FILL   = 'rgba(129, 140, 248, 0.12)'
const SNAP_GREEN    = '#22c55e'

function drawSegment(g, ax, ay, bx, by, color, width, alpha = 1) {
  g.moveTo(ax, ay).lineTo(bx, by)
    .stroke({ width: width + 2, color: HALO_COLOR, alpha: HALO_ALPHA * alpha })
  g.moveTo(ax, ay).lineTo(bx, by)
    .stroke({ width, color, alpha })
}

function drawDashedSegment(g, ax, ay, bx, by, color, width, dashOn, dashOff, alpha = 1) {
  const len = Math.hypot(bx - ax, by - ay)
  if (len <= 1e-9) return
  const ux = (bx - ax) / len
  const uy = (by - ay) / len
  let cursor = 0
  let phaseOn = true
  let remain = dashOn
  while (cursor < len) {
    const step = Math.min(len - cursor, remain)
    const x1 = ax + ux * cursor
    const y1 = ay + uy * cursor
    const x2 = ax + ux * (cursor + step)
    const y2 = ay + uy * (cursor + step)
    if (phaseOn) {
      g.moveTo(x1, y1).lineTo(x2, y2)
        .stroke({ width: width + 1.5, color: HALO_COLOR, alpha: HALO_ALPHA * alpha })
      g.moveTo(x1, y1).lineTo(x2, y2)
        .stroke({ width, color, alpha })
    }
    cursor += step
    remain -= step
    if (remain <= 1e-9) {
      phaseOn = !phaseOn
      remain = phaseOn ? dashOn : dashOff
    }
  }
}

export function attachDraftOverlay({ scene, useDraftStore, useCableStore, useFloorStore }) {
  const layer = scene.layers.overlays
  const g = new Graphics()
  g.eventMode = 'none'
  layer.addChild(g)
  // Separate Container for Pixi Text labels (px-distance readout while
  // drawing / scale-preview). Cleared and rebuilt each redraw alongside g.
  const labelRoot = new Container()
  labelRoot.eventMode = 'none'
  layer.addChild(labelRoot)

  const clearLabels = () => {
    while (labelRoot.children.length > 0) {
      const c = labelRoot.children[0]
      labelRoot.removeChild(c)
      c.destroy({ children: true })
    }
  }

  // Find an existing tray vertex (across the active floor) that matches
  // the cursor xy exactly — drives the green snap halo while drawing.
  const findVertexAt = (xy) => {
    if (!useCableStore || !useFloorStore) return null
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return null
    const trays = useCableStore.getState().traysByFloor?.[fid] ?? []
    for (const t of trays) {
      for (const v of (t.points ?? [])) {
        if (v.x === xy.x && v.y === xy.y) return v
      }
    }
    return null
  }

  const redraw = () => {
    g.clear()
    clearLabels()
    const { mode, points, cursor, snapHint, doorWindowDraft, scalePreview } = useDraftStore.getState()

    // Scale preview while ScaleDialog is open — renders the locked pt1→pt2
    // line (solid, no dashes) + both endpoint dots + the px label. Mirrors
    // oldSrc ScaleLayer with pt1 + pt2 both set. Rendered on top of (i.e.
    // after) regular draft so a stale draft doesn't paint over it; in
    // practice draft is cleared right before scalePreview is set.
    if (scalePreview) {
      drawScalePreview(g, scalePreview.p0, scalePreview.p1)
    }

    // DRAW_DOOR / DRAW_WINDOW preview — after the first click on a wall,
    // paint a coloured band between startFrac and the live cursorFrac so
    // the user sees both endpoints + drag direction before the second
    // click commits. Coloured to match the eventual opening (door brown
    // / window blue, OPENING_TYPES.color).
    if (doorWindowDraft) {
      drawDoorWindowDraft(g, doorWindowDraft)
    }

    // Wall endpoint snap halo — render whenever the snapHint says we're
    // snapping to an existing wall endpoint, even before the user has
    // placed the first draft point (oldSrc WallLayer 280-285 fires from
    // mousePos regardless of drawStart).
    if (snapHint && snapHint.kind === 'wallEndpoint' && snapHint.pos) {
      drawWallEndpointSnapHalo(g, snapHint.pos.x, snapHint.pos.y)
    }
    // Wall segment snap halo — orange SQUARE ring at the perpendicular
    // foot when wall draw / wall endpoint drag is locked onto another
    // wall's segment. Same shape as the tray-onto-wall snap.
    if (snapHint && snapHint.kind === 'wallSegment' && snapHint.pos) {
      drawSegmentSnapHalo(g, snapHint.pos.x, snapHint.pos.y)
    }
    // Tray vertex snap halo — green ring at the target vertex while a
    // tray-vertex drag is locked onto another tray's endpoint (oldSrc
    // CableTrayLayer dragSnapTarget). Rendered regardless of editor /
    // draft mode so the SELECT-mode vertex drag drives it.
    if (snapHint && snapHint.kind === 'trayVertex' && snapHint.pos) {
      drawTrayVertexSnapHalo(g, snapHint.pos.x, snapHint.pos.y)
    }
    // Tray segment snap halo — orange SQUARE (same shape / colour as
    // wall-segment, drawSegmentSnapHalo). Triggers auto-split of the
    // target tray on pointerup, wired in handlesLayer.
    if (snapHint && snapHint.kind === 'traySegment' && snapHint.pos) {
      drawSegmentSnapHalo(g, snapHint.pos.x, snapHint.pos.y)
    }

    if (!mode || points.length === 0) return

    if (mode === EDITOR_MODE.DRAW_CABLE_TRAY) {
      drawTrayDraft(g, points, cursor, findVertexAt)
      return
    }
    if (mode === EDITOR_MODE.DRAW_WALL) {
      drawWallDraft(g, points, cursor)
      return
    }
    if (mode === EDITOR_MODE.CROP_IMAGE) {
      drawCropDraft(g, points, cursor)
      return
    }
    if (mode === EDITOR_MODE.DRAW_SCALE) {
      drawScaleDraft(g, points, cursor)
      return
    }
    drawPolyDraft(g, mode, points, cursor)
  }

  // DRAW_SCALE draft — between 1st click and 2nd click. Mirrors oldSrc
  // ScaleLayer with pt1 set + endPt = mousePos: dashed [6,4] yellow line
  // from pt1 to cursor, endpoint dot ONLY at pt1 (oldSrc's `pt2` block is
  // gated on pt2 being committed, so during the ghost the cursor end is
  // bare). Label tracks the cursor and updates live.
  function drawScaleDraft(g, points, cursor) {
    const p0 = points[0]
    if (!p0) return
    const endPt = cursor ?? null
    drawScaleLine(g, p0, endPt, /* dashed */ true)
    drawScaleEndpoint(g, p0)
    if (endPt) drawScaleLabel(p0, endPt)
  }

  // DRAW_SCALE preview — after 2nd click + while ScaleDialog is open.
  // Mirrors oldSrc ScaleLayer with pt2 set (solid line, both endpoints,
  // px label).
  function drawScalePreview(g, p0, p1) {
    if (!p0 || !p1) return
    drawScaleLine(g, p0, p1, /* dashed */ false)
    drawScaleEndpoint(g, p0)
    drawScaleEndpoint(g, p1)
    drawScaleLabel(p0, p1)
  }

  // oldSrc ScaleLayer line: black outline width 4 alpha 0.45, yellow inner
  // width 2. Dash [6,4] when ghost, solid when committed.
  function drawScaleLine(g, a, b, dashed) {
    if (!a || !b) return
    if (dashed) {
      drawDashedScaleSegment(g, a.x, a.y, b.x, b.y)
    } else {
      g.moveTo(a.x, a.y).lineTo(b.x, b.y)
        .stroke({ width: 4, color: HALO_COLOR, alpha: 0.45 })
      g.moveTo(a.x, a.y).lineTo(b.x, b.y)
        .stroke({ width: 2, color: SCALE_COLOR, alpha: 1 })
    }
  }

  // Same line shape as solid path but rebuilt segment-by-segment so the
  // dash mask applies to BOTH the black halo + the yellow inner stroke
  // together. oldSrc Konva Line dash parameter wraps both effective layers
  // because both share the same Line node.
  function drawDashedScaleSegment(g, ax, ay, bx, by) {
    const len = Math.hypot(bx - ax, by - ay)
    if (len <= 1e-9) return
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    const dashOn = 6, dashOff = 4
    let cursor = 0
    let phaseOn = true
    let remain = dashOn
    while (cursor < len) {
      const step = Math.min(len - cursor, remain)
      const x1 = ax + ux * cursor
      const y1 = ay + uy * cursor
      const x2 = ax + ux * (cursor + step)
      const y2 = ay + uy * (cursor + step)
      if (phaseOn) {
        g.moveTo(x1, y1).lineTo(x2, y2)
          .stroke({ width: 4, color: HALO_COLOR, alpha: 0.45 })
        g.moveTo(x1, y1).lineTo(x2, y2)
          .stroke({ width: 2, color: SCALE_COLOR, alpha: 1 })
      }
      cursor += step
      remain -= step
      if (remain <= 1e-9) {
        phaseOn = !phaseOn
        remain = phaseOn ? dashOn : dashOff
      }
    }
  }

  // oldSrc ScaleLayer endpoint: black halo r=7 alpha 0.3 + yellow inner r=5.
  function drawScaleEndpoint(g, p) {
    if (!p) return
    g.circle(p.x, p.y, 7).fill({ color: HALO_COLOR, alpha: 0.3 })
    g.circle(p.x, p.y, 5).fill({ color: SCALE_COLOR, alpha: 1 })
  }

  // oldSrc ScaleLayer label: black rounded rect 68×18 alpha 0.55 + yellow
  // 11px "{round(pixelDist)} px" text, anchored 18 px above the line midpoint.
  function drawScaleLabel(a, b) {
    const pixelDist = Math.round(Math.hypot(b.x - a.x, b.y - a.y))
    if (pixelDist <= 0) return
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2 - 18
    g.roundRect(midX - 34, midY - 9, 68, 18, 4)
      .fill({ color: HALO_COLOR, alpha: 0.55 })
    const t = new Text({ text: `${pixelDist} px`, style: SCALE_LABEL_STYLE })
    t.anchor.set(0.5, 0.5)
    t.position.set(midX, midY)
    labelRoot.addChild(t)
  }

  // DRAW_DOOR / DRAW_WINDOW: paint a coloured band between startFrac and
  // cursorFrac along the host wall + a marker at the first click. Reads
  // the wall geometry on each redraw (cheap) so cursorFrac → world coords
  // tracks any wall edit happening underneath.
  function drawDoorWindowDraft(g, draft) {
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return
    const wall = (useWallStore.getState().wallsByFloor[fid] ?? []).find((w) => w.id === draft.wallId)
    if (!wall) return
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale
    const dxw = wall.endX - wall.startX
    const dyw = wall.endY - wall.startY
    const sx = wall.startX + dxw * draft.startFrac
    const sy = wall.startY + dyw * draft.startFrac
    const cx = wall.startX + dxw * draft.cursorFrac
    const cy = wall.startY + dyw * draft.cursorFrac
    const ot = draft.kind === 'window' ? OPENING_TYPES.WINDOW : OPENING_TYPES.DOOR
    const color = ot.color
    // Dashed coloured band (matches the eventual opening colour) between
    // the two endpoints. Width 5 world-px so it visually reads as the
    // opening preview without overpowering the wall body underneath.
    drawDashedSegment(g, sx, sy, cx, cy, color, 5, 10 * s, 5 * s, 0.85)
    // First-click marker — solid coloured disc + black halo so the user
    // can clearly see "this is the start of the opening".
    g.circle(sx, sy, 7 * s).fill({ color: HALO_COLOR, alpha: HALO_ALPHA })
    g.circle(sx, sy, 5 * s).fill({ color, alpha: 1 })
    // Cursor-end marker — open ring so it reads as "this end is still
    // moving" / not yet committed.
    g.circle(cx, cy, 6 * s).stroke({ width: 2 * s, color, alpha: 1 })
  }

  // Cyan ring + black halo at an existing wall endpoint the cursor is
  // snapping to. Used for BOTH draw-mode snap and wall-endpoint-drag snap.
  // Radii bumped +2 vs the original oldSrc port per user request (9 → 11,
  // 7 → 9).
  function drawWallEndpointSnapHalo(g, x, y) {
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale
    g.circle(x, y, 13 * s).fill({ color: 0x000000, alpha: 0.4 })
    g.circle(x, y, 11 * s)
      .fill({ color: 0x00e5ff, alpha: 0.25 })
      .stroke({ width: 2 * s, color: 0x00e5ff, alpha: 1 })
  }

  // Green snap halo at a tray vertex (oldSrc CableTrayLayer 774-778:
  // ring r=10, dot r=4, colour #22c55e). Same style as the tray-draw
  // vertex snap so the drag visual matches the draw visual.
  function drawTrayVertexSnapHalo(g, x, y) {
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale
    g.circle(x, y, 10 * s).stroke({ width: 2 * s, color: SNAP_GREEN, alpha: 1 })
    g.circle(x, y, 4 * s).fill({ color: SNAP_GREEN, alpha: 1 })
  }

  // Orange square ring at the perpendicular foot when wall draw / wall
  // endpoint drag / tray vertex drag is locked onto another wall's or
  // tray's segment. Same shape as the wall-segment snap during tray
  // draw (drawTrayDraft 246-252). Shared across all four code paths.
  function drawSegmentSnapHalo(g, x, y) {
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale
    const SNAP_ORANGE = '#f59e0b'
    const r = 13 * s
    g.poly([
      x - r, y - r,
      x + r, y - r,
      x + r, y + r,
      x - r, y + r,
    ]).stroke({ width: 2.5 * s, color: SNAP_ORANGE, alpha: 1 })
  }

  // CROP_IMAGE draft preview (oldSrc CropLayer): dashed cyan rect from
  // click1 to cursor + dark mask outside the rect (so the user can see
  // what part of the image they'll keep). The actual crop is committed
  // to floor.cropX/Y/Width/Height on the 2nd click — draftModeController
  // owns that. We only handle the visual preview here.
  function drawCropDraft(g, points, cursor) {
    if (!cursor || points.length === 0) return
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale
    const p0 = points[0]
    const x = Math.min(p0.x, cursor.x)
    const y = Math.min(p0.y, cursor.y)
    const w = Math.abs(cursor.x - p0.x)
    const h = Math.abs(cursor.y - p0.y)
    if (w < 1 || h < 1) return
    // Dashed cyan border (oldSrc BORDER_COLOR #00e5ff, dash [8, 4] * 1/scale).
    drawDashedSegment(g, x,     y,     x + w, y,     '#00e5ff', 2 * s, 8 * s, 4 * s, 1)
    drawDashedSegment(g, x + w, y,     x + w, y + h, '#00e5ff', 2 * s, 8 * s, 4 * s, 1)
    drawDashedSegment(g, x + w, y + h, x,     y + h, '#00e5ff', 2 * s, 8 * s, 4 * s, 1)
    drawDashedSegment(g, x,     y + h, x,     y,     '#00e5ff', 2 * s, 8 * s, 4 * s, 1)
    // Rule-of-thirds guides — faint vertical / horizontal lines.
    for (const frac of [1 / 3, 2 / 3]) {
      g.moveTo(x + w * frac, y).lineTo(x + w * frac, y + h)
        .stroke({ width: 0.5 * s, color: '#00e5ff', alpha: 0.4 })
      g.moveTo(x, y + h * frac).lineTo(x + w, y + h * frac)
        .stroke({ width: 0.5 * s, color: '#00e5ff', alpha: 0.4 })
    }
  }

  // Wall: dashed cyan ghost + cyan endpoint marker at the draft start
  // (oldSrc WallLayer.jsx 250-285). Plus parallel-wall lock visualisation
  // when snapHint says we're locked to an existing wall's angle / perp —
  // same purple guide tray uses (drawTrayDraft 253-264).
  function drawWallDraft(g, points, cursor) {
    const color = COLOR_BY_MODE[EDITOR_MODE.DRAW_WALL]
    const start = points[0]
    // Parallel-wall lock indicator (drawn UNDER the start dot so it
    // doesn't obscure the marker).
    const hint = useDraftStore.getState().snapHint
    if (hint && hint.kind === 'parallelWall' && hint.ref && cursor) {
      const vpScale = useViewportStore.getState().scale || 1
      const s = 1 / vpScale
      const PARALLEL_PURPLE = '#a78bfa'
      const w = hint.ref
      g.moveTo(w.startX, w.startY).lineTo(w.endX, w.endY)
        .stroke({ width: 3 * s, color: PARALLEL_PURPLE, alpha: 0.55, cap: 'round' })
      drawDashedSegment(g, start.x, start.y, hint.pos.x, hint.pos.y,
        PARALLEL_PURPLE, 1.2 * s, 4 * s, 4 * s, 0.8)
      g.circle(hint.pos.x, hint.pos.y, 4 * s)
        .fill({ color: PARALLEL_PURPLE, alpha: 1 })
    }
    // Start dot.
    g.circle(start.x, start.y, 9).fill({ color: HALO_COLOR, alpha: HALO_ALPHA })
    g.circle(start.x, start.y, 6).fill({ color, alpha: 1 })
    if (cursor) {
      // Dashed ghost line: width 3 cyan + width 6 black halo dash.
      drawDashedSegment(g, start.x, start.y, cursor.x, cursor.y, color, 3, 8, 5, 1)
    }
  }

  // Polygon / polyline draft (scope / floor hole). DRAW_SCALE has its own
  // dedicated path (drawScaleDraft) — keep this routine polygon-only.
  function drawPolyDraft(g, mode, points, cursor) {
    const color = COLOR_BY_MODE[mode] ?? DEFAULT_COLOR
    const isPolygon = mode === EDITOR_MODE.DRAW_SCOPE || mode === EDITOR_MODE.DRAW_FLOOR_HOLE
    const dashed = isPolygon
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      if (dashed) drawDashedSegment(g, a.x, a.y, b.x, b.y, color, 3, 6, 4, 1)
      else drawSegment(g, a.x, a.y, b.x, b.y, color, 3)
    }
    if (cursor && points.length > 0) {
      const last = points[points.length - 1]
      if (dashed) drawDashedSegment(g, last.x, last.y, cursor.x, cursor.y, color, 3, 6, 4, 0.7)
      else drawSegment(g, last.x, last.y, cursor.x, cursor.y, color, 3, 0.7)
      if (isPolygon && points.length >= 2) {
        drawDashedSegment(g, cursor.x, cursor.y, points[0].x, points[0].y, color, 2, 6, 4, 0.4)
      }
    }
    for (const p of points) {
      g.circle(p.x, p.y, 7).fill({ color: HALO_COLOR, alpha: HALO_ALPHA })
      g.circle(p.x, p.y, 5).fill({ color, alpha: 1 })
    }
    if (isPolygon && points.length >= 3) {
      g.circle(points[0].x, points[0].y, 9)
        .stroke({ width: 2, color, alpha: 1 })
    }
  }

  // Cable tray draft (oldSrc DraftTray).
  function drawTrayDraft(g, points, cursor, findVertexAt) {
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale
    const sys = getTraySystem(DEFAULT_TRAY.system)
    const draftStroke = sys.color
    const magnetPx = DEFAULT_TRAY.magnetDistance ?? 100
    // Magnet halo along committed segments.
    if (points.length >= 2) {
      g.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
      g.stroke({
        width: magnetPx * 2, color: MAGNET_FILL, alpha: 1,
        cap: 'round', join: 'round',
      })
    }
    // Magnet halo along ghost segment.
    if (cursor && points.length >= 1) {
      const last = points[points.length - 1]
      g.moveTo(last.x, last.y).lineTo(cursor.x, cursor.y)
        .stroke({ width: magnetPx * 2, color: MAGNET_FILL, alpha: 0.5, cap: 'round' })
    }
    // Committed segments — solid.
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      g.moveTo(a.x, a.y).lineTo(b.x, b.y)
        .stroke({ width: 2.4 * s, color: draftStroke, alpha: 1, cap: 'round', join: 'round' })
    }
    // Ghost segment — dashed.
    if (cursor && points.length >= 1) {
      const last = points[points.length - 1]
      drawDashedSegment(g, last.x, last.y, cursor.x, cursor.y, draftStroke, 2 * s, 10 * s, 6 * s, 0.65)
    }
    // Vertex dots — white fill + colored stroke (matches oldSrc DraftTray).
    for (const p of points) {
      g.circle(p.x, p.y, 4 * s)
        .fill({ color: '#ffffff', alpha: 1 })
        .stroke({ width: 1.5 * s, color: draftStroke, alpha: 1 })
    }
    // Vertex snap halo — green ring + dot when cursor sits on an existing
    // tray vertex.
    if (cursor) {
      const target = findVertexAt(cursor)
      if (target) {
        g.circle(target.x, target.y, 10 * s)
          .stroke({ width: 2 * s, color: SNAP_GREEN, alpha: 1 })
        g.circle(target.x, target.y, 4 * s)
          .fill({ color: SNAP_GREEN, alpha: 1 })
      }
    }
    // 20-3 wall / parallel snap visuals (oldSrc CableTrayLayer 798-838).
    const hint = useDraftStore.getState().snapHint
    if (hint && hint.pos) {
      const SNAP_ORANGE = '#f59e0b'
      const PARALLEL_PURPLE = '#a78bfa'
      if (hint.kind === 'wallEndpoint') {
        // Solid orange circle ring at endpoint.
        g.circle(hint.pos.x, hint.pos.y, 13 * s)
          .stroke({ width: 2.5 * s, color: SNAP_ORANGE, alpha: 1 })
      } else if (hint.kind === 'wallSegment') {
        // Orange square ring around segment foot.
        const r = 13 * s
        g.poly([
          hint.pos.x - r, hint.pos.y - r,
          hint.pos.x + r, hint.pos.y - r,
          hint.pos.x + r, hint.pos.y + r,
          hint.pos.x - r, hint.pos.y + r,
        ]).stroke({ width: 2.5 * s, color: SNAP_ORANGE, alpha: 1 })
      } else if (hint.kind === 'parallelWall' && hint.ref && points.length > 0) {
        // Tint the reference wall + dashed purple guide from the last draft
        // anchor to the locked cursor pos.
        const w = hint.ref
        g.moveTo(w.startX, w.startY).lineTo(w.endX, w.endY)
          .stroke({ width: 3 * s, color: PARALLEL_PURPLE, alpha: 0.55, cap: 'round' })
        const anchor = points[points.length - 1]
        drawDashedSegment(g, anchor.x, anchor.y, hint.pos.x, hint.pos.y,
          PARALLEL_PURPLE, 1.2 * s, 4 * s, 4 * s, 0.8)
        g.circle(hint.pos.x, hint.pos.y, 4 * s)
          .fill({ color: PARALLEL_PURPLE, alpha: 1 })
      }
    }
  }

  const unsubscribe = useDraftStore.subscribe(redraw)
  const unsubViewport = useViewportStore.subscribe(redraw)
  // Wall store subscription keeps the DRAW_DOOR / DRAW_WINDOW preview band
  // in sync if the host wall is dragged / edited between clicks.
  const unsubWalls = useWallStore.subscribe(redraw)
  redraw()

  return () => {
    unsubscribe()
    unsubViewport()
    unsubWalls()
    layer.removeChild(g)
    g.destroy()
    clearLabels()
    layer.removeChild(labelRoot)
    labelRoot.destroy({ children: true })
  }
}

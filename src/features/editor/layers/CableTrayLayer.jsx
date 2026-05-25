import React, { useState } from 'react'
import { Group, Line, Circle } from 'react-konva'
import { useCableStore, getTraySystem, DEFAULT_TRAY } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { generateId } from '@/utils/id'

// Snap radius (screen px) when dragging an existing vertex onto another
// tray's vertex. Same value as the draft-mode snap so the UX feels uniform.
const VERTEX_SNAP_SCREEN_PX = 24

// Tray colour scheme defaults — overridden per tray by its `system` field
// (19-3). Defaults match the 'data' system entry so legacy trays without a
// system render identically to before.
// Selection cue: border switches to white so the system identity (body fill
// + dashed centreline both keep the system color). Red was previously used
// but clashed with the Power system; white is unambiguous and doesn't
// collide with any system color or cable color in the palette.
const TRAY_SELECTED_BORDER = '#ffffff'
const MAGNET_FILL          = 'rgba(129, 140, 248, 0.12)'
const MAGNET_STROKE        = 'rgba(129, 140, 248, 0.45)'

// Visual width (screen px) of the channel — borders sit at ±halfWidth from
// the centreline. Tuned so the body fill, two borders, and dashed centre
// are all individually legible at typical zoom levels.
const TRAY_WIDTH_SCREEN_PX = 8

// Build a parallel offset polyline. Each vertex is shifted perpendicular by
// `offset` (px in canvas coords); the perpendicular at an interior vertex
// is the angle bisector of the incoming and outgoing edges, scaled so the
// edge-to-offset distance stays exactly `offset` on both sides (miter join).
// `extPrev` / `extNext` let the caller supply a fake "previous" / "next"
// point for the first / last vertex so an endpoint that meets another
// tray at a shared junction still uses a miter join instead of a
// perpendicular cap. Returns a fresh array of points.
function offsetPolyline(points, offset, { extPrev = null, extNext = null } = {}) {
  if (points.length < 2) return points.map((p) => ({ ...p }))
  const perp = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    return { x: -dy / len, y: dx / len }   // "left" of segment direction
  }
  const out = new Array(points.length)
  for (let i = 0; i < points.length; i++) {
    const cur = points[i]
    const prev = i > 0 ? points[i - 1] : extPrev
    const next = i < points.length - 1 ? points[i + 1] : extNext
    let nx, ny
    if (prev && next) {
      const p1 = perp(prev, cur)
      const p2 = perp(cur, next)
      // Miter math: |p1·p2 + 1| → 0 at a 180° fold; clamp to avoid the
      // miter shooting off to infinity at near-reversals.
      const denom = Math.max(1 + p1.x * p2.x + p1.y * p2.y, 0.05)
      nx = (p1.x + p2.x) / denom
      ny = (p1.y + p2.y) / denom
    } else if (next) {
      const p = perp(cur, next); nx = p.x; ny = p.y
    } else {
      const p = perp(prev, cur); nx = p.x; ny = p.y
    }
    out[i] = { x: cur.x + nx * offset, y: cur.y + ny * offset }
  }
  return out
}

// Build a closed-polygon outline for a tray channel: top border, end cap
// (semicircle when the endpoint is open, miter when it meets another
// tray), bottom border, and start cap. Used as the single Konva Line so
// the body fill and the surrounding border line are guaranteed to share
// the exact same outline (no gap between the two).
function buildChannelPolygon(points, halfW, extPrev, extNext) {
  if (points.length < 2) return []
  const up   = offsetPolyline(points,  halfW, { extPrev, extNext })
  const down = offsetPolyline(points, -halfW, { extPrev, extNext })

  // Sample N interior points along the half-circle from `from` to `to`,
  // both at distance halfW from `center`, sweeping through the side where
  // `outward` points. N excludes the two endpoints (caller already has them).
  const ARC_N = 12
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const arcBetween = (center, from, to, outward) => {
    const fromA = Math.atan2(from.y - center.y, from.x - center.x)
    const toA   = Math.atan2(to.y - center.y, to.x - center.x)
    const outA  = Math.atan2(outward.y, outward.x)
    const fromN = norm(fromA)
    let toCCW   = norm(toA);  if (toCCW <= fromN) toCCW += 2 * Math.PI
    let outCCW  = norm(outA); if (outCCW <= fromN) outCCW += 2 * Math.PI
    const ccw   = outCCW > fromN && outCCW < toCCW
    const sweep = ccw ? (toCCW - fromN) : -(2 * Math.PI - (toCCW - fromN))
    const out = []
    for (let k = 1; k < ARC_N; k++) {
      const t = k / ARC_N
      const a = fromN + sweep * t
      out.push({ x: center.x + halfW * Math.cos(a), y: center.y + halfW * Math.sin(a) })
    }
    return out
  }

  const unit = (p, q) => {
    const dx = q.x - p.x, dy = q.y - p.y
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len }
  }

  const poly = []
  // Top border: up[0] → up[last]
  for (const p of up) poly.push(p)
  // End cap — semicircle for open ends, straight close for miter junctions
  if (!extNext) {
    const end = points[points.length - 1]
    const fwd = unit(points[points.length - 2], end)   // outward = forward
    poly.push(...arcBetween(end, up[up.length - 1], down[down.length - 1], fwd))
  }
  // Bottom border reversed: down[last] → down[0]
  for (let i = down.length - 1; i >= 0; i--) poly.push(down[i])
  // Start cap
  if (!extPrev) {
    const start = points[0]
    const fwd = unit(start, points[1])
    poly.push(...arcBetween(start, down[0], up[0], { x: -fwd.x, y: -fwd.y }))
  }
  return poly.flatMap((p) => [p.x, p.y])
}

// For each tray, look up other trays that share an EXACT endpoint xy and
// return a fake "extra" point in the neighbour's direction so offsetPolyline
// can miter the junction cleanly. Only fires for 2-tray junctions; 3+ way
// T-junctions fall back to perpendicular caps (the visual seam there is
// fine — the geometry is already ambiguous).
function computeTrayNeighborExts(trays) {
  const junctions = new Map()   // 'x|y' → [{ trayIdx, side, inwardDir }]
  const unitVec = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len }
  }
  trays.forEach((tray, idx) => {
    const pts = tray.points
    if (!pts || pts.length < 2) return
    const start = pts[0], end = pts[pts.length - 1]
    const startKey = `${start.x}|${start.y}`
    const endKey   = `${end.x}|${end.y}`
    if (!junctions.has(startKey)) junctions.set(startKey, [])
    if (!junctions.has(endKey))   junctions.set(endKey, [])
    junctions.get(startKey).push({ trayIdx: idx, side: 'start', inwardDir: unitVec(start, pts[1]) })
    junctions.get(endKey).push({ trayIdx: idx, side: 'end',   inwardDir: unitVec(end,   pts[pts.length - 2]) })
  })
  return trays.map((tray, idx) => {
    const pts = tray.points
    if (!pts || pts.length < 2) return { startExt: null, endExt: null }
    const lookup = (key, vertex) => {
      const list = junctions.get(key) ?? []
      if (list.length !== 2) return null    // unambiguous 2-tray junction only
      const other = list.find((e) => e.trayIdx !== idx)
      if (!other) return null
      return { x: vertex.x + other.inwardDir.x, y: vertex.y + other.inwardDir.y }
    }
    const startKey = `${pts[0].x}|${pts[0].y}`
    const endKey   = `${pts[pts.length - 1].x}|${pts[pts.length - 1].y}`
    return {
      startExt: lookup(startKey, pts[0]),
      endExt:   lookup(endKey,   pts[pts.length - 1]),
    }
  })
}

// Interactive vertex handle (only visible when the tray is selected).
// Draggable for moving, with a small × badge for deletion. Shift+click
// (on a non-endpoint vertex) splits the tray into two trays sharing the
// vertex's exact xy — the graph builder treats coincident xy as the same
// node so the network stays connected.
function VertexHandle({
  x, y, index, isEndpoint, canDelete, color, inverseScale,
  onDragMove, onDragEnd, onDelete, onSplit, onClickVertex, setHoverCursor,
}) {
  const s = inverseScale
  const [hovered, setHovered] = useState(false)
  // Show the delete badge whenever the vertex is hovered AND deletion is
  // allowed (tray would still have ≥ 2 points after removal). Putting it on
  // hover keeps the canvas calm when nothing is being edited; the badge
  // sits offset to the upper-right of the vertex.
  const badgeOffset = 11 * s

  return (
    <Group>
      <Circle
        x={x}
        y={y}
        radius={(hovered ? 8 : 6) * s}
        fill="#fff"
        stroke={color}
        strokeWidth={(hovered ? 2.4 : 2) * s}
        draggable
        onMouseEnter={() => { setHovered(true); setHoverCursor?.('move') }}
        onMouseLeave={() => { setHovered(false); setHoverCursor?.(null) }}
        onClick={(e) => {
          if (e.evt.button !== 0) return
          e.cancelBubble = true
          if (e.evt.shiftKey && !isEndpoint) {
            onSplit?.(index)
            return
          }
          onClickVertex?.(index)
        }}
        onDragStart={(e) => { e.cancelBubble = true }}
        onDragMove={(e) => {
          e.cancelBubble = true
          const raw = { x: e.target.x(), y: e.target.y() }
          const snapped = onDragMove?.(index, raw) ?? raw
          e.target.position(snapped)
        }}
        onDragEnd={(e) => { e.cancelBubble = true; onDragEnd?.(index) }}
      />
      {hovered && canDelete && (
        <Group
          x={x + badgeOffset}
          y={y - badgeOffset}
          onMouseEnter={() => { setHoverCursor?.('pointer') }}
          onMouseLeave={() => { setHoverCursor?.(null) }}
          onClick={(e) => { if (e.evt.button !== 0) return; e.cancelBubble = true; onDelete?.(index) }}
        >
          <Circle radius={7 * s} fill="#000" opacity={0.35} listening={false} />
          <Circle radius={6 * s} fill="#e74c3c" stroke="#fff" strokeWidth={1.2 * s} />
          <Line points={[-3 * s, -3 * s, 3 * s, 3 * s]} stroke="#fff" strokeWidth={1.5 * s} lineCap="round" listening={false} />
          <Line points={[3 * s, -3 * s, -3 * s, 3 * s]} stroke="#fff" strokeWidth={1.5 * s} lineCap="round" listening={false} />
        </Group>
      )}
    </Group>
  )
}

// `mode`:
//   'full'            — body + magnet + handles + segments (used when the
//                       overlay split isn't active, i.e. nothing selected).
//   'bodyOnly'        — body + magnet + body-drag, but skip interactive
//                       handles / per-segment hit-tests. Used in the BASE
//                       layer for the currently-selected tray so its body
//                       (and drag handler) stay rooted in the base — the
//                       overlay only adds the handles on top. This is what
//                       prevents the mid-drag "jump" where moving the tray
//                       between Konva parents would tear the drag apart.
//   'interactiveOnly' — handles + per-segment hit-tests + snap halos, no
//                       body / magnet / body-drag. Used by the overlay so
//                       handles + segments float above APs / switches.
function TrayPolyline({ tray, mode = 'full', isSelected, isHovered, showMagnet, startExt, endExt, onHover, onClick, inverseScale, setHoverCursor, isDrawingMode, dimmed, allowDrag, allowHover, allowCmdHover, allowAnyHover, allowClick, onVertexDragMove, onVertexDragEnd, onDeleteVertex, onSplitVertex, onInsertVertex, onSplitSegment, onTranslate, onTranslateEnd }) {
  const s = inverseScale
  const flat = tray.points.flatMap((p) => [p.x, p.y])
  const sys = getTraySystem(tray.system)
  // Border switches to the selection color on select; body fill + centreline
  // stay at the system color so the user can still tell the discipline apart
  // while editing. `stroke` is reused by VertexHandle so its ring matches the
  // current selection cue.
  const borderColor = isSelected ? TRAY_SELECTED_BORDER : sys.color
  const stroke = borderColor
  const bodyFillCol = sys.fill
  const centerLineColor = sys.color
  const magnetPx = tray.magnetDistance ?? 100
  const showBody = mode !== 'interactiveOnly'
  const showInteractive = mode !== 'bodyOnly'
  // Body drag: track the cursor between dragmove ticks so we can hand the
  // store an incremental (dx, dy) each frame, AND remember the Group's
  // absolute position at dragstart so dragBoundFunc can pin it there for
  // the whole drag. The visual moves entirely from store re-renders.
  // dragBoundFunc receives ABSOLUTE coords (Stage has a viewport transform
  // that puts local-(0,0) somewhere other than screen-(0,0)), so simply
  // returning {x:0,y:0} would warp the Group to the screen origin — the
  // exact "body offset" the user saw.
  const bodyDragLastRef    = React.useRef(null)
  const bodyDragOrigAbsRef = React.useRef(null)

  return (
    <Group
      // Both the base body Group AND the overlay interactive Group are
      // draggable. The overlay's segment hit-tests sit on top of the body
      // in z-order; if the overlay wasn't draggable, a click on the body
      // (which lands on overlay's segments) couldn't initiate body-drag.
      // Both Groups share the same onTranslate path, so dragging either one
      // updates the same store points — body and handles stay in sync.
      // (Plain clicks on a segment without movement still fire onClick on
      // the segment line itself, which cancels bubble and inserts a vertex.)
      draggable={allowDrag && !dimmed}
      onMouseEnter={() => {
        // Cursor cue: 'pointer' if a click would select; 'move' once the tray
        // is already selected (so a drag now translates it). Drawing mode is
        // handled by Stage-level cursor; we still want to signal selectability
        // when allowed. Weak-hover modes keep their mode cursor unchanged.
        if (isDrawingMode) {
          // Stage already shows 'crosshair' — don't override.
        } else if (allowDrag || allowClick) {
          setHoverCursor?.(isSelected ? 'move' : 'pointer')
        }
        if (allowAnyHover) onHover(tray.id)
      }}
      onMouseLeave={() => { setHoverCursor?.(null); onHover(null) }}
      onClick={(e) => {
        if (e.evt.button !== 0) return
        // In tray drawing mode: don't consume the click — let it bubble to
        // the Stage handler, which will add a new draft vertex (already
        // snapped to this tray's endpoint when in snap range).
        if (isDrawingMode) return
        if (!allowClick) return
        e.cancelBubble = true
        onClick(tray.id, e)
      }}
      dragBoundFunc={() => bodyDragOrigAbsRef.current ?? { x: 0, y: 0 }}
      onDragStart={(e) => {
        e.cancelBubble = true
        // Auto-select before moving so the panel/handles show the right tray.
        if (!isSelected) onClick?.(tray.id, e)
        const p = e.target.getStage()?.getPointerPosition()
        bodyDragLastRef.current = p ? { x: p.x, y: p.y } : null
        // Snapshot absolute position so dragBoundFunc can keep the Group
        // anchored exactly where it was when the drag started.
        bodyDragOrigAbsRef.current = e.target.getAbsolutePosition()
      }}
      onDragMove={(e) => {
        e.cancelBubble = true
        const p = e.target.getStage()?.getPointerPosition()
        const last = bodyDragLastRef.current
        if (!p || !last) return
        // getPointerPosition() returns stage-container CSS pixels (verified
        // empirically — when pointer is dispatched at canvas-local (500, 300)
        // the function returns (500, 300), not the scaled-down canvas coord).
        // So we multiply the screen-px delta by inverseScale to land in
        // canvas-px before handing it to the store.
        const incDx = (p.x - last.x) * s
        const incDy = (p.y - last.y) * s
        bodyDragLastRef.current = { x: p.x, y: p.y }
        if (incDx !== 0 || incDy !== 0) onTranslate?.(incDx, incDy)
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true
        bodyDragLastRef.current = null
        bodyDragOrigAbsRef.current = null
        // Group was pinned at its original absolute position throughout the
        // drag — nothing to reset.
        // Phase 24 step 2 — commit accumulated drag overlay to the store.
        onTranslateEnd?.()
      }}
    >
      {/* Magnet halo — drawn first so the tray sits on top of it.
          Capsule shape via thick line + round caps; radius == magnetDistance. */}
      {showBody && showMagnet && (
        <Line
          points={flat}
          stroke={MAGNET_FILL}
          strokeWidth={magnetPx * 2}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}
      {showBody && showMagnet && (
        <Line
          points={flat}
          stroke={MAGNET_STROKE}
          strokeWidth={1.2 * s}
          dash={[6 * s, 4 * s]}
          opacity={0.7}
          // Emulate outline of the capsule by offsetting via a wider stroke that
          // only paints the perimeter is not possible in Konva; this dashed line
          // along centre + the fill above is the visual cue. The capsule outline
          // proper would need an extra path — skipped for MVP simplicity.
          listening={false}
        />
      )}
      {/* Hit-test polyline (transparent thick line) so click works anywhere
          near the tray, even outside the visible stroke width. Always render
          it when the body is shown — including for the selected tray's
          bodyOnly base, so the Group still owns a clickable surface to start
          body-drag on. (Segment hit-tests are in the overlay; they are on
          TOP in z-order so they win for narrow segment-line clicks, and this
          wide line catches the rest so body-drag remains possible.) */}
      {showBody && (
        <Line
          points={flat}
          stroke="transparent"
          strokeWidth={Math.max(14 * s, 14)}
          lineCap="round"
          lineJoin="round"
        />
      )}
      {/* Per-segment hit-test lines — only when selected. Plain click inserts
          a new vertex at the perpendicular foot of the click point.
          Shift+click splits the tray at that point (two new trays meeting at
          the click foot — both share the exact xy so the graph merges them).
          Hit width is intentionally narrower (8*s vs 14*s) than the body so
          vertex/× handles drawn on top stay easy to grab. */}
      {showInteractive && isSelected && !isDrawingMode && tray.points.slice(0, -1).map((a, i) => {
        const b = tray.points[i + 1]
        return (
          <Line
            key={`seg-hit-${i}`}
            points={[a.x, a.y, b.x, b.y]}
            stroke="transparent"
            strokeWidth={Math.max(8 * s, 8)}
            lineCap="butt"
            onMouseEnter={() => { setHoverCursor?.('copy') }}
            onMouseLeave={() => { setHoverCursor?.(null) }}
            onClick={(e) => {
              if (e.evt.button !== 0) return
              e.cancelBubble = true
              if (e.evt?.shiftKey) {
                onSplitSegment?.(i, e)
              } else {
                onInsertVertex?.(i, e)
              }
            }}
          />
        )
      })}
      {/* 17-1 channel: a single closed polygon carries the body fill AND the
          full border outline — top + bottom borders, plus a semicircle cap
          at each open endpoint and a miter at shared junctions. The dashed
          centreline is a separate line so the dash phase stays straight. */}
      {showBody && (() => {
        const halfW = (TRAY_WIDTH_SCREEN_PX * s) / 2
        const polyFlat = buildChannelPolygon(tray.points, halfW, startExt, endExt)
        const borderW  = (isSelected ? 2.2 : isHovered ? 1.4 : 1.1) * s
        // 23-3f hover = colour invert. Normal: body = sys.fill (low-opacity
        // pastel), border = sys.color (solid). Hover: body = sys.color
        // (solid — tray "fills in"), border = sys.fill (the previous body
        // colour). Selected keeps its red border untouched.
        const isInvert = isHovered && !isSelected
        const fillCol  = isInvert ? sys.color : bodyFillCol
        const strokeCol = isSelected ? TRAY_SELECTED_BORDER : (isInvert ? bodyFillCol : sys.color)
        // Centreline stays the system colour for normal+selected; on hover
        // invert it to white so it reads through the now-solid body.
        const centerCol = isInvert ? '#ffffff' : centerLineColor
        return (
          <>
            <Line
              points={polyFlat}
              closed
              fill={fillCol}
              stroke={strokeCol}
              strokeWidth={borderW}
              lineJoin="miter"
              miterLimit={10}
              listening={false}
            />
            <Line
              points={flat}
              stroke={centerCol}
              strokeWidth={0.9 * s}
              dash={[6 * s, 4 * s]}
              opacity={isInvert ? 0.85 : 0.7}
              lineCap="round"
              listening={false}
            />
          </>
        )
      })()}
      {/* Vertex handles — interactive when selected, decorative when not.
          The selected variant is draggable + has a × delete badge; shift+click
          on an interior vertex splits the tray. Skipped in bodyOnly mode
          (the overlay carries the handles in that case). */}
      {showInteractive && isSelected && !isDrawingMode && (
        tray.points.map((p, i) => (
          <VertexHandle
            key={`v-${i}`}
            x={p.x}
            y={p.y}
            index={i}
            isEndpoint={i === 0 || i === tray.points.length - 1}
            canDelete={tray.points.length > 2}
            color={stroke}
            inverseScale={s}
            onDragMove={onVertexDragMove}
            onDragEnd={onVertexDragEnd}
            onDelete={onDeleteVertex}
            onSplit={onSplitVertex}
            setHoverCursor={setHoverCursor}
          />
        ))
      )}
    </Group>
  )
}

// `renderMode`:
//   'all'      — render every tray with mode='full' (default; used when
//                nothing is selected so no overlay is mounted).
//   'base'     — render every tray. Unselected → mode='full'; selected →
//                mode='bodyOnly' (body stays anchored in the base layer so
//                its drag handler doesn't get re-parented mid-drag). Used
//                in the base when something is selected.
//   'overlay'  — render ONLY the selected tray with mode='interactiveOnly'
//                (handles + segments + snap halos). Mounted AFTER APLayer
//                in Editor2D so the handles float above other layers.
function CableTrayLayer({ floorId, selectedTrayId, selectedItems = [], onTrayClick, viewportScale, setHoverCursor, isDrawingMode, draftPoints, draftMagnetPx, mousePos, snapHint, draftAnchor, dimmed, toCanvasPos, renderMode = 'all', capability }) {
  const allowDrag     = !!capability?.allowDragExisting?.cable
  const allowClick    = !!capability?.allowSelectClick?.cable
  const allowHover    = !!capability?.allowSelectHover?.cable
  // 23-3f weak hover so the user can see which tray a right-click will target
  // when they're in DRAW_WALL / PLACE_AP / etc.
  const allowCmdHover = !!capability?.allowCommandHover?.cable
  const allowAnyHover = allowHover || allowCmdHover
  const magnetPolicy  = capability?.showMagnet?.tray ?? 'never'
  const allTrays      = useCableStore((s) => s.traysByFloor[floorId] ?? [])
  const trays = renderMode === 'overlay'
    ? allTrays.filter((t) => t.id === selectedTrayId)
    : allTrays
  const polylineModeFor = (trayId) => {
    if (renderMode === 'overlay') return 'interactiveOnly'
    if (renderMode === 'base' && trayId === selectedTrayId) return 'bodyOnly'
    return 'full'
  }
  const updateTray    = useCableStore((s) => s.updateTray)
  const addTray       = useCableStore((s) => s.addTray)
  const nextTrayName  = useCableStore((s) => s.nextTrayName)
  const removeTrayFn  = useCableStore((s) => s.removeTray)
  const floor         = useFloorStore((s) => s.floors.find((f) => f.id === floorId))
  const inverseScale  = 1 / (viewportScale || 1)
  const [hoveredId, setHoveredId] = useState(null)
  const batchSelectedIds = selectedItems.length > 1
    ? new Set(selectedItems.filter((it) => it.type === 'cable_tray').map((it) => it.id))
    : null

  // Phase 24 step 2 — drag overlay subscriptions. Body drag accumulates a
  // {dx,dy} offset; vertex drag pins one vertex to a new absolute xy. Both
  // stay out of the canonical store until dragEnd, so CableLayer's expensive
  // computeRoutes doesn't re-run per drag tick.
  const trayBodyOverlay   = useDragOverlayStore((s) => s.tray)
  const trayVertexOverlay = useDragOverlayStore((s) => s.trayVertex)
  const hasOverlay = !!(trayBodyOverlay || trayVertexOverlay)
  // Apply overlay to tray points so the visual follows the cursor without
  // mutating the store. When no overlay is active, identity-return `trays`
  // so neighborExts / downstream memos cache hit.
  const displayedTrays = hasOverlay
    ? trays.map((t) => {
        let points = t.points
        if (trayBodyOverlay?.id === t.id) {
          points = points.map((p) => ({ x: p.x + trayBodyOverlay.dx, y: p.y + trayBodyOverlay.dy }))
        }
        if (trayVertexOverlay?.trayId === t.id) {
          points = points.map((p, i) =>
            i === trayVertexOverlay.vertexIdx
              ? { x: trayVertexOverlay.x, y: trayVertexOverlay.y }
              : p,
          )
        }
        return points === t.points ? t : { ...t, points }
      })
    : trays
  // 17-1 follow-up: pre-compute per-tray junction info so each tray miters
  // cleanly into its neighbour where they share an exact endpoint.
  const neighborExts = React.useMemo(() => computeTrayNeighborExts(displayedTrays), [displayedTrays])

  // Snap a vertex being dragged onto another tray's vertex (or another
  // vertex of the same tray) within VERTEX_SNAP_SCREEN_PX. Excludes the
  // dragged vertex itself so it doesn't snap to its own old position.
  // Returns { pos, target } — `target` is the snapped-to vertex when a snap
  // actually fired, else null. Caller uses `target` to drive the snap halo.
  // Always iterates `allTrays` (not the render-filtered `trays`) so the
  // overlay instance can still snap onto vertices on the base-rendered trays.
  const snapVertexDrag = React.useCallback((trayId, vertexIdx, pos) => {
    const snapDist = VERTEX_SNAP_SCREEN_PX * inverseScale
    let best = pos, bestD = snapDist, target = null
    for (const t of allTrays) {
      for (let i = 0; i < t.points.length; i++) {
        if (t.id === trayId && i === vertexIdx) continue
        const v = t.points[i]
        const d = Math.hypot(pos.x - v.x, pos.y - v.y)
        if (d < bestD) { bestD = d; best = { x: v.x, y: v.y }; target = best }
      }
    }
    return { pos: best, target }
  }, [allTrays, inverseScale])

  // Snap-target for the currently dragging vertex — drives the green halo
  // shown at the other tray's endpoint. Null when no drag or no snap.
  const [dragSnapTarget, setDragSnapTarget] = useState(null)

  // Detect if mousePos sits exactly on an existing tray vertex (snap target).
  // Editor2D pre-snaps the mousePos, so an exact-match scan is enough.
  // Uses allTrays so the indicator also fires for trays hidden in the base
  // due to `hideSelected` mode.
  const snapHit = (isDrawingMode && mousePos)
    ? (() => {
        for (const t of allTrays) {
          for (const v of t.points) {
            if (v.x === mousePos.x && v.y === mousePos.y) return v
          }
        }
        // Also detect snap onto current draft's own vertices (committed ones)
        if (draftPoints) {
          for (let i = 0; i < draftPoints.length - 1; i++) {
            const v = draftPoints[i]
            if (v.x === mousePos.x && v.y === mousePos.y) return v
          }
        }
        return null
      })()
    : null

  return (
    <Group opacity={dimmed ? 0.2 : 1}>
      {displayedTrays.map((tray, i) => {
        const isSel = tray.id === selectedTrayId || (batchSelectedIds?.has(tray.id) ?? false)
        const isHov = tray.id === hoveredId
        return (
          <TrayPolyline
            key={tray.id}
            tray={tray}
            mode={polylineModeFor(tray.id)}
            isSelected={isSel}
            isHovered={isHov}
            // Magnet halo policy (derived from capability):
            //   'all' → every tray's halo on (drawing / place-switch modes)
            //   'selectedOnly' → only on selected/hovered (SELECT mode)
            //   'never' → hidden
            showMagnet={
              magnetPolicy === 'all' ? true :
              magnetPolicy === 'selectedOnly' ? (isSel || isHov) :
              false
            }
            startExt={neighborExts[i]?.startExt ?? null}
            endExt={neighborExts[i]?.endExt ?? null}
            onHover={setHoveredId}
            onClick={onTrayClick}
            inverseScale={inverseScale}
            setHoverCursor={setHoverCursor}
            isDrawingMode={isDrawingMode}
            dimmed={dimmed}
            allowDrag={allowDrag}
            allowHover={allowHover}
            allowCmdHover={allowCmdHover}
            allowAnyHover={allowAnyHover}
            allowClick={allowClick}
            onTranslate={(incDx, incDy) => {
              // Phase 24 step 2 — accumulate into drag overlay instead of
              // writing the canonical store every tick. CableLayer's
              // computeRoutes (Dijkstra × 50 AP) re-runs on traysByFloor
              // change; writing per-tick made tray body drag stutter.
              // dragEnd commits the accumulated offset → see onTranslateEnd.
              const cur = useDragOverlayStore.getState().tray
              const baseDx = (cur?.id === tray.id) ? cur.dx : 0
              const baseDy = (cur?.id === tray.id) ? cur.dy : 0
              useDragOverlayStore.getState().setTray({
                id: tray.id,
                dx: baseDx + incDx,
                dy: baseDy + incDy,
              })
            }}
            onTranslateEnd={() => {
              const cur = useDragOverlayStore.getState().tray
              if (cur?.id === tray.id && (cur.dx !== 0 || cur.dy !== 0)) {
                // Read fresh store points so the commit picks up any external
                // mutations during the drag (rare but cheap to handle).
                const fresh = useCableStore.getState().traysByFloor[floorId]?.find((t) => t.id === tray.id)
                if (fresh) {
                  const newPoints = fresh.points.map((p) => ({
                    x: p.x + cur.dx,
                    y: p.y + cur.dy,
                  }))
                  updateTray(floorId, tray.id, { points: newPoints })
                }
              }
              useDragOverlayStore.getState().setTray(null)
            }}
            onVertexDragMove={(idx, raw) => {
              // Phase 24 step 2 — write to overlay instead of store. snap
              // logic still runs against fresh allTrays so target halo is
              // accurate; commit happens in onVertexDragEnd.
              const { pos, target } = snapVertexDrag(tray.id, idx, raw)
              setDragSnapTarget(target)
              useDragOverlayStore.getState().setTrayVertex({
                trayId: tray.id,
                vertexIdx: idx,
                x: pos.x,
                y: pos.y,
              })
              return pos
            }}
            onVertexDragEnd={(idx) => {
              setDragSnapTarget(null)
              const cur = useDragOverlayStore.getState().trayVertex
              if (cur?.trayId === tray.id && cur.vertexIdx === idx) {
                const fresh = useCableStore.getState().traysByFloor[floorId]?.find((t) => t.id === tray.id)
                if (fresh) {
                  const newPoints = fresh.points.map((pt, j) =>
                    j === idx ? { x: cur.x, y: cur.y } : pt,
                  )
                  updateTray(floorId, tray.id, { points: newPoints })
                }
              }
              useDragOverlayStore.getState().setTrayVertex(null)
            }}
            onDeleteVertex={(idx) => {
              if (tray.points.length <= 2) return
              const newPoints = tray.points.filter((_, j) => j !== idx)
              updateTray(floorId, tray.id, { points: newPoints })
            }}
            onSplitVertex={(idx) => {
              if (idx <= 0 || idx >= tray.points.length - 1) return
              // Two new trays share the exact vertex at idx → graph builder
              // (cable-spec §10 / 12-2d) treats coincident xy as one node.
              const ptsA = tray.points.slice(0, idx + 1)
              const ptsB = tray.points.slice(idx)
              removeTrayFn(floorId, tray.id)
              // Fresh names — split children are independent objects.
              // nextTrayName() reads + increments the global counter each call.
              const nameA = nextTrayName({ floor })
              addTray(floorId, { ...tray, id: generateId('tray'), name: nameA, points: ptsA })
              const nameB = nextTrayName({ floor })
              addTray(floorId, { ...tray, id: generateId('tray'), name: nameB, points: ptsB })
            }}
            onInsertVertex={(segIdx, e) => {
              if (!toCanvasPos) return
              const stage = e?.target?.getStage?.()
              const screenPos = stage?.getPointerPosition?.()
              if (!screenPos) return
              const canvasPos = toCanvasPos(screenPos)
              // Project onto the segment so the inserted vertex sits exactly
              // on the existing tray line, then user can drag it elsewhere.
              const a = tray.points[segIdx], b = tray.points[segIdx + 1]
              const dx = b.x - a.x, dy = b.y - a.y
              const lenSq = dx * dx + dy * dy
              if (lenSq < 1e-6) return
              const t = ((canvasPos.x - a.x) * dx + (canvasPos.y - a.y) * dy) / lenSq
              const tc = Math.max(0, Math.min(1, t))
              const foot = { x: a.x + tc * dx, y: a.y + tc * dy }
              const newPoints = [
                ...tray.points.slice(0, segIdx + 1),
                foot,
                ...tray.points.slice(segIdx + 1),
              ]
              updateTray(floorId, tray.id, { points: newPoints })
            }}
            onSplitSegment={(segIdx, e) => {
              if (!toCanvasPos) return
              const stage = e?.target?.getStage?.()
              const screenPos = stage?.getPointerPosition?.()
              if (!screenPos) return
              const canvasPos = toCanvasPos(screenPos)
              const a = tray.points[segIdx], b = tray.points[segIdx + 1]
              const dx = b.x - a.x, dy = b.y - a.y
              const lenSq = dx * dx + dy * dy
              if (lenSq < 1e-6) return
              const t = ((canvasPos.x - a.x) * dx + (canvasPos.y - a.y) * dy) / lenSq
              const tc = Math.max(0, Math.min(1, t))
              const foot = { x: a.x + tc * dx, y: a.y + tc * dy }
              // Two new trays, both containing the foot vertex so they share
              // the exact xy at the split point (12-2d coincidence-merge keeps
              // them graph-connected).
              const ptsA = [...tray.points.slice(0, segIdx + 1), foot]
              const ptsB = [foot, ...tray.points.slice(segIdx + 1)]
              removeTrayFn(floorId, tray.id)
              const nameA = nextTrayName({ floor })
              addTray(floorId, { ...tray, id: generateId('tray'), name: nameA, points: ptsA })
              const nameB = nextTrayName({ floor })
              addTray(floorId, { ...tray, id: generateId('tray'), name: nameB, points: ptsB })
            }}
          />
        )
      })}

      {/* Draft + draw-mode snap indicator only render in the base instance
          (the overlay instance is for the selected tray and should stay
          lean — drawing implies nothing is selected anyway). */}
      {renderMode !== 'overlay' && isDrawingMode && draftPoints && draftPoints.length > 0 && (
        <DraftTray
          points={draftPoints}
          magnetPx={draftMagnetPx ?? 100}
          mousePos={mousePos}
          inverseScale={inverseScale}
        />
      )}

      {/* Snap indicator: green halo when the cursor has snapped onto an
          existing tray vertex (works even before the first click of a draft). */}
      {renderMode !== 'overlay' && snapHit && (
        <Group x={snapHit.x} y={snapHit.y} listening={false}>
          <Circle radius={10 * inverseScale} stroke="#22c55e" strokeWidth={2 * inverseScale} />
          <Circle radius={4  * inverseScale} fill="#22c55e" />
        </Group>
      )}

      {/* 18-5: same green halo while a vertex of a selected tray is being
          dragged onto another tray's vertex. Makes the snap target visible
          before release so the user knows the two will become coincident. */}
      {dragSnapTarget && (
        <Group x={dragSnapTarget.x} y={dragSnapTarget.y} listening={false}>
          <Circle radius={10 * inverseScale} stroke="#22c55e" strokeWidth={2 * inverseScale} />
          <Circle radius={4  * inverseScale} fill="#22c55e" />
        </Group>
      )}

      {/* 20-3 wall snap halo — orange to distinguish from tray-vertex (green).
          Kind is communicated via the OUTER ring (not a centre dot), since the
          mouse cursor sits on top of the centre and can obscure small shapes:
          - wallEndpoint → solid circle ring (snap to corner)
          - wallSegment  → solid square ring (snap to wall edge / perpendicular)
          A small label below the ring spells out the kind verbatim so even
          colour-blind users can read it. */}
      {renderMode !== 'overlay' && snapHint && (snapHint.kind === 'wallEndpoint' || snapHint.kind === 'wallSegment') && (
        <Group x={snapHint.pos.x} y={snapHint.pos.y} listening={false}>
          {snapHint.kind === 'wallEndpoint' && (
            <Circle radius={13 * inverseScale} stroke="#f59e0b" strokeWidth={2.5 * inverseScale} />
          )}
          {snapHint.kind === 'wallSegment' && (
            <Line
              points={[-13 * inverseScale, -13 * inverseScale,  13 * inverseScale, -13 * inverseScale,
                        13 * inverseScale,  13 * inverseScale, -13 * inverseScale,  13 * inverseScale]}
              closed
              stroke="#f59e0b"
              strokeWidth={2.5 * inverseScale}
            />
          )}
        </Group>
      )}

      {/* 20-3 parallel-wall guide — a dim guide line from anchor toward cursor
          plus a tinted highlight on the reference wall, so the user knows what
          direction is being locked AND which wall is steering the lock. */}
      {renderMode !== 'overlay' && snapHint && snapHint.kind === 'parallelWall' && draftAnchor && (
        <Group listening={false}>
          {snapHint.ref && (
            <Line
              points={[snapHint.ref.startX, snapHint.ref.startY, snapHint.ref.endX, snapHint.ref.endY]}
              stroke="#a78bfa"
              strokeWidth={3 * inverseScale}
              opacity={0.55}
              lineCap="round"
            />
          )}
          <Line
            points={[draftAnchor.x, draftAnchor.y, snapHint.pos.x, snapHint.pos.y]}
            stroke="#a78bfa"
            strokeWidth={1.2 * inverseScale}
            dash={[4 * inverseScale, 4 * inverseScale]}
            opacity={0.8}
          />
          <Circle x={snapHint.pos.x} y={snapHint.pos.y} radius={4 * inverseScale} fill="#a78bfa" />
        </Group>
      )}
    </Group>
  )
}

function DraftTray({ points, magnetPx, mousePos, inverseScale }) {
  const s = inverseScale
  const flatCommitted = points.flatMap((p) => [p.x, p.y])
  // Draft uses the default-system stroke (no tray exists yet to read from).
  const draftStroke = getTraySystem(DEFAULT_TRAY.system).color
  const ghostFlat = mousePos
    ? [...flatCommitted, mousePos.x, mousePos.y]
    : flatCommitted

  return (
    <Group listening={false}>
      {/* Magnet halo preview along committed segments */}
      {points.length >= 2 && (
        <Line
          points={flatCommitted}
          stroke={MAGNET_FILL}
          strokeWidth={magnetPx * 2}
          lineCap="round"
          lineJoin="round"
        />
      )}
      {/* Magnet halo preview along ghost segment (current cursor lead) */}
      {mousePos && points.length >= 1 && (
        <Line
          points={[points[points.length - 1].x, points[points.length - 1].y, mousePos.x, mousePos.y]}
          stroke={MAGNET_FILL}
          strokeWidth={magnetPx * 2}
          lineCap="round"
          lineJoin="round"
          opacity={0.5}
        />
      )}
      {/* Committed segments — solid */}
      {points.length >= 2 && (
        <Line
          points={flatCommitted}
          stroke={draftStroke}
          strokeWidth={2.4 * s}
          lineCap="round"
          lineJoin="round"
        />
      )}
      {/* Ghost segment from last point to cursor */}
      {mousePos && points.length >= 1 && (
        <Line
          points={[points[points.length - 1].x, points[points.length - 1].y, mousePos.x, mousePos.y]}
          stroke={draftStroke}
          strokeWidth={2 * s}
          dash={[10 * s, 6 * s]}
          opacity={0.65}
          lineCap="round"
        />
      )}
      {/* Vertex dots */}
      {points.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={4 * s}
          fill="#fff"
          stroke={draftStroke}
          strokeWidth={1.5 * s}
        />
      ))}
    </Group>
  )
}

export default CableTrayLayer

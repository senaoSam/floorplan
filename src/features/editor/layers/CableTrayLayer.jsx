import React, { useState } from 'react'
import { Group, Line, Circle } from 'react-konva'
import DeleteButton from './DeleteButton'
import { useCableStore } from '@/store/useCableStore'
import { generateId } from '@/utils/id'

// Snap radius (screen px) when dragging an existing vertex onto another
// tray's vertex. Same value as the draft-mode snap so the UX feels uniform.
const VERTEX_SNAP_SCREEN_PX = 24

// Tray colour scheme: indigo (blue-leaning purple), distinct from cable
// (cyan / violet) and walls.
const TRAY_COLOR        = '#818cf8'                    // indigo-400 border
const TRAY_SELECTED     = '#e74c3c'
const TRAY_BODY_FILL    = 'rgba(99, 102, 241, 0.40)'   // indigo-500 @ 40% — visible body
const TRAY_SELECTED_FILL = 'rgba(231, 76, 60, 0.32)'
const MAGNET_FILL       = 'rgba(129, 140, 248, 0.12)'
const MAGNET_STROKE     = 'rgba(129, 140, 248, 0.45)'

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

// Point at 50% of the polyline's total path length.
function polylineMidpoint(points) {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
  }
  let walked = 0
  const target = total / 2
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + seg >= target) {
      const t = (target - walked) / (seg || 1)
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    walked += seg
  }
  return points[points.length - 1]
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
          onClick={(e) => { e.cancelBubble = true; onDelete?.(index) }}
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

function TrayPolyline({ tray, isSelected, isHovered, showMagnet, startExt, endExt, onHover, onClick, onRightMouseDown, inverseScale, onDelete, setHoverCursor, isDrawingMode, dimmed, onVertexDragMove, onVertexDragEnd, onDeleteVertex, onSplitVertex, onInsertVertex, onSplitSegment, onTranslate }) {
  const s = inverseScale
  const flat = tray.points.flatMap((p) => [p.x, p.y])
  const stroke = isSelected ? TRAY_SELECTED : TRAY_COLOR
  const magnetPx = tray.magnetDistance ?? 100

  return (
    <Group
      draggable={!isDrawingMode && !dimmed}
      onMouseEnter={() => {
        // Cursor cue: 'pointer' if a click would select; 'move' once the tray
        // is already selected (so a drag now translates it). Drawing mode
        // overrides with 'crosshair' to signal "click to add a vertex".
        const cur = isDrawingMode ? 'crosshair' : isSelected ? 'move' : 'pointer'
        setHoverCursor?.(cur)
        onHover(tray.id)
      }}
      onMouseLeave={() => { setHoverCursor?.(null); onHover(null) }}
      onClick={(e) => {
        // In tray drawing mode: don't consume the click — let it bubble to
        // the Stage handler, which will add a new draft vertex (already
        // snapped to this tray's endpoint when in snap range). Hover and
        // selection-on-click remain intact when NOT drawing.
        if (isDrawingMode) return
        e.cancelBubble = true
        onClick(tray.id, e)
      }}
      onContextMenu={(e) => {
        if (isDrawingMode) return  // let Stage finish the draft instead
        e.evt.preventDefault()
        e.cancelBubble = true
        onClick(tray.id, e)
      }}
      onMouseDown={(e) => {
        if (isDrawingMode) return  // no right-drag of existing trays while drawing
        if (e.evt.button === 2) {
          e.cancelBubble = true
          onRightMouseDown?.(e.currentTarget)
        }
      }}
      onDragStart={(e) => {
        e.cancelBubble = true
        // Auto-select before moving so the panel/handles show the right tray.
        if (!isSelected) onClick?.(tray.id, e)
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true
        const dx = e.target.x()
        const dy = e.target.y()
        e.target.position({ x: 0, y: 0 })
        if (dx !== 0 || dy !== 0) onTranslate?.(dx, dy)
      }}
    >
      {/* Magnet halo — drawn first so the tray sits on top of it.
          Capsule shape via thick line + round caps; radius == magnetDistance. */}
      {showMagnet && (
        <Line
          points={flat}
          stroke={MAGNET_FILL}
          strokeWidth={magnetPx * 2}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}
      {showMagnet && (
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
          near the tray, even outside the visible stroke width.
          When the tray is selected we replace this single fat hit-line with
          per-segment hit-test lines (below) so a click on a segment can
          insert a vertex at the click point instead of just re-selecting. */}
      {!isSelected && (
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
      {isSelected && !isDrawingMode && tray.points.slice(0, -1).map((a, i) => {
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
      {(() => {
        const halfW = (TRAY_WIDTH_SCREEN_PX * s) / 2
        const polyFlat = buildChannelPolygon(tray.points, halfW, startExt, endExt)
        const borderW  = (isSelected ? 1.6 : isHovered ? 1.3 : 1.1) * s
        const fillCol  = isSelected ? TRAY_SELECTED_FILL : TRAY_BODY_FILL
        return (
          <>
            <Line
              points={polyFlat}
              closed
              fill={fillCol}
              stroke={stroke}
              strokeWidth={borderW}
              lineJoin="miter"
              miterLimit={10}
              listening={false}
            />
            <Line
              points={flat}
              stroke={stroke}
              strokeWidth={0.9 * s}
              dash={[6 * s, 4 * s]}
              opacity={0.7}
              lineCap="round"
              listening={false}
            />
          </>
        )
      })()}
      {/* Vertex handles — interactive when selected, decorative when not.
          The selected variant is draggable + has a × delete badge; shift+click
          on an interior vertex splits the tray. */}
      {isSelected && !isDrawingMode ? (
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
      ) : (
        isSelected && tray.points.map((p, i) => (
          <Circle
            key={`v-${i}`}
            x={p.x}
            y={p.y}
            radius={4 * s}
            fill="#fff"
            stroke={stroke}
            strokeWidth={1.5 * s}
            listening={false}
          />
        ))
      )}
      {/* Quick delete button at polyline midpoint so it's easy to spot and
          its hit area overlaps the line — moving mouse onto the X stays inside
          the group's combined hit area, so onMouseLeave doesn't drop it. */}
      {isHovered && onDelete && tray.points.length >= 2 && (() => {
        const mid = polylineMidpoint(tray.points)
        return (
          <DeleteButton
            x={mid.x}
            y={mid.y}
            scale={s}
            onClick={() => onDelete(tray.id)}
            setHoverCursor={setHoverCursor}
            leaveCursor={isDrawingMode ? 'crosshair' : 'pointer'}
          />
        )
      })()}
    </Group>
  )
}

function CableTrayLayer({ floorId, selectedTrayId, selectedItems = [], onTrayClick, onRightMouseDown, viewportScale, onDelete, setHoverCursor, isDrawingMode, draftPoints, draftMagnetPx, mousePos, dimmed, toCanvasPos }) {
  const trays         = useCableStore((s) => s.traysByFloor[floorId] ?? [])
  const updateTray    = useCableStore((s) => s.updateTray)
  const addTray       = useCableStore((s) => s.addTray)
  const nextTrayName  = useCableStore((s) => s.nextTrayName)
  const removeTrayFn  = useCableStore((s) => s.removeTray)
  const inverseScale  = 1 / (viewportScale || 1)
  const [hoveredId, setHoveredId] = useState(null)
  const batchSelectedIds = selectedItems.length > 1
    ? new Set(selectedItems.filter((it) => it.type === 'cable_tray').map((it) => it.id))
    : null
  // 17-1 follow-up: pre-compute per-tray junction info so each tray miters
  // cleanly into its neighbour where they share an exact endpoint.
  const neighborExts = React.useMemo(() => computeTrayNeighborExts(trays), [trays])

  // Snap a vertex being dragged onto another tray's vertex (or another
  // vertex of the same tray) within VERTEX_SNAP_SCREEN_PX. Excludes the
  // dragged vertex itself so it doesn't snap to its own old position.
  const snapVertexDrag = React.useCallback((trayId, vertexIdx, pos) => {
    const snapDist = VERTEX_SNAP_SCREEN_PX * inverseScale
    let best = pos, bestD = snapDist
    for (const t of trays) {
      for (let i = 0; i < t.points.length; i++) {
        if (t.id === trayId && i === vertexIdx) continue
        const v = t.points[i]
        const d = Math.hypot(pos.x - v.x, pos.y - v.y)
        if (d < bestD) { bestD = d; best = { x: v.x, y: v.y } }
      }
    }
    return best
  }, [trays, inverseScale])

  // Detect if mousePos sits exactly on an existing tray vertex (snap target).
  // Editor2D pre-snaps the mousePos, so an exact-match scan is enough.
  const snapHit = (isDrawingMode && mousePos)
    ? (() => {
        for (const t of trays) {
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
      {trays.map((tray, i) => {
        const isSel = tray.id === selectedTrayId || (batchSelectedIds?.has(tray.id) ?? false)
        const isHov = tray.id === hoveredId
        return (
          <TrayPolyline
            key={tray.id}
            tray={tray}
            isSelected={isSel}
            isHovered={isHov}
            // Show magnet halo while drawing trays OR when this one is selected/hovered.
            showMagnet={isDrawingMode || isSel || isHov}
            startExt={neighborExts[i]?.startExt ?? null}
            endExt={neighborExts[i]?.endExt ?? null}
            onHover={setHoveredId}
            onClick={onTrayClick}
            onRightMouseDown={onRightMouseDown}
            inverseScale={inverseScale}
            onDelete={onDelete}
            setHoverCursor={setHoverCursor}
            isDrawingMode={isDrawingMode}
            dimmed={dimmed}
            onTranslate={(dx, dy) => {
              const newPoints = tray.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
              updateTray(floorId, tray.id, { points: newPoints })
            }}
            onVertexDragMove={(idx, raw) => {
              const snapped = snapVertexDrag(tray.id, idx, raw)
              const newPoints = tray.points.map((pt, j) => (j === idx ? snapped : pt))
              updateTray(floorId, tray.id, { points: newPoints })
              return snapped
            }}
            onVertexDragEnd={() => { /* store already up to date via drag-move */ }}
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
              const nameA = nextTrayName()
              addTray(floorId, { ...tray, id: generateId('tray'), name: nameA, points: ptsA })
              const nameB = nextTrayName()
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
              const nameA = nextTrayName()
              addTray(floorId, { ...tray, id: generateId('tray'), name: nameA, points: ptsA })
              const nameB = nextTrayName()
              addTray(floorId, { ...tray, id: generateId('tray'), name: nameB, points: ptsB })
            }}
          />
        )
      })}

      {/* Draft polyline being drawn (DRAW_CABLE_TRAY mode) */}
      {isDrawingMode && draftPoints && draftPoints.length > 0 && (
        <DraftTray
          points={draftPoints}
          magnetPx={draftMagnetPx ?? 100}
          mousePos={mousePos}
          inverseScale={inverseScale}
        />
      )}

      {/* Snap indicator: green halo when the cursor has snapped onto an
          existing tray vertex (works even before the first click of a draft). */}
      {snapHit && (
        <Group x={snapHit.x} y={snapHit.y} listening={false}>
          <Circle radius={10 * inverseScale} stroke="#22c55e" strokeWidth={2 * inverseScale} />
          <Circle radius={4  * inverseScale} fill="#22c55e" />
        </Group>
      )}
    </Group>
  )
}

function DraftTray({ points, magnetPx, mousePos, inverseScale }) {
  const s = inverseScale
  const flatCommitted = points.flatMap((p) => [p.x, p.y])
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
          stroke={TRAY_COLOR}
          strokeWidth={2.4 * s}
          lineCap="round"
          lineJoin="round"
        />
      )}
      {/* Ghost segment from last point to cursor */}
      {mousePos && points.length >= 1 && (
        <Line
          points={[points[points.length - 1].x, points[points.length - 1].y, mousePos.x, mousePos.y]}
          stroke={TRAY_COLOR}
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
          stroke={TRAY_COLOR}
          strokeWidth={1.5 * s}
        />
      ))}
    </Group>
  )
}

export default CableTrayLayer

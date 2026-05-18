import React, { useState } from 'react'
import { Group, Line, Circle } from 'react-konva'
import DeleteButton from './DeleteButton'
import { useCableStore } from '@/store/useCableStore'

// Tray colour scheme: muted blue, distinct from cable (grey/cyan) and walls.
const TRAY_COLOR        = '#60a5fa'
const TRAY_SELECTED     = '#e74c3c'
const MAGNET_FILL       = 'rgba(96, 165, 250, 0.12)'
const MAGNET_STROKE     = 'rgba(96, 165, 250, 0.45)'

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

function TrayPolyline({ tray, isSelected, isHovered, showMagnet, onHover, onClick, onRightMouseDown, inverseScale, onDelete, setHoverCursor, isDrawingMode }) {
  const s = inverseScale
  const flat = tray.points.flatMap((p) => [p.x, p.y])
  const stroke = isSelected ? TRAY_SELECTED : TRAY_COLOR
  const magnetPx = tray.magnetDistance ?? 100

  return (
    <Group
      onMouseEnter={() => { setHoverCursor?.(isDrawingMode ? 'crosshair' : 'pointer'); onHover(tray.id) }}
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
          near the tray, even outside the visible stroke width. */}
      <Line
        points={flat}
        stroke="transparent"
        strokeWidth={Math.max(14 * s, 14)}
        lineCap="round"
        lineJoin="round"
      />
      {/* Visible tray polyline */}
      <Line
        points={flat}
        stroke={stroke}
        strokeWidth={(isSelected ? 3.2 : isHovered ? 2.8 : 2.4) * s}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />
      {/* Vertex markers (only when selected) */}
      {isSelected && tray.points.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={4 * s}
          fill="#fff"
          stroke={stroke}
          strokeWidth={1.5 * s}
          listening={false}
        />
      ))}
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

function CableTrayLayer({ floorId, selectedTrayId, selectedItems = [], onTrayClick, onRightMouseDown, viewportScale, onDelete, setHoverCursor, isDrawingMode, draftPoints, draftMagnetPx, mousePos, dimmed }) {
  const trays         = useCableStore((s) => s.traysByFloor[floorId] ?? [])
  const inverseScale  = 1 / (viewportScale || 1)
  const [hoveredId, setHoveredId] = useState(null)
  const batchSelectedIds = selectedItems.length > 1
    ? new Set(selectedItems.filter((it) => it.type === 'cable_tray').map((it) => it.id))
    : null

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
      {trays.map((tray) => {
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
            onHover={setHoveredId}
            onClick={onTrayClick}
            onRightMouseDown={onRightMouseDown}
            inverseScale={inverseScale}
            onDelete={onDelete}
            setHoverCursor={setHoverCursor}
            isDrawingMode={isDrawingMode}
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

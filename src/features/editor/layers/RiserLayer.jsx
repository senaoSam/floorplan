import React, { useState } from 'react'
import { Group, Circle, Rect, Line, Text } from 'react-konva'
import DeleteButton from './DeleteButton'
import { useCableStore } from '@/store/useCableStore'

// Riser icon = small square (cross-section view) with an arrow indicating the
// vertical shaft passes up + down through floors. Distinct enough from APs
// (frequency rings) and switches (chassis rectangles) at a glance.
const RISER_COLOR    = '#a78bfa'  // violet-400
const RISER_SELECTED = '#e74c3c'
const MAGNET_FILL    = 'rgba(167, 139, 250, 0.14)'
const MAGNET_STROKE  = 'rgba(167, 139, 250, 0.5)'

function RiserMarker({ riser, isSelected, isHovered, onHover, isDraggable, onClick, onMoved, onDragMove, onRightMouseDown, inverseScale, onDelete, setHoverCursor, showMagnet, floorCount }) {
  const s = inverseScale
  const strokeColor = isSelected ? RISER_SELECTED : RISER_COLOR
  const size = 18 * s
  const magnetPx = riser.magnetDistance ?? 100

  return (
    <Group
      x={riser.x}
      y={riser.y}
      draggable={isDraggable}
      onMouseEnter={() => { setHoverCursor?.('grab'); onHover(riser.id) }}
      onMouseLeave={() => { setHoverCursor?.(null); onHover(null) }}
      onClick={(e) => { e.cancelBubble = true; onClick(riser.id, e) }}
      onContextMenu={(e) => {
        e.evt.preventDefault()
        e.cancelBubble = true
        onClick(riser.id, e)
      }}
      onMouseDown={(e) => {
        if (e.evt.button === 2) {
          e.cancelBubble = true
          onRightMouseDown?.(e.currentTarget)
        }
      }}
      onDragStart={(e) => { e.cancelBubble = true; onClick(riser.id, e) }}
      onDragMove={(e) => {
        e.cancelBubble = true
        onDragMove?.(riser.id, e.target.x(), e.target.y())
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true
        onMoved(riser.id, e.target.x(), e.target.y())
      }}
    >
      {/* Magnet halo (circular — riser is a point, not a line). Only when
          editing-mode/hover/selected so it doesn't clutter the canvas. */}
      {showMagnet && (
        <>
          <Circle
            radius={magnetPx}
            fill={MAGNET_FILL}
            listening={false}
          />
          <Circle
            radius={magnetPx}
            stroke={MAGNET_STROKE}
            strokeWidth={1.2 * s}
            dash={[6 * s, 4 * s]}
            listening={false}
          />
        </>
      )}
      {/* Cross-section square — top-down view of the vertical shaft */}
      <Rect
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        cornerRadius={2 * s}
        fill="#1f2937"
        stroke={strokeColor}
        strokeWidth={(isSelected ? 2.5 : isHovered ? 2 : 1.5) * s}
      />
      {/* Inner cross "+" — symbolises the vertical chase */}
      <Line
        points={[-size / 2 + 4 * s, 0, size / 2 - 4 * s, 0]}
        stroke={strokeColor}
        strokeWidth={1.2 * s}
        listening={false}
      />
      <Line
        points={[0, -size / 2 + 4 * s, 0, size / 2 - 4 * s]}
        stroke={strokeColor}
        strokeWidth={1.2 * s}
        listening={false}
      />
      {/* Up/down arrows above & below — make "vertical shaft" obvious */}
      <Line
        points={[0, -size / 2 - 5 * s, -3 * s, -size / 2 - 1 * s, 3 * s, -size / 2 - 1 * s]}
        closed
        fill={strokeColor}
        listening={false}
      />
      <Line
        points={[0, size / 2 + 5 * s, -3 * s, size / 2 + 1 * s, 3 * s, size / 2 + 1 * s]}
        closed
        fill={strokeColor}
        listening={false}
      />
      {/* Name + floor count label */}
      <Text
        text={floorCount > 0 ? `${riser.name} (${floorCount}F)` : riser.name}
        fontSize={11 * s}
        fill="#fff"
        align="center"
        offsetX={40 * s}
        offsetY={size / 2 + 22 * s}
        width={80 * s}
        shadowColor="#000"
        shadowBlur={4}
        shadowOpacity={0.9}
        listening={false}
      />
      {isHovered && onDelete && (
        <DeleteButton
          x={size / 2}
          y={-size / 2}
          scale={s}
          onClick={() => onDelete(riser.id)}
          setHoverCursor={setHoverCursor}
        />
      )}
    </Group>
  )
}

// Renders every riser whose floorIds contains `floorId`. Risers are global
// (shared xy across floors) so this layer only displays the subset visible
// on the active floor.
function RiserLayer({ floorId, selectedRiserId, selectedItems = [], onRiserClick, onRiserDragMove, onRiserDragEnd, onRightMouseDown, viewportScale, onDelete, setHoverCursor, dimmed, isPlacingMode }) {
  const risers       = useCableStore((s) => s.risers)
  const updateRiser  = useCableStore((s) => s.updateRiser)
  const inverseScale = 1 / (viewportScale || 1)
  const [hoveredId, setHoveredId] = useState(null)
  const batchSelectedIds = selectedItems.length > 1
    ? new Set(selectedItems.filter((it) => it.type === 'cable_riser').map((it) => it.id))
    : null

  const handleMoved = (id, x, y) => {
    updateRiser(id, { x, y })
    onRiserDragEnd?.()
  }

  const visibleRisers = risers.filter((r) => (r.floorIds ?? []).includes(floorId))

  return (
    <Group opacity={dimmed ? 0.2 : 1}>
      {visibleRisers.map((r) => {
        const isSel = r.id === selectedRiserId || (batchSelectedIds?.has(r.id) ?? false)
        const isHov = r.id === hoveredId
        return (
          <RiserMarker
            key={r.id}
            riser={r}
            isSelected={isSel}
            isHovered={isHov}
            onHover={setHoveredId}
            isDraggable
            onClick={onRiserClick}
            onMoved={handleMoved}
            onDragMove={onRiserDragMove}
            onRightMouseDown={onRightMouseDown}
            inverseScale={inverseScale}
            onDelete={onDelete}
            setHoverCursor={setHoverCursor}
            showMagnet={isPlacingMode || isSel || isHov}
            floorCount={(r.floorIds ?? []).length}
          />
        )
      })}
    </Group>
  )
}

export default RiserLayer

import React, { useState } from 'react'
import { Group, Circle, Rect, Line, Text } from 'react-konva'
import { useCableStore } from '@/store/useCableStore'

// Riser icon = small square (cross-section view) with an arrow indicating the
// vertical shaft passes up + down through floors. Distinct enough from APs
// (frequency rings) and switches (chassis rectangles) at a glance.
const RISER_COLOR    = '#a78bfa'  // violet-400
const RISER_SELECTED = '#e74c3c'
const MAGNET_FILL    = 'rgba(167, 139, 250, 0.14)'
const MAGNET_STROKE  = 'rgba(167, 139, 250, 0.5)'

function RiserMarker({ riser, isSelected, isHovered, onHover, isDraggable, allowHover, allowCmdHover, allowAnyHover, allowClick, allowContextMenu, onClick, onContextMenu, onMoved, onDragMove, inverseScale, setHoverCursor, showMagnet, floorCount }) {
  const s = inverseScale
  const strokeColor = isSelected ? RISER_SELECTED : RISER_COLOR
  const size = 18 * s
  const magnetPx = riser.magnetDistance ?? 100

  return (
    <Group
      x={riser.x}
      y={riser.y}
      draggable={isDraggable}
      onMouseEnter={() => {
        if (isDraggable) setHoverCursor?.('grab')
        if (allowAnyHover) onHover(riser.id)
      }}
      onMouseLeave={() => { setHoverCursor?.(null); onHover(null) }}
      onClick={(e) => {
        if (e.evt.button !== 0) return
        if (!allowClick) return
        e.cancelBubble = true
        onClick?.(riser.id, e)
      }}
      onContextMenu={(e) => {
        if (!allowContextMenu) return
        e.evt.preventDefault?.()
        e.cancelBubble = true
        onContextMenu?.(riser.id, e)
      }}
      onDragStart={(e) => { e.cancelBubble = true; onClick?.(riser.id, e) }}
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
      {/* 23-3f isHovered alone isn't enough — thicker stroke implies select
          affordance, so only apply it under strong hover (allowHover). Weak
          hover gets a faint outer ring instead (below). */}
      <Rect
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        cornerRadius={2 * s}
        fill="#1f2937"
        stroke={strokeColor}
        strokeWidth={(isSelected ? 2.5 : (isHovered && allowHover) ? 2 : 1.5) * s}
      />
      {/* 23-3f Weak hover ring — appears in non-SELECT modes only */}
      {isHovered && !isSelected && !allowHover && allowCmdHover && (
        <Rect
          x={-size / 2 - 2 * s}
          y={-size / 2 - 2 * s}
          width={size + 4 * s}
          height={size + 4 * s}
          cornerRadius={3 * s}
          stroke="#fff"
          strokeWidth={1.2 * s}
          opacity={0.35}
          listening={false}
        />
      )}
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
    </Group>
  )
}

// Renders every riser whose floorIds contains `floorId`. Risers are global
// (shared xy across floors) so this layer only displays the subset visible
// on the active floor.
function RiserLayer({ floorId, selectedRiserId, selectedItems = [], onRiserClick, onRiserContextMenu, onRiserDragMove, onRiserDragEnd, viewportScale, setHoverCursor, dimmed, capability }) {
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

  const allowDrag        = !!capability?.allowDragExisting?.cable
  const allowClick       = !!capability?.allowSelectClick?.cable
  const allowHover       = !!capability?.allowSelectHover?.cable
  const allowCmdHover    = !!capability?.allowCommandHover?.cable
  const allowAnyHover    = allowHover || allowCmdHover
  const allowContextMenu = !!capability?.allowContextMenu
  const magnetPolicy     = capability?.showMagnet?.riser ?? 'never'

  return (
    <Group opacity={dimmed ? 0.2 : 1}>
      {visibleRisers.map((r) => {
        const isSel = r.id === selectedRiserId || (batchSelectedIds?.has(r.id) ?? false)
        const isHov = r.id === hoveredId
        const showMagnet =
          magnetPolicy === 'all' ? true :
          magnetPolicy === 'selectedOnly' ? (isSel || isHov) :
          false
        return (
          <RiserMarker
            key={r.id}
            riser={r}
            isSelected={isSel}
            isHovered={isHov}
            onHover={setHoveredId}
            isDraggable={allowDrag}
            allowHover={allowHover}
            allowCmdHover={allowCmdHover}
            allowAnyHover={allowAnyHover}
            allowClick={allowClick}
            allowContextMenu={allowContextMenu}
            onClick={onRiserClick}
            onContextMenu={onRiserContextMenu}
            onMoved={handleMoved}
            onDragMove={onRiserDragMove}
            inverseScale={inverseScale}
            setHoverCursor={setHoverCursor}
            showMagnet={showMagnet}
            floorCount={(r.floorIds ?? []).length}
          />
        )
      })}
    </Group>
  )
}

export default RiserLayer

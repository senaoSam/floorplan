import React, { useState } from 'react'
import { Group, Line, Circle } from 'react-konva'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import DeleteButton from './DeleteButton'

const HOLE_FILL   = 'rgba(124, 58, 237, 0.20)'
const HOLE_STROKE = '#7c3aed'

// 繪製中的 ghost 預覽
function DrawingPreview({ points, mousePos, snapRadius }) {
  if (points.length === 0) return null

  const flatPoints = points.flatMap((p) => [p.x, p.y])
  const first = points[0]

  const canSnap = points.length >= 3
  const isSnapping =
    canSnap &&
    mousePos &&
    Math.hypot(mousePos.x - first.x, mousePos.y - first.y) < snapRadius

  return (
    <>
      {/* 已確認線段 — 黑色外框 */}
      {points.length >= 2 && (
        <Line
          points={flatPoints}
          stroke="#000"
          strokeWidth={5}
          dash={[6, 4]}
          opacity={0.5}
          listening={false}
        />
      )}
      {/* 已確認線段 */}
      {points.length >= 2 && (
        <Line
          points={flatPoints}
          stroke="#a855f7"
          strokeWidth={3}
          dash={[6, 4]}
          listening={false}
        />
      )}

      {/* ghost 線：最後一點 → 滑鼠 — 黑色外框 */}
      {mousePos && (
        <Line
          points={[
            points[points.length - 1].x,
            points[points.length - 1].y,
            mousePos.x,
            mousePos.y,
          ]}
          stroke="#000"
          strokeWidth={5}
          dash={[6, 4]}
          opacity={0.4}
          listening={false}
        />
      )}
      {/* ghost 線 */}
      {mousePos && (
        <Line
          points={[
            points[points.length - 1].x,
            points[points.length - 1].y,
            mousePos.x,
            mousePos.y,
          ]}
          stroke="#a855f7"
          strokeWidth={3}
          dash={[6, 4]}
          opacity={0.7}
          listening={false}
        />
      )}

      {/* 頂點圓點 */}
      {points.map((p, i) => (
        <React.Fragment key={i}>
          <Circle x={p.x} y={p.y} radius={7} fill="#000" opacity={0.4} listening={false} />
          <Circle x={p.x} y={p.y} radius={5} fill="#a855f7" listening={false} />
        </React.Fragment>
      ))}

      {/* 第一點吸附提示 */}
      {isSnapping && (
        <Circle
          x={first.x}
          y={first.y}
          radius={snapRadius}
          stroke="#7c3aed"
          strokeWidth={2}
          fill="rgba(124,58,237,0.25)"
          listening={false}
        />
      )}
    </>
  )
}

function FloorHoleLayer({
  floorId,
  drawingPoints,
  mousePos,
  snapRadius,
  selectedHoleId,
  selectedItems = [],
  onHoleClick,
  dimmed,
  isSelectMode,
  isDrawingActive,
  onRightMouseDown,
  onDelete,
  viewportScale,
  setHoverCursor,
}) {
  const holes           = useFloorHoleStore((s) => s.floorHolesByFloor[floorId] ?? [])
  const updateFloorHole = useFloorHoleStore((s) => s.updateFloorHole)
  const [hoveredId, setHoveredId] = useState(null)
  const batchSelectedIds = selectedItems.length > 1 ? new Set(selectedItems.filter((it) => it.type === 'floor_hole').map((it) => it.id)) : null

  return (
    <Group opacity={dimmed ? 0.2 : 1}>
      {/* 已完成的 Floor Hole 多邊形 */}
      {holes.map((hole) => {
        const isSelected = hole.id === selectedHoleId || (batchSelectedIds?.has(hole.id) ?? false)
        const isHovered  = hole.id === hoveredId
        return (
          <Group
            key={hole.id}
            draggable
            onMouseEnter={() => { setHoverCursor?.('move'); setHoveredId(hole.id) }}
            onMouseLeave={() => { setHoverCursor?.(null); setHoveredId(null) }}
            onMouseDown={(e) => {
              if (e.evt.button === 2) {
                e.cancelBubble = true
                onRightMouseDown?.(e.currentTarget)
              }
            }}
            onDragStart={(e) => {
              e.cancelBubble = true
              onHoleClick?.(hole.id, e)
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true
              const dx = e.target.x()
              const dy = e.target.y()
              e.target.position({ x: 0, y: 0 })
              const newPoints = []
              for (let i = 0; i < hole.points.length; i += 2) {
                newPoints.push(hole.points[i] + dx, hole.points[i + 1] + dy)
              }
              updateFloorHole(floorId, hole.id, { points: newPoints })
            }}
          >
            <Line
              points={hole.points}
              closed
              fill={isHovered && !isSelected ? 'rgba(124, 58, 237, 0.35)' : HOLE_FILL}
              stroke={isSelected ? '#e74c3c' : isHovered ? '#fff' : HOLE_STROKE}
              strokeWidth={isSelected ? 4 : isHovered ? 4 : 3}
              dash={[10, 4]}
              shadowColor={isHovered ? '#fff' : 'rgba(0,0,0,0.6)'}
              shadowBlur={isHovered ? 8 : 4}
              shadowOffset={{ x: 0, y: 0 }}
              hitStrokeWidth={10}
              onClick={(e) => {
                e.cancelBubble = true
                onHoleClick?.(hole.id, e)
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault()
                e.cancelBubble = true
                onHoleClick?.(hole.id, e)
              }}
            />
            {/* 快速刪除按鈕 */}
            {isHovered && onDelete && (() => {
              let cx = 0, cy = 0
              const n = hole.points.length / 2
              for (let i = 0; i < hole.points.length; i += 2) {
                cx += hole.points[i]; cy += hole.points[i + 1]
              }
              cx /= n; cy /= n
              return (
                <DeleteButton
                  x={cx}
                  y={cy}
                  scale={1 / (viewportScale || 1)}
                  onClick={() => onDelete(hole.id)}
                  setHoverCursor={setHoverCursor}
                />
              )
            })()}
          </Group>
        )
      })}

      {/* 繪製中預覽 */}
      <DrawingPreview points={drawingPoints} mousePos={mousePos} snapRadius={snapRadius} />
    </Group>
  )
}

export default FloorHoleLayer

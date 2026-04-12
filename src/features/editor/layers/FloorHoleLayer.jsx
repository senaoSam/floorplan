import React from 'react'
import { Group, Line, Circle } from 'react-konva'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'

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
      {/* 已確認線段 */}
      {points.length >= 2 && (
        <Line
          points={flatPoints}
          stroke="#f1c40f"
          strokeWidth={2}
          dash={[6, 4]}
          listening={false}
        />
      )}

      {/* ghost 線：最後一點 → 滑鼠 */}
      {mousePos && (
        <Line
          points={[
            points[points.length - 1].x,
            points[points.length - 1].y,
            mousePos.x,
            mousePos.y,
          ]}
          stroke="#f1c40f"
          strokeWidth={2}
          dash={[6, 4]}
          opacity={0.6}
          listening={false}
        />
      )}

      {/* 頂點圓點 */}
      {points.map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={4} fill="#f1c40f" listening={false} />
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
  onHoleClick,
}) {
  const holes = useFloorHoleStore((s) => s.floorHolesByFloor[floorId] ?? [])

  return (
    <Group>
      {/* 已完成的 Floor Hole 多邊形 */}
      {holes.map((hole) => {
        const isSelected = hole.id === selectedHoleId
        return (
          <Line
            key={hole.id}
            points={hole.points}
            closed
            fill={HOLE_FILL}
            stroke={isSelected ? '#e74c3c' : HOLE_STROKE}
            strokeWidth={isSelected ? 3 : 2}
            dash={[10, 4]}
            hitStrokeWidth={10}
            onClick={(e) => {
              e.cancelBubble = true
              onHoleClick?.(hole.id)
            }}
          />
        )
      })}

      {/* 繪製中預覽 */}
      <DrawingPreview points={drawingPoints} mousePos={mousePos} snapRadius={snapRadius} />
    </Group>
  )
}

export default FloorHoleLayer

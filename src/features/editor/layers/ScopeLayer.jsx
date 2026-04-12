import React from 'react'
import { Group, Line, Circle } from 'react-konva'
import { useScopeStore } from '@/store/useScopeStore'

const ZONE_STYLE = {
  in:  { fill: 'rgba(46, 213, 115, 0.15)', stroke: '#2ed573' },
  out: { fill: 'rgba(255, 71,  87,  0.15)', stroke: '#ff4757' },
}

// 繪製中的 ghost 預覽
function DrawingPreview({ points, mousePos, snapRadius }) {
  if (points.length === 0) return null

  const flatClosed = points.flatMap((p) => [p.x, p.y])
  const first = points[0]

  // 判斷是否進入第一點吸附範圍
  const canSnap = points.length >= 3
  const isSnapping = canSnap && mousePos &&
    Math.hypot(mousePos.x - first.x, mousePos.y - first.y) < snapRadius

  return (
    <>
      {/* 已確認的線段 */}
      {points.length >= 2 && (
        <Line
          points={flatClosed}
          stroke="#f1c40f"
          strokeWidth={2}
          dash={[6, 4]}
          listening={false}
        />
      )}

      {/* ghost 線：最後一點 → 滑鼠 */}
      {mousePos && (
        <Line
          points={[points[points.length - 1].x, points[points.length - 1].y, mousePos.x, mousePos.y]}
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

      {/* 第一點吸附提示：進入範圍才顯示綠色放大圓 */}
      {isSnapping && (
        <Circle
          x={first.x} y={first.y}
          radius={snapRadius}
          stroke="#2ed573"
          strokeWidth={2}
          fill="rgba(46,213,115,0.25)"
          listening={false}
        />
      )}
    </>
  )
}

function ScopeLayer({ floorId, drawingPoints, mousePos, snapRadius, selectedScopeId, onScopeClick }) {
  const zones = useScopeStore((s) => s.scopesByFloor[floorId] ?? [])

  return (
    <Group>
      {/* 已完成的區域 */}
      {zones.map((zone) => {
        const style = ZONE_STYLE[zone.type] ?? ZONE_STYLE.in
        const isSelected = zone.id === selectedScopeId
        return (
          <Line
            key={zone.id}
            points={zone.points}
            closed
            fill={style.fill}
            stroke={isSelected ? '#e74c3c' : style.stroke}
            strokeWidth={isSelected ? 3 : 2}
            dash={zone.type === 'out' ? [8, 4] : undefined}
            hitStrokeWidth={10}
            onClick={(e) => { e.cancelBubble = true; onScopeClick?.(zone.id) }}
          />
        )
      })}

      {/* 繪製中預覽 */}
      <DrawingPreview points={drawingPoints} mousePos={mousePos} snapRadius={snapRadius} />
    </Group>
  )
}

export default ScopeLayer

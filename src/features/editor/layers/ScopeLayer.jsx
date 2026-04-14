import React, { useState } from 'react'
import { Group, Line, Circle } from 'react-konva'
import { useScopeStore } from '@/store/useScopeStore'

const ZONE_STYLE = {
  in:  { fill: 'rgba(46, 213, 115, 0.18)', stroke: '#2ed573' },
  out: { fill: 'rgba(255, 71,  87,  0.18)', stroke: '#ff4757' },
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
      {/* 已確認的線段 — 黑色外框 */}
      {points.length >= 2 && (
        <Line
          points={flatClosed}
          stroke="#000"
          strokeWidth={5}
          dash={[6, 4]}
          opacity={0.5}
          listening={false}
        />
      )}
      {/* 已確認的線段 */}
      {points.length >= 2 && (
        <Line
          points={flatClosed}
          stroke="#2ed573"
          strokeWidth={3}
          dash={[6, 4]}
          listening={false}
        />
      )}

      {/* ghost 線：最後一點 → 滑鼠 — 黑色外框 */}
      {mousePos && (
        <Line
          points={[points[points.length - 1].x, points[points.length - 1].y, mousePos.x, mousePos.y]}
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
          points={[points[points.length - 1].x, points[points.length - 1].y, mousePos.x, mousePos.y]}
          stroke="#2ed573"
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
          <Circle x={p.x} y={p.y} radius={5} fill="#2ed573" listening={false} />
        </React.Fragment>
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

function ScopeLayer({ floorId, drawingPoints, mousePos, snapRadius, selectedScopeId, onScopeClick, isSelectMode, isDrawingActive, onScopeDragMove, onScopeDragEnd, onRightMouseDown }) {
  const zones       = useScopeStore((s) => s.scopesByFloor[floorId] ?? [])
  const updateScope = useScopeStore((s) => s.updateScope)
  const [hoveredId, setHoveredId] = useState(null)

  return (
    <Group>
      {/* 已完成的區域 */}
      {zones.map((zone) => {
        const style = ZONE_STYLE[zone.type] ?? ZONE_STYLE.in
        const isSelected = zone.id === selectedScopeId
        const isHovered  = zone.id === hoveredId
        return (
          <Group
            key={zone.id}
            draggable
            onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'move'; setHoveredId(zone.id) }}
            onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; setHoveredId(null) }}
            onMouseDown={(e) => {
              if (e.evt.button === 2) {
                e.cancelBubble = true
                onRightMouseDown?.(e.currentTarget)
              }
            }}
            onDragStart={(e) => {
              e.cancelBubble = true
              onScopeClick?.(zone.id)
            }}
            onDragMove={(e) => {
              e.cancelBubble = true
              onScopeDragMove?.(zone.id, e.target.x(), e.target.y())
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true
              const dx = e.target.x()
              const dy = e.target.y()
              e.target.position({ x: 0, y: 0 })
              onScopeDragEnd?.()
              const newPoints = []
              for (let i = 0; i < zone.points.length; i += 2) {
                newPoints.push(zone.points[i] + dx, zone.points[i + 1] + dy)
              }
              updateScope(floorId, zone.id, { points: newPoints })
            }}
          >
            <Line
              points={zone.points}
              closed
              fill={isHovered && !isSelected ? style.fill.replace('0.18', '0.35') : style.fill}
              stroke={isSelected ? '#e74c3c' : isHovered ? '#fff' : style.stroke}
              strokeWidth={isSelected ? 5 : isHovered ? 4 : 3}
              dash={zone.type === 'out' ? [8, 4] : undefined}
              shadowColor={isHovered ? '#fff' : 'rgba(0,0,0,0.6)'}
              shadowBlur={isHovered ? 8 : 4}
              shadowOffset={{ x: 0, y: 0 }}
              hitStrokeWidth={10}
              onClick={(e) => {
                e.cancelBubble = true
                onScopeClick?.(zone.id)
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault()
                e.cancelBubble = true
                onScopeClick?.(zone.id)
              }}
            />
          </Group>
        )
      })}

      {/* 繪製中預覽 */}
      <DrawingPreview points={drawingPoints} mousePos={mousePos} snapRadius={snapRadius} />
    </Group>
  )
}

export default ScopeLayer

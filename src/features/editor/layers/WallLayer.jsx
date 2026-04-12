import React from 'react'
import { Group, Line, Circle } from 'react-konva'
import { useWallStore } from '@/store/useWallStore'

function WallLayer({ floorId, drawStart, mousePos, selectedWallId, onWallClick, onWallDragMove, onWallDragEnd, isDrawMode, isDrawingActive, snapRadius, onRightMouseDown }) {
  const walls      = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
  const updateWall = useWallStore((s) => s.updateWall)

  // 找出游標正在吸附的端點（draw 模式下才需要）
  let snapEndpoint = null
  if (isDrawMode && mousePos && snapRadius) {
    for (const w of walls) {
      for (const ep of [{ x: w.startX, y: w.startY }, { x: w.endX, y: w.endY }]) {
        if (Math.hypot(mousePos.x - ep.x, mousePos.y - ep.y) < snapRadius) {
          snapEndpoint = ep
          break
        }
      }
      if (snapEndpoint) break
    }
  }

  return (
    <Group>
      {/* 已完成的牆體 */}
      {walls.map((wall) => {
        const isSelected = wall.id === selectedWallId
        return (
          <Group
            key={wall.id}
            draggable
            onMouseDown={(e) => {
              if (e.evt.button === 2) {
                e.cancelBubble = true
                onRightMouseDown?.(e.currentTarget)
              }
            }}
            onDragStart={(e) => {
              e.cancelBubble = true
              onWallClick?.(wall.id)
            }}
            onDragMove={(e) => {
              e.cancelBubble = true
              onWallDragMove?.(wall.id, e.target.x(), e.target.y())
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true
              const dx = e.target.x()
              const dy = e.target.y()
              updateWall(floorId, wall.id, {
                startX: wall.startX + dx,
                startY: wall.startY + dy,
                endX:   wall.endX   + dx,
                endY:   wall.endY   + dy,
              })
              e.target.position({ x: 0, y: 0 })
              onWallDragEnd?.()
            }}
          >
            <Line
              points={[wall.startX, wall.startY, wall.endX, wall.endY]}
              stroke={isSelected ? '#e74c3c' : wall.material.color}
              strokeWidth={isSelected ? 5 : 3}
              lineCap="round"
              hitStrokeWidth={12}
              onClick={(e) => {
                if (isDrawMode) return
                e.cancelBubble = true
                onWallClick?.(wall.id)
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault()
                if (isDrawingActive) return
                e.cancelBubble = true
                onWallClick?.(wall.id)
              }}
            />
          </Group>
        )
      })}

      {/* 繪製中的 ghost 線 */}
      {drawStart && mousePos && (
        <>
          <Line
            points={[drawStart.x, drawStart.y, mousePos.x, mousePos.y]}
            stroke="#000"
            strokeWidth={4}
            dash={[8, 5]}
            opacity={0.5}
            listening={false}
          />
          <Line
            points={[drawStart.x, drawStart.y, mousePos.x, mousePos.y]}
            stroke="#00e5ff"
            strokeWidth={2}
            dash={[8, 5]}
            listening={false}
          />
        </>
      )}

      {/* 繪製中的起點 */}
      {drawStart && (
        <>
          <Circle x={drawStart.x} y={drawStart.y} radius={7} fill="#000" opacity={0.4} listening={false} />
          <Circle x={drawStart.x} y={drawStart.y} radius={5} fill="#00e5ff" listening={false} />
        </>
      )}

      {/* 端點吸附高亮 */}
      {snapEndpoint && (
        <>
          <Circle x={snapEndpoint.x} y={snapEndpoint.y} radius={9} fill="#000" opacity={0.4} listening={false} />
          <Circle x={snapEndpoint.x} y={snapEndpoint.y} radius={7} stroke="#00e5ff" strokeWidth={2} fill="rgba(0,229,255,0.25)" listening={false} />
        </>
      )}
    </Group>
  )
}

export default WallLayer

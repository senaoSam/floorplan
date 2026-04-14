import React, { useState } from 'react'
import { Group, Line, Circle } from 'react-konva'
import { useWallStore } from '@/store/useWallStore'
import DeleteButton from './DeleteButton'

// 端點吸附（排除自身牆體）
function snapToEndpoint(pos, walls, snapDist, excludeWallId) {
  for (const w of walls) {
    if (w.id === excludeWallId) continue
    for (const ep of [{ x: w.startX, y: w.startY }, { x: w.endX, y: w.endY }]) {
      if (Math.hypot(pos.x - ep.x, pos.y - ep.y) < snapDist) return ep
    }
  }
  return pos
}

function EndpointHandle({ x, y, which, wallId, walls, floorId, snapRadius, inverseScale, updateWall, onWallDragMove, onWallDragEnd, onExtendFromEndpoint, setHoverCursor }) {
  const [dragPos, setDragPos] = useState(null)
  const displayX = dragPos ? dragPos.x : x
  const displayY = dragPos ? dragPos.y : y

  return (
    <Circle
      x={displayX}
      y={displayY}
      radius={7 * inverseScale}
      fill="#fff"
      stroke="#e74c3c"
      strokeWidth={2.5 * inverseScale}
      draggable
      onMouseEnter={() => { setHoverCursor?.('crosshair') }}
      onMouseLeave={() => { setHoverCursor?.('move') }}
      onDragStart={(e) => {
        e.cancelBubble = true
      }}
      onDragMove={(e) => {
        e.cancelBubble = true
        const raw = { x: e.target.x(), y: e.target.y() }
        const snapped = snapToEndpoint(raw, walls, snapRadius, wallId)
        e.target.position(snapped)
        setDragPos(snapped)
        const patch = which === 'start'
          ? { startX: snapped.x, startY: snapped.y }
          : { endX: snapped.x, endY: snapped.y }
        updateWall(floorId, wallId, patch)
        onWallDragMove?.(wallId, 0, 0)
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true
        setDragPos(null)
        onWallDragEnd?.()
      }}
      onDblClick={(e) => {
        e.cancelBubble = true
        onExtendFromEndpoint?.({ x, y })
      }}
    />
  )
}

function WallLayer({ floorId, drawStart, mousePos, selectedWallId, onWallClick, onWallDragMove, onWallDragEnd, isDrawMode, isDrawingActive, snapRadius, onRightMouseDown, onDelete, viewportScale, setHoverCursor, onExtendFromEndpoint }) {
  const walls      = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
  const updateWall = useWallStore((s) => s.updateWall)
  const [hoveredId, setHoveredId] = useState(null)
  const inverseScale = 1 / (viewportScale || 1)

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
        const isHovered  = wall.id === hoveredId
        return (
          <Group
            key={wall.id}
            draggable
            onMouseEnter={() => { setHoverCursor?.('move'); setHoveredId(wall.id) }}
            onMouseLeave={() => { setHoverCursor?.(null); setHoveredId(null) }}
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
            {/* hover 發光 */}
            {isHovered && !isSelected && (
              <Line
                points={[wall.startX, wall.startY, wall.endX, wall.endY]}
                stroke="#fff"
                strokeWidth={18}
                lineCap="round"
                opacity={0.3}
                listening={false}
              />
            )}
            {/* 黑色外框增加對比 */}
            <Line
              points={[wall.startX, wall.startY, wall.endX, wall.endY]}
              stroke="#000"
              strokeWidth={isHovered ? 14 : isSelected ? 10 : 7}
              lineCap="round"
              opacity={0.4}
              listening={false}
            />
            <Line
              points={[wall.startX, wall.startY, wall.endX, wall.endY]}
              stroke={isSelected ? '#e74c3c' : isHovered ? '#fff' : wall.material.color}
              strokeWidth={isHovered ? 8 : isSelected ? 6 : 4}
              lineCap="round"
              hitStrokeWidth={14}
              onClick={(e) => {
                e.cancelBubble = true
                onWallClick?.(wall.id)
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault()
                e.cancelBubble = true
                onWallClick?.(wall.id)
              }}
            />
            {/* 快速刪除按鈕 */}
            {isHovered && onDelete && (
              <DeleteButton
                x={(wall.startX + wall.endX) / 2}
                y={(wall.startY + wall.endY) / 2 - 18 * inverseScale}
                scale={inverseScale}
                onClick={() => onDelete(wall.id)}
                setHoverCursor={setHoverCursor}
              />
            )}
            {/* 端點拖曳把手 */}
            {(isSelected || isHovered) && ['start', 'end'].map((which) => {
              const ex = which === 'start' ? wall.startX : wall.endX
              const ey = which === 'start' ? wall.startY : wall.endY
              return (
                <EndpointHandle
                  key={which}
                  x={ex}
                  y={ey}
                  which={which}
                  wallId={wall.id}
                  walls={walls}
                  floorId={floorId}
                  snapRadius={snapRadius}
                  inverseScale={inverseScale}
                  updateWall={updateWall}
                  onWallDragMove={onWallDragMove}
                  onWallDragEnd={onWallDragEnd}
                  onExtendFromEndpoint={onExtendFromEndpoint}
                  setHoverCursor={setHoverCursor}
                />
              )
            })}
          </Group>
        )
      })}

      {/* 繪製中的 ghost 線 */}
      {drawStart && mousePos && (
        <>
          <Line
            points={[drawStart.x, drawStart.y, mousePos.x, mousePos.y]}
            stroke="#000"
            strokeWidth={6}
            dash={[8, 5]}
            opacity={0.5}
            listening={false}
          />
          <Line
            points={[drawStart.x, drawStart.y, mousePos.x, mousePos.y]}
            stroke="#00e5ff"
            strokeWidth={3}
            dash={[8, 5]}
            listening={false}
          />
        </>
      )}

      {/* 繪製中的起點 */}
      {drawStart && (
        <>
          <Circle x={drawStart.x} y={drawStart.y} radius={9} fill="#000" opacity={0.4} listening={false} />
          <Circle x={drawStart.x} y={drawStart.y} radius={6} fill="#00e5ff" listening={false} />
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

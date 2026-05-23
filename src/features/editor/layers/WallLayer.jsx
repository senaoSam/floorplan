import React, { useState } from 'react'
import { Group, Line, Circle, Rect } from 'react-konva'
import { useWallStore } from '@/store/useWallStore'
import { OPENING_TYPES } from '@/constants/materials'

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

function WallLayer({ floorId, drawStart, mousePos, selectedWallId, selectedItems = [], onWallClick, onWallContextMenu, onWallDragMove, onWallDragEnd, isDrawMode, isDrawingActive, isTrayMode, snapRadius, viewportScale, setHoverCursor, onExtendFromEndpoint, isDoorWindowMode, dwWallId, dwStartFrac, dwOpeningType, capability }) {
  // Capability flags (23-2b). Layer never reads `editorMode` directly.
  const allowDrag      = !!capability?.allowDragExisting?.struct
  const allowHover     = !!capability?.allowSelectHover?.struct
  // 23-3f weak hover: signals "right-click here will open command menu" without
  // promising selectability. Strictly weaker than allowSelectHover — different
  // visual treatment (faint outline only, no move cursor).
  const allowCmdHover  = !!capability?.allowCommandHover?.struct
  const allowAnyHover  = allowHover || allowCmdHover
  const allowClick     = !!capability?.allowSelectClick?.struct
  const showHandles    = !!capability?.showHandles?.struct
  // DOOR_WINDOW is a special read-only-hover case: hover/click are on for wall
  // (to pick host), but drag must stay off — capability flags already encode
  // that (allowDragExisting.struct === false in DOOR_WINDOW), so allowDrag is
  // correctly false there.
  const walls      = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
  const updateWall = useWallStore((s) => s.updateWall)
  const [hoveredId, setHoveredId] = useState(null)
  const inverseScale = 1 / (viewportScale || 1)
  const batchSelectedIds = selectedItems.length > 1 ? new Set(selectedItems.filter((it) => it.type === 'wall').map((it) => it.id)) : null

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
        const isSelected = wall.id === selectedWallId || (batchSelectedIds?.has(wall.id) ?? false)
        const isHovered  = wall.id === hoveredId
        return (
          <Group
            key={wall.id}
            draggable={allowDrag}
            onMouseEnter={() => {
              // Cursor cue only when left-click would actually do something
              // (select / drag). Weak-hover modes keep their mode cursor.
              if (allowDrag) setHoverCursor?.('move')
              if (allowAnyHover) setHoveredId(wall.id)
            }}
            onMouseLeave={() => { setHoverCursor?.(null); setHoveredId(null) }}
            onDragStart={(e) => {
              e.cancelBubble = true
              onWallClick?.(wall.id, e)
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
            {/* hover 發光（門窗模式下用不同顏色提示） */}
            {/* 23-3f Strong hover (SELECT-like) = thick white glow. Weak
                hover (allowCmdHover only) = thin faint outline that just
                says "you're aimed at this object" without screaming
                "I'm selectable". */}
            {isHovered && !isSelected && !isDoorWindowMode && allowHover && (
              <Line
                points={[wall.startX, wall.startY, wall.endX, wall.endY]}
                stroke="#fff"
                strokeWidth={18}
                lineCap="round"
                opacity={0.3}
                listening={false}
              />
            )}
            {isHovered && !isSelected && !isDoorWindowMode && !allowHover && allowCmdHover && (
              <Line
                points={[wall.startX, wall.startY, wall.endX, wall.endY]}
                stroke="#fff"
                strokeWidth={8}
                lineCap="round"
                opacity={0.15}
                listening={false}
              />
            )}
            {isHovered && isDoorWindowMode && (
              <Line
                points={[wall.startX, wall.startY, wall.endX, wall.endY]}
                stroke={dwOpeningType === 'window' ? '#5DADE2' : '#8B5E3C'}
                strokeWidth={16}
                lineCap="round"
                opacity={0.25}
                listening={false}
              />
            )}
            {/* 黑色外框增加對比 */}
            <Line
              points={[wall.startX, wall.startY, wall.endX, wall.endY]}
              stroke="#000"
              strokeWidth={isHovered ? 10 : isSelected ? 7 : 4}
              lineCap="round"
              opacity={0.4}
              listening={false}
            />
            <Line
              points={[wall.startX, wall.startY, wall.endX, wall.endY]}
              stroke={isHovered ? '#fff' : wall.material.color}
              strokeWidth={isHovered ? 6 : isSelected ? 5 : 3}
              lineCap="round"
              hitStrokeWidth={14}
              onClick={(e) => {
                if (e.evt.button !== 0) return
                // DOOR_WINDOW + tray drawing mode want the click to bubble to
                // Stage so the mode handler can decide. Other modes that don't
                // allow click on walls just no-op.
                if (isDoorWindowMode || isTrayMode) return
                if (!allowClick) return
                e.cancelBubble = true
                onWallClick?.(wall.id, e)
              }}
              onContextMenu={(e) => {
                if (!capability?.allowContextMenu) return
                e.evt.preventDefault?.()
                e.cancelBubble = true
                onWallContextMenu?.(wall.id, e)
              }}
            />
            {/* 門窗 opening 段 */}
            {(wall.openings ?? []).map((op) => {
              const dx = wall.endX - wall.startX
              const dy = wall.endY - wall.startY
              const sx = wall.startX + op.startFrac * dx
              const sy = wall.startY + op.startFrac * dy
              const ex = wall.startX + op.endFrac * dx
              const ey = wall.startY + op.endFrac * dy
              const ot = OPENING_TYPES[op.type === 'window' ? 'WINDOW' : 'DOOR']
              return (
                <Line
                  key={op.id}
                  points={[sx, sy, ex, ey]}
                  stroke={ot.color}
                  strokeWidth={isSelected ? 6 : isHovered ? 8 : 6}
                  lineCap="butt"
                  listening={false}
                />
              )
            })}
            {/* 端點拖曳把手 — 只在 SELECT mode（showHandles=true）顯示 */}
            {showHandles && (isSelected || isHovered) && ['start', 'end'].map((which) => {
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

      {/* 門窗繪製中 ghost 預覽 */}
      {isDoorWindowMode && dwWallId && dwStartFrac != null && mousePos && (() => {
        const wall = walls.find((w) => w.id === dwWallId)
        if (!wall) return null
        const dx = wall.endX - wall.startX
        const dy = wall.endY - wall.startY
        const lenSq = dx * dx + dy * dy
        if (lenSq < 1e-6) return null
        const t = Math.max(0, Math.min(1, ((mousePos.x - wall.startX) * dx + (mousePos.y - wall.startY) * dy) / lenSq))
        const f1 = Math.min(dwStartFrac, t)
        const f2 = Math.max(dwStartFrac, t)
        const sx = wall.startX + f1 * dx, sy = wall.startY + f1 * dy
        const ex = wall.startX + f2 * dx, ey = wall.startY + f2 * dy
        const color = dwOpeningType === 'window' ? '#5DADE2' : '#8B5E3C'
        // 起點標記
        const startPx = wall.startX + dwStartFrac * dx
        const startPy = wall.startY + dwStartFrac * dy
        return (
          <>
            <Line points={[sx, sy, ex, ey]} stroke={color} strokeWidth={8} opacity={0.5} dash={[6, 4]} lineCap="butt" listening={false} />
            <Circle x={startPx} y={startPy} radius={6} fill={color} opacity={0.7} listening={false} />
          </>
        )
      })()}
    </Group>
  )
}

export default WallLayer

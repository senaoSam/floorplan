import React, { useState } from 'react'
import { Group, Rect, Line, Circle } from 'react-konva'

const HANDLE_SIZE = 8
const MASK_FILL = 'rgba(0,0,0,0.55)'
const BORDER_COLOR = '#00e5ff'
const HANDLE_FILL = '#fff'
const HANDLE_STROKE = '#00e5ff'

function CropHandle({ x, y, viewportScale, onDragStart, onDragMove, onDragEnd }) {
  const r = HANDLE_SIZE / viewportScale
  return (
    <Circle
      x={x}
      y={y}
      radius={r}
      fill={HANDLE_FILL}
      stroke={HANDLE_STROKE}
      strokeWidth={2 / viewportScale}
      draggable
      onMouseDown={(e) => { e.cancelBubble = true }}
      onDragStart={(e) => {
        e.cancelBubble = true
        onDragStart?.()
      }}
      onDragMove={(e) => {
        e.cancelBubble = true
        onDragMove?.(e.target.x(), e.target.y())
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true
        onDragEnd?.(e.target.x(), e.target.y())
      }}
      hitStrokeWidth={12 / viewportScale}
    />
  )
}

function CropLayer({
  floor,
  cropStart,
  mousePos,
  isCropMode,
  isFloorImageSelected,
  viewportScale,
  onCropChange,
}) {
  if (!floor) return null

  const imgW = floor.imageWidth
  const imgH = floor.imageHeight
  const rotation = floor.rotation || 0
  const cx = imgW / 2
  const cy = imgH / 2

  // Local drag state for real-time handle feedback
  const [dragRect, setDragRect] = useState(null)

  // Determine the crop rect to display
  let rect = null

  if (dragRect) {
    // During handle drag — use local state for immediate feedback
    rect = dragRect
  } else if (isCropMode && cropStart && mousePos) {
    // Drawing in progress — use cropStart + mousePos
    rect = normalizeRect(cropStart.x, cropStart.y, mousePos.x, mousePos.y)
  } else if (floor.cropX != null) {
    // Saved crop
    rect = { x: floor.cropX, y: floor.cropY, w: floor.cropWidth, h: floor.cropHeight }
  }

  if (!rect || rect.w < 2 || rect.h < 2) return null

  // 三種顯示層級
  const isDrawing = isCropMode && cropStart               // 正在畫框中
  const isAdjusting = !isDrawing && isFloorImageSelected   // 選取平面圖微調
  const showMask = isDrawing || !!dragRect                 // 遮罩只在畫框 / 拖 handle 時
  const showGuides = isDrawing || !!dragRect               // 三分線同上
  const showBorder = isDrawing || isAdjusting || !!dragRect
  const showHandles = !isDrawing && isAdjusting && floor.cropX != null && onCropChange

  // 平常工作時完全不渲染（靠 clipFunc 裁切）
  if (!showBorder && !showMask) return null

  const sw = 2 / viewportScale

  // Mask: 4 rects around the crop area (within image bounds)
  const masks = [
    { x: 0, y: 0, width: imgW, height: Math.max(0, rect.y) },
    { x: 0, y: rect.y + rect.h, width: imgW, height: Math.max(0, imgH - rect.y - rect.h) },
    { x: 0, y: rect.y, width: Math.max(0, rect.x), height: rect.h },
    { x: rect.x + rect.w, y: rect.y, width: Math.max(0, imgW - rect.x - rect.w), height: rect.h },
  ]

  // Build a handle drag handler for a given corner
  const makeHandleDrag = (corner) => {
    const getNewRect = (nx, ny) => {
      const { cropX, cropY, cropWidth, cropHeight } = floor
      let x1 = cropX, y1 = cropY, x2 = cropX + cropWidth, y2 = cropY + cropHeight
      if (corner === 'tl') { x1 = nx; y1 = ny }
      if (corner === 'tr') { x2 = nx; y1 = ny }
      if (corner === 'bl') { x1 = nx; y2 = ny }
      if (corner === 'br') { x2 = nx; y2 = ny }
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2)
      const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1)
      return { x: rx, y: ry, w: rw, h: rh }
    }
    return {
      onDragStart: () => {},
      onDragMove: (nx, ny) => {
        const r = getNewRect(nx, ny)
        if (r.w > 2 && r.h > 2) setDragRect(r)
      },
      onDragEnd: (nx, ny) => {
        const r = getNewRect(nx, ny)
        setDragRect(null)
        if (r.w > 2 && r.h > 2) {
          onCropChange({ cropX: r.x, cropY: r.y, cropWidth: r.w, cropHeight: r.h })
        }
      },
    }
  }

  return (
    <Group
      x={cx} y={cy}
      offsetX={cx} offsetY={cy}
      rotation={rotation}
      listening={showHandles}
    >
      {/* Dark mask outside crop — only while drawing / dragging handle */}
      {showMask && masks.map((m, i) => (
        <Rect key={i} {...m} fill={MASK_FILL} listening={false} />
      ))}

      {/* Border */}
      {showBorder && (
        <Rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          stroke={BORDER_COLOR}
          strokeWidth={sw}
          dash={[8 / viewportScale, 4 / viewportScale]}
          listening={false}
        />
      )}

      {/* Rule-of-thirds guide lines — only while drawing / dragging handle */}
      {showGuides && [1/3, 2/3].map((frac) => (
        <React.Fragment key={frac}>
          <Line
            points={[rect.x + rect.w * frac, rect.y, rect.x + rect.w * frac, rect.y + rect.h]}
            stroke={BORDER_COLOR}
            strokeWidth={0.5 / viewportScale}
            opacity={0.4}
            listening={false}
          />
          <Line
            points={[rect.x, rect.y + rect.h * frac, rect.x + rect.w, rect.y + rect.h * frac]}
            stroke={BORDER_COLOR}
            strokeWidth={0.5 / viewportScale}
            opacity={0.4}
            listening={false}
          />
        </React.Fragment>
      ))}

      {/* Corner handles for adjustment */}
      {showHandles && (
        <>
          {[
            { key: 'tl', hx: rect.x,          hy: rect.y },
            { key: 'tr', hx: rect.x + rect.w, hy: rect.y },
            { key: 'bl', hx: rect.x,          hy: rect.y + rect.h },
            { key: 'br', hx: rect.x + rect.w, hy: rect.y + rect.h },
          ].map(({ key, hx, hy }) => {
            const handlers = makeHandleDrag(key)
            return (
              <CropHandle
                key={key}
                x={hx}
                y={hy}
                viewportScale={viewportScale}
                onDragStart={handlers.onDragStart}
                onDragMove={handlers.onDragMove}
                onDragEnd={handlers.onDragEnd}
              />
            )
          })}
        </>
      )}
    </Group>
  )
}

function normalizeRect(x1, y1, x2, y2) {
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  return { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

export default CropLayer

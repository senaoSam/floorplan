import React, { useState, useEffect } from 'react'
import { Layer, Image as KonvaImage } from 'react-konva'

function FloorImageLayer({ floor, isSelectMode, onFloorImageClick }) {
  const [image, setImage] = useState(null)

  useEffect(() => {
    if (!floor?.imageUrl) return
    let cancelled = false
    const img = new window.Image()
    img.onload = () => { if (!cancelled) setImage(img) }
    img.src = floor.imageUrl
    return () => { cancelled = true }
  }, [floor?.imageUrl])

  if (!image) return null

  const rotation = floor.rotation || 0
  const cx = floor.imageWidth / 2
  const cy = floor.imageHeight / 2

  return (
    <Layer>
      <KonvaImage
        image={image}
        x={cx}
        y={cy}
        offsetX={cx}
        offsetY={cy}
        width={floor.imageWidth}
        height={floor.imageHeight}
        opacity={floor.opacity}
        rotation={rotation}
        onClick={(e) => {
          if (e.evt.button !== 0) return
          if (!isSelectMode) return
          e.cancelBubble = true
          onFloorImageClick?.()
        }}
      />
    </Layer>
  )
}

export default FloorImageLayer

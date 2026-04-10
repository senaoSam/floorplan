import React, { useState, useEffect } from 'react'
import { Layer, Image as KonvaImage } from 'react-konva'

function FloorImageLayer({ floor }) {
  const [image, setImage] = useState(null)

  useEffect(() => {
    if (!floor?.imageUrl) return
    const img = new window.Image()
    img.onload = () => setImage(img)
    img.src = floor.imageUrl
  }, [floor?.imageUrl])

  if (!image) return null

  return (
    <Layer>
      <KonvaImage
        image={image}
        x={0}
        y={0}
        width={floor.imageWidth}
        height={floor.imageHeight}
        opacity={floor.opacity}
      />
    </Layer>
  )
}

export default FloorImageLayer

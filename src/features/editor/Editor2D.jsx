import React, { useRef, useState, useEffect } from 'react'
import { Stage, Layer, Rect } from 'react-konva'
import './Editor2D.sass'

function Editor2D() {
  const containerRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  // 監聽容器尺寸，讓 Stage 永遠填滿父元素
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSize({ width, height })
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="editor-2d">
      {size.width > 0 && (
        <Stage width={size.width} height={size.height}>
          <Layer>
            {/* 畫布底色 */}
            <Rect
              x={0}
              y={0}
              width={size.width}
              height={size.height}
              fill="#1e1e2e"
            />
          </Layer>
        </Stage>
      )}
    </div>
  )
}

export default Editor2D

import React, { useMemo } from 'react'
import * as THREE from 'three'

// Billboarded name label — white text on a dark pill, same visual family as
// APLayer3D's label (duplicated there for historical reasons; new layers
// should use this shared one). Textures are cached per text string so
// re-renders never rebuild the canvas.

const labelTextureCache = new Map()
function getLabelTexture(text) {
  if (labelTextureCache.has(text)) return labelTextureCache.get(text)
  const pad = 18
  const fontSize = 42
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  ctx.font = `600 ${fontSize}px sans-serif`
  const textW = Math.ceil(ctx.measureText(text).width)
  canvas.width  = textW + pad * 2
  canvas.height = fontSize + pad * 2
  // Re-set font after resizing canvas (context resets).
  const ctx2 = canvas.getContext('2d')
  ctx2.font = `600 ${fontSize}px sans-serif`
  ctx2.textBaseline = 'middle'
  ctx2.textAlign = 'center'
  // Pill background
  const r = canvas.height / 2
  ctx2.fillStyle = 'rgba(15, 23, 42, 0.88)'
  ctx2.beginPath()
  ctx2.moveTo(r, 0)
  ctx2.lineTo(canvas.width - r, 0)
  ctx2.arc(canvas.width - r, r, r, -Math.PI / 2, Math.PI / 2)
  ctx2.lineTo(r, canvas.height)
  ctx2.arc(r, r, r, Math.PI / 2, -Math.PI / 2)
  ctx2.fill()
  ctx2.strokeStyle = 'rgba(255, 255, 255, 0.25)'
  ctx2.lineWidth = 2
  ctx2.stroke()
  // Text
  ctx2.fillStyle = '#f1f5f9'
  ctx2.fillText(text, canvas.width / 2, canvas.height / 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  else tex.encoding = THREE.sRGBEncoding
  tex.needsUpdate = true
  const entry = { texture: tex, aspect: canvas.width / canvas.height }
  labelTextureCache.set(text, entry)
  return entry
}

export default function Label3D({ text, position, opacity = 1, heightM = 0.5 }) {
  const { texture, aspect } = useMemo(() => getLabelTexture(text), [text])
  const widthM = heightM * aspect
  return (
    <sprite position={position} scale={[widthM, heightM, 1]}>
      <spriteMaterial
        map={texture}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
      />
    </sprite>
  )
}

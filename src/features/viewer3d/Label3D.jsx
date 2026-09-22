import React, { useMemo } from 'react'
import * as THREE from 'three'

// Billboarded name label — white text on a dark pill, same visual family as
// APLayer3D's label (duplicated there for historical reasons; new layers
// should use this shared one). Textures are cached per text string so
// re-renders never rebuild the canvas.

// 51-9: the pill used to rasterise at a flat 42px regardless of display, so
// on a HiDPI screen — or simply zoomed in — the text went soft. Render at
// SUPERSAMPLE x the layout size and let the GPU downscale, which keeps it
// crisp without changing the label's world size (the sprite is scaled from
// the LAYOUT dimensions, not the pixel ones).
//
// Capped rather than taken straight from devicePixelRatio: labels are cached
// per string for the life of the page, so a 3x-DPR display would otherwise
// hold triple-area canvases for every device name in the scene.
const SUPERSAMPLE = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2) * 1.5

// 52-C2: bounded, with disposal on eviction. The key is a user-editable
// device name, so renaming in 3D minted a new entry per keystroke ("AP-0",
// "AP-01", …) and nothing was ever disposed — each entry is a canvas plus a
// GPU texture carrying a full mipmap chain at up to 3x supersampling.
// SwitchLayer3D caches the same way but keys on a port count clamped to
// 4–48, so it tops out at 45 entries; the pattern was fine, the key wasn't.
// 256 comfortably covers every label on screen at once (a 300-AP floor plus
// switches and cameras), so eviction only ever touches stale entries.
const LABEL_CACHE_MAX = 256
const labelTextureCache = new Map()

function cacheLabel(text, entry) {
  // Map preserves insertion order, so the first key is the oldest.
  while (labelTextureCache.size >= LABEL_CACHE_MAX) {
    const oldestKey = labelTextureCache.keys().next().value
    const oldest = labelTextureCache.get(oldestKey)
    labelTextureCache.delete(oldestKey)
    oldest?.texture?.dispose()
  }
  labelTextureCache.set(text, entry)
}

// Colour variants. `plain` is the original dark pill with light text, used by
// every existing caller; `accent` inverts it to a filled blue pill with dark
// text for "this one is selected".
//
// A tinted plate behind the plain pill was the first attempt at that state and
// read as a highlight bar rather than a selected label — the pill kept its own
// dark background, so the blue only showed around the edges. Painting the pill
// itself is what makes the state unmistakable.
const VARIANTS = {
  plain:  { fill: 'rgba(15, 23, 42, 0.88)', stroke: 'rgba(255, 255, 255, 0.25)', text: '#f1f5f9' },
  accent: { fill: '#3b82f6',                stroke: 'rgba(255, 255, 255, 0.55)', text: '#0b1220' },
}

function getLabelTexture(text, variant = 'plain') {
  // The cache key carries the variant: keyed on text alone, the first render
  // of a name would pin its colours for every later use of that same name.
  const key = variant === 'plain' ? text : `${variant}::${text}`
  const hit = labelTextureCache.get(key)
  if (hit) {
    // Refresh recency: delete + re-set moves it to the end of the order, so
    // labels currently on screen aren't evicted by a burst of renames.
    labelTextureCache.delete(key)
    labelTextureCache.set(key, hit)
    return hit
  }
  const colors = VARIANTS[variant] ?? VARIANTS.plain
  const pad = 18
  const fontSize = 42
  const s = SUPERSAMPLE

  // Measure at layout scale so the pill proportions are unchanged.
  const probe = document.createElement('canvas').getContext('2d')
  probe.font = `600 ${fontSize}px sans-serif`
  const textW = Math.ceil(probe.measureText(text).width)
  const layoutW = textW + pad * 2
  const layoutH = fontSize + pad * 2

  const canvas = document.createElement('canvas')
  canvas.width  = Math.ceil(layoutW * s)
  canvas.height = Math.ceil(layoutH * s)
  const ctx = canvas.getContext('2d')
  // Draw in layout units; the transform does the upscaling.
  ctx.scale(s, s)
  ctx.font = `600 ${fontSize}px sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  // Pill background
  const r = layoutH / 2
  ctx.fillStyle = colors.fill
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(layoutW - r, 0)
  ctx.arc(layoutW - r, r, r, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(r, layoutH)
  ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2)
  ctx.fill()
  ctx.strokeStyle = colors.stroke
  ctx.lineWidth = 2
  ctx.stroke()
  // Text
  ctx.fillStyle = colors.text
  ctx.fillText(text, layoutW / 2, layoutH / 2)

  const tex = new THREE.CanvasTexture(canvas)
  // Mipmaps + anisotropy: without them a supersampled texture shimmers when
  // the label is small on screen, which is most of the time in a wide view.
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 4
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  else tex.encoding = THREE.sRGBEncoding
  tex.needsUpdate = true
  const entry = { texture: tex, aspect: layoutW / layoutH }
  cacheLabel(key, entry)
  return entry
}

// Test/diagnostic hook — never used by render code.
export function __labelCacheStats() {
  return { size: labelTextureCache.size, max: LABEL_CACHE_MAX }
}

// `interactive` opts a label out of raycasting. Sprites are hit-testable by
// default, and these draw with depthTest:false, so a label sitting in front of
// a clickable object silently eats its pointer events even when the object is
// visually on top. Callers that place their own hit target behind a label pass
// interactive={false} so the target is what the pointer actually finds.
export default function Label3D({ text, position, opacity = 1, heightM = 0.5, interactive = true, variant = 'plain' }) {
  const { texture, aspect } = useMemo(() => getLabelTexture(text, variant), [text, variant])
  const widthM = heightM * aspect
  return (
    <sprite
      position={position}
      scale={[widthM, heightM, 1]}
      raycast={interactive ? undefined : () => null}
    >
      <spriteMaterial
        map={texture}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
        // 51-3: these pills already ignore depth (they read as a HUD layer),
        // so fogging them would only wash out the text at distance.
        fog={false}
      />
    </sprite>
  )
}

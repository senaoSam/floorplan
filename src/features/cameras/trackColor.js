// Deterministic per-track colour tint — lightness-only jitter (±0.10) on the
// type's base colour, so a crowd stops reading as clones while the hue-coded
// state semantics stay intact (amber = detected person, blue = detected car,
// grey ghost = undetected, which is NOT jittered). Keyed on the track id, so
// the same target wears the same shade on every replay and in both the 2D
// tracksLayer and the 3D TrackLayer3D.

const JITTER = 0.10

// FNV-1a over the id → stable offset in [−JITTER, +JITTER].
export function lightnessJitter(id) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (((h >>> 0) % 1024) / 1024 - 0.5) * 2 * JITTER
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h, s, l }
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToHex(h, s, l) {
  let r, g, b
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

// Memoised: called per target per frame from both render layers.
//
// 53-G9: bounded, following the Label3D.jsx LRU convention. Track ids are
// minted fresh on every crowd regeneration, so the old unbounded Map grew by
// ~3000 entries per "重新產生" click and never shrank — ~150k entries after
// 20 clicks. Values are plain colour strings (nothing to dispose on eviction,
// unlike Label3D's textures); 8192 covers several floors' worth of targets on
// screen at once, so eviction only touches ids from discarded crowds.
const TINT_CACHE_MAX = 8192
const cache = new Map()
export function trackTint(baseHex, id) {
  const key = `${baseHex}|${id}`
  let out = cache.get(key)
  if (out) return out
  const { h, s, l } = hexToHsl(baseHex)
  out = hslToHex(h, s, Math.min(0.9, Math.max(0.1, l + lightnessJitter(id))))
  // Map preserves insertion order, so the first key is the oldest.
  while (cache.size >= TINT_CACHE_MAX) {
    cache.delete(cache.keys().next().value)
  }
  cache.set(key, out)
  return out
}

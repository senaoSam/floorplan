import { Texture } from 'pixi.js'

// 52-C1: shared, reference-counted cache for floor-plan textures.
//
// Both floorImageLayer and refOverlayLayer used to do this inline:
//
//   const img = new window.Image()
//   img.onload = () => resolve(Texture.from(img))
//
// which leaks. `Texture.from(img)` keys Pixi's cache on the SOURCE OBJECT, so
// a fresh `new Image()` per load always misses — every visit to a floor built
// another GPU texture for the same URL. Neither layer freed them either:
// both destroy with `{ texture: false }`. Measured cost: three 4000×3000
// floors, 30 floor switches, ~1.4 GB of VRAM never reclaimed. refOverlayLayer
// made it worse by rebuilding on every entry into ALIGN_FLOOR mode.
//
// Keying on the URL instead means revisiting a floor reuses the texture, and
// ref-counting lets the last release actually free it. Callers must pair every
// acquire() with exactly one release().
//
// Note on blob URLs: useFloorStore revokes a floor's object URL when the floor
// is deleted, and its consumers release the texture at the same time, so a
// stale entry can't outlive its URL.

const entries = new Map()   // url -> { texture, refs, promise }

// Load an image URL via HTMLImageElement rather than Assets.load(): Pixi v8's
// resolver picks a parser from the URL extension, and blob URLs (file upload /
// PDF import) have none, so `.texture` access throws.
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = (e) =>
      reject(e instanceof Error ? e : new Error(`image load failed: ${url}`))
    img.src = url
  })
}

// Acquire a texture for `url`, incrementing its refcount. Concurrent callers
// share one in-flight load. Rejects if the image fails; the failed entry is
// dropped so a later retry can start clean.
export function acquireFloorTexture(url) {
  if (!url) return Promise.reject(new Error('acquireFloorTexture: no url'))

  let entry = entries.get(url)
  if (!entry) {
    entry = { texture: null, refs: 0, promise: null }
    entries.set(url, entry)
    entry.promise = loadImage(url)
      .then((img) => {
        // Dropped while loading (every acquirer released first) — don't
        // create a GPU texture nobody asked for any more.
        if (!entries.has(url)) throw new Error(`floor texture released while loading: ${url}`)
        entry.texture = Texture.from(img)
        return entry.texture
      })
      .catch((err) => {
        entries.delete(url)
        throw err
      })
  }
  entry.refs += 1
  return entry.promise
}

// Release one reference. The texture is destroyed when the last holder lets go.
export function releaseFloorTexture(url) {
  const entry = entries.get(url)
  if (!entry) return
  entry.refs -= 1
  if (entry.refs > 0) return
  entries.delete(url)
  // destroy(true) also frees the underlying source, which is the whole point
  // here — the old `destroy({ texture: false })` is what kept the VRAM.
  if (entry.texture) entry.texture.destroy(true)
}

// Diagnostic hook. FloorplanSystem exposes this on window in DEV — read it
// from there, not via `await import()`, which can hand back a second module
// instance after HMR and report an empty cache.
export function __floorTextureCacheStats() {
  return {
    size: entries.size,
    urls: [...entries.entries()].map(([url, e]) => ({
      url: url.length > 60 ? `${url.slice(0, 60)}…` : url,
      refs: e.refs,
      loaded: !!e.texture,
    })),
  }
}

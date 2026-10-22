import * as THREE from 'three'

// Procedural wall surfaces for the 3D view: a painted albedo + a height map
// (fed to bumpMap) per material, plus a cheap fake-AO shader patch.
//
// Everything is drawn once with Canvas2D from a seeded RNG — no texture files
// ship with the app — and cached for the life of the page (like Label3D's
// sprite cache), so every wall of a material shares one pair of textures.
//
// UV convention: buildWallGeometry authors its Shape in METRES with the origin
// at the wall's bottom-left, and ExtrudeGeometry's default UV generator copies
// those shape coordinates straight into uv. So uv is "metres along / metres
// up", and each texture's repeat is just 1 / its tile size in metres. Courses
// and panel joints therefore start at the floor on every wall.
//
// Visual only. Like thicknessM, nothing here reaches the RF engines — wall
// attenuation is material.dbLoss / customDb.

const TEX_SIZE = 512

// How strongly the material's identification colour (constants/materials.js)
// tints the realistic texture. The texture alone would make concrete and
// drywall, or brick and wood, hard to tell apart at plan distance; the full
// colour would bury the texture. 0.35 keeps "which material is this" readable
// while the surface still looks like the real thing.
export const WALL_TINT_STRENGTH = 0.35

// Fake ambient occlusion, in metres from the wall's bottom edge. CONTACT is the
// dark band where a wall meets the floor (only drawn when the wall actually
// stands on the floor, bottomHeight ≈ 0). GRADIENT is the slow darkening of
// the lower part of every wall, standing in for bounce light the floor would
// block — it is what makes a wall read as standing in a room instead of
// floating in front of one. Values are the multiplier at the bottom edge.
const AO_CONTACT_M = 0.45
const AO_CONTACT_MIN = 0.62
const AO_GRADIENT_M = 2.6
const AO_GRADIENT_MIN = 0.9

// ── Seeded helpers ─────────────────────────────────────────────────────────

function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Tileable value noise: a cells×cells lattice that wraps, bilinearly smoothed.
// Summed over a few octaves it gives the low-frequency mottling real concrete
// and paint have. Returns values in 0..1, one per pixel.
function tileNoise(size, octaves, rand) {
  const out = new Float32Array(size * size)
  let amp = 1
  let total = 0
  for (const cells of octaves) {
    const lattice = new Float32Array(cells * cells)
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells
      const y0 = Math.floor(fy)
      const ty = fy - y0
      const sy = ty * ty * (3 - 2 * ty)
      const r0 = (y0 % cells) * cells
      const r1 = ((y0 + 1) % cells) * cells
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const x0 = Math.floor(fx)
        const tx = fx - x0
        const sx = tx * tx * (3 - 2 * tx)
        const c0 = x0 % cells
        const c1 = (x0 + 1) % cells
        const top = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * sx
        const bot = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * sx
        out[y * size + x] += (top + (bot - top) * sy) * amp
      }
    }
    total += amp
    amp *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

function makeCanvas() {
  const c = document.createElement('canvas')
  c.width = TEX_SIZE
  c.height = TEX_SIZE
  return c
}

// Run `draw(x, y)` at a position and at its wrapped copies, so marks that
// cross a tile edge continue on the opposite edge and the texture stays
// seamless when repeated.
function wrapped(x, y, r, draw) {
  const S = TEX_SIZE
  for (const ox of [0, -S, S]) {
    if (ox !== 0 && (x + ox < -r || x + ox > S + r)) continue
    for (const oy of [0, -S, S]) {
      if (oy !== 0 && (y + oy < -r || y + oy > S + r)) continue
      draw(x + ox, y + oy)
    }
  }
}

// Thousands of 1–2 px flecks: pinholes, grit, paint flecks. The single most
// effective step in making a flat fill read as a material.
function speckle(ctx, rand, count, dark, light, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rand() * TEX_SIZE
    const y = rand() * TEX_SIZE
    const s = rand() < 0.8 ? 1 : 2
    ctx.fillStyle = rand() < 0.6 ? dark : light
    ctx.globalAlpha = alpha * (0.4 + rand() * 0.6)
    ctx.fillRect(x, y, s, s)
  }
  ctx.globalAlpha = 1
}

// Large soft stains. Low alpha; their job is to break up the tile's
// repetition so a long wall doesn't show the same patch every metre or two.
function blotches(ctx, rand, count, rgb, alpha, rMin, rMax) {
  for (let i = 0; i < count; i++) {
    const x = rand() * TEX_SIZE
    const y = rand() * TEX_SIZE
    const r = rMin + rand() * (rMax - rMin)
    const a = alpha * (0.4 + rand() * 0.6)
    wrapped(x, y, r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r)
      g.addColorStop(0, `rgba(${rgb},${a})`)
      g.addColorStop(1, `rgba(${rgb},0)`)
      ctx.fillStyle = g
      ctx.fillRect(px - r, py - r, r * 2, r * 2)
    })
  }
}

// Fill a canvas pixel-by-pixel from a per-pixel function returning [r,g,b].
function fillPixels(canvas, fn) {
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE)
  const d = img.data
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const i = (y * TEX_SIZE + x) * 4
      const [r, g, b] = fn(x, y, y * TEX_SIZE + x)
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return ctx
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

// ── Per-material painters ──────────────────────────────────────────────────
// Each returns { albedo, height, tileW, tileH, roughness, metalness, bump }.
// Canvas y runs DOWN while wall uv.v runs UP; nothing below is direction-
// sensitive except the brick bond, which is symmetric anyway.

// Cast-in-place concrete: formwork panels 1.2 × 0.6 m with recessed joints,
// tie-rod holes, mottling, pinholes and stains. Tile 2.4 × 2.4 m.
function paintConcrete(seed) {
  const rand = makeRng(seed)
  const tileW = 2.4
  const tileH = 2.4
  const pxPerM = TEX_SIZE / tileW
  const noise = tileNoise(TEX_SIZE, [4, 8, 16, 64], rand)
  const albedo = makeCanvas()
  const height = makeCanvas()
  const a = fillPixels(albedo, (x, y, i) => {
    const v = 168 + (noise[i] - 0.5) * 34
    return [v, v, v - 5]
  })
  const h = fillPixels(height, (x, y, i) => {
    const v = 140 + (noise[i] - 0.5) * 40
    return [v, v, v]
  })
  blotches(a, rand, 22, '70,68,62', 0.07, 20, 90)
  speckle(a, rand, 2600, '#5f5f5a', '#d8d8d2', 0.35)
  speckle(h, rand, 900, '#404040', '#404040', 0.6)

  // Panel joints: a thin dark line in albedo, a recessed groove in height.
  const panelW = 1.2 * pxPerM
  const panelH = 0.6 * pxPerM
  a.fillStyle = 'rgba(80,80,76,0.35)'
  h.fillStyle = 'rgb(70,70,70)'
  for (let x = 0; x < TEX_SIZE; x += panelW) {
    a.fillRect(x - 1, 0, 2, TEX_SIZE)
    h.fillRect(x - 1, 0, 2, TEX_SIZE)
  }
  for (let y = 0; y < TEX_SIZE; y += panelH) {
    a.fillRect(0, y - 1, TEX_SIZE, 2)
    h.fillRect(0, y - 1, TEX_SIZE, 2)
  }
  // Tie-rod holes, two per panel at the classic quarter points.
  const holeR = 0.014 * pxPerM
  for (let px = 0; px < TEX_SIZE; px += panelW) {
    for (let py = 0; py < TEX_SIZE; py += panelH) {
      for (const fx of [0.25, 0.75]) {
        const cx = px + panelW * fx
        const cy = py + panelH * 0.5
        a.fillStyle = 'rgba(55,55,52,0.75)'
        a.beginPath(); a.arc(cx, cy, holeR, 0, Math.PI * 2); a.fill()
        h.fillStyle = 'rgb(20,20,20)'
        h.beginPath(); h.arc(cx, cy, holeR, 0, Math.PI * 2); h.fill()
      }
    }
  }
  return { albedo, height, tileW, tileH, roughness: 0.88, metalness: 0.02, bump: 1.4 }
}

// Running-bond brick, 240 × 80 mm modules with 10 mm mortar. Each brick gets
// its own shade, a few run darker (over-fired). Tile 0.96 × 0.96 m.
function paintBrick(seed) {
  const rand = makeRng(seed)
  const tileW = 0.96
  const tileH = 0.96
  const pxPerM = TEX_SIZE / tileW
  const noise = tileNoise(TEX_SIZE, [8, 32, 128], rand)
  const albedo = makeCanvas()
  const height = makeCanvas()
  const a = albedo.getContext('2d')
  const h = height.getContext('2d')
  a.fillStyle = 'rgb(176,170,160)'
  a.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
  h.fillStyle = 'rgb(60,60,60)'
  h.fillRect(0, 0, TEX_SIZE, TEX_SIZE)

  const brickW = 0.24 * pxPerM
  const brickH = 0.08 * pxPerM
  const joint = 0.01 * pxPerM
  const rows = Math.round(TEX_SIZE / brickH)
  const cols = Math.round(TEX_SIZE / brickW)
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * brickW * 0.5
    for (let c = -1; c < cols; c++) {
      const x = c * brickW + offset + joint / 2
      const y = r * brickH + joint / 2
      const w = brickW - joint
      const bh = brickH - joint
      const burnt = rand() < 0.12
      const hue = 8 + rand() * 12
      const sat = 42 + rand() * 18
      const lit = burnt ? 22 + rand() * 8 : 32 + rand() * 12
      a.fillStyle = `hsl(${hue},${sat}%,${lit}%)`
      h.fillStyle = `rgb(${170 + rand() * 30},${170},${170})`
      wrapped(x + w / 2, y + bh / 2, Math.max(w, bh), (cx, cy) => {
        a.fillRect(cx - w / 2, cy - bh / 2, w, bh)
        h.fillRect(cx - w / 2, cy - bh / 2, w, bh)
      })
    }
  }
  // Surface variation over everything (bricks are never a flat colour).
  const img = a.getImageData(0, 0, TEX_SIZE, TEX_SIZE)
  for (let i = 0; i < noise.length; i++) {
    const k = 0.82 + noise[i] * 0.36
    img.data[i * 4] = clamp255(img.data[i * 4] * k)
    img.data[i * 4 + 1] = clamp255(img.data[i * 4 + 1] * k)
    img.data[i * 4 + 2] = clamp255(img.data[i * 4 + 2] * k)
  }
  a.putImageData(img, 0, 0)
  speckle(a, rand, 1800, '#3a2a22', '#c9a48c', 0.3)
  speckle(h, rand, 1400, '#7a7a7a', '#e0e0e0', 0.5)
  blotches(a, rand, 10, '40,30,25', 0.08, 25, 70)
  return { albedo, height, tileW, tileH, roughness: 0.9, metalness: 0.0, bump: 2.2 }
}

// Vertical timber cladding, 150 mm boards with V-grooves and wavy grain.
// Tile 1.2 m wide × 2.4 m tall (boards run the full height of most walls).
function paintWood(seed) {
  const rand = makeRng(seed)
  const tileW = 1.2
  const tileH = 2.4
  const boardPx = (0.15 / tileW) * TEX_SIZE
  const albedo = makeCanvas()
  const height = makeCanvas()
  const a = albedo.getContext('2d')
  const h = height.getContext('2d')
  h.fillStyle = 'rgb(160,160,160)'
  h.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
  const boards = Math.round(TEX_SIZE / boardPx)
  for (let b = 0; b < boards; b++) {
    const x0 = b * boardPx
    const hue = 24 + rand() * 10
    const sat = 38 + rand() * 16
    const lit = 34 + rand() * 12
    a.fillStyle = `hsl(${hue},${sat}%,${lit}%)`
    a.fillRect(x0, 0, boardPx, TEX_SIZE)
    // Grain: thin wavy streaks, darker and lighter than the board.
    const streaks = 14 + Math.floor(rand() * 10)
    for (let s = 0; s < streaks; s++) {
      const gx = x0 + rand() * boardPx
      const amp = 1 + rand() * 3
      const freq = 2 + rand() * 4
      const phase = rand() * Math.PI * 2
      a.strokeStyle = rand() < 0.65
        ? `hsla(${hue},${sat}%,${lit - 10}%,${0.25 + rand() * 0.3})`
        : `hsla(${hue},${sat}%,${lit + 8}%,${0.15 + rand() * 0.2})`
      a.lineWidth = 0.6 + rand() * 1.2
      a.beginPath()
      for (let y = 0; y <= TEX_SIZE; y += 8) {
        const x = gx + Math.sin((y / TEX_SIZE) * Math.PI * 2 * freq + phase) * amp
        if (y === 0) a.moveTo(x, y); else a.lineTo(x, y)
      }
      a.stroke()
    }
    // Groove between boards: dark line + recessed height.
    a.fillStyle = 'rgba(30,18,10,0.7)'
    a.fillRect(x0, 0, 2, TEX_SIZE)
    h.fillStyle = 'rgb(40,40,40)'
    h.fillRect(x0 - 1, 0, 3, TEX_SIZE)
  }
  speckle(a, rand, 900, '#2a1a10', '#d0a070', 0.25)
  blotches(a, rand, 8, '30,20,10', 0.07, 30, 90)
  return { albedo, height, tileW, tileH, roughness: 0.62, metalness: 0.0, bump: 1.2 }
}

// Painted gypsum board: 1.2 × 2.4 m sheets with taped (barely visible) seams
// and a fine roller stipple. Deliberately the quietest texture — real drywall
// mostly reads through its light, not its pattern.
function paintDrywall(seed) {
  const rand = makeRng(seed)
  const tileW = 1.2
  const tileH = 2.4
  const low = tileNoise(TEX_SIZE, [3, 6], rand)
  const fine = tileNoise(TEX_SIZE, [128, 256], rand)
  const albedo = makeCanvas()
  const height = makeCanvas()
  const a = fillPixels(albedo, (x, y, i) => {
    const v = 226 + (low[i] - 0.5) * 10 + (fine[i] - 0.5) * 8
    return [v, v - 1, v - 5]
  })
  fillPixels(height, (x, y, i) => {
    const v = 128 + (fine[i] - 0.5) * 70
    return [v, v, v]
  })
  // Taped seam at the sheet edge: a faint lighter band from the joint compound.
  const g = a.createLinearGradient(-8, 0, 8, 0)
  g.addColorStop(0, 'rgba(255,255,250,0)')
  g.addColorStop(0.5, 'rgba(255,255,250,0.12)')
  g.addColorStop(1, 'rgba(255,255,250,0)')
  a.fillStyle = g
  a.fillRect(-8, 0, 16, TEX_SIZE)
  a.save(); a.translate(TEX_SIZE, 0); a.fillRect(-8, 0, 16, TEX_SIZE); a.restore()
  blotches(a, rand, 10, '90,85,75', 0.035, 40, 120)
  speckle(a, rand, 500, '#a8a49a', '#ffffff', 0.15)
  return { albedo, height, tileW, tileH, roughness: 0.92, metalness: 0.0, bump: 0.5 }
}

// Ribbed sheet metal: trapezoidal ribs every 200 mm, brushed vertically, with
// light grime. The ribs live in the height map; the albedo only carries the
// brushing and the dirt, so the shading comes from the actual light direction.
function paintMetal(seed) {
  const rand = makeRng(seed)
  const tileW = 1.0
  const tileH = 1.0
  const ribPx = (0.2 / tileW) * TEX_SIZE
  const low = tileNoise(TEX_SIZE, [4, 8], rand)
  const albedo = makeCanvas()
  const height = makeCanvas()
  const a = fillPixels(albedo, (x, y, i) => {
    const v = 150 + (low[i] - 0.5) * 18
    return [v - 4, v, v + 6]
  })
  fillPixels(height, (x) => {
    // Rib profile across one period: valley, 15% slope, crest, slope.
    const t = (x % ribPx) / ribPx
    let p
    if (t < 0.35) p = 0
    else if (t < 0.5) p = (t - 0.35) / 0.15
    else if (t < 0.85) p = 1
    else p = 1 - (t - 0.85) / 0.15
    const v = 60 + p * 150
    return [v, v, v]
  })
  for (let i = 0; i < 1400; i++) {
    const x = rand() * TEX_SIZE
    a.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
    a.fillRect(x, 0, 1, TEX_SIZE)
  }
  blotches(a, rand, 12, '70,60,50', 0.06, 30, 90)
  speckle(a, rand, 700, '#555a60', '#e6ecf2', 0.2)
  return { albedo, height, tileW, tileH, roughness: 0.48, metalness: 0.45, bump: 3.0 }
}

const PAINTERS = {
  concrete: [paintConcrete, 11],
  brick: [paintBrick, 23],
  wood: [paintWood, 37],
  drywall: [paintDrywall, 41],
  metal: [paintMetal, 53],
}

// ── Texture cache ──────────────────────────────────────────────────────────

const cache = new Map()

function toTexture(canvas, tileW, tileH, srgb) {
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / tileW, 1 / tileH)
  t.anisotropy = 8   // clamped to the GPU max by three; walls are seen at grazing angles
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  return t
}

// Surface for a wall material id. Unknown ids (mock imports, future materials)
// fall back to concrete, the default wall material. Glass has no surface —
// WallLayer3D draws it with the Fresnel glass material instead.
export function getWallSurface(materialId) {
  const key = PAINTERS[materialId] ? materialId : 'concrete'
  let s = cache.get(key)
  if (!s) {
    const [paint, seed] = PAINTERS[key]
    const p = paint(seed)
    s = {
      map: toTexture(p.albedo, p.tileW, p.tileH, true),
      bumpMap: toTexture(p.height, p.tileW, p.tileH, false),
      bumpScale: p.bump,
      roughness: p.roughness,
      metalness: p.metalness,
    }
    cache.set(key, s)
  }
  return s
}

// Material colour for a wall: white lerped toward the identification colour.
// Lerp in sRGB so 0.35 means "35% of the way there" the way the swatch looks.
const _srgb = { r: 0, g: 0, b: 0 }
export function wallTint(hex) {
  new THREE.Color(hex).getRGB(_srgb, THREE.SRGBColorSpace)
  const k = WALL_TINT_STRENGTH
  return new THREE.Color().setRGB(
    1 + (_srgb.r - 1) * k,
    1 + (_srgb.g - 1) * k,
    1 + (_srgb.b - 1) * k,
    THREE.SRGBColorSpace,
  )
}

// ── Fake AO shader patch ───────────────────────────────────────────────────
// Returns an onBeforeCompile for a wall's meshStandardMaterial. `uniforms` is
// a per-wall object { uWallHalfH, uWallContact } the caller keeps mutating as
// the wall is edited; the shader holds references to those same objects, so
// edits land without a recompile. The function's source is identical for
// every wall, so three's default program cache key (onBeforeCompile.toString)
// lets all walls share one compiled program.
//
// The multiplier is applied to the diffuse albedo, so it darkens direct light
// as well as ambient — physically wrong for AO, but it is the darkening the
// eye expects at a wall foot, and it costs two smoothsteps per fragment
// instead of the depth/normal prepass that made real SSAO unaffordable
// (51-12: +25 ms at 300 AP).
const f3 = (v) => v.toFixed(3)
export function makeWallAOPatch(uniforms) {
  return (shader) => {
    shader.uniforms.uWallHalfH = uniforms.uWallHalfH
    shader.uniforms.uWallContact = uniforms.uWallContact
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWallY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWallY = position.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vWallY;\nuniform float uWallHalfH;\nuniform float uWallContact;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float wallUp = vWallY + uWallHalfH;
          float contact = mix(${f3(AO_CONTACT_MIN)}, 1.0, smoothstep(0.0, ${f3(AO_CONTACT_M)}, wallUp));
          contact = mix(1.0, contact, uWallContact);
          float grad = mix(${f3(AO_GRADIENT_MIN)}, 1.0, smoothstep(0.0, ${f3(AO_GRADIENT_M)}, wallUp));
          diffuseColor.rgb *= contact * grad;
        }`,
      )
  }
}

// 59-6: the same fake AO for a batch of merged walls (WallLayer3D merges the
// opaque walls of a non-active floor). Each wall's height above its own bottom
// and its on-floor flag come per vertex (aWallUp = local y + half height,
// aWallContact) instead of per-wall uniforms, so the result is the one above
// to the bit. Module-level, so every batch shares one compiled program.
export function mergedWallAOPatch(shader) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute float aWallUp;\nattribute float aWallContact;\nvarying float vWallUp;\nvarying float vWallContact;',
    )
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWallUp = aWallUp;\nvWallContact = aWallContact;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vWallUp;\nvarying float vWallContact;')
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
        {
          float wallUp = vWallUp;
          float contact = mix(${f3(AO_CONTACT_MIN)}, 1.0, smoothstep(0.0, ${f3(AO_CONTACT_M)}, wallUp));
          contact = mix(1.0, contact, vWallContact);
          float grad = mix(${f3(AO_GRADIENT_MIN)}, 1.0, smoothstep(0.0, ${f3(AO_GRADIENT_M)}, wallUp));
          diffuseColor.rgb *= contact * grad;
        }`,
    )
}

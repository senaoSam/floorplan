// Antenna pattern catalog for "custom" antenna mode.
// Each pattern is 36 dB samples: index k = angle k*10° measured from the antenna bore-sight,
// wrapping clockwise to 350°. Symmetric patterns have mirrored values around index 0 / 18.
// Main-lobe bore-sight (0°) is normalized to 0 dB; back-lobe is a negative value.

const PATTERN_SAMPLES = 36
const STEP_DEG = 360 / PATTERN_SAMPLES

// Build a symmetric pattern from a half-profile (19 values for 0°~180°).
// The returned array is length 36 with mirror symmetry: samples[36-k] = samples[k] for k=1..17.
function fromHalf(half) {
  const out = new Array(PATTERN_SAMPLES)
  for (let k = 0; k < PATTERN_SAMPLES; k++) {
    const mirrored = k <= 18 ? k : PATTERN_SAMPLES - k
    out[k] = half[mirrored]
  }
  return out
}

// Patch: cos² main lobe, smooth roll-off, back lobe ~-25 dB.
const PATCH_HALF = Array.from({ length: 19 }, (_, i) => {
  const deg = i * 10
  if (deg >= 180) return -25
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad / 2)
  // cos² (cos(θ/2)) maps 0°→0 dB, 90°→-3 dB, 120°→-6 dB, 180°→-∞ → clamp to -25.
  const lin = cos * cos
  const db = lin > 1e-3 ? 10 * Math.log10(lin) : -25
  return Math.max(db, -25)
})

// Sector profile: flat 0 dB inside the sector, steep fall-off outside to -backDb.
function sectorHalf(sectorDeg, backDb) {
  const half = sectorDeg / 2
  const edgeTaper = 15  // degrees for the -0 dB → full attenuation fall
  return Array.from({ length: 19 }, (_, i) => {
    const deg = i * 10
    if (deg <= half) return 0
    if (deg >= half + edgeTaper) return -backDb
    const t = (deg - half) / edgeTaper
    return -backDb * t
  })
}

// ── Built-in "directional" sector taper ────────────────────────────────────
// Relative sector gain (≤ 0 dB): flat inside half-beamwidth, linear fall to the
// back lobe across the edge-taper zone. This is the source of truth for the
// directional antenna mode — the JS engine (propagation.js) imports it, and the
// APPanel preview builds a synthetic pattern from it so what the user sees in
// the 3D lobe equals what the engine computes.
// NOTE: the WebGL engine (propagationGL.js) hand-copies these constants and the
// sectorTaperDb body into its shader strings (GLSL can't import JS) — keep those
// two copies in sync if you change the numbers here.
export const DIRECTIONAL_BACK_DB = 20
export const DIRECTIONAL_EDGE_DEG = 15
export function sectorTaperDb(absOffDeg, halfBwDeg) {
  if (absOffDeg <= halfBwDeg) return 0
  if (absOffDeg >= halfBwDeg + DIRECTIONAL_EDGE_DEG) return -DIRECTIONAL_BACK_DB
  return -DIRECTIONAL_BACK_DB * (absOffDeg - halfBwDeg) / DIRECTIONAL_EDGE_DEG
}

// Build a directional pattern object (36 dB samples) from a beamwidth, so the
// PatternPreview3D lobe can render the built-in sector the same way it renders a
// catalog pattern. Each sample k is the relative sector gain at offset k*STEP_DEG
// from bore-sight — identical to the per-ray taper the engine applies. The 3D
// preview sums Gh(az)+Gv(el), matching the engine's sectorTaperDb(absOff)+
// sectorTaperDb(vertOff), so the surface is what apGainDbi computes.
export function buildDirectionalPattern(beamwidthDeg) {
  const half = beamwidthDeg / 2
  const samples = new Array(PATTERN_SAMPLES)
  for (let k = 0; k < PATTERN_SAMPLES; k++) {
    let deg = k * STEP_DEG
    if (deg > 180) deg = 360 - deg   // fold to [0, 180] offset from bore-sight
    samples[k] = sectorTaperDb(deg, half)
  }
  return { id: 'directional', label: 'Directional', samples }
}

export const ANTENNA_PATTERNS = {
  PATCH: {
    id: 'patch',
    label: 'Patch（貼片）',
    description: '前半球 cos² 漸降，背面 ≈ −25 dB',
    samples: fromHalf(PATCH_HALF),
  },
  SECTOR_90: {
    id: 'sector-90',
    label: 'Sector 90°',
    description: '90° 扇區內平坦，兩側急降，背面 ≈ −30 dB',
    samples: fromHalf(sectorHalf(90, 30)),
  },
  SECTOR_120: {
    id: 'sector-120',
    label: 'Sector 120°',
    description: '120° 扇區內平坦，兩側急降，背面 ≈ −25 dB',
    samples: fromHalf(sectorHalf(120, 25)),
  },
}

export const ANTENNA_PATTERN_LIST = Object.values(ANTENNA_PATTERNS)

export const DEFAULT_PATTERN_ID = ANTENNA_PATTERNS.PATCH.id

export const getPatternById = (id) =>
  ANTENNA_PATTERN_LIST.find((p) => p.id === id) ?? ANTENNA_PATTERNS.PATCH

// Lookup gain in dB for a given offset angle (radians, already wrapped to [0, π]).
// Linear interpolation between the two nearest samples.
export function sampleGain(pattern, offsetRad) {
  const offsetDeg = Math.abs(offsetRad) * 180 / Math.PI
  const normalized = ((offsetDeg % 360) + 360) % 360
  const idx = normalized / STEP_DEG
  const lo = Math.floor(idx) % PATTERN_SAMPLES
  const hi = (lo + 1) % PATTERN_SAMPLES
  const frac = idx - Math.floor(idx)
  return pattern.samples[lo] * (1 - frac) + pattern.samples[hi] * frac
}

export { PATTERN_SAMPLES, STEP_DEG }

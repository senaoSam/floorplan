// Deterministic seedable RNG (mulberry32) — same seed reproduces the same
// stream, so mock data stays byte-stable across reloads (spec §3.5). This is
// the shared copy for the stats domain; the camera domain has its own local
// copy in features/cameras/mockTracks.js (kept as-is to avoid touching an
// unrelated module).
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Derive a stable 32-bit seed from a string (FNV-1a) so callers can seed by
// floorId / apId / mac without hand-picking integers.
export function hashStringToSeed(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// 32-E debug perf probe — OFF by default, zero cost unless turned on.
//
// Turn on from the browser console:
//   window.__perfProbe = true            // start logging
//   __perf.start('hover')                // optional label for the next window
//   ...do the laggy interaction...
//   __perf.report()                      // print a summary table + reset
//   window.__perfProbe = false           // stop
//
// What it captures:
//   - per-frame time via requestAnimationFrame (real GPU+CPU frame cost, the
//     thing the user actually feels — NOT just a synchronous setState timing)
//   - named span timings reported by instrumented code (probe('cable.rebuild', ms))
//   - routesCache hit/miss counts (probeCache)
//   - which store fired each rebuild (probeEvent)
//
// Everything no-ops when window.__perfProbe is falsy, so it's safe to leave the
// hooks in production code.

const isOn = () => typeof window !== 'undefined' && window.__perfProbe

const state = {
  label: 'session',
  frames: [],          // frame deltas (ms)
  spans: new Map(),    // name -> { n, total, max, samples: number[] }
  events: new Map(),   // store name -> count
  cacheHit: 0,
  cacheMiss: 0,
  rafId: 0,
  lastT: 0,
}

function resetState(label) {
  state.label = label ?? state.label
  state.frames = []
  state.spans = new Map()
  state.events = new Map()
  state.cacheHit = 0
  state.cacheMiss = 0
  state.lastT = 0
}

function frameLoop(t) {
  if (!isOn()) { state.rafId = 0; return }
  if (state.lastT) state.frames.push(t - state.lastT)
  state.lastT = t
  state.rafId = requestAnimationFrame(frameLoop)
}

function ensureLoop() {
  if (isOn() && !state.rafId) {
    state.lastT = 0
    state.rafId = requestAnimationFrame(frameLoop)
  }
}

// Record a named span (ms). Wrap with `if (perfOn())` at the call site to avoid
// even computing the timing when the probe is off.
export function perfOn() { return isOn() }

export function probe(name, ms) {
  if (!isOn()) return
  ensureLoop()
  let s = state.spans.get(name)
  if (!s) { s = { n: 0, total: 0, max: 0, samples: [] }; state.spans.set(name, s) }
  s.n += 1
  s.total += ms
  if (ms > s.max) s.max = ms
  if (s.samples.length < 500) s.samples.push(ms)
}

export function probeCache(hit) {
  if (!isOn()) return
  if (hit) state.cacheHit += 1; else state.cacheMiss += 1
}

export function probeEvent(storeName) {
  if (!isOn()) return
  ensureLoop()
  state.events.set(storeName, (state.events.get(storeName) ?? 0) + 1)
}

function pct(arr, p) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function report() {
  const f = state.frames
  const avg = f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0
  console.log(`%c[perf] "${state.label}" — ${f.length} frames`, 'font-weight:bold;color:#22d3ee')
  if (f.length) {
    console.log(
      `  frame ms: avg ${avg.toFixed(1)} (${(1000 / avg).toFixed(0)} fps) | ` +
      `p50 ${pct(f, 0.5).toFixed(1)} | p95 ${pct(f, 0.95).toFixed(1)} | ` +
      `max ${Math.max(...f).toFixed(1)} | jank>33ms: ${f.filter((x) => x > 33).length} | jank>100ms: ${f.filter((x) => x > 100).length}`,
    )
  }
  const rows = []
  for (const [name, s] of state.spans) {
    rows.push({ span: name, calls: s.n, totalMs: +s.total.toFixed(1), avgMs: +(s.total / s.n).toFixed(2), maxMs: +s.max.toFixed(1), p95: +pct(s.samples, 0.95).toFixed(2) })
  }
  rows.sort((a, b) => b.totalMs - a.totalMs)
  if (rows.length) console.table(rows)
  if (state.events.size) console.log('  rebuild triggers:', Object.fromEntries(state.events))
  console.log(`  routesCache: ${state.cacheHit} hit / ${state.cacheMiss} miss`)
  resetState()
}

// Expose a tiny console API.
if (typeof window !== 'undefined') {
  window.__perf = {
    start(label) { window.__perfProbe = true; resetState(label); ensureLoop(); console.log(`[perf] recording "${label ?? 'session'}" — interact, then __perf.report()`) },
    report,
    stop() { window.__perfProbe = false; if (state.rafId) cancelAnimationFrame(state.rafId); state.rafId = 0; console.log('[perf] stopped') },
  }
}

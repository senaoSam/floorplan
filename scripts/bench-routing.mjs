// 32-0 — computeRoutes wall-clock baseline.
// Synthetic single-floor scenes: N APs + M trays + a switch grid, structured
// to mirror DemoLoader (APs sit inside tray magnets so they route via graph).
//
// Run:  node scripts/bench-routing.mjs
// Matrix: AP ∈ {50,150,300,500,1000} × tray ∈ {0,1,5,10}
//
// This is a PURE-FUNCTION bench — imports computeRoutes directly, no browser,
// no React. Numbers reflect the per-pointermove cost cablesLayer.js pays.

import { performance } from 'node:perf_hooks'
import { computeRoutes } from '../src/features/cable/computeRoutes.js'
import { buildBuildingGraph } from '../src/features/cable/buildGraph.js'
import { dijkstra, unionFind } from '../src/features/cable/routing.js'

const W = 4000   // canvas px — big floor so 1000 APs spread out
const H = 3000
const PX_PER_M = 4000 / 120  // ~33 px/m, like a real building

function makeFloor() {
  return { id: 'F1', name: 'F1', scale: PX_PER_M, floorHeight: 3.0, elevation: 0 }
}

// Grid of access switches — one switch per ~250 APs so cables have a target.
function makeSwitches(nSwitches) {
  const out = []
  for (let i = 0; i < nSwitches; i++) {
    out.push({
      id: `sw-${i}`,
      name: `SW-${i}`,
      x: ((i + 0.5) / nSwitches) * W,
      y: H / 2,
      kind: 'switch',
      mountHeight: 0.5,
      model: 'POE-24', portCount: 24, poeBudget: 370,
      uplinkTo: i > 0 ? 'sw-0' : null,   // S2S links → exercise that path too
      cableType: 'auto',
    })
  }
  return out
}

// APs on a grid filling the canvas.
function makeAPs(n) {
  const out = []
  const cols = Math.ceil(Math.sqrt(n * (W / H)))
  const rows = Math.ceil(n / cols)
  let k = 0
  for (let r = 0; r < rows && k < n; r++) {
    for (let c = 0; c < cols && k < n; c++) {
      out.push({
        id: `ap-${k}`,
        name: `AP-${k}`,
        x: ((c + 0.5) / cols) * W,
        y: ((r + 0.5) / rows) * H,
        z: 2.4, txPower: 20, frequency: 5, channel: 36,
        antennaMode: 'omni',
      })
      k++
    }
  }
  return out
}

// M horizontal trays spread vertically across the floor, each with a wide
// magnet so APs near it snap. tray 0 passes through the switch row.
function makeTrays(m) {
  const out = []
  for (let i = 0; i < m; i++) {
    const y = m === 1 ? H / 2 : ((i + 0.5) / m) * H
    out.push({
      id: `tray-${i}`,
      name: `Tray-${i}`,
      points: [{ x: 0, y }, { x: W, y }],
      magnetDistance: 400,   // wide capsule → many APs snap
      system: 'data',
    })
  }
  return out
}

function bench(label, scene, iters) {
  // warmup
  computeRoutes(scene)
  const t0 = performance.now()
  let routeCount = 0
  for (let i = 0; i < iters; i++) {
    const { routes } = computeRoutes(scene)
    routeCount = routes.size
  }
  const total = performance.now() - t0
  const per = total / iters
  return { label, per, routeCount, iters }
}

const AP_COUNTS   = [50, 150, 300, 500, 1000]
const TRAY_COUNTS = [0, 1, 5, 10]

console.log('# 32-0 computeRoutes baseline (single floor)')
console.log(`# canvas ${W}x${H}, scale ${PX_PER_M.toFixed(1)} px/m`)
console.log('')
console.log('| AP | trays | switches | ms/call | routes | iters | verdict |')
console.log('|----|-------|----------|---------|--------|-------|---------|')

for (const ap of AP_COUNTS) {
  const nSwitches = Math.max(1, Math.round(ap / 250))
  for (const tray of TRAY_COUNTS) {
    const scene = {
      floors: [makeFloor()],
      apsByFloor: { F1: makeAPs(ap) },
      switchesByFloor: { F1: makeSwitches(nSwitches) },
      traysByFloor: { F1: makeTrays(tray) },
      risers: [],
    }
    // fewer iters for the heavy cases so the whole bench finishes fast
    const iters = ap >= 500 ? 5 : ap >= 150 ? 15 : 40
    const r = bench(`${ap}/${tray}`, scene, iters)
    const verdict = r.per <= 16 ? '✅ <16ms (drag OK)'
      : r.per <= 50 ? '⚠️ 16-50ms (laggy)'
      : '❌ >50ms (janky)'
    console.log(
      `| ${ap} | ${tray} | ${nSwitches} | ${r.per.toFixed(2)} | ${r.routeCount} | ${r.iters} | ${verdict} |`,
    )
  }
}

console.log('')
console.log('# Note: cablesLayer rebuild() calls computeRoutes ONCE per pointermove.')
console.log('# 60fps budget = 16.7ms/frame. Any row >16ms → drag drops frames.')

// ── Breakdown: where does the 94ms go? graph build vs 1000× Dijkstra ──
// This decides the incremental strategy. If buildGraph is cheap and Dijkstra
// dominates, then "rebuild graph + run ONLY 1 Dijkstra" is enough — no splice.
console.log('')
console.log('# === Breakdown @ 1000 AP / 1 tray (the worst case) ===')
{
  const scene = {
    floors: [makeFloor()],
    apsByFloor: { F1: makeAPs(1000) },
    switchesByFloor: { F1: makeSwitches(4) },
    traysByFloor: { F1: makeTrays(1) },
    risers: [],
  }
  const ITERS = 5

  // (a) graph build only
  let t = performance.now()
  let g
  for (let i = 0; i < ITERS; i++) g = buildBuildingGraph(scene)
  const buildMs = (performance.now() - t) / ITERS

  // (b) unionFind only
  t = performance.now()
  let uf
  for (let i = 0; i < ITERS; i++) uf = unionFind([...g.nodes.keys()], g.adj)
  const ufMs = (performance.now() - t) / ITERS

  // (c) ONE Dijkstra from one AP node on the full graph
  const apNodeId = g.endpointNodeIds.aps.get('ap-0')?.nodeId
  t = performance.now()
  for (let i = 0; i < ITERS; i++) dijkstra(g.adj, apNodeId)
  const oneDijkstraMs = (performance.now() - t) / ITERS

  // (d) full computeRoutes for reference
  t = performance.now()
  for (let i = 0; i < ITERS; i++) computeRoutes(scene)
  const fullMs = (performance.now() - t) / ITERS

  console.log(`graph build         : ${buildMs.toFixed(2)} ms`)
  console.log(`unionFind           : ${ufMs.toFixed(2)} ms`)
  console.log(`ONE Dijkstra        : ${oneDijkstraMs.toFixed(2)} ms`)
  console.log(`full computeRoutes  : ${fullMs.toFixed(2)} ms`)
  console.log('')
  console.log(`# "rebuild graph + 1 Dijkstra" estimate (no-splice incremental):`)
  console.log(`#   ${(buildMs + ufMs + oneDijkstraMs).toFixed(2)} ms vs full ${fullMs.toFixed(2)} ms`)
  console.log(`# If this is <16ms, the SIMPLE incremental (no graph splice) is enough.`)
}

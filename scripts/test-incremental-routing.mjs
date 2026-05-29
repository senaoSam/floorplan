// 32-C correctness test — incremental routing MUST equal full computeRoutes.
//
// Run: npx vite-node scripts/test-incremental-routing.mjs
//
// Strategy:
//  1. Build a scene with APs / switches / trays / a riser (cross-floor).
//  2. For a grid of dragged-AP positions, assert routeOneAP(ctx, apMoved)
//     deep-equals computeRoutes(sceneWithApMoved).routes.get(apId).
//  3. For switch drag, assert routeOneSwitchLink + dependent routeOneAP
//     match the full recompute for the moved switch.
//  This is the "no jump on release" guarantee.

import {
  computeRoutes,
  buildRoutingContext,
  routeOneAP,
  routeOneSwitchLink,
} from '../src/features/cable/computeRoutes.js'

let pass = 0, fail = 0
function eq(label, a, b) {
  const sa = JSON.stringify(a)
  const sb = JSON.stringify(b)
  if (sa === sb) { pass++; return }
  fail++
  console.log(`❌ ${label}`)
  console.log(`   incremental: ${sa}`)
  console.log(`   full       : ${sb}`)
}

const PX_PER_M = 33.3

function makeScene(apOverride) {
  const floorA = { id: 'FA', name: 'A', scale: PX_PER_M, floorHeight: 3, elevation: 0 }
  const floorB = { id: 'FB', name: 'B', scale: PX_PER_M, floorHeight: 3, elevation: 3 }
  const baseAps = [
    { id: 'ap-1', name: 'AP1', x: 200, y: 300, z: 2.4, antennaMode: 'omni' },
    { id: 'ap-2', name: 'AP2', x: 800, y: 320, z: 2.4, antennaMode: 'omni' },
    { id: 'ap-3', name: 'AP3', x: 1500, y: 900, z: 2.4, antennaMode: 'omni' }, // far → maybe fallback
  ]
  const apsA = baseAps.map((a) => (apOverride && apOverride.id === a.id ? { ...a, ...apOverride } : a))
  return {
    floors: [floorA, floorB],
    apsByFloor: {
      FA: apsA,
      FB: [{ id: 'ap-b1', name: 'APB1', x: 300, y: 300, z: 2.4, antennaMode: 'omni' }],
    },
    switchesByFloor: {
      FA: [
        { id: 'sw-1', name: 'SW1', x: 500, y: 300, kind: 'switch', uplinkTo: 'idf-1', cableType: 'auto' },
        { id: 'idf-1', name: 'IDF1', x: 1000, y: 300, kind: 'idf', uplinkTo: null, cableType: 'auto' },
      ],
      FB: [{ id: 'sw-b1', name: 'SWB1', x: 300, y: 300, kind: 'switch', uplinkTo: null, cableType: 'auto' }],
    },
    traysByFloor: {
      FA: [{ id: 'tray-1', name: 'T1', points: [{ x: 0, y: 300 }, { x: 1100, y: 300 }], magnetDistance: 200, system: 'data' }],
      FB: [{ id: 'tray-b1', name: 'TB1', points: [{ x: 0, y: 300 }, { x: 600, y: 300 }], magnetDistance: 200, system: 'data' }],
    },
    risers: [{ id: 'riser-1', x: 1000, y: 300, floorIds: ['FA', 'FB'], magnetDistance: 150 }],
  }
}

// ── Test 1: drag ap-1 across a grid of positions ──
console.log('# Test 1 — drag ap-1, incremental routeOneAP vs full recompute')
for (let gx = 50; gx <= 1600; gx += 150) {
  for (let gy = 100; gy <= 1000; gy += 200) {
    const moved = { id: 'ap-1', x: gx, y: gy }
    const scene = makeScene(moved)
    // Full
    const full = computeRoutes(scene).routes.get('ap-1')
    // Incremental: build ctx from the SAME scene (graph rebuilt ~1ms), route just ap-1
    const ctx = buildRoutingContext(scene)
    const apMoved = scene.apsByFloor.FA.find((a) => a.id === 'ap-1')
    const inc = routeOneAP(ctx, apMoved, 'FA')
    eq(`ap-1 @ (${gx},${gy})`, inc, full)
  }
}

// ── Test 2: drag sw-1 (an access switch with dependent APs + an S2S uplink) ──
console.log('# Test 2 — drag sw-1, incremental dependents + S2S link vs full')
for (let gx = 100; gx <= 1000; gx += 150) {
  const scene = JSON.parse(JSON.stringify(makeScene()))
  // move sw-1
  scene.switchesByFloor.FA.find((s) => s.id === 'sw-1').x = gx
  const full = computeRoutes(scene)
  const ctx = buildRoutingContext(scene)
  const movedSw = scene.switchesByFloor.FA.find((s) => s.id === 'sw-1')
  // dependents = APs whose full route lands on sw-1 (either before or after);
  // here we just recompute ALL FA aps incrementally and compare each.
  for (const ap of scene.apsByFloor.FA) {
    const inc = routeOneAP(ctx, ap, 'FA')
    eq(`sw-1@${gx} route ${ap.id}`, inc, full.routes.get(ap.id))
  }
  const incLink = routeOneSwitchLink(ctx, movedSw)
  eq(`sw-1@${gx} S2S link`, incLink, full.switchLinks.get('sw-1'))
}

// ── Test 3: cross-floor riser route (ap-b1 routes up to FA via riser?) ──
console.log('# Test 3 — every AP & link in a static scene matches full')
{
  const scene = makeScene()
  const full = computeRoutes(scene)
  const ctx = buildRoutingContext(scene)
  for (const [fid, list] of Object.entries(scene.apsByFloor)) {
    for (const ap of list) {
      eq(`static ${ap.id}`, routeOneAP(ctx, ap, fid), full.routes.get(ap.id))
    }
  }
  for (const [, sw] of ctx.swById) {
    const inc = routeOneSwitchLink(ctx, sw)
    const fullLink = full.switchLinks.get(sw.id)
    if (inc || fullLink) eq(`static link ${sw.id}`, inc, fullLink ?? null)
  }
}

console.log('')
console.log(`# RESULT: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)

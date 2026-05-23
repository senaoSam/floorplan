// 22-1 CSV Planning BOM export.
//
// Bundles everything CableSummaryPanel already computes (AP cables, S2S
// links, tray BOM, fill ratios) into a single CSV file the user can drop
// into Excel / Google Sheets.
//
// Why one CSV with multiple sections (not several files in a zip)?
//   - One download = one click, no extraction step
//   - Excel / Sheets handle "blank row + heading row" gracefully (each
//     section becomes its own visual block when opened)
//   - Section dividers (`# ── ...`) survive as benign cells; users skip
//     past them in Excel's filter dropdowns
//
// English column headers are deliberate — Excel default locale handles
// them as plain text and numeric columns don't get auto-formatted as
// dates / phone numbers. The header line of each section is the part
// machine consumers (downstream scripts) will key on.
//
// This module is store-free: callers pass in the already-computed
// routes / switchLinks / trayBOM / trayFillByKey so we don't reach into
// Zustand from a util file.

// CSV string escape. Wraps a value in quotes when it contains comma /
// quote / newline; doubles up embedded quotes per RFC 4180. Numbers /
// nulls / undefined pass through as bare cells.
function csvCell(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function csvRow(cells) {
  return cells.map(csvCell).join(',')
}

// Round to N decimal places, returning the bare number (not a string) so
// the cell stays numeric in Excel. null / undefined / NaN pass through.
function round(n, digits = 2) {
  if (n == null || isNaN(n)) return null
  const k = Math.pow(10, digits)
  return Math.round(n * k) / k
}

// Polyline length in canvas pixels. computeTrayBOM only exposes per-floor
// totals, but the CSV needs each tray's own length, so re-walk the points
// here (cheap — at most a few dozen vertices per tray).
function polylineLengthPx(points) {
  if (!points || points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

// Build the CSV string from already-computed planning data.
//
// Inputs:
//   floors            : array of Floor records
//   apsByFloor        : { [floorId]: AP[] }
//   switchesByFloor   : { [floorId]: Switch[] }
//   routes            : Map<apId, route>           (computeRoutes result)
//   switchLinks       : Map<srcSwId, link>         (computeRoutes result)
//   trayBOM           : computeTrayBOM result
//   trayFillByKey     : Map<`${floorId}|${trayId}`, fill>   (computeTrayFill per tray)
//   wasteFactor       : number (1.10 default)
//
// Output: full CSV text (newline-joined). Caller is responsible for
// triggering the download (see triggerCSVDownload below).
export function buildPlanningBOMCsv({
  floors = [],
  apsByFloor = {},
  switchesByFloor = {},
  routes = new Map(),
  switchLinks = new Map(),
  trayBOM = null,
  trayFillByKey = new Map(),
  traysByFloor = {},
  wasteFactor = 1.10,
}) {
  const lines = []
  const floorById = new Map(floors.map((f) => [f.id, f]))

  // Flatten AP + Switch lookups so we can resolve names regardless of floor.
  const apById = new Map()
  for (const list of Object.values(apsByFloor)) {
    for (const a of list ?? []) apById.set(a.id, a)
  }
  const swById = new Map()
  for (const list of Object.values(switchesByFloor)) {
    for (const s of list ?? []) swById.set(s.id, s)
  }
  const floorName = (id) => floorById.get(id)?.name ?? id

  // ── Header banner (helps a human opening the file in Excel) ──
  lines.push('# Floorplan Planner — Planning BOM')
  lines.push(`# Generated: ${new Date().toISOString()}`)
  lines.push('# NOTE: Planning estimate. Not a construction final BOM.')
  lines.push('')

  // ── 1. AP cables ───────────────────────────────────────────────
  lines.push('# ── 1. AP CABLES ──')
  lines.push(csvRow([
    'FloorName', 'APName', 'SwitchName', 'CableType',
    'CableLengthM', 'ZDropM', 'RouteStatus',
  ]))
  // Stable ordering: by floor index, then by AP name within floor.
  const apRows = []
  for (const route of routes.values()) {
    const ap = apById.get(route.apId)
    const sw = route.switchId ? swById.get(route.switchId) : null
    apRows.push({
      floorIdx: floors.findIndex((f) => f.id === route.homeFloorId),
      floorName: floorName(route.homeFloorId),
      apName: ap?.name ?? route.apId,
      swName: sw?.name ?? '',
      cableType: route.cableType ?? '',
      cableM: round(route.cableM, 2),
      zDropM: round(route.zDropM, 2),
      routeStatus: route.routeStatus,
    })
  }
  apRows.sort((a, b) => a.floorIdx - b.floorIdx || a.apName.localeCompare(b.apName))
  for (const r of apRows) {
    lines.push(csvRow([
      r.floorName, r.apName, r.swName, r.cableType,
      r.cableM, r.zDropM, r.routeStatus,
    ]))
  }
  lines.push('')

  // ── 2. Switch-to-switch (S2S) links ─────────────────────────────
  lines.push('# ── 2. SWITCH-TO-SWITCH (S2S) ──')
  lines.push(csvRow([
    'SrcFloor', 'SrcSwitch', 'TargetFloor', 'TargetSwitch',
    'CableType', 'CableLengthM', 'RouteStatus',
  ]))
  const s2sRows = []
  for (const link of switchLinks.values()) {
    const src = swById.get(link.srcId)
    const tgt = swById.get(link.targetId)
    s2sRows.push({
      srcFloorIdx: floors.findIndex((f) => f.id === link.srcFloorId),
      srcFloor: floorName(link.srcFloorId),
      srcName: src?.name ?? link.srcId,
      tgtFloor: floorName(link.targetFloorId),
      tgtName: tgt?.name ?? link.targetId,
      cableType: link.cableType,
      cableM: round(link.cableM, 2),
      routeStatus: link.routeStatus,
    })
  }
  s2sRows.sort((a, b) => a.srcFloorIdx - b.srcFloorIdx || a.srcName.localeCompare(b.srcName))
  for (const r of s2sRows) {
    lines.push(csvRow([
      r.srcFloor, r.srcName, r.tgtFloor, r.tgtName,
      r.cableType, r.cableM, r.routeStatus,
    ]))
  }
  if (s2sRows.length === 0) {
    // Marker row so a downstream parser sees "section exists but empty"
    // rather than treating the missing rows as parse error.
    lines.push('# (no S2S links)')
  }
  lines.push('')

  // ── 3. Cable trays ──────────────────────────────────────────────
  lines.push('# ── 3. CABLE TRAYS ──')
  lines.push(csvRow([
    'FloorName', 'TrayName', 'System', 'LengthM',
    'WidthMm', 'DepthMm', 'MountHeightM',
    'CableCount', 'FillRatioPct',
  ]))
  const trayRows = []
  for (const floor of floors) {
    const list = traysByFloor[floor.id] ?? []
    for (const tray of list) {
      // Per-tray length: px → m via floor scale. computeTrayBOM only exposes
      // per-floor totals, so we recompute the tray's own length here.
      const px = polylineLengthPx(tray.points)
      const lengthM = floor?.scale && floor.scale > 0 ? px / floor.scale : null
      const fill = trayFillByKey.get(`${floor.id}|${tray.id}`)
      const pct = fill?.fillRatio != null ? round(fill.fillRatio * 100, 1) : null
      trayRows.push({
        floorIdx: floors.findIndex((f) => f.id === floor.id),
        floorName: floor.name ?? floor.id,
        trayName: tray.name ?? tray.id,
        system: tray.system ?? '',
        lengthM: round(lengthM, 2),
        widthMm: tray.widthMm ?? '',
        depthMm: tray.depthMm ?? '',
        mountHeightM: round(tray.mountHeight, 2),
        cableCount: fill?.count ?? 0,
        fillPct: pct,
      })
    }
  }
  trayRows.sort((a, b) => a.floorIdx - b.floorIdx || a.trayName.localeCompare(b.trayName))
  for (const r of trayRows) {
    lines.push(csvRow([
      r.floorName, r.trayName, r.system, r.lengthM,
      r.widthMm, r.depthMm, r.mountHeightM,
      r.cableCount, r.fillPct,
    ]))
  }
  if (trayRows.length === 0) {
    lines.push('# (no trays)')
  }
  lines.push('')

  // ── 4. Summary totals ───────────────────────────────────────────
  // Compute totals from the data we just emitted so the summary stays
  // consistent with the row sections above.
  let totalApM = 0
  let totalS2sM = 0
  let copperM = 0
  let fiberM = 0
  for (const r of apRows) {
    if (r.cableM != null) {
      totalApM += r.cableM
      if (r.cableType === 'fiber') fiberM += r.cableM
      else copperM += r.cableM
    }
  }
  for (const r of s2sRows) {
    if (r.cableM != null) {
      totalS2sM += r.cableM
      if (r.cableType === 'fiber') fiberM += r.cableM
      else copperM += r.cableM
    }
  }
  const trayTotal = round(trayBOM?.totalLengthM, 2)
  const trayTotalWaste = round(trayBOM?.totalLengthWithWasteM, 2)

  lines.push('# ── 4. SUMMARY ──')
  lines.push(csvRow([
    'TotalAPCableM', 'TotalS2SCableM', 'CopperTotalM', 'FiberTotalM',
    'TrayLengthM', `TrayLengthWithWasteM (×${wasteFactor.toFixed(2)})`,
    'LFittings', 'TJoints', 'Crosses',
  ]))
  lines.push(csvRow([
    round(totalApM, 2),
    round(totalS2sM, 2),
    round(copperM, 2),
    round(fiberM, 2),
    trayTotal,
    trayTotalWaste,
    trayBOM?.lfits ?? 0,
    trayBOM?.tjoints ?? 0,
    trayBOM?.crosses ?? 0,
  ]))

  return lines.join('\r\n')   // \r\n so Excel on Windows reads it cleanly
}

// Trigger a browser download of the given CSV string. UTF-8 BOM prefix so
// Excel on Windows defaults to the right encoding for any non-ASCII
// floor / tray names (e.g. "1F" is fine but "一樓" needs the BOM).
export function triggerCSVDownload(csvText, filename = 'floorplan-bom.csv') {
  // Guard against SSR / test env (no DOM).
  if (typeof document === 'undefined') return false
  const blob = new Blob(['﻿', csvText], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // appendChild ensures the click() works in Firefox (Chrome / Safari are
  // fine without). Cleanup happens synchronously after click — the blob
  // URL stays alive long enough for the download to start.
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return true
}

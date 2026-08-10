// PDF Planning Report.
//
// Port of oldSrc/features/cable/exportPlanningPdf.js (Phase 22-2) onto the PIXI
// renderer, PLUS the RF half the old report never had: per-floor coverage /
// blind-spot / verdict numbers from the Phase 42 plan-quality engine. The
// backlog item asks for "涵蓋熱圖截圖 + AP 清單 + verdict + Planning BOM", and
// only the cabling side existed before.
//
// Document layout:
//   Page 1            cover (title, timestamp, building-wide summary)
//   Page 2            RF COVERAGE — per-floor coverage %, blind area, verdict
//   Pages 3 .. N+2    one per floor — plan snapshot + per-floor summary
//   Page N+3          AP CABLE detail table (auto-paginated)
//   Page N+4          S2S link detail (skipped when empty)
//   Page N+5          TRAY BOM + capacity bottlenecks
//   Page N+6          Warnings (Unroutable / Graph / channel conflicts)
//
// Implementation notes carried over from oldSrc:
//   - jsPDF ships Latin fonts only. The report is deliberately English-headed
//     so we don't have to lazy-load a ~3 MB CJK font, and any non-ASCII name
//     that sneaks in (a renamed floor) is transliterated to `?` by asciiSafe.
//     The cover documents this so a floor labelled "一樓" showing as `?？` is
//     not read as data corruption.
//   - Page snapshots come from capturePlanPng — the same path the standalone
//     PNG export uses, so the PDF matches what the user can export by hand.
//
// New-src differences from the oldSrc version, all forced by the port:
//   - capturePlanPng takes { app, world } (PIXI) instead of a Konva stage, and
//     is reached through getSceneRefs() so it works in production builds too.
//   - routes / switchLinks / warnings come from getCachedRoutes in one call
//     rather than the old buildPlanningSnapshot helper.
//   - tray fill is recomputed here via computeTrayCableLoads + computeTrayFill
//     instead of being handed in as a prebuilt map.

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { capturePlanPng } from '@/features/exportPng/exportPlanView'
import { getSceneRefs } from '@/render/sceneRegistry'
import { getCachedRoutes } from '@/features/cable/routesCache'
import { computeTrayBOM } from '@/features/cable/computeTrayBOM'
import { computeTrayCableLoads, computeTrayFill } from '@/features/cable/computeTrayFill'
import { getCapacityProfile, DEFAULT_CAPACITY_PROFILE } from '@/store/useCableStore'
import { computePlanQualityStats } from '@/features/heatmap/planQuality'
import { COVERAGE_THRESHOLD_DBM, COVERAGE_TARGET_PCT } from '@/constants/coverage'

const FONT = 'helvetica'

// Header fill used by every table, and the two alert fills.
const HEAD_FILL = [30, 41, 59]
const DANGER_FILL = [220, 38, 38]
const WARN_FILL = [217, 119, 6]

// Replace any code point outside printable ASCII with `?`, keeping a couple of
// sensible substitutions. jsPDF drops an entire text run when it hits a glyph
// the font can't map, so this must run on every user-supplied string.
function asciiSafe(s) {
  if (s == null) return { text: '', dirty: false }
  let dirty = false
  const out = String(s).replace(/[^\x20-\x7E]/g, (ch) => {
    dirty = true
    if (ch === ' ') return ' '
    if (ch === '–' || ch === '—') return '-'
    return '?'
  })
  return { text: out, dirty }
}

const T = (s) => asciiSafe(s).text

const bucketLen = (m) => (m < 30 ? 'short' : m < 90 ? 'mid' : 'long')

// computeTrayFill's statusLabel is Chinese (注意 / 滿載 / 超出), which the
// Latin-only font would render as "??". Map the status KEY to English instead of
// transliterating the label.
const FILL_STATUS_EN = {
  ok: 'OK',
  warn: 'Near limit',
  full: 'At limit',
  exceed: 'Over limit',
}

// Polyline length in metres for one tray (same recompute the panel does).
function trayLengthM(tray, floor) {
  const pts = tray.points ?? []
  let lenPx = 0
  for (let i = 0; i < pts.length - 1; i++) {
    lenPx += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
  }
  return floor.scale && floor.scale > 0 ? lenPx / floor.scale : null
}

// Build the PDF.
//
// Inputs are the raw store slices; everything derived (routes, BOM, tray fill,
// plan quality) is computed here so a caller can't hand in a stale snapshot.
//
//   floors            ordered floor list
//   apsByFloor        { [floorId]: AP[] }
//   wallsByFloor      { [floorId]: Wall[] }   (plan-quality input)
//   scopesByFloor     { [floorId]: Scope[] }  (plan-quality input)
//   switchesByFloor   { [floorId]: Switch[] }
//   traysByFloor      { [floorId]: Tray[] }
//   risers            Riser[]
//   wasteFactor       tray BOM waste multiplier
//   capacityProfile   tray fill rule id  + customCapacity for 'custom'
//   regulatoryDomain  label for the cover
//   coverageTargetPct verdict threshold (defaults to the shared constant)
//   thresholdDbm      coverage threshold (defaults to the shared constant)
//   setActiveFloor    switches floors so each plan PNG paints the right content
//   getActiveFloorId  read the current floor; restored at the end
//   onProgress        (msg) => void, for a status string in the UI
//
// Returns Promise<Blob>. The caller triggers the download.
export async function buildPlanningPdf({
  floors = [],
  apsByFloor = {},
  wallsByFloor = {},
  scopesByFloor = {},
  switchesByFloor = {},
  traysByFloor = {},
  risers = [],
  wasteFactor = 1.10,
  capacityProfile = DEFAULT_CAPACITY_PROFILE,
  customCapacity = null,
  regulatoryDomain = 'TW',
  coverageTargetPct = COVERAGE_TARGET_PCT,
  thresholdDbm = COVERAGE_THRESHOLD_DBM,
  setActiveFloor = () => {},
  getActiveFloorId = () => null,
  onProgress = () => {},
}) {
  const { routes, switchLinks, warnings } = getCachedRoutes({
    floors, apsByFloor, switchesByFloor, traysByFloor, risers,
  })
  const trayBOM = computeTrayBOM({ floors, traysByFloor, wasteFactor })
  const trayLoads = computeTrayCableLoads({ routes, switchLinks, traysByFloor })
  const profile = getCapacityProfile(capacityProfile, customCapacity)

  // Cross-floor name lookups.
  const apById = new Map()
  for (const list of Object.values(apsByFloor)) {
    for (const a of list ?? []) apById.set(a.id, a)
  }
  const swById = new Map()
  for (const list of Object.values(switchesByFloor)) {
    for (const s of list ?? []) swById.set(s.id, s)
  }
  const floorById = new Map(floors.map((f) => [f.id, f]))
  const floorName = (id) => T(floorById.get(id)?.name ?? id)

  // Track whether any name needed transliteration, so the caveat line on the
  // cover is only stated when it actually applies.
  let anyLossyName = false
  for (const f of floors) if (asciiSafe(f.name).dirty) anyLossyName = true

  // A4 landscape — plan images are usually wider than tall.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 32

  // ── Cover ──────────────────────────────────────────────────────────
  onProgress('產生封面...')
  doc.setFont(FONT, 'bold')
  doc.setFontSize(22)
  doc.text('Floorplan Planning Report', margin, margin + 18)

  doc.setFont(FONT, 'normal')
  doc.setFontSize(10)
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const meta = [
    `Generated: ${now} UTC`,
    `Regulatory domain: ${T(regulatoryDomain)}`,
    `Floors: ${floors.length}`,
  ]
  meta.forEach((line, i) => doc.text(line, margin, margin + 44 + i * 14))

  let totalApM = 0
  let totalS2sM = 0
  let copperM = 0
  let fiberM = 0
  for (const r of routes.values()) {
    if (r.cableM == null) continue
    totalApM += r.cableM
    if (r.cableType === 'fiber') fiberM += r.cableM
    else copperM += r.cableM
  }
  for (const link of switchLinks.values()) {
    if (link.cableM == null) continue
    totalS2sM += link.cableM
    if (link.cableType === 'fiber') fiberM += link.cableM
    else copperM += link.cableM
  }
  let totalSwitches = 0
  for (const list of Object.values(switchesByFloor)) totalSwitches += (list ?? []).length
  let totalTrays = 0
  for (const list of Object.values(traysByFloor)) totalTrays += (list ?? []).length
  let totalAPs = 0
  for (const list of Object.values(apsByFloor)) totalAPs += (list ?? []).length

  autoTable(doc, {
    startY: margin + 90,
    head: [['Metric', 'Value']],
    body: [
      ['APs', String(totalAPs)],
      ['APs with a cable route', String(routes.size)],
      ['Switches', String(totalSwitches)],
      ['Trays', String(totalTrays)],
      ['Risers', String(risers.length)],
      ['AP cable total (m)', totalApM.toFixed(1)],
      ['S2S cable total (m)', totalS2sM.toFixed(1)],
      ['Copper total (m)', copperM.toFixed(1)],
      ['Fiber total (m)', fiberM.toFixed(1)],
      ['Tray length (m)', (trayBOM?.totalLengthM ?? 0).toFixed(1)],
      [`Tray length + waste (x${wasteFactor.toFixed(2)})`,
        (trayBOM?.totalLengthWithWasteM ?? 0).toFixed(1)],
      ['Tray fittings (L / T / X)',
        `${trayBOM?.lfits ?? 0} / ${trayBOM?.tjoints ?? 0} / ${trayBOM?.crosses ?? 0}`],
    ],
    styles: { font: FONT, fontSize: 10 },
    headStyles: { fillColor: HEAD_FILL, textColor: 255 },
    margin: { left: margin },
    tableWidth: 320,
  })

  doc.setFontSize(9)
  doc.setTextColor(120)
  const caveat = anyLossyName
    ? 'Planning estimate. Not a construction final BOM. Non-ASCII names are shown transliterated.'
    : 'Planning estimate. Not a construction final BOM.'
  doc.text(caveat, margin, pageH - margin)
  doc.setTextColor(0)

  // ── RF coverage + verdict ──────────────────────────────────────────
  // The half the oldSrc report lacked. Runs the same engine the planning-quality
  // panel uses, per floor, so the PDF verdict and the on-screen verdict cannot
  // disagree. Floors without a calibrated scale are reported as such rather than
  // silently scored — a coverage % computed without a scale is meaningless.
  onProgress('產生 RF 涵蓋率...')
  doc.addPage()
  doc.setFont(FONT, 'bold')
  doc.setFontSize(14)
  doc.text('RF COVERAGE', margin, margin + 14)
  doc.setFont(FONT, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(
    `Coverage = share of in-scope floor area at or above ${thresholdDbm} dBm. `
    + `Target ${coverageTargetPct}%. Reflections/diffraction off (first-order estimate).`,
    margin, margin + 30,
  )
  doc.setTextColor(0)

  const covRows = []
  const conflictRows = []
  for (const floor of floors) {
    const aps = apsByFloor[floor.id] ?? []
    if (!floor.scale) {
      covRows.push([floorName(floor.id), String(aps.length), 'no scale set', '-', '-', '-', 'NOT MEASURED'])
      continue
    }
    const q = computePlanQualityStats({
      floor,
      walls: wallsByFloor[floor.id] ?? [],
      aps,
      scopes: scopesByFloor[floor.id] ?? [],
      thresholdDbm,
    })
    if (!q) {
      covRows.push([floorName(floor.id), String(aps.length), 'n/a', '-', '-', '-', 'NOT MEASURED'])
      continue
    }
    covRows.push([
      floorName(floor.id),
      String(q.apCount),
      `${q.coveragePct.toFixed(1)}%`,
      `${q.secondaryCoveragePct.toFixed(1)}%`,
      `${q.blindPct.toFixed(1)}%`,
      q.blindAreaM2.toFixed(0),
      q.coveragePct >= coverageTargetPct ? 'PASS' : 'BELOW TARGET',
    ])
    for (const c of q.channelConflicts ?? []) {
      conflictRows.push([
        floorName(floor.id),
        T(apById.get(c.apA)?.name ?? c.apA),
        T(apById.get(c.apB)?.name ?? c.apB),
        `${c.band} GHz`,
        String(c.channel),
      ])
    }
  }

  autoTable(doc, {
    startY: margin + 40,
    head: [['Floor', 'APs', 'Coverage', 'Redundant (>=2 AP)', 'Blind', 'Blind area (m2)', 'Verdict']],
    body: covRows,
    styles: { font: FONT, fontSize: 9 },
    headStyles: { fillColor: HEAD_FILL, textColor: 255 },
    margin: { left: margin, right: margin },
    // Colour only the verdict cell — a fully tinted row would fight the table.
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 6) return
      const v = data.cell.raw
      if (v === 'PASS') data.cell.styles.textColor = [16, 185, 129]
      else if (v === 'BELOW TARGET') data.cell.styles.textColor = DANGER_FILL
      else data.cell.styles.textColor = [120, 120, 120]
    },
  })

  // ── Per-floor pages ────────────────────────────────────────────────
  // Each plan PNG needs its floor to be the ACTIVE one, because the scene only
  // ever holds the active floor's content. We restore the user's floor after.
  const originalFloorId = getActiveFloorId()

  for (let i = 0; i < floors.length; i++) {
    const floor = floors[i]
    onProgress(`產生 ${T(floor.name ?? floor.id)} (${i + 1}/${floors.length})...`)

    setActiveFloor(floor.id)
    // Let React commit and the scene repaint the new floor before we bake it.
    await new Promise((resolve) => setTimeout(resolve, 220))

    doc.addPage()
    doc.setFont(FONT, 'bold')
    doc.setFontSize(16)
    doc.text(`Floor: ${floorName(floor.id)}`, margin, margin + 14)

    let floorApM = 0
    let floorAPCount = 0
    let floorUnroutable = 0
    for (const r of routes.values()) {
      if (r.homeFloorId !== floor.id) continue
      floorAPCount++
      if (r.routeStatus === 'unroutable') floorUnroutable++
      if (r.cableM != null) floorApM += r.cableM
    }
    doc.setFont(FONT, 'normal')
    doc.setFontSize(10)
    doc.text(
      `APs: ${floorAPCount}    Cable: ${floorApM.toFixed(1)} m    Unroutable: ${floorUnroutable}`,
      margin, margin + 32,
    )

    const refs = getSceneRefs()
    if (refs && floor.imageUrl && floor.imageWidth && floor.imageHeight) {
      const png = capturePlanPng({
        app: refs.app,
        world: refs.world,
        imageWidth: floor.imageWidth,
        imageHeight: floor.imageHeight,
        pixelRatio: 2,
      })
      if (png) {
        const avail = {
          x: margin,
          y: margin + 46,
          w: pageW - margin * 2,
          h: pageH - margin - (margin + 46),
        }
        // Fit inside the remaining area, preserving aspect ratio.
        const imgRatio = floor.imageWidth / floor.imageHeight
        const boxRatio = avail.w / avail.h
        const drawW = imgRatio > boxRatio ? avail.w : avail.h * imgRatio
        const drawH = imgRatio > boxRatio ? avail.w / imgRatio : avail.h
        doc.addImage(
          png, 'PNG',
          avail.x + (avail.w - drawW) / 2,
          avail.y + (avail.h - drawH) / 2,
          drawW, drawH, undefined, 'FAST',
        )
      }
    } else {
      doc.setFontSize(11)
      doc.setTextColor(150)
      doc.text(
        refs ? '(no plan image imported for this floor)' : '(canvas not ready — snapshot skipped)',
        margin, margin + 80,
      )
      doc.setTextColor(0)
    }
  }

  if (originalFloorId) {
    setActiveFloor(originalFloorId)
    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  // ── AP cables ──────────────────────────────────────────────────────
  onProgress('產生 AP 線纜表...')
  doc.addPage()
  doc.setFont(FONT, 'bold')
  doc.setFontSize(14)
  doc.text('AP CABLES', margin, margin + 14)

  const apRows = []
  for (const r of routes.values()) {
    const ap = apById.get(r.apId)
    const sw = r.switchId ? swById.get(r.switchId) : null
    apRows.push({
      floorIdx: floors.findIndex((f) => f.id === r.homeFloorId),
      floorName: floorName(r.homeFloorId),
      apName: T(ap?.name ?? r.apId),
      swName: T(sw?.name ?? ''),
      cableType: r.cableType ?? '',
      cableM: r.cableM != null ? r.cableM.toFixed(2) : '',
      zDropM: r.zDropM != null ? r.zDropM.toFixed(2) : '',
      bucket: r.cableM != null ? bucketLen(r.cableM) : '',
      status: r.routeStatus,
    })
  }
  apRows.sort((a, b) => a.floorIdx - b.floorIdx || a.apName.localeCompare(b.apName))
  autoTable(doc, {
    startY: margin + 26,
    head: [['Floor', 'AP', 'Switch', 'Type', 'Length (m)', 'Z-drop (m)', 'Bracket', 'Status']],
    body: apRows.map((r) => [
      r.floorName, r.apName, r.swName, r.cableType, r.cableM, r.zDropM, r.bucket, r.status,
    ]),
    styles: { font: FONT, fontSize: 9 },
    headStyles: { fillColor: HEAD_FILL, textColor: 255 },
    margin: { left: margin, right: margin },
  })

  // ── Switch-to-switch ───────────────────────────────────────────────
  if (switchLinks.size > 0) {
    onProgress('產生 S2S 連線表...')
    doc.addPage()
    doc.setFont(FONT, 'bold')
    doc.setFontSize(14)
    doc.text('SWITCH-TO-SWITCH', margin, margin + 14)
    const s2sRows = []
    for (const link of switchLinks.values()) {
      s2sRows.push([
        floorName(link.srcFloorId),
        T(swById.get(link.srcId)?.name ?? link.srcId),
        floorName(link.targetFloorId),
        T(swById.get(link.targetId)?.name ?? link.targetId),
        T(link.tier ?? ''),
        link.cableType,
        link.cableM != null ? link.cableM.toFixed(2) : '',
        link.routeStatus,
      ])
    }
    autoTable(doc, {
      startY: margin + 26,
      head: [['Src Floor', 'Src SW', 'Tgt Floor', 'Tgt SW', 'Tier', 'Type', 'Length (m)', 'Status']],
      body: s2sRows,
      styles: { font: FONT, fontSize: 9 },
      headStyles: { fillColor: HEAD_FILL, textColor: 255 },
      margin: { left: margin, right: margin },
    })
  }

  // ── Trays ──────────────────────────────────────────────────────────
  onProgress('產生線槽 BOM...')
  doc.addPage()
  doc.setFont(FONT, 'bold')
  doc.setFontSize(14)
  doc.text('CABLE TRAYS', margin, margin + 14)
  doc.setFont(FONT, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(120)
  // Design principle: warnings say "exceeds the selected fill rule", never
  // "code violation" — the profile is a user choice, not a regulation.
  //
  // The profile's own label is CJK ("Planning（25% / 40%）") and would come out
  // as "Planning?25% / 40%?" through the Latin-only font, so state the ratios
  // numerically instead of transliterating the label.
  const warnPct = profile?.warnRatio != null ? `${(profile.warnRatio * 100).toFixed(0)}%` : '-'
  const fullPct = profile?.fullRatio != null ? `${(profile.fullRatio * 100).toFixed(0)}%` : '-'
  doc.text(
    `Fill rule: ${T(profile?.value ?? capacityProfile)} (warn ${warnPct} / full ${fullPct}). `
    + 'Flagged trays exceed the selected fill rule.',
    margin, margin + 30,
  )
  doc.setTextColor(0)

  const trayRows = []
  const bottlenecks = []
  for (const floor of floors) {
    for (const tray of traysByFloor[floor.id] ?? []) {
      const load = trayLoads.get(`${floor.id}|${tray.id}`) ?? { count: 0, copperCount: 0, fiberCount: 0 }
      const fill = computeTrayFill({ tray, load, profile })
      const lenM = trayLengthM(tray, floor)
      trayRows.push([
        floorName(floor.id),
        T(tray.name ?? tray.id),
        T(tray.system ?? ''),
        lenM != null ? lenM.toFixed(2) : '',
        tray.widthMm ?? '',
        tray.depthMm ?? '',
        tray.mountHeight?.toFixed?.(2) ?? '',
        fill?.count ?? 0,
        fill?.fillRatio != null ? (fill.fillRatio * 100).toFixed(1) : '',
      ])
      if (fill.status !== 'ok') {
        bottlenecks.push([
          floorName(floor.id),
          T(tray.name ?? tray.id),
          `${(fill.fillRatio * 100).toFixed(1)}%`,
          String(fill.count),
          FILL_STATUS_EN[fill.status] ?? fill.status,
        ])
      }
    }
  }
  autoTable(doc, {
    startY: margin + 40,
    head: [['Floor', 'Tray', 'System', 'Length (m)', 'W (mm)', 'D (mm)', 'Mount (m)', 'Cables', 'Fill %']],
    body: trayRows,
    styles: { font: FONT, fontSize: 9 },
    headStyles: { fillColor: HEAD_FILL, textColor: 255 },
    margin: { left: margin, right: margin },
  })

  if (bottlenecks.length > 0) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 18,
      head: [['Floor', 'Tray', 'Fill %', 'Cables', 'Status']],
      body: bottlenecks,
      styles: { font: FONT, fontSize: 9 },
      headStyles: { fillColor: WARN_FILL, textColor: 255 },
      margin: { left: margin, right: margin },
    })
  }

  // ── Warnings ───────────────────────────────────────────────────────
  const unroutableAPs = []
  for (const r of routes.values()) {
    if (r.routeStatus !== 'unroutable') continue
    unroutableAPs.push([floorName(r.homeFloorId), T(apById.get(r.apId)?.name ?? r.apId)])
  }
  if (unroutableAPs.length + warnings.length + conflictRows.length > 0) {
    onProgress('產生警告...')
    doc.addPage()
    doc.setFont(FONT, 'bold')
    doc.setFontSize(14)
    doc.text('WARNINGS', margin, margin + 14)

    let cursorY = margin + 30

    if (unroutableAPs.length > 0) {
      doc.setFont(FONT, 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...DANGER_FILL)
      doc.text(`Unroutable APs (${unroutableAPs.length})`, margin, cursorY)
      doc.setTextColor(0)
      autoTable(doc, {
        startY: cursorY + 6,
        head: [['Floor', 'AP']],
        body: unroutableAPs,
        styles: { font: FONT, fontSize: 9 },
        headStyles: { fillColor: DANGER_FILL, textColor: 255 },
        margin: { left: margin, right: margin },
      })
      cursorY = doc.lastAutoTable.finalY + 16
    }

    if (conflictRows.length > 0) {
      doc.setFont(FONT, 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...WARN_FILL)
      doc.text(`Co-channel conflicts (${conflictRows.length})`, margin, cursorY)
      doc.setTextColor(0)
      autoTable(doc, {
        startY: cursorY + 6,
        head: [['Floor', 'AP A', 'AP B', 'Band', 'Channel']],
        body: conflictRows,
        styles: { font: FONT, fontSize: 9 },
        headStyles: { fillColor: WARN_FILL, textColor: 255 },
        margin: { left: margin, right: margin },
      })
      cursorY = doc.lastAutoTable.finalY + 16
    }

    if (warnings.length > 0) {
      doc.setFont(FONT, 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...WARN_FILL)
      doc.text(`Graph warnings (${warnings.length})`, margin, cursorY)
      doc.setTextColor(0)
      autoTable(doc, {
        startY: cursorY + 6,
        head: [['#', 'Message']],
        body: warnings.map((w, i) => [String(i + 1), T(w)]),
        styles: { font: FONT, fontSize: 9, cellWidth: 'wrap' },
        headStyles: { fillColor: WARN_FILL, textColor: 255 },
        margin: { left: margin, right: margin },
        columnStyles: { 0: { cellWidth: 24 } },
      })
    }
  }

  // Page numbers, added last so the total is known.
  const pageCount = doc.internal.getNumberOfPages()
  doc.setFont(FONT, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(140)
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.text(`${p} / ${pageCount}`, pageW - margin, pageH - margin + 10, { align: 'right' })
  }
  doc.setTextColor(0)

  onProgress('完成')
  return doc.output('blob')
}

// Trigger a download for the produced Blob.
export function triggerPdfDownload(blob, filename = 'planning-report.pdf') {
  if (typeof document === 'undefined') return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return true
}

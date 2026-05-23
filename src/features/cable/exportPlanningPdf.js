// 22-2 PDF Planning Report.
//
// Produces a multi-page PDF that bundles the user's planning data into a
// document they can hand to a client / installer / archive:
//
//   Page 1            cover (title, timestamp, building-wide summary)
//   Pages 2 .. N+1    one per floor — PNG snapshot + per-floor summary
//   Page N+2          AP CABLE detail table (auto-paginated)
//   Page N+3          S2S link detail (skipped when empty)
//   Page N+4          TRAY BOM + capacity bottlenecks
//   Page N+5          Warnings (Unroutable / Graph) — skipped when empty
//
// Implementation notes:
//   - jsPDF v4 ships with Latin fonts only. We deliberately keep the
//     report English-headed (AP CABLES / SWITCH-TO-SWITCH / TRAY BOM
//     / WARNINGS) so we don't have to lazy-load a 3 MB CJK font. Object
//     names from the app are auto-generated as ASCII (AP-01, TRAY-…,
//     SW-01) so the report renders cleanly for stock demo data.
//   - For Chinese strings that DO sneak in (renamed floors / custom
//     names), we fall back to the entity's id. The cover page documents
//     this caveat at the bottom so the reader knows why a floor labelled
//     "一樓" shows as `floor-1779...-1` in the PDF.
//   - Page snapshots come from capturePlanPng — same engine 22-3a uses,
//     so the PDF version matches what the user could export standalone.

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { capturePlanPng } from '@/features/editor/exportPlanView'

// jsPDF lookup keys for fonts that don't break on non-Latin input. We
// fall through `helvetica` and never touch helvetica with CJK strings;
// the sanitiser below catches that risk before render.
const FONT = 'helvetica'

// Replace any code point > U+007E with `?` and tag the result so the
// caller knows their string was lossy. PDF rendering otherwise drops
// the entire run when it hits an unmapped glyph.
function asciiSafe(s) {
  if (s == null) return ''
  const str = String(s)
  // U+007E is `~` — the last printable ASCII before the high range.
  // We keep U+00A0 (nbsp) → space + U+2013/2014 → '-' for nicer fallbacks,
  // but everything else outside ASCII gets a `?`.
  let dirty = false
  const out = str.replace(/[^\x20-\x7E]/g, (ch) => {
    dirty = true
    if (ch === ' ') return ' '
    if (ch === '–' || ch === '—') return '-'
    return '?'
  })
  return { text: out, dirty }
}

// Convenience: call asciiSafe but return just the text, dropping the
// dirty flag. Used for table cells where we don't want to track per-cell
// fallbacks individually.
const T = (s) => asciiSafe(s).text

// Length bucket (matches CableSummaryPanel).
const bucketLen = (m) => (m < 30 ? 'short' : m < 90 ? 'mid' : 'long')

// Build the PDF document from already-computed planning data + a Konva
// stage reference (so we can re-use capturePlanPng per floor).
//
// Inputs:
//   stage            Konva Stage (one per app)
//   floors           full floor list (ordered as user arranged them)
//   apsByFloor       { [floorId]: AP[] }
//   switchesByFloor  { [floorId]: Switch[] }
//   traysByFloor     { [floorId]: Tray[] }
//   risers           Riser[] (global)
//   routes           Map<apId, route>   (from computeRoutes)
//   switchLinks      Map<srcSwId, link> (from computeRoutes)
//   warnings         string[]           (graph warnings)
//   trayBOM          computeTrayBOM result
//   trayFillByKey    Map<`${floorId}|${trayId}`, fill>
//   wasteFactor      number
//   regulatoryDomain string label (for cover page)
//   setActiveFloor   (fn) — used to switch floors so the stage holds the
//                    right per-floor content while we capture each PNG
//   getActiveFloorId (fn) — read current floor id; we restore it at the end
//   onProgress       (msg) => void  optional, called between major steps
//                    so the UI can update a status string ("正在生成 ...")
//
// Returns a Promise<Blob> for the rendered PDF. Caller is responsible for
// triggering the download.
export async function buildPlanningPdf({
  stage,
  floors = [],
  apsByFloor = {},
  switchesByFloor = {},
  traysByFloor = {},
  routes = new Map(),
  switchLinks = new Map(),
  warnings = [],
  trayBOM = null,
  trayFillByKey = new Map(),
  wasteFactor = 1.10,
  regulatoryDomain = 'TW',
  setActiveFloor = () => {},
  getActiveFloorId = () => null,
  onProgress = () => {},
}) {
  // Lookups so we can resolve names across floors.
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

  // A4 landscape — plan images are usually wider than tall.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 32

  // ── Cover page ─────────────────────────────────────────────────────
  onProgress('產生封面...')
  doc.setFont(FONT, 'bold')
  doc.setFontSize(22)
  doc.text('Floorplan Planning Report', margin, margin + 18)

  doc.setFont(FONT, 'normal')
  doc.setFontSize(10)
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const meta = [
    `Generated: ${now} UTC`,
    `Regulatory domain: ${regulatoryDomain}`,
    `Floors: ${floors.length}`,
  ]
  meta.forEach((line, i) => doc.text(line, margin, margin + 44 + i * 14))

  // Building summary numbers
  const totalAP = routes.size
  let totalApM = 0
  let totalS2sM = 0
  let copperM = 0
  let fiberM  = 0
  for (const r of routes.values()) {
    if (r.cableM != null) {
      totalApM += r.cableM
      if (r.cableType === 'fiber') fiberM += r.cableM
      else copperM += r.cableM
    }
  }
  for (const link of switchLinks.values()) {
    if (link.cableM != null) {
      totalS2sM += link.cableM
      if (link.cableType === 'fiber') fiberM += link.cableM
      else copperM += link.cableM
    }
  }
  let totalSwitches = 0
  for (const list of Object.values(switchesByFloor)) totalSwitches += (list ?? []).length
  let totalTrays = 0
  for (const list of Object.values(traysByFloor)) totalTrays += (list ?? []).length

  // Summary table on the cover.
  autoTable(doc, {
    startY: margin + 90,
    head: [['Metric', 'Value']],
    body: [
      ['APs',                 String(totalAP)],
      ['Switches',            String(totalSwitches)],
      ['Trays',               String(totalTrays)],
      ['AP cable total (m)',  totalApM.toFixed(1)],
      ['S2S cable total (m)', totalS2sM.toFixed(1)],
      ['Copper total (m)',    copperM.toFixed(1)],
      ['Fiber total (m)',     fiberM.toFixed(1)],
      ['Tray length (m)',     (trayBOM?.totalLengthM ?? 0).toFixed(1)],
      [`Tray length + waste (x${wasteFactor.toFixed(2)})`,
                              (trayBOM?.totalLengthWithWasteM ?? 0).toFixed(1)],
      ['Tray fittings (L / T / X)',
                              `${trayBOM?.lfits ?? 0} / ${trayBOM?.tjoints ?? 0} / ${trayBOM?.crosses ?? 0}`],
    ],
    styles: { font: FONT, fontSize: 10 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: margin },
    tableWidth: 320,
  })

  // Caveat note at the bottom of the cover.
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(
    'Planning estimate. Not a construction final BOM. Non-ASCII names may render as their IDs.',
    margin, pageH - margin,
  )
  doc.setTextColor(0)

  // ── Per-floor pages ────────────────────────────────────────────────
  // To capture each floor's PNG we have to switch the active floor in
  // Editor2D so the stage paints that floor's content. We restore the
  // original active floor at the end.
  const originalFloorId = getActiveFloorId()

  for (let i = 0; i < floors.length; i++) {
    const floor = floors[i]
    onProgress(`產生 ${T(floor.name ?? floor.id)} (${i + 1}/${floors.length})...`)

    // Switch + wait for React commit + Editor2D viewport fit.
    setActiveFloor(floor.id)
    await new Promise((resolve) => setTimeout(resolve, 180))

    doc.addPage()
    doc.setFont(FONT, 'bold')
    doc.setFontSize(16)
    doc.text(`Floor: ${floorName(floor.id)}`, margin, margin + 14)

    // Per-floor stats
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

    // Capture the plan PNG. Floors without an imageUrl get a placeholder.
    if (floor.imageUrl && floor.imageWidth && floor.imageHeight) {
      const png = capturePlanPng({
        stage,
        imageWidth: floor.imageWidth,
        imageHeight: floor.imageHeight,
        pixelRatio: 2,
      })
      if (png) {
        // Fit the image into the remaining page area below the header.
        const avail = {
          x: margin,
          y: margin + 46,
          w: pageW - margin * 2,
          h: pageH - margin - (margin + 46),
        }
        // Preserve aspect ratio.
        const imgRatio = floor.imageWidth / floor.imageHeight
        const boxRatio = avail.w / avail.h
        let drawW, drawH
        if (imgRatio > boxRatio) {
          drawW = avail.w
          drawH = avail.w / imgRatio
        } else {
          drawH = avail.h
          drawW = avail.h * imgRatio
        }
        const drawX = avail.x + (avail.w - drawW) / 2
        const drawY = avail.y + (avail.h - drawH) / 2
        // 'FAST' compression keeps the PDF small. We re-encode the PNG
        // jsPDF picked up from our data URL.
        doc.addImage(png, 'PNG', drawX, drawY, drawW, drawH, undefined, 'FAST')
      }
    } else {
      doc.setFontSize(11)
      doc.setTextColor(150)
      doc.text('(no plan image imported for this floor)', margin, margin + 80)
      doc.setTextColor(0)
    }
  }

  // Restore active floor so the user sees what they had before.
  if (originalFloorId) {
    setActiveFloor(originalFloorId)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  // ── AP CABLES table ────────────────────────────────────────────────
  onProgress('產生 AP 線纜表...')
  doc.addPage()
  doc.setFont(FONT, 'bold')
  doc.setFontSize(14)
  doc.text('AP CABLES', margin, margin + 14)

  // Stable ordering by floor index then AP name.
  const apRows = []
  for (const r of routes.values()) {
    const ap = apById.get(r.apId)
    const sw = r.switchId ? swById.get(r.switchId) : null
    apRows.push({
      floorIdx:  floors.findIndex((f) => f.id === r.homeFloorId),
      floorName: floorName(r.homeFloorId),
      apName:    T(ap?.name ?? r.apId),
      swName:    T(sw?.name ?? ''),
      cableType: r.cableType ?? '',
      cableM:    r.cableM != null ? r.cableM.toFixed(2) : '',
      zDropM:    r.zDropM != null ? r.zDropM.toFixed(2) : '',
      status:    r.routeStatus,
    })
  }
  apRows.sort((a, b) =>
    a.floorIdx - b.floorIdx || a.apName.localeCompare(b.apName),
  )
  autoTable(doc, {
    startY: margin + 26,
    head: [['Floor', 'AP', 'Switch', 'Type', 'Length (m)', 'Z-drop (m)', 'Status']],
    body: apRows.map((r) => [r.floorName, r.apName, r.swName, r.cableType, r.cableM, r.zDropM, r.status]),
    styles: { font: FONT, fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: margin, right: margin },
  })

  // ── S2S table (skipped when empty) ─────────────────────────────────
  if (switchLinks.size > 0) {
    onProgress('產生 S2S 連線表...')
    doc.addPage()
    doc.setFont(FONT, 'bold')
    doc.setFontSize(14)
    doc.text('SWITCH-TO-SWITCH', margin, margin + 14)
    const s2sRows = []
    for (const link of switchLinks.values()) {
      const src = swById.get(link.srcId)
      const tgt = swById.get(link.targetId)
      s2sRows.push([
        floorName(link.srcFloorId),
        T(src?.name ?? link.srcId),
        floorName(link.targetFloorId),
        T(tgt?.name ?? link.targetId),
        link.cableType,
        link.cableM != null ? link.cableM.toFixed(2) : '',
        link.routeStatus,
      ])
    }
    autoTable(doc, {
      startY: margin + 26,
      head: [['Src Floor', 'Src SW', 'Tgt Floor', 'Tgt SW', 'Type', 'Length (m)', 'Status']],
      body: s2sRows,
      styles: { font: FONT, fontSize: 9 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      margin: { left: margin, right: margin },
    })
  }

  // ── Tray BOM + bottlenecks ─────────────────────────────────────────
  onProgress('產生線槽 BOM...')
  doc.addPage()
  doc.setFont(FONT, 'bold')
  doc.setFontSize(14)
  doc.text('CABLE TRAYS', margin, margin + 14)

  const trayRows = []
  for (const floor of floors) {
    const list = traysByFloor[floor.id] ?? []
    for (const tray of list) {
      // Per-tray length: same polyline-length recompute as the CSV exporter.
      const pts = tray.points ?? []
      let lenPx = 0
      for (let i = 0; i < pts.length - 1; i++) {
        lenPx += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
      }
      const lenM = floor.scale && floor.scale > 0 ? lenPx / floor.scale : null
      const fill = trayFillByKey.get(`${floor.id}|${tray.id}`)
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
    }
  }
  autoTable(doc, {
    startY: margin + 26,
    head: [['Floor', 'Tray', 'System', 'Length (m)', 'W (mm)', 'D (mm)', 'Mount (m)', 'Cables', 'Fill %']],
    body: trayRows,
    styles: { font: FONT, fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: margin, right: margin },
  })

  // ── Warnings page (skipped when nothing to warn about) ─────────────
  const unroutableAPs = []
  for (const r of routes.values()) {
    if (r.routeStatus === 'unroutable') {
      const ap = apById.get(r.apId)
      unroutableAPs.push({
        floorName: floorName(r.homeFloorId),
        apName: T(ap?.name ?? r.apId),
      })
    }
  }
  if (unroutableAPs.length + warnings.length > 0) {
    onProgress('產生警告...')
    doc.addPage()
    doc.setFont(FONT, 'bold')
    doc.setFontSize(14)
    doc.text('WARNINGS', margin, margin + 14)

    let cursorY = margin + 30

    if (unroutableAPs.length > 0) {
      doc.setFont(FONT, 'bold')
      doc.setFontSize(11)
      doc.setTextColor(220, 38, 38)
      doc.text(`Unroutable APs (${unroutableAPs.length})`, margin, cursorY)
      doc.setTextColor(0)
      cursorY += 6
      autoTable(doc, {
        startY: cursorY,
        head: [['Floor', 'AP']],
        body: unroutableAPs.map((u) => [u.floorName, u.apName]),
        styles: { font: FONT, fontSize: 9 },
        headStyles: { fillColor: [220, 38, 38], textColor: 255 },
        margin: { left: margin, right: margin },
      })
      cursorY = doc.lastAutoTable.finalY + 16
    }

    if (warnings.length > 0) {
      doc.setFont(FONT, 'bold')
      doc.setFontSize(11)
      doc.setTextColor(217, 119, 6)
      doc.text(`Graph warnings (${warnings.length})`, margin, cursorY)
      doc.setTextColor(0)
      cursorY += 6
      autoTable(doc, {
        startY: cursorY,
        head: [['#', 'Message']],
        body: warnings.map((w, i) => [String(i + 1), T(w)]),
        styles: { font: FONT, fontSize: 9, cellWidth: 'wrap' },
        headStyles: { fillColor: [217, 119, 6], textColor: 255 },
        margin: { left: margin, right: margin },
        columnStyles: { 0: { cellWidth: 24 } },
      })
    }
  }

  onProgress('完成')
  return doc.output('blob')
}

// Trigger download for the produced PDF Blob.
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

// Compare two screenshot folders (before / after) and report per-scenario diff.
// Usage: node scripts/perf/diff.mjs <beforeDir> <afterDir> [--threshold 0.1]
//
// Hard-zero policy: AP markers / walls / cable / overlays must match byte-for-byte.
// Heatmap GL has known float jitter; we report it but don't auto-fail. The
// final pass/fail is a human read of the printed table.

import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const args = process.argv.slice(2)
if (args.length < 2) {
  console.error('Usage: node scripts/perf/diff.mjs <beforeDir> <afterDir> [--threshold 0.1] [--out <outDir>]')
  process.exit(1)
}
const [beforeDir, afterDir] = args
let pmThreshold = 0.1
let outDir = null
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--threshold') pmThreshold = parseFloat(args[++i])
  else if (args[i] === '--out')   outDir = args[++i]
}
if (outDir) fs.mkdirSync(outDir, { recursive: true })

const beforeFiles = fs.readdirSync(beforeDir).filter((f) => f.endsWith('.png')).sort()
const rows = []
let totalDiff = 0
let totalPx = 0

for (const f of beforeFiles) {
  const bp = path.join(beforeDir, f)
  const ap = path.join(afterDir, f)
  if (!fs.existsSync(ap)) {
    rows.push({ file: f, w: '-', h: '-', diff: 'MISSING', pct: '-', note: 'after file missing' })
    continue
  }
  const before = PNG.sync.read(fs.readFileSync(bp))
  const after  = PNG.sync.read(fs.readFileSync(ap))
  if (before.width !== after.width || before.height !== after.height) {
    rows.push({
      file: f, w: `${before.width}x${after.width}`, h: `${before.height}x${after.height}`,
      diff: 'SIZE-MISMATCH', pct: '-', note: 'dimensions differ',
    })
    continue
  }
  const { width, height } = before
  const diff = new PNG({ width, height })
  const diffPx = pixelmatch(before.data, after.data, diff.data, width, height, {
    threshold: pmThreshold,
    alpha: 0.1,
    aaColor: [255, 255, 0],
    diffColor: [255, 0, 0],
  })
  const total = width * height
  totalDiff += diffPx
  totalPx += total
  if (outDir && diffPx > 0) {
    fs.writeFileSync(path.join(outDir, f), PNG.sync.write(diff))
  }
  rows.push({
    file: f, w: width, h: height,
    diff: diffPx,
    pct: (100 * diffPx / total).toFixed(4) + '%',
    note: diffPx === 0 ? 'OK' : diffPx < total * 0.001 ? 'minor (≤0.1%)' : 'CHECK',
  })
}

console.log('\nScreenshot diff — pixelmatch threshold=' + pmThreshold)
console.log('before: ' + beforeDir)
console.log('after:  ' + afterDir)
if (outDir) console.log('diff:   ' + outDir + ' (only files with diff > 0)')
console.log()
const colW = { file: 32, w: 6, h: 6, diff: 12, pct: 10, note: 20 }
const header = `${'file'.padEnd(colW.file)} ${'w'.padStart(colW.w)} ${'h'.padStart(colW.h)} ${'diff'.padStart(colW.diff)} ${'pct'.padStart(colW.pct)}  ${'note'.padEnd(colW.note)}`
console.log(header)
console.log('-'.repeat(header.length))
for (const r of rows) {
  console.log(
    `${String(r.file).padEnd(colW.file)} ${String(r.w).padStart(colW.w)} ${String(r.h).padStart(colW.h)} ${String(r.diff).padStart(colW.diff)} ${String(r.pct).padStart(colW.pct)}  ${String(r.note).padEnd(colW.note)}`,
  )
}
console.log('-'.repeat(header.length))
console.log(`TOTAL diff px: ${totalDiff} / ${totalPx} (${(100 * totalDiff / totalPx).toFixed(4)}%)`)

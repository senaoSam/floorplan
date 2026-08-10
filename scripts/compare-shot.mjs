// Compose before/after comparison images for visual-change review.
//
// Usage:
//   node scripts/compare-shot.mjs decode <in.txt> <out.png>
//   node scripts/compare-shot.mjs join <before.png> <after.png> <out.png> [label]
//
// `decode` turns a data-URL dump (as produced by the Playwright MCP
// browser_evaluate `filename` option) into a real PNG.
//
// `join` stacks a before/after pair side by side with a divider and BEFORE /
// AFTER captions, so a reviewer can see the change in one glance instead of
// alt-tabbing between two files. Pure PNG encode/decode via zlib — no image
// dependency, because the repo intentionally has no imaging library and this
// harness is regenerated on demand rather than committed as a build step.

import fs from 'node:fs'
import zlib from 'node:zlib'

// ── minimal PNG reader (8-bit RGB/RGBA, non-interlaced) ────────────────────
function readPng(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${file}`)
  let pos = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0
  const idat = []
  let palette = null, trns = null
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'PLTE') palette = Buffer.from(data)
    else if (type === 'tRNS') trns = Buffer.from(data)
    else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`color type ${colorType} unsupported`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    const row = raw.subarray(rp, rp + stride); rp += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= channels ? prev[x - channels] : 0
      let v = row[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
  }

  // Normalise everything to RGBA so the compositor has one code path.
  const rgba = Buffer.alloc(width * height * 4, 255)
  for (let i = 0, n = width * height; i < n; i++) {
    if (colorType === 3) {
      const idx = out[i] * 3
      rgba[i * 4] = palette[idx]; rgba[i * 4 + 1] = palette[idx + 1]; rgba[i * 4 + 2] = palette[idx + 2]
      rgba[i * 4 + 3] = trns && out[i] < trns.length ? trns[out[i]] : 255
    } else if (channels === 1) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i]
    } else if (channels === 2) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i * 2]
      rgba[i * 4 + 3] = out[i * 2 + 1]
    } else if (channels === 3) {
      rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]
    } else {
      rgba[i * 4] = out[i * 4]; rgba[i * 4 + 1] = out[i * 4 + 1]
      rgba[i * 4 + 2] = out[i * 4 + 2]; rgba[i * 4 + 3] = out[i * 4 + 3]
    }
  }
  return { width, height, rgba }
}

function writePng({ width, height, rgba }, file) {
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0   // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

// ── 5x7 bitmap font, enough for the captions we draw ──────────────────────
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

function drawText(img, text, x0, y0, scale, rgb) {
  for (let ci = 0; ci < text.length; ci++) {
    const g = GLYPHS[text[ci].toUpperCase()]
    if (!g) continue
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (g[gy][gx] !== '1') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x0 + (ci * 6 + gx) * scale + sx
            const py = y0 + gy * scale + sy
            if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue
            const o = (py * img.width + px) * 4
            img.rgba[o] = rgb[0]; img.rgba[o + 1] = rgb[1]; img.rgba[o + 2] = rgb[2]; img.rgba[o + 3] = 255
          }
        }
      }
    }
  }
}

function fillRect(img, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= img.height) continue
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= img.width) continue
      const o = (y * img.width + x) * 4
      img.rgba[o] = rgb[0]; img.rgba[o + 1] = rgb[1]; img.rgba[o + 2] = rgb[2]; img.rgba[o + 3] = 255
    }
  }
}

function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x
      if (tx < 0 || tx >= dst.width) continue
      const so = (y * src.width + x) * 4
      const to = (ty * dst.width + tx) * 4
      dst.rgba[to] = src.rgba[so]
      dst.rgba[to + 1] = src.rgba[so + 1]
      dst.rgba[to + 2] = src.rgba[so + 2]
      dst.rgba[to + 3] = 255
    }
  }
}

const BAND = 34          // caption band height
const GAP = 8            // divider width
const CAPTION_SCALE = 3

function join(beforeFile, afterFile, outFile) {
  const a = readPng(beforeFile)
  const b = readPng(afterFile)
  const h = Math.max(a.height, b.height)
  const width = a.width + GAP + b.width
  const height = h + BAND
  const img = { width, height, rgba: Buffer.alloc(width * height * 4, 255) }
  fillRect(img, 0, 0, width, height, [15, 23, 42])
  blit(img, a, 0, BAND)
  blit(img, b, a.width + GAP, BAND)
  // Divider so the seam between two dark 3D renders is unmistakable.
  fillRect(img, a.width, 0, GAP, height, [248, 250, 252])
  drawText(img, 'BEFORE', 10, 8, CAPTION_SCALE, [148, 163, 184])
  drawText(img, 'AFTER', a.width + GAP + 10, 8, CAPTION_SCALE, [74, 222, 128])
  writePng(img, outFile)
  return { width, height }
}

function decode(inFile, outFile) {
  const txt = fs.readFileSync(inFile, 'utf8').trim().replace(/^"|"$/g, '')
  const b64 = txt.slice(txt.indexOf(',') + 1)
  fs.writeFileSync(outFile, Buffer.from(b64, 'base64'))
}

// Crop a region out of a shot, optionally magnifying it. Nearest-neighbour on
// purpose: these images are evidence about 1-2 px line widths, so a smoothing
// filter would blur away the very thing under review.
function crop(inFile, outFile, x, y, w, h, zoom = 1) {
  const src = readPng(inFile)
  const z = Math.max(1, Math.round(zoom))
  const img = { width: w * z, height: h * z, rgba: Buffer.alloc(w * z * h * z * 4, 255) }
  for (let dy = 0; dy < h * z; dy++) {
    const sy = y + Math.floor(dy / z)
    for (let dx = 0; dx < w * z; dx++) {
      const sx = x + Math.floor(dx / z)
      const to = (dy * img.width + dx) * 4
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue
      const so = (sy * src.width + sx) * 4
      img.rgba[to] = src.rgba[so]
      img.rgba[to + 1] = src.rgba[so + 1]
      img.rgba[to + 2] = src.rgba[so + 2]
      img.rgba[to + 3] = 255
    }
  }
  writePng(img, outFile)
  return { width: img.width, height: img.height }
}

// Report how many pixels differ, and where. Used to sanity-check that a
// before/after pair actually differs in the region under review (and to catch
// the "identical shots because the camera moved / nothing applied" failure).
function diff(aFile, bFile) {
  const a = readPng(aFile)
  const b = readPng(bFile)
  if (a.width !== b.width || a.height !== b.height) return { error: 'size mismatch' }
  let n = 0
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const o = (y * a.width + x) * 4
      if (Math.abs(a.rgba[o] - b.rgba[o]) > 6 ||
          Math.abs(a.rgba[o + 1] - b.rgba[o + 1]) > 6 ||
          Math.abs(a.rgba[o + 2] - b.rgba[o + 2]) > 6) {
        n++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const total = a.width * a.height
  return {
    changedPx: n,
    pct: +((n / total) * 100).toFixed(3),
    bbox: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  }
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'decode') {
  decode(rest[0], rest[1])
  console.log(`decoded → ${rest[1]}`)
} else if (cmd === 'join') {
  const r = join(rest[0], rest[1], rest[2])
  console.log(`joined → ${rest[2]} (${r.width}x${r.height})`)
} else if (cmd === 'crop') {
  const [inF, outF, x, y, w, h, zoom] = rest
  const r = crop(inF, outF, +x, +y, +w, +h, zoom ? +zoom : 1)
  console.log(`cropped → ${outF} (${r.width}x${r.height})`)
} else if (cmd === 'diff') {
  console.log(JSON.stringify(diff(rest[0], rest[1]), null, 2))
} else {
  console.error('usage: compare-shot.mjs decode <in.txt> <out.png>')
  console.error('   or: compare-shot.mjs join <before.png> <after.png> <out.png>')
  console.error('   or: compare-shot.mjs crop <in.png> <out.png> <x> <y> <w> <h> [zoom]')
  console.error('   or: compare-shot.mjs diff <a.png> <b.png>')
  process.exit(1)
}

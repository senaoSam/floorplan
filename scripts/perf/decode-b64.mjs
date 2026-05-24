// Decode a base64 PNG file to a real PNG.
// Usage: node scripts/perf/decode-b64.mjs <input.b64> <output.png>
import fs from 'node:fs'
const [inp, out] = process.argv.slice(2)
if (!inp || !out) { console.error('args: <input.b64> <output.png>'); process.exit(1) }
let raw = fs.readFileSync(inp, 'utf8').trim()
// Strip any quote chars MCP wrapper may add and `data:image/png;base64,` if still there
if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1)
raw = raw.replace(/^data:image\/png;base64,/, '').replace(/\s+/g, '')
fs.writeFileSync(out, Buffer.from(raw, 'base64'))
console.log('wrote ' + out + ' (' + Buffer.from(raw, 'base64').length + ' bytes)')

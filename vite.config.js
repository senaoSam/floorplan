import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

const SRC = path.resolve(__dirname, './src')
const OLD_SRC = path.resolve(__dirname, './oldSrc')
const EXTS = ['.jsx', '.js', '.ts', '.tsx', '.mjs', '.json']

// Resolve a bare `@/…` specifier (extension-less) against /oldSrc on disk.
function resolveUnderOldSrc(rel) {
  const base = path.resolve(OLD_SRC, rel)
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base
  for (const e of EXTS) if (fs.existsSync(base + e)) return base + e
  for (const e of EXTS) {
    const idx = path.join(base, 'index' + e)
    if (fs.existsSync(idx)) return idx
  }
  return null
}

// Per-importer `@/…` alias so the archived Konva build can run on the SAME
// dev server as the new PIXI build — no second `pnpm dev:oldsrc` needed.
//
//   new (PIXI):  index.html   → /src/main.jsx     →  @ resolves to /src
//   old (Konva): oldsrc.html  → /oldSrc/main.jsx  →  @ resolves to /oldSrc
//
// Open the archived build at:  http://localhost:5173/floorplan/oldsrc.html
//
// Only `@/…` specifiers imported from a JS/JSX file under /oldSrc are
// redirected; everything else falls through to the default `@ → /src` alias.
// (oldSrc `.sass` files also `@use '@/styles/variables'`, but that goes through
//  sass's own resolver — not this hook — and src/styles & oldSrc/styles
//  _variables.sass are byte-identical, so resolving to /src is harmless.)
const SRC_PREFIX = SRC.replace(/\\/g, '/') + '/'

function oldSrcScopedAlias() {
  return {
    name: 'oldsrc-scoped-alias',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null
      // Only redirect imports coming FROM a file under /oldSrc.
      if (!/(^|\/)oldSrc\//.test(importer.replace(/\\/g, '/'))) return null
      // vite's built-in alias plugin runs before this hook, so `@/x` may have
      // already been rewritten to an absolute `/src/x` path. Recover the
      // `@`-relative part from either form, then resolve it against /oldSrc.
      let rel = null
      if (source.startsWith('@/')) {
        rel = source.slice(2)
      } else {
        const s = source.replace(/\\/g, '/')
        if (s.startsWith(SRC_PREFIX)) rel = s.slice(SRC_PREFIX.length)
      }
      if (rel == null) return null
      // null falls through (e.g. sass `@/styles/variables` — handled by sass's
      // own resolver, and src/oldSrc _variables.sass are identical anyway).
      return resolveUnderOldSrc(rel)
    },
  }
}

export default defineConfig({
  base: '/floorplan/',
  plugins: [oldSrcScopedAlias(), react()],
  resolve: {
    alias: {
      '@': SRC,
    },
  },
  worker: {
    format: 'es',
  },
})

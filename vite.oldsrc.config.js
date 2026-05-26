import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Parallel dev config for the archived Konva implementation in /oldSrc.
// Used purely for side-by-side visual comparison against the new PIXI
// renderer in /src.
//
//   pnpm dev          → new (src) on port 5175 / base /floorplan/
//   pnpm dev:oldsrc   → old (oldSrc) on port 5180 / base /floorplan-old/
//                       served from oldsrc.html

export default defineConfig({
  base: '/floorplan-old/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './oldSrc'),
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5180,
    open: '/floorplan-old/oldsrc.html',
  },
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'oldsrc.html'),
    },
  },
})

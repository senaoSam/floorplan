import { Application, Text, TextStyle } from 'pixi.js'

const root = document.getElementById('root')

const app = new Application()

await app.init({
  resizeTo: window,
  background: '#0f1419',
  antialias: true,
  preference: 'webgpu',
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
})

root.appendChild(app.canvas)

const label = new Text({
  text: 'Phase 25 — 31-0 PixiJS scaffold',
  style: new TextStyle({
    fill: '#9aa3ad',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 14,
  }),
})
label.x = 16
label.y = 12
app.stage.addChild(label)

if (import.meta.env.DEV) {
  window.__pixiApp = app
}

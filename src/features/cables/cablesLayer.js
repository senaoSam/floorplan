import { Graphics } from 'pixi.js'
import { computeRoutes } from '@/features/cable/computeRoutes'
import { useEditorStore } from '@/store/useEditorStore'

// Cable adapter — runs computeRoutes against the full building data on
// every change to floor / AP / wall / cable stores, then draws the routes
// landing on the active floor. Visual rules ported from oldSrc CableLayer.jsx:
//
//   tray (AP → switch via tray) — solid cyan main run + dashed cyan drop
//     legs at endpoints (segments touching an 'endpoint' point.kind)
//   fallback-manhattan          — long-dash pale grey (no drop-leg split)
//   unroutable                  — small red ring at the AP
//
// 17-2 selection-driven focus:
//   * AP selected     → routes hitting that AP keep full opacity, others dim
//   * Switch selected → routes hitting that switch keep full opacity, others dim
//   * Focused routes additionally get an indigo highlight band underneath
//
// Mounted on scene.layers.cables which is set to eventMode='none' in
// scene.js — cables stay purely visual. Fiber/copper distinction is only
// rendered for switch-to-switch trunks (TODO 14-2, not in MVP).

const TRAY_COPPER_COLOR  = '#22d3ee'
const FALLBACK_COLOR     = '#9ca3af'
const UNROUTABLE_COLOR   = '#ef4444'
const HIGHLIGHT_COLOR    = 'rgba(129, 140, 248, 0.55)'  // indigo-400 @ 55%
const HIGHLIGHT_WIDTH    = 10
const TRAY_WIDTH_MAIN    = 1.6
const TRAY_WIDTH_DROP    = 1.4
const FALLBACK_WIDTH     = 1.2
const DROP_DASH_ON       = 6
const DROP_DASH_OFF      = 4
const FALLBACK_DASH_ON   = 14
const FALLBACK_DASH_OFF  = 10
const DIM_OPACITY        = 0.18

function drawSolidSegment(g, ax, ay, bx, by, color, width, alpha) {
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width, color, alpha })
}

function drawDashedSegment(g, ax, ay, bx, by, color, width, dashOn, dashOff, alpha) {
  const len = Math.hypot(bx - ax, by - ay)
  if (len <= 1e-9) return
  const ux = (bx - ax) / len
  const uy = (by - ay) / len
  let cursor = 0
  let phaseOn = true
  let remain = dashOn
  while (cursor < len) {
    const step = Math.min(len - cursor, remain)
    const x1 = ax + ux * cursor
    const y1 = ay + uy * cursor
    const x2 = ax + ux * (cursor + step)
    const y2 = ay + uy * (cursor + step)
    if (phaseOn) g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width, color, alpha })
    cursor += step
    remain -= step
    if (remain <= 1e-9) {
      phaseOn = !phaseOn
      remain = phaseOn ? dashOn : dashOff
    }
  }
}

export function attachCablesLayer({
  scene,
  useFloorStore,
  useAPStore,
  useCableStore,
}) {
  const layer = scene.layers.cables
  const g = new Graphics()
  g.eventMode = 'none' // pure visual — never intercept clicks
  layer.addChild(g)

  const rebuild = () => {
    const { floors, activeFloorId } = useFloorStore.getState()
    const apsByFloor = useAPStore.getState().apsByFloor
    const switchesByFloor = useCableStore.getState().switchesByFloor
    const traysByFloor = useCableStore.getState().traysByFloor
    const risers = useCableStore.getState().risers
    const editor = useEditorStore.getState()

    g.clear()
    if (!activeFloorId || floors.length === 0) return

    const { routes } = computeRoutes({
      floors,
      apsByFloor,
      switchesByFloor,
      traysByFloor,
      risers,
    })

    const hasFocus = editor.selectedId && (editor.selectedType === 'ap' || editor.selectedType === 'switch')
    const isRouteFocused = (r) => {
      if (!hasFocus) return false
      if (editor.selectedType === 'ap')     return r.apId     === editor.selectedId
      if (editor.selectedType === 'switch') return r.switchId === editor.selectedId
      return false
    }

    // First pass: indigo highlight band UNDER all focused routes.
    if (hasFocus) {
      const activeAps = apsByFloor[activeFloorId] ?? []
      for (const ap of activeAps) {
        const route = routes.get(ap.id)
        if (!route || !isRouteFocused(route)) continue
        if (route.routeStatus === 'unroutable') continue
        const pts = route.points
        if (!pts || pts.length < 2) continue
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i]
          if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
          g.moveTo(a.x, a.y).lineTo(b.x, b.y)
            .stroke({ width: HIGHLIGHT_WIDTH, color: HIGHLIGHT_COLOR, alpha: 1, cap: 'round' })
        }
      }
    }

    // Second pass: actual cable lines.
    const activeAps = apsByFloor[activeFloorId] ?? []
    for (const ap of activeAps) {
      const route = routes.get(ap.id)
      if (!route) continue
      const focused = isRouteFocused(route)
      const alpha = hasFocus && !focused ? DIM_OPACITY : 0.95
      if (route.routeStatus === 'unroutable') {
        g.circle(ap.x, ap.y, 14)
          .stroke({ width: 2, color: UNROUTABLE_COLOR, alpha: 0.9 * alpha })
        continue
      }
      const pts = route.points
      if (!pts || pts.length < 2) continue

      if (route.routeStatus === 'fallback-manhattan') {
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i]
          if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
          drawDashedSegment(g, a.x, a.y, b.x, b.y, FALLBACK_COLOR, FALLBACK_WIDTH, FALLBACK_DASH_ON, FALLBACK_DASH_OFF, alpha)
        }
        continue
      }

      // tray route — per-segment: dashed drop legs at endpoints, solid mid.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        if (a.floorId !== activeFloorId || b.floorId !== activeFloorId) continue
        const isDrop = a.kind === 'endpoint' || b.kind === 'endpoint'
        if (isDrop) {
          drawDashedSegment(g, a.x, a.y, b.x, b.y, TRAY_COPPER_COLOR, TRAY_WIDTH_DROP, DROP_DASH_ON, DROP_DASH_OFF, alpha * 0.9)
        } else {
          drawSolidSegment(g, a.x, a.y, b.x, b.y, TRAY_COPPER_COLOR, TRAY_WIDTH_MAIN, alpha)
        }
      }
    }
  }

  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubAP = useAPStore.subscribe(rebuild)
  const unsubCable = useCableStore.subscribe(rebuild)
  // Selection drives focus dim — must also subscribe.
  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  const unsubEditor = useEditorStore.subscribe(() => {
    const s = useEditorStore.getState()
    if (s.selectedId === lastSelectedId && s.selectedType === lastSelectedType) return
    lastSelectedId = s.selectedId
    lastSelectedType = s.selectedType
    rebuild()
  })
  rebuild()

  return () => {
    unsubFloor()
    unsubAP()
    unsubCable()
    unsubEditor()
    layer.removeChild(g)
    g.destroy()
  }
}

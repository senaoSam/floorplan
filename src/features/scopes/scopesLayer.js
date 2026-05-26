import { Graphics } from 'pixi.js'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'

// Scope adapter — fills + outlines polygon scopes on scene.layers.scopes.
// Colours match oldSrc:
//   in-scope  (type='in')  → green fill + solid green stroke
//   out-scope (type='out') → red fill + dashed red stroke
//
// Selection + hover invert handled in-layer per oldSrc concept:
//   selected → red stroke 5 px
//   hovered  → white stroke 5 px (mimics 23-3f hover invert)

const COLOR_IN_FILL    = 'rgba(46, 213, 115, 0.18)'
const COLOR_IN_STROKE  = '#2ed573'
const COLOR_OUT_FILL   = 'rgba(255, 71, 87, 0.18)'
const COLOR_OUT_STROKE = '#ff4757'
const SELECT_STROKE    = '#e74c3c'
const HOVER_STROKE     = '#ffffff'
const STROKE_WIDTH     = 3
const STROKE_WIDTH_EMPHASIS = 5
const DASH_ON  = 8
const DASH_OFF = 4

function drawDashedPolygon(g, flat, dashOn, dashOff, opts) {
  if (!flat || flat.length < 4) return
  const n = flat.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const cx = flat[i * 2], cy = flat[i * 2 + 1]
    const tx = flat[j * 2], ty = flat[j * 2 + 1]
    const len = Math.hypot(tx - cx, ty - cy)
    if (len <= 1e-9) continue
    const ux = (tx - cx) / len
    const uy = (ty - cy) / len
    let cursor = 0
    let phaseOn = true
    let remain = dashOn
    while (cursor < len) {
      const step = Math.min(len - cursor, remain)
      const x1 = cx + ux * cursor
      const y1 = cy + uy * cursor
      const x2 = cx + ux * (cursor + step)
      const y2 = cy + uy * (cursor + step)
      if (phaseOn) g.moveTo(x1, y1).lineTo(x2, y2).stroke(opts)
      cursor += step
      remain -= step
      if (remain <= 1e-9) {
        phaseOn = !phaseOn
        remain = phaseOn ? dashOn : dashOff
      }
    }
  }
}

export function attachScopesLayer({ scene, useFloorStore, useScopeStore }) {
  const layer = scene.layers.scopes
  const g = new Graphics()
  layer.addChild(g)

  const rebuild = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const scopes = useScopeStore.getState().scopesByFloor[activeFloorId] ?? []
    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    g.clear()
    for (const scope of scopes) {
      if (!scope.points || scope.points.length < 4) continue
      const flat = scope.points.slice()
      const isOut = scope.type === 'out'
      const isSelected = editorState.selectedId === scope.id && editorState.selectedType === 'scope'
      const isHovered  = hoverState.id === scope.id && hoverState.type === 'scope'
      g.poly(flat).fill({
        color: isOut ? COLOR_OUT_FILL : COLOR_IN_FILL,
        alpha: 1,
      })
      const baseStroke = isOut ? COLOR_OUT_STROKE : COLOR_IN_STROKE
      let stroke = baseStroke
      let width = STROKE_WIDTH
      if (isSelected) { stroke = SELECT_STROKE; width = STROKE_WIDTH_EMPHASIS }
      else if (isHovered) { stroke = HOVER_STROKE; width = STROKE_WIDTH_EMPHASIS }
      // Hover / selected always renders solid; only the unstyled out-scope
      // uses the dashed pattern — when the user is actively hovering it the
      // solid emphasis reads better and matches oldSrc.
      if (isOut && !isSelected && !isHovered) {
        drawDashedPolygon(g, flat, DASH_ON, DASH_OFF, { width, color: stroke, alpha: 1 })
      } else {
        g.poly(flat).stroke({ width, color: stroke, alpha: 1 })
      }
    }
  }

  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubScope = useScopeStore.subscribe(rebuild)
  const unsubEditor = useEditorStore.subscribe(rebuild)
  const unsubHover = useHoverStore.subscribe(rebuild)
  rebuild()

  return () => {
    unsubFloor()
    unsubScope()
    unsubEditor()
    unsubHover()
    layer.removeChild(g)
    g.destroy()
  }
}

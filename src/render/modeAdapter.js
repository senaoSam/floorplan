import { getModeCapability } from '@/render/modeCapabilities'

// Wires editor mode → canvas-side side-effects:
//   * canvas cursor (oldSrc capability.cursor)
//   * per-layer dim opacity (cap.keepLayers — layers in the keep-list
//     stay at full opacity, everything else dims to 0.4). Replaces the
//     prior category-based dim so e.g. PLACE_AP correctly dims walls
//     even though the user might want to see scopes (different layer
//     but same 'struct' category).
//
// Pan-mode override: when a viewport pan is in flight, stage.cursor is
// 'grabbing' / 'grab' — that wins over the mode cursor because
// viewport.js sets it directly on stage. Mode cursor sets canvas.style
// instead, so the two cursors don't collide (canvas.style is the
// default; stage.cursor overrides only while a pointer event is active).

// Every scene layer that participates in dim/keep. heatmap included so
// PLACE_AP can keep it bright while every other mode fades it.
const DIMMABLE_LAYER_KEYS = [
  'floorImage',
  'heatmap',
  'walls',
  'scopes',
  'cables',
  'trays',
  'devicesAP',
  'devicesSW',
  'devicesRiser',
]

export function attachModeAdapter({ scene, canvas, useEditorStore }) {
  const apply = () => {
    const mode = useEditorStore.getState().editorMode
    const cap = getModeCapability(mode)
    if (canvas) canvas.style.cursor = cap.cursor ?? 'default'
    const keep = cap.keepLayers
    const keepAll = keep === 'all'
    for (const key of DIMMABLE_LAYER_KEYS) {
      const layer = scene.layers[key]
      if (!layer) continue
      const isKept = keepAll || (Array.isArray(keep) && keep.includes(key))
      layer.alpha = isKept ? 1 : 0.4
    }
  }

  let lastMode = null
  const onChange = () => {
    const mode = useEditorStore.getState().editorMode
    if (mode === lastMode) return
    lastMode = mode
    apply()
  }
  apply()
  const unsub = useEditorStore.subscribe(onChange)
  return () => unsub()
}

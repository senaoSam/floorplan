import { getModeCapability } from '@/render/modeCapabilities'

// Wires editor mode → canvas-side side-effects:
//   * stage cursor (oldSrc capability.cursor)
//   * per-layer dim opacity (oldSrc capability.dimOthers — fade non-
//     target object categories to ~0.4 so the canvas visually reads
//     "you are in X mode")
//
// Ports the oldSrc `useEffect` blocks in Editor2D.jsx that set
// container.style.cursor and layer.opacity. Centralised here so
// every layer doesn't need its own subscription.
//
// Pan-mode override: when a viewport pan is in flight, stage.cursor is
// 'grabbing' / 'grab' — that wins over the mode cursor because
// viewport.js sets it directly on stage. Mode cursor sets canvas.style
// instead, so the two cursors don't collide (canvas.style is the
// default; stage.cursor overrides only while a pointer event is active).

export function attachModeAdapter({ scene, canvas, useEditorStore }) {
  const layerCategoryMap = [
    { layer: scene.layers.walls,    cat: 'struct'   },
    { layer: scene.layers.scopes,   cat: 'struct'   },   // FloorHole rides on scopes layer
    { layer: scene.layers.cables,   cat: 'cable'    },
    { layer: scene.layers.trays,    cat: 'cable'    },
    { layer: scene.layers.devicesAP,    cat: 'wireless' },
    { layer: scene.layers.devicesSW,    cat: 'cable'    },
    { layer: scene.layers.devicesRiser, cat: 'cable'    },
    { layer: scene.layers.floorImage,   cat: 'meta'     },
  ]

  const apply = () => {
    const mode = useEditorStore.getState().editorMode
    const cap = getModeCapability(mode)
    // Cursor — set on the actual canvas element so it takes effect even
    // when no pointer is over a PIXI interactive container.
    if (canvas) canvas.style.cursor = cap.cursor ?? 'default'
    // Dim non-target categories. opacity 1 (visible) / 0.4 (faded).
    for (const { layer, cat } of layerCategoryMap) {
      if (!layer) continue
      layer.alpha = cap.dimOthers.includes(cat) ? 0.4 : 1
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

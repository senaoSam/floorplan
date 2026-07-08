// Wires the editor store's show* flags to scene.layers[*].visible so the
// LayerToggle panel can show/hide entire layers without each adapter
// needing its own subscription. Per-band AP / per-kind Switch filtering
// stays inside the respective layers (those need to re-render the
// subset).
//
// CAMERA mode (Phase 34) overrides the toggles: per design consensus the
// mode shows ONLY walls + floor image — every other content layer is
// hidden outright (not dimmed). The show* flags are untouched, so leaving
// the mode restores exactly what the user had toggled on.

import { EDITOR_MODE } from '@/store/useEditorStore'

const MAP = [
  ['showFloorImage', 'floorImage'],
  ['showWalls',      'walls'],
  ['showAPs',        'devicesAP'],
  ['showSwitches',   'devicesSW'],
  ['showRisers',     'devicesRiser'],
  ['showCableTrays', 'trays'],
  ['showCables',     'cables'],
  ['showScopes',     'scopes'],
  ['showFloorHoles', 'floorHoles'],
]

// Layers force-hidden while in CAMERA mode (floorImage / walls stay).
const CAMERA_HIDDEN = new Set([
  'devicesAP', 'devicesSW', 'devicesRiser', 'trays', 'cables', 'scopes', 'floorHoles',
])

export function bindLayerVisibility({ scene, useEditorStore }) {
  const apply = () => {
    const s = useEditorStore.getState()
    const inCamera = s.editorMode === EDITOR_MODE.CAMERA
    const inStats = s.editorMode === EDITOR_MODE.STATS
    for (const [key, layerKey] of MAP) {
      const layer = scene.layers[layerKey]
      if (layer) layer.visible = !!s[key] && !(inCamera && CAMERA_HIDDEN.has(layerKey))
    }
    // heatmap has no LayerToggle entry (heatmapAdapter manages its sprite via
    // the heatmap store) — but CAMERA and STATS modes must blank it: CAMERA is
    // walls-only, and STATS draws its own AP-load glow that reads clearer
    // without the RSSI field underneath. Gate the whole container here.
    if (scene.layers.heatmap) scene.layers.heatmap.visible = !inCamera && !inStats
  }
  const unsubscribe = useEditorStore.subscribe(apply)
  apply()
  return unsubscribe
}

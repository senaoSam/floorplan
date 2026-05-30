// Wires the editor store's show* flags to scene.layers[*].visible so the
// LayerToggle panel can show/hide entire layers without each adapter
// needing its own subscription. Per-band AP / per-kind Switch filtering
// stays inside the respective layers (those need to re-render the
// subset).

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

export function bindLayerVisibility({ scene, useEditorStore }) {
  const apply = () => {
    const s = useEditorStore.getState()
    for (const [key, layerKey] of MAP) {
      const layer = scene.layers[layerKey]
      if (layer) layer.visible = !!s[key]
    }
  }
  const unsubscribe = useEditorStore.subscribe(apply)
  apply()
  return unsubscribe
}

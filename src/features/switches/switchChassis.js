// Shared chassis sizing — used by switchesLayer + selectionOverlayLayer
// + hoverOverlayLayer so they all draw the same footprint.
//
// Rules ported from oldSrc SwitchLayer.jsx (29-6):
//   widthMult = portCount >= 48 ? 1.5 : portCount <= 12 ? 0.8 : 1.0
//   isCore    = sw.isCoreLayer || kind === 'mdf' || kind === 'router'
//   w = 30 * widthMult
//   h = isCore ? 22 : 18

const KIND_LABEL_MAP = {
  switch: 'SW',
  idf:    'IDF',
  mdf:    'MDF',
  router: 'RTR',
}

export function getChassisSize(sw) {
  const portCount = sw?.portCount ?? 24
  const kind = sw?.kind ?? 'switch'
  const isCore = !!sw?.isCoreLayer || kind === 'mdf' || kind === 'router'
  const widthMult = portCount >= 48 ? 1.5 : portCount <= 12 ? 0.8 : 1.0
  return {
    w: 30 * widthMult,
    h: isCore ? 22 : 18,
    isCore,
    kind,
    portCount,
  }
}

export function getKindLabel(kind) {
  return KIND_LABEL_MAP[kind] ?? 'SW'
}

// Port pip dot count — proxies port density without trying to render all 48.
export function getPortDotCount(portCount) {
  if (portCount >= 48) return 12
  if (portCount >= 24) return 8
  if (portCount >= 12) return 6
  return 4
}

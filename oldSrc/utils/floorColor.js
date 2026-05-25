// Distinct tint colors for reference floor overlays in align mode.
// Chosen for good contrast against dark canvas and the active floor's walls.
const PALETTE = [
  '#ef5350', // red
  '#26c6da', // cyan
  '#ffca28', // amber
  '#66bb6a', // green
  '#ab47bc', // purple
  '#ff7043', // deep orange
  '#42a5f5', // blue
  '#d4e157', // lime
]

export function getFloorColor(index) {
  if (index < 0) return PALETTE[0]
  return PALETTE[index % PALETTE.length]
}

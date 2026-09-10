import { useEditorStore } from '@/store/useEditorStore'

// Floor-plate visibility, shared by every layer that paints a full-floor
// rectangle: the slab itself, the heatmap planes, and the camera overlays.
//
// Hiding just the slab wasn't enough to read a stacked building — those
// overlay planes span the same floor rect, so their square corners kept
// drawing the storey outline the slab had stopped drawing. They follow the
// plate now: faded with it, gone with it.
//
// 'solid' — normal. 'ghost' — translucent, storeys below show through.
// 'off'   — not drawn at all.

// Fraction of normal opacity a plate-following surface keeps in ghost mode.
// Higher than the slab's own ghost factor: these planes ARE the data the user
// came for, so they fade to "readable through" rather than "barely there".
export const GHOST_OVERLAY_OPACITY = 0.35

// Multiplier to apply to a plane's normal opacity, or null when it shouldn't
// draw at all. Call sites: `const k = floorPlateOpacityFactor(plate)`.
export function floorPlateOpacityFactor(plate) {
  if (plate === 'off') return null
  return plate === 'ghost' ? GHOST_OVERLAY_OPACITY : 1
}

// Hook form for the plane components, which read the mode straight from the
// store rather than taking it as a prop.
export function useFloorPlateFactor() {
  const plate = useEditorStore((s) => s.floorPlate3D)
  return floorPlateOpacityFactor(plate)
}

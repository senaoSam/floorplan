import { EDITOR_MODE } from '@/store/useEditorStore'

// Drives scene.contentWrap's transform from the active floor's align
// fields. Only applied while editor is in ALIGN_FLOOR mode — every other
// mode resets the wrap to identity so the per-active-floor layers
// (floorImage / walls / aps / ...) render at their natural world coords
// like they always have.
//
// Mirrors oldSrc Editor2D `alignLayerProps(activeFloor)`:
//   pivot = (imageWidth/2, imageHeight/2)
//   position = pivot + (alignOffsetX, alignOffsetY)
//   rotation = alignRotation (degrees → radians)
//   scale = alignScale
export function bindAlignTransform({ scene, useEditorStore, useFloorStore }) {
  const wrap = scene.contentWrap

  const apply = () => {
    const mode = useEditorStore.getState().editorMode
    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)

    if (mode !== EDITOR_MODE.ALIGN_FLOOR || !floor) {
      wrap.position.set(0, 0)
      wrap.pivot.set(0, 0)
      wrap.rotation = 0
      wrap.scale.set(1, 1)
      return
    }

    const cx = (floor.imageWidth ?? 0) / 2
    const cy = (floor.imageHeight ?? 0) / 2
    const ox = floor.alignOffsetX ?? 0
    const oy = floor.alignOffsetY ?? 0
    const sc = floor.alignScale ?? 1
    const rt = ((floor.alignRotation ?? 0) * Math.PI) / 180

    wrap.pivot.set(cx, cy)
    wrap.position.set(cx + ox, cy + oy)
    wrap.rotation = rt
    wrap.scale.set(sc, sc)
  }

  const unsubEditor = useEditorStore.subscribe(apply)
  const unsubFloor  = useFloorStore.subscribe(apply)
  apply()

  return () => {
    unsubEditor()
    unsubFloor()
    // Reset to identity so the wrap is sane after teardown.
    wrap.position.set(0, 0)
    wrap.pivot.set(0, 0)
    wrap.rotation = 0
    wrap.scale.set(1, 1)
  }
}

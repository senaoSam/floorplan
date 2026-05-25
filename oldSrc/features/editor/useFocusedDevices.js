import { useMemo } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { computeRoutes } from '@/features/cable/computeRoutes'

// 17-2: which APs / switches are "related" to the current selection so the
// layers can draw an indigo halo around them.
//   - AP selected → its destination switch
//   - Switch selected → every AP whose route lands on this switch, plus any
//     other switches linked to it via S2S uplinks
// Returns Set instances so callers can do O(1) membership tests.
export function useFocusedDevices() {
  const selectedId   = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const floors          = useFloorStore((s) => s.floors)
  const apsByFloor      = useAPStore((s) => s.apsByFloor)
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const traysByFloor    = useCableStore((s) => s.traysByFloor)
  const risers          = useCableStore((s) => s.risers)

  return useMemo(() => {
    const aps = new Set()
    const switches = new Set()
    if (!selectedId || (selectedType !== 'ap' && selectedType !== 'switch')) {
      return { aps, switches }
    }
    const { routes, switchLinks } = computeRoutes({
      floors, apsByFloor, switchesByFloor, traysByFloor, risers,
    })
    if (selectedType === 'ap') {
      const r = routes.get(selectedId)
      if (r?.switchId) switches.add(r.switchId)
    } else {
      // selectedType === 'switch'
      for (const [apId, r] of routes) {
        if (r.switchId === selectedId) aps.add(apId)
      }
      for (const link of switchLinks.values()) {
        if (link.srcId === selectedId)    switches.add(link.targetId)
        if (link.targetId === selectedId) switches.add(link.srcId)
      }
    }
    return { aps, switches }
  }, [selectedId, selectedType, floors, apsByFloor, switchesByFloor, traysByFloor, risers])
}

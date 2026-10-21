import { create } from 'zustand'

// What-if radios for the heatmap while a planning dialog previews its result
// (auto power, redundant 2.4 GHz). `plan` maps the floor's APs to what the
// dialog's apply would write -- the same function apply runs, applied to the
// live APs, so an edit made during the preview shows in it and the preview
// is always what apply writes. It applies on `floorId` until the plan is
// applied or dropped. `showBefore` is the dialogs' before / after switch --
// the field without the plan. Carries its own floorId (like
// useAutoPlaceStore), so a preview left behind cannot draw on another floor.
export const useRadioPreviewStore = create((set) => ({
  floorId: null,
  plan: null,
  showBefore: false,

  setPreview: (floorId, plan) => set({ floorId, plan, showBefore: false }),
  setShowBefore: (v) => set({ showBefore: v }),
  clearPreview: () => set({ floorId: null, plan: null, showBefore: false }),
}))

// `apsByFloor` with the preview's plan applied to its floor (unchanged when
// there is none, or on the before side of the switch).
export function withRadioPreview(apsByFloor, state = useRadioPreviewStore.getState()) {
  const { floorId, plan, showBefore } = state
  if (!floorId || !plan || showBefore) return apsByFloor
  return { ...apsByFloor, [floorId]: plan(apsByFloor[floorId] ?? []) }
}

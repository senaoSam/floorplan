import { useEffect } from 'react'
import { useRadioPreviewStore } from '@/store/useRadioPreviewStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'

// Planning dialogs (auto power, redundant 2.4 GHz): while `plan` -- the
// dialog's apply as a function of `floorId`'s APs -- is given, the heatmap
// shows it (useRadioPreviewStore), switched on for it. `view`
// ({ mode, bandFilter? }) puts the heatmap on that view for the preview and
// may change while it lasts (the dialog's own view switch) without restarting
// it. When the preview ends (apply, reset, close, unmount) the heatmap goes
// back to how it was. Pass a null floorId for no preview. One planning dialog
// is open at a time (usePlanningDialogStore), so previews never overlap and
// the restores unwind in order.
export function useRadioPreview(floorId, plan, view = null) {
  const hasView = !!view
  useEffect(() => {
    if (!floorId || !plan) return undefined
    const hm = useHeatmapStore.getState()
    const wasEnabled = hm.enabled
    const prevView = { mode: hm.mode, bandFilter: hm.bandFilter, lastSingleBand: hm.lastSingleBand }
    useRadioPreviewStore.getState().setPreview(floorId, plan)
    if (!wasEnabled) hm.setEnabled(true)
    return () => {
      useRadioPreviewStore.getState().clearPreview()
      if (hasView) useHeatmapStore.setState(prevView)
      if (!wasEnabled) useHeatmapStore.getState().setEnabled(false)
    }
  }, [floorId, plan, hasView])

  const mode = view?.mode ?? null
  const bandFilter = view?.bandFilter ?? null
  useEffect(() => {
    if (!floorId || !plan || !mode) return
    if (useHeatmapStore.getState().mode !== mode) useHeatmapStore.getState().setMode(mode)
    if (bandFilter && useHeatmapStore.getState().bandFilter !== bandFilter) {
      useHeatmapStore.getState().setBandFilter(bandFilter)
    }
  }, [floorId, plan, mode, bandFilter])
}

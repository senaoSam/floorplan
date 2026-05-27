import React, { useEffect, useRef } from 'react'
import { initScene } from '@/render/scene'
import { bindViewport } from '@/render/viewport'
import { attachFloorImageLayer } from '@/features/floorImage/floorImageLayer'
import { attachWallsLayer } from '@/features/walls/wallsLayer'
import { attachAPsLayer } from '@/features/aps/apsLayer'
import { attachSwitchesLayer } from '@/features/switches/switchesLayer'
import { attachTraysLayer } from '@/features/trays/traysLayer'
import { attachCablesLayer } from '@/features/cables/cablesLayer'
import { attachSelectionOverlay } from '@/features/selection/selectionOverlayLayer'
import { attachHoverOverlay } from '@/features/selection/hoverOverlayLayer'
import { attachScopesLayer } from '@/features/scopes/scopesLayer'
import { attachFloorHolesLayer } from '@/features/floorHoles/floorHolesLayer'
import { bindLayerVisibility } from '@/render/layerVisibilityBinder'
import { attachHeatmapLayer } from '@/render/heatmapAdapter'
import { bindHeatmapHover } from '@/render/heatmapHoverBinder'
import { attachDraftOverlay } from '@/features/draft/draftOverlayLayer'
import { attachHandlesLayer } from '@/features/handles/handlesLayer'
import { createDraftModeController } from '@/render/draftModeController'
import ScaleDialog from '@/components/ScaleDialog/ScaleDialog'
import { useViewportStore } from '@/store/useViewportStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useHoverReadoutStore } from '@/store/useHoverReadoutStore'
import { useDraftStore } from '@/store/useDraftStore'
import './FloorplanSystem.sass'

// Integration boundary the host product will mount. Owns the PIXI scene
// lifecycle + all layer adapters. External chrome (TopBar / SidebarLeft /
// PanelRight / floating control panels) lives outside this component.
function FloorplanSystem(/* { buildingData, onSave } */) {
  const containerRef = useRef(null)
  const [scaleDialog, setScaleDialog] = React.useState(null)
  // { p0, p1 } | null

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let scene = null
    let detachViewport = null
    let detachFloorImage = null
    let detachWalls = null
    let detachAPs = null
    let detachSwitches = null
    let detachTrays = null
    let detachCables = null
    let detachHeatmap = null
    let detachSelection = null
    let detachHover = null
    let detachLayerVisibility = null
    let detachScopes = null
    let detachFloorHoles = null
    let detachHeatmapHover = null
    let detachDraftOverlay = null
    let detachHandles = null
    let cancelled = false

    const draftCtrl = createDraftModeController({
      useEditorStore,
      useFloorStore,
      useWallStore,
      useScopeStore,
      useFloorHoleStore,
      useCableStore,
      useDraftStore,
      onRequestScaleDialog: ({ p0, p1 }) => setScaleDialog({ p0, p1 }),
    })

    initScene({ container: el }).then((s) => {
      if (cancelled) {
        s.destroy()
        return
      }
      scene = s
      detachViewport = bindViewport({
        app: s.app,
        canvas: s.app.canvas,
        scene: s,
        world: s.world,
        store: useViewportStore,
        onBackgroundClick: () => useEditorStore.getState().clearSelected(),
        onMarqueeCommit: (rect) => {
          const fid = useFloorStore.getState().activeFloorId
          if (!fid) return
          const aps = useAPStore.getState().apsByFloor[fid] ?? []
          const inside = aps.filter((ap) =>
            ap.x >= rect.minX && ap.x <= rect.maxX &&
            ap.y >= rect.minY && ap.y <= rect.maxY,
          )
          useEditorStore.getState().setSelectedItems(
            inside.map((ap) => ({ id: ap.id, type: 'ap' })),
          )
        },
        isPlaceMode: () => {
          const m = useEditorStore.getState().editorMode
          return m === EDITOR_MODE.PLACE_AP
              || m === EDITOR_MODE.PLACE_SWITCH
              || m === EDITOR_MODE.PLACE_RISER
        },
        isDrawMode: draftCtrl.isDrawMode,
        onDrawModeClick: draftCtrl.onDrawModeClick,
        onDrawModeMove: draftCtrl.onDrawModeMove,
        onDrawModeRightClick: draftCtrl.onDrawModeRightClick,
        onDrawModeDoubleClick: draftCtrl.onDrawModeDoubleClick,
        onPlaceModeClick: ({ x, y }) => {
          const fid = useFloorStore.getState().activeFloorId
          if (!fid) return
          const editor = useEditorStore.getState()
          const cable = useCableStore.getState()
          if (editor.editorMode === EDITOR_MODE.PLACE_AP) {
            const band = editor.placeApBand ?? 5
            const channel = band === 2.4 ? 1 : band === 5 ? 36 : 1
            const width = band === 2.4 ? 20 : 80
            const ap = {
              id: `ap-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
              name: useAPStore.getState().nextAPName(),
              x, y, z: 2.4,
              txPower: 20,
              frequency: band,
              channel, channelWidth: width,
              antennaMode: 'omni', azimuth: 0, beamwidth: 60,
              patternId: null, mountType: 'ceiling', modelId: null,
              color: '#4fc3f7',
            }
            useAPStore.getState().addAP(fid, ap)
            return
          }
          if (editor.editorMode === EDITOR_MODE.PLACE_SWITCH) {
            const kind = editor.placeSwitchKind ?? 'switch'
            cable.addSwitch(fid, {
              id: `sw-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
              name: cable.nextSwitchName(kind),
              x, y,
              kind,
              mountHeight: 0.5,
              model: '',
              portCount: 24,
              poeBudget: kind === 'switch' ? 370 : 0,
              uplinkTo: null,
              cableType: 'auto',
            })
            return
          }
          if (editor.editorMode === EDITOR_MODE.PLACE_RISER) {
            // Riser is global (cross-floor). For MVP just stash a single-
            // floor entry on the active floor's id list.
            cable.addRiser({
              id: `riser-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
              name: typeof cable.nextRiserName === 'function' ? cable.nextRiserName() : `R-${Date.now() % 100}`,
              x, y,
              floorIds: [fid],
              magnetDistance: 100,
            })
          }
        },
      })
      detachFloorImage = attachFloorImageLayer({
        scene: s,
        useFloorStore,
        useViewportStore,
        useEditorStore,
      })
      detachWalls = attachWallsLayer({
        scene: s,
        useFloorStore,
        useWallStore,
      })
      detachAPs = attachAPsLayer({
        scene: s,
        useFloorStore,
        useAPStore,
        useCableStore,
      })
      detachSwitches = attachSwitchesLayer({
        scene: s,
        useFloorStore,
        useCableStore,
        useAPStore,
      })
      detachTrays = attachTraysLayer({
        scene: s,
        useFloorStore,
        useCableStore,
      })
      detachCables = attachCablesLayer({
        scene: s,
        useFloorStore,
        useAPStore,
        useCableStore,
      })
      detachHeatmap = attachHeatmapLayer({
        scene: s,
        useFloorStore,
        useWallStore,
        useAPStore,
        useHeatmapStore,
      })
      detachSelection = attachSelectionOverlay({
        scene: s,
        useFloorStore,
        useAPStore,
        useWallStore,
        useCableStore,
        useEditorStore,
        useDragOverlayStore,
      })
      detachHover = attachHoverOverlay({
        scene: s,
        useFloorStore,
        useAPStore,
        useWallStore,
        useCableStore,
        useEditorStore,
        useHoverStore,
      })
      detachLayerVisibility = bindLayerVisibility({
        scene: s,
        useEditorStore,
      })
      detachScopes = attachScopesLayer({
        scene: s,
        useFloorStore,
        useScopeStore,
      })
      detachFloorHoles = attachFloorHolesLayer({
        scene: s,
        useFloorStore,
        useFloorHoleStore,
      })
      detachHeatmapHover = bindHeatmapHover({
        scene: s,
        useFloorStore,
        useWallStore,
        useAPStore,
        useHeatmapStore,
        useHoverReadoutStore,
      })
      detachDraftOverlay = attachDraftOverlay({
        scene: s,
        useDraftStore,
        useCableStore,
        useFloorStore,
      })
      detachHandles = attachHandlesLayer({
        scene: s,
        useFloorStore,
        useWallStore,
        useCableStore,
        useEditorStore,
      })
      if (import.meta.env.DEV) {
        window.__pixiApp = s.app
        window.__scene = s
        window.__stores = {
          editor: useEditorStore,
          floor: useFloorStore,
          ap: useAPStore,
          wall: useWallStore,
          cable: useCableStore,
          heatmap: useHeatmapStore,
          viewport: useViewportStore,
          drag: useDragOverlayStore,
          hover: useHoverStore,
          scope: useScopeStore,
          hole: useFloorHoleStore,
          hoverReadout: useHoverReadoutStore,
          draft: useDraftStore,
        }
      }
    })

    const onKeyDown = (e) => {
      // Don't fire while typing in inputs/textareas (e.g. AP name field).
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Escape') {
        const s = useEditorStore.getState()
        const draft = useDraftStore.getState()
        const inNonSelectMode = s.editorMode !== EDITOR_MODE.SELECT
                              && s.editorMode !== EDITOR_MODE.PAN
        // Drawing / placing / cropping / aligning modes — Esc fully aborts.
        // Clear any draft in flight AND drop back to SELECT so the next
        // canvas click doesn't start a fresh draft of the abandoned mode.
        // (oldSrc only cleared the draft and kept the mode; the user
        // perceived that as "Esc did nothing" because clicks kept opening
        // new walls / scopes / trays.)
        if (inNonSelectMode || (draft && draft.mode != null)) {
          draftCtrl.handleKey('Escape')   // clearDraft via the controller
          if (inNonSelectMode) s.setEditorMode(EDITOR_MODE.SELECT)
          return
        }
        // Esc closes the context menu first if open, otherwise clears
        // selection. Matches the ObjectContextMenu's own Esc handler.
        if (s.contextMenu) {
          s.closeContextMenu()
        } else {
          s.clearSelected()
        }
        return
      }
      if (e.key === 'Enter') {
        if (draftCtrl.handleKey('Enter')) {
          e.preventDefault()
          return
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const s = useEditorStore.getState()
        const fid = useFloorStore.getState().activeFloorId
        if (!fid) return

        // Batch (marquee multi-select) takes priority over single selection.
        if (s.selectedItems.length > 1) {
          const apIds = s.selectedItems.filter((it) => it.type === 'ap').map((it) => it.id)
          if (apIds.length > 0) useAPStore.getState().removeAPs(fid, apIds)
          s.clearSelected()
          return
        }

        if (!s.selectedId) return
        if (s.selectedType === 'ap') {
          useAPStore.getState().removeAP(fid, s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'wall') {
          useWallStore.getState().removeWall(fid, s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'switch') {
          useCableStore.getState().removeSwitch(fid, s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'cable_tray') {
          useCableStore.getState().removeTray(fid, s.selectedId)
          s.clearSelected()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      if (detachLayerVisibility) detachLayerVisibility()
      if (detachHandles) detachHandles()
      if (detachDraftOverlay) detachDraftOverlay()
      if (detachHeatmapHover) detachHeatmapHover()
      if (detachFloorHoles) detachFloorHoles()
      if (detachScopes) detachScopes()
      if (detachHover) detachHover()
      if (detachSelection) detachSelection()
      if (detachHeatmap) detachHeatmap()
      if (detachCables) detachCables()
      if (detachTrays) detachTrays()
      if (detachSwitches) detachSwitches()
      if (detachAPs) detachAPs()
      if (detachWalls) detachWalls()
      if (detachFloorImage) detachFloorImage()
      if (detachViewport) detachViewport()
      if (scene) scene.destroy()
      if (import.meta.env.DEV) {
        delete window.__pixiApp
        delete window.__scene
      }
    }
  }, [])

  const pxDist = scaleDialog
    ? Math.hypot(scaleDialog.p1.x - scaleDialog.p0.x, scaleDialog.p1.y - scaleDialog.p0.y)
    : 0

  return (
    <div className="floorplan-system">
      <div ref={containerRef} className="floorplan-system__canvas" />
      {scaleDialog && (
        <ScaleDialog
          pixelDistance={pxDist}
          onConfirm={(pxPerM) => {
            const fid = useFloorStore.getState().activeFloorId
            if (fid) useFloorStore.getState().setFloorScale(fid, pxPerM)
            setScaleDialog(null)
            useEditorStore.getState().setEditorMode(EDITOR_MODE.SELECT)
          }}
          onCancel={() => setScaleDialog(null)}
        />
      )}
    </div>
  )
}

export default FloorplanSystem

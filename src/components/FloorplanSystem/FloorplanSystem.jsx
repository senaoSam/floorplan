import React, { useEffect, useRef } from 'react'
import { initScene } from '@/render/scene'
import { bindViewport } from '@/render/viewport'
import { attachModeAdapter } from '@/render/modeAdapter'
import { useHistoryStore } from '@/store/useHistoryStore'
import { collectMarqueeHits } from '@/features/marquee/marqueeHits'
import { greedyChannelAssign } from '@/utils/autoChannelPlan'
import { attachFloorImageLayer } from '@/features/floorImage/floorImageLayer'
import { attachWallsLayer } from '@/features/walls/wallsLayer'
import { attachAPsLayer } from '@/features/aps/apsLayer'
import { attachSwitchesLayer } from '@/features/switches/switchesLayer'
import { attachTraysLayer } from '@/features/trays/traysLayer'
import { attachRisersLayer } from '@/features/risers/risersLayer'
import { attachCamerasLayer } from '@/features/cameras/camerasLayer'
import { attachTracksLayer } from '@/features/cameras/tracksLayer'
import { attachOccupancyLayer } from '@/features/cameras/occupancyLayer'
import { attachBlindSpotLayer } from '@/features/cameras/blindSpotLayer'
import { attachOverlapLayer } from '@/features/cameras/overlapLayer'
import { attachGapMarkerLayer } from '@/features/cameras/gapMarkerLayer'
import { attachAnalyticsLayer } from '@/features/cameras/analyticsLayer'
import { bindTracking } from '@/features/cameras/trackingBinder'
import { attachCablesLayer } from '@/features/cables/cablesLayer'
import { attachSelectionOverlay } from '@/features/selection/selectionOverlayLayer'
import { attachHoverOverlay } from '@/features/selection/hoverOverlayLayer'
import { attachScopesLayer } from '@/features/scopes/scopesLayer'
import { attachFloorHolesLayer } from '@/features/floorHoles/floorHolesLayer'
import { bindLayerVisibility } from '@/render/layerVisibilityBinder'
import { attachHeatmapLayer } from '@/render/heatmapAdapter'
import { bindHeatmapHover } from '@/render/heatmapHoverBinder'
import { bindClientView } from '@/features/clientView/clientViewBinder'
import { attachClientViewLayer } from '@/features/clientView/clientViewLayer'
import { attachStatsOverlayLayer } from '@/features/stats/statsOverlayLayer'
import { attachGhostAPsLayer } from '@/features/autoPlace/ghostAPsLayer'
import { attachDraftOverlay } from '@/features/draft/draftOverlayLayer'
import { attachHandlesLayer } from '@/features/handles/handlesLayer'
import { attachRefOverlayLayer } from '@/features/refOverlay/refOverlayLayer'
import { bindAlignTransform } from '@/render/bindAlignTransform'
import { createDraftModeController } from '@/render/draftModeController'
import { setActiveScene, clearActiveScene } from '@/render/sceneRegistry'
import ScaleDialog from '@/components/ScaleDialog/ScaleDialog'
import Viewer3D from '@/features/viewer3d/Viewer3D'
import { useViewportStore } from '@/store/useViewportStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useEditorStore, EDITOR_MODE, VIEW_MODE } from '@/store/useEditorStore'
import { getDefaultTxPower } from '@/constants/apModels'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useHoverReadoutStore } from '@/store/useHoverReadoutStore'
import { useClientViewStore } from '@/store/useClientViewStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useDraftStore } from '@/store/useDraftStore'
import { useAutoPlaceStore } from '@/store/useAutoPlaceStore'
import { useMaterialToastStore } from '@/store/useMaterialToastStore'
import { showUiToast } from '@/store/useUiToastStore'
import { MATERIAL_LIST } from '@/constants/materials'
import { generateId } from '@/utils/id'
import { isTypingTarget } from '@/utils/isTypingTarget'
import { getModeCapability } from '@/render/modeCapabilities'
import MaterialToast from '@/components/MaterialToast/MaterialToast'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import './FloorplanSystem.sass'

// Unified delete policy (ui-spec §2.4): single objects delete immediately
// with an undo-hint toast; batches (>1) confirm first. Labels for the toast.
const DELETE_TYPE_LABEL = {
  ap: 'AP', wall: '牆', switch: 'Switch', cable_tray: '線槽', scope: '範圍',
  floor_hole: '中庭', cable_riser: 'Riser', camera: '相機',
  tripwire: '計數線', camera_zone: '分析區域',
}

// One-time (per session) explainer toasts for modes that repaint the canvas
// so drastically that panels appear to "vanish" (ui-spec §2.4).
const MODE_ENTRY_TOAST = {
  [EDITOR_MODE.CAMERA]: '已進入 Camera 模式：畫布只顯示底圖與牆，RF / 佈線面板暫時隱藏，切回其他模式即恢復',
  [EDITOR_MODE.CLIENT_VIEW]: '已進入 Client 視角：左鍵點畫布放置模擬裝置，拖曳觀察漫遊',
}
const seenModeToasts = new Set()

// Integration boundary the host product will mount. Owns the PIXI scene
// lifecycle + all layer adapters. External chrome (TopBar / SidebarLeft /
// PanelRight / floating control panels) lives outside this component.
function FloorplanSystem(/* { buildingData, onSave } */) {
  const containerRef = useRef(null)
  const [scaleDialog, setScaleDialog] = React.useState(null)
  // { p0, p1 } | null
  // Marquee batch delete awaiting confirmation (ui-spec §2.4): the snapshot
  // of selectedItems taken when Delete was pressed. null = no pending ask.
  const [pendingBatchDelete, setPendingBatchDelete] = React.useState(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let scene = null
    let detachRenderOnDemand = null
    let detachViewport = null
    let detachModeAdapter = null
    let detachFloorImage = null
    let detachWalls = null
    let detachAPs = null
    let detachSwitches = null
    let detachTrays = null
    let detachRisers = null
    let detachCameras = null
    let detachTracks = null
    let detachOccupancy = null
    let detachBlindSpots = null
    let detachOverlap = null
    let detachGapMarker = null
    let analyticsCtl = null
    let detachTracking = null
    let detachCables = null
    let detachHeatmap = null
    let detachSelection = null
    let detachHover = null
    let detachLayerVisibility = null
    let detachScopes = null
    let detachFloorHoles = null
    let detachHeatmapHover = null
    let detachClientView = null
    let detachClientViewLayer = null
    let detachStatsOverlay = null
    let detachGhostAPs = null
    let detachDraftOverlay = null
    let detachHandles = null
    let detachRefOverlay = null
    let detachAlignTransform = null
    let cancelled = false

    const draftCtrl = createDraftModeController({
      useEditorStore,
      useFloorStore,
      useWallStore,
      useScopeStore,
      useFloorHoleStore,
      useCableStore,
      useDraftStore,
      useViewportStore,
      onRequestScaleDialog: ({ p0, p1 }) => setScaleDialog({ p0, p1 }),
    })

    initScene({ container: el }).then((s) => {
      if (cancelled) {
        s.destroy()
        return
      }
      scene = s
      // Render-on-demand wiring. Every store that can change anything visible
      // schedules a single coalesced render (see scene.requestRender). Because
      // the actual render is deferred to the next animation frame, it always
      // runs AFTER the layers' synchronous store-subscriber redraws in the same
      // tick — so we don't depend on subscription order. This is the central
      // safety net: any state change → exactly one repaint, instead of PIXI's
      // default 60 repaints/sec. (Non-store paint paths — marquee drag, async
      // heatmap texture upload — call scene.requestRender() directly.)
      const renderStores = [
        useViewportStore, useFloorStore, useWallStore, useAPStore, useCableStore,
        useHeatmapStore, useEditorStore, useDragOverlayStore, useHoverStore,
        useScopeStore, useFloorHoleStore, useHoverReadoutStore, useDraftStore,
        useClientViewStore, useCameraStore, useTrackingStore,
      ]
      const reqRender = () => s.requestRender()
      detachRenderOnDemand = renderStores.map((st) => st.subscribe(reqRender))
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
          const editor = useEditorStore.getState()
          const cable = useCableStore.getState()
          // Marquee respects per-layer visibility (oldSrc parity).
          const hits = collectMarqueeHits(rect, {
            floorId: fid,
            walls:       useWallStore.getState().wallsByFloor[fid] ?? [],
            aps:         useAPStore.getState().apsByFloor[fid] ?? [],
            scopes:      useScopeStore.getState().scopesByFloor[fid] ?? [],
            floorHoles:  useFloorHoleStore.getState().floorHolesByFloor[fid] ?? [],
            switches:    cable.switchesByFloor[fid] ?? [],
            trays:       cable.traysByFloor[fid] ?? [],
            risers:      cable.risers ?? [],
            visibility: {
              showWalls:      editor.showWalls,
              showAPs:        editor.showAPs,
              showScopes:     editor.showScopes,
              showFloorHoles: editor.showFloorHoles,
              showSwitches:   editor.showSwitches,
              showCableTrays: editor.showCableTrays,
              showRisers:     editor.showRisers,
            },
          })
          editor.setSelectedItems(hits)
        },
        isPlaceMode: () => {
          const m = useEditorStore.getState().editorMode
          return m === EDITOR_MODE.PLACE_AP
              || m === EDITOR_MODE.PLACE_SWITCH
              || m === EDITOR_MODE.PLACE_RISER
              || m === EDITOR_MODE.CAMERA
        },
        isDrawMode: draftCtrl.isDrawMode,
        isMarqueeMode: () => useEditorStore.getState().editorMode === EDITOR_MODE.MARQUEE_SELECT,
        isPanMode:     () => useEditorStore.getState().editorMode === EDITOR_MODE.PAN,
        isCropMode:    () => useEditorStore.getState().editorMode === EDITOR_MODE.CROP_IMAGE,
        isAlignMode:   () => useEditorStore.getState().editorMode === EDITOR_MODE.ALIGN_FLOOR,
        isClientViewMode: () => useEditorStore.getState().editorMode === EDITOR_MODE.CLIENT_VIEW,
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
            const defaultChannel = band === 2.4 ? 1 : band === 5 ? 36 : 1
            const width = band === 2.4 ? 20 : 80
            const newId = `ap-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
            // Auto-channel-on-place (oldSrc Editor2D 1164-1170): probe greedy
            // assignment including the new AP, take its assignment if any.
            let channel = defaultChannel
            if (editor.autoChannelOnPlace) {
              const existing = useAPStore.getState().apsByFloor[fid] ?? []
              const probe = [...existing, { id: newId, x, y, frequency: band }]
              const assignments = greedyChannelAssign(probe, editor.regulatoryDomain)
              const picked = assignments.get(newId)
              if (picked) channel = picked.channel
            }
            const ap = {
              id: newId,
              name: useAPStore.getState().nextAPName(),
              x, y, z: 2.4,
              txPower: getDefaultTxPower(band),
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
          if (editor.editorMode === EDITOR_MODE.CAMERA) {
            const cams = useCameraStore.getState()
            // An armed tripwire/zone draw tool claims the click (two-click
            // draw); only an idle tool places a camera.
            if (cams.drawTool && analyticsCtl) {
              analyticsCtl.commitDrawClick({ x, y })
              return
            }
            cams.addCamera(fid, {
              id: generateId('cam'),
              name: cams.nextCameraName(),
              x, y, z: 2.5,
              azimuth: 0,
              tiltDeg: 30,
              fovDeg: 90,
              rangeM: 12,
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
      detachModeAdapter = attachModeAdapter({
        scene: s,
        canvas: s.app.canvas,
        useEditorStore,
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
        onDrawModeClick: draftCtrl.onDrawModeClick,
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
      detachRisers = attachRisersLayer({
        scene: s,
        useFloorStore,
        useCableStore,
      })
      detachCameras = attachCamerasLayer({
        scene: s,
        useFloorStore,
        useWallStore,
        useCameraStore,
      })
      detachTracks = attachTracksLayer({
        scene: s,
        useFloorStore,
        useWallStore,
        useCameraStore,
        useTrackingStore,
      })
      detachOccupancy = attachOccupancyLayer({
        scene: s,
        useFloorStore,
        useTrackingStore,
        useCameraStore,
        useWallStore,
      })
      detachBlindSpots = attachBlindSpotLayer({
        scene: s,
        useFloorStore,
        useWallStore,
        useCameraStore,
      })
      detachOverlap = attachOverlapLayer({
        scene: s,
        useFloorStore,
        useWallStore,
        useCameraStore,
      })
      detachGapMarker = attachGapMarkerLayer({ scene: s })
      analyticsCtl = attachAnalyticsLayer({
        scene: s,
        useFloorStore,
        useCameraStore,
        useTrackingStore,
      })
      detachTracking = bindTracking({ useEditorStore })
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
        useScopeStore,
        useFloorHoleStore,
        useHeatmapStore,
        useDragOverlayStore,
        useEditorStore,
        useAutoPlaceStore,
      })
      detachGhostAPs = attachGhostAPsLayer({
        scene: s,
        useAutoPlaceStore,
        useFloorStore,
        useAPStore,
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
        useScopeStore,
        useHeatmapStore,
        useHoverReadoutStore,
      })
      detachClientView = bindClientView({
        scene: s,
        useEditorStore,
        useFloorStore,
        useWallStore,
        useAPStore,
        useScopeStore,
        useClientViewStore,
        useHeatmapStore,
      })
      detachClientViewLayer = attachClientViewLayer({
        scene: s,
        useClientViewStore,
        useFloorStore,
        useAPStore,
        useEditorStore,
      })
      detachStatsOverlay = attachStatsOverlayLayer({
        scene: s,
        useFloorStore,
        useAPStore,
        useWallStore,
        useScopeStore,
        useCableStore,
        useEditorStore,
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
      detachRefOverlay = attachRefOverlayLayer({
        scene: s,
        useFloorStore,
        useEditorStore,
        useWallStore,
        useAPStore,
        useScopeStore,
        useFloorHoleStore,
      })
      detachAlignTransform = bindAlignTransform({
        scene: s,
        useEditorStore,
        useFloorStore,
      })
      // All layers attached and have drawn their initial content into the
      // (render-on-demand) scene — paint the first real frame.
      s.requestRender()
      // Register the live scene so production export paths (PNG / PDF) can
      // read {app, world} — works in ALL build modes (the DEV window.* bridge
      // below is only for the MCP / devtools console). See sceneRegistry.js.
      setActiveScene(s)
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
          history: useHistoryStore,
          camera: useCameraStore,
          tracking: useTrackingStore,
          autoPlace: useAutoPlaceStore,
        }
      }
    })

    // Track Shift state for tray / wall angle-lock — independent of the
    // mode-specific handler below so we catch keyup too. oldSrc Editor2D
    // 824-836 wires this exact pair of listeners.
    const onShiftDown = (e) => { if (e.key === 'Shift') useDraftStore.getState().setShiftHeld(true) }
    const onShiftUp   = (e) => { if (e.key === 'Shift') useDraftStore.getState().setShiftHeld(false) }
    window.addEventListener('keydown', onShiftDown)
    window.addEventListener('keyup',   onShiftUp)

    // Cancel any in-flight draft when the editor mode changes. Without
    // this, switching from DRAW_WALL (mid-draft) to PLACE_AP leaves
    // draftStore.mode === DRAW_WALL and the overlay keeps painting the
    // wall ghost while the user is trying to place APs — user-flagged
    // bug "繪製中切換 mode 會卡 bug".
    let lastEditorModeForDraft = useEditorStore.getState().editorMode
    const unsubModeForDraft = useEditorStore.subscribe(() => {
      const m = useEditorStore.getState().editorMode
      if (m === lastEditorModeForDraft) return
      lastEditorModeForDraft = m
      const draftMode = useDraftStore.getState().mode
      if (draftMode != null && draftMode !== m) {
        useDraftStore.getState().clearDraft()
      }
      // World-switch explainer (ui-spec §2.4): entering CAMERA / CLIENT_VIEW
      // hides whole panel families — tell the user once per session so the
      // vanishing panels don't read as data loss.
      const msg = MODE_ENTRY_TOAST[m]
      if (msg && !seenModeToasts.has(m)) {
        seenModeToasts.add(m)
        showUiToast(msg, { duration: 5000 })
      }
    })

    const onKeyDown = (e) => {
      // Don't fire while typing in any form control (ui-spec §2.4 guard —
      // includes <select> and contentEditable, not just INPUT/TEXTAREA).
      if (isTypingTarget(e.target)) return

      // F2 = rename the selected object (the context menu advertises this
      // shortcut): open the right panel if collapsed, then focus its 名稱
      // field. Single selection only — batches have no name field.
      if (e.key === 'F2') {
        const s = useEditorStore.getState()
        if (s.selectedId && s.selectedItems.length <= 1) {
          e.preventDefault()
          if (s.panelCollapsed) s.togglePanelCollapsed()
          setTimeout(() => {
            const fields = document.querySelectorAll('.panel-right .pnl__field')
            for (const f of fields) {
              const label = f.querySelector('.pnl__field-label')
              if (label && label.textContent.trim().startsWith('名稱')) {
                const input = f.querySelector('input')
                if (input) { input.focus(); input.select() }
                return
              }
            }
          }, 60)
        }
        return
      }

      // Backspace during a draw steps back the last placed vertex / wall
      // segment (draftCtrl decides per mode). Must run BEFORE the Delete/
      // Backspace delete branch below so it isn't swallowed as a delete, and
      // before global undo so a mid-draw Backspace never triggers history
      // undo. (Ctrl+Z is intentionally NOT a step-back — it stays global undo;
      // oldSrc bound both, but we keep undo unambiguous.)
      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (draftCtrl.handleDraftBackspace()) {
          e.preventDefault()
          return
        }
      }

      // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z OR Ctrl+Y = redo. Matches
      // oldSrc keyboard shortcuts. Trigger BEFORE the per-key branches
      // so editing chords don't fall through into the mode logic.
      const cmd = e.ctrlKey || e.metaKey
      if (cmd && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) useHistoryStore.getState().redo()
        else useHistoryStore.getState().undo()
        return
      }
      if (cmd && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        useHistoryStore.getState().redo()
        return
      }

      // ALIGN_FLOOR mode: Esc = 完成 (same as the panel's 完成 button —
      // ui-spec §2.4 unifies "how do I leave this tool" on Esc; the adjusted
      // offset/scale/rotation persist either way). Delete/Backspace are still
      // swallowed so alignment work isn't lost to a stray keypress.
      if (useEditorStore.getState().editorMode === EDITOR_MODE.ALIGN_FLOOR) {
        if (e.key === 'Escape') {
          useEditorStore.getState().setEditorMode(EDITOR_MODE.SELECT)
          return
        }
        if (e.key === 'Delete' || e.key === 'Backspace') return
      }

      if (e.key === 'Escape') {
        const s = useEditorStore.getState()
        const draft = useDraftStore.getState()
        // CAMERA mode with an armed tripwire/zone tool: first Esc cancels the
        // tool (and its draft point); a second Esc exits the mode as usual.
        if (s.editorMode === EDITOR_MODE.CAMERA && useCameraStore.getState().drawTool) {
          useCameraStore.getState().setDrawTool(null)
          return
        }
        // DRAW_DOOR / DRAW_WINDOW aren't in DRAW_MODES (no multi-point draft),
        // but they DO have a two-click "in progress" state: doorWindowDraft is
        // set after the first click on a wall. Give them the same two-stage Esc
        // as the polyline draw tools for consistency:
        //   1) a door/window placement is half-done → cancel just it, STAY in
        //      the mode (wallsLayer's own Esc handler clears dw.wallId +
        //      doorWindowDraft; we only need to NOT leave the mode here).
        //   2) nothing half-placed → leave the tool back to SELECT.
        const isDoorWindow = s.editorMode === EDITOR_MODE.DRAW_DOOR
                          || s.editorMode === EDITOR_MODE.DRAW_WINDOW
        if (isDoorWindow) {
          if (draft.doorWindowDraft) {
            useDraftStore.getState().setDoorWindowDraft(null)
          } else {
            s.setEditorMode(EDITOR_MODE.SELECT)
          }
          return
        }
        // CROP_IMAGE is in DRAW_MODES but its draft is a single drag-box anchor,
        // not a multi-click shape worth preserving — so it opts OUT of the
        // two-stage cancel: one Esc clears the box AND leaves to SELECT.
        if (s.editorMode === EDITOR_MODE.CROP_IMAGE) {
          draftCtrl.handleKey('Escape')  // clear the anchor if any
          s.setEditorMode(EDITOR_MODE.SELECT)
          return
        }
        // Real multi-point draw modes (DRAW_WALL / SCOPE / FLOOR_HOLE /
        // CABLE_TRAY / SCALE) — Esc is a two-stage cancel that mirrors the
        // drawing gesture rather than a single "abort everything":
        //   1) a draft is in flight (≥1 point committed) → cancel just that
        //      in-progress shape, but STAY in the mode so the user can start
        //      the next one immediately. (User: "繪製時 esc 個別功能".)
        //   2) no draft yet → nothing to cancel, so Esc leaves to SELECT.
        if (draftCtrl.isDrawMode()) {
          if (draft && draft.mode != null && draft.points.length > 0) {
            draftCtrl.handleKey('Escape')  // clearDraft only; keep the mode
          } else {
            // Leaving DRAW_SCALE: if the ScaleDialog is open (draft already
            // cleared, waiting on the meters input) but the input lost focus,
            // Esc reaches here. Tear the dialog + preview down too, else the
            // mode flips to SELECT while an orphan dialog / preview line lingers.
            setScaleDialog(null)
            useDraftStore.getState().clearScalePreview()
            s.setEditorMode(EDITOR_MODE.SELECT)
          }
          return
        }
        // Non-draw, non-default modes (PLACE_AP / PLACE_SWITCH / PLACE_RISER /
        // CLIENT_VIEW …) have no multi-click draft to preserve — Esc leaves the
        // tool back to SELECT. Also clear any stray draft.
        const inNonSelectMode = s.editorMode !== EDITOR_MODE.SELECT
                              && s.editorMode !== EDITOR_MODE.PAN
        if (inNonSelectMode || (draft && draft.mode != null)) {
          draftCtrl.handleKey('Escape')
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

      // Tab — cycle PLACE_AP band (2.4 / 5 / 6), PLACE_SWITCH kind
      // (switch / idf / mdf / router), or DRAW_WALL material (glass →
      // drywall → wood → brick → concrete → metal). Shift+Tab reverses.
      // Pops the material toast naming the new selection.
      if (e.key === 'Tab' && !cmd && !e.altKey) {
        const ed = useEditorStore.getState()
        if (ed.editorMode === EDITOR_MODE.PLACE_AP) {
          e.preventDefault()
          const bands = [2.4, 5, 6]
          const idx = Math.max(0, bands.indexOf(ed.placeApBand ?? 5))
          const dir = e.shiftKey ? -1 : 1
          const next = bands[(idx + dir + bands.length) % bands.length]
          ed.setPlaceApBand(next)
          const colorByBand = { 2.4: '#f39c12', 5: '#4fc3f7', 6: '#a855f7' }
          useMaterialToastStore.getState().showToast({
            label: `${next} GHz`, color: colorByBand[next], key: 'Tab',
          })
          return
        }
        if (ed.editorMode === EDITOR_MODE.PLACE_SWITCH) {
          e.preventDefault()
          const kinds  = ['switch', 'idf', 'mdf', 'router']
          const labels = { switch: 'Switch', idf: 'IDF', mdf: 'MDF', router: 'Router' }
          const colors = { switch: '#22d3ee', idf: '#34d399', mdf: '#fbbf24', router: '#f472b6' }
          const idx = Math.max(0, kinds.indexOf(ed.placeSwitchKind ?? 'switch'))
          const dir = e.shiftKey ? -1 : 1
          const next = kinds[(idx + dir + kinds.length) % kinds.length]
          ed.setPlaceSwitchKind(next)
          useMaterialToastStore.getState().showToast({
            label: labels[next], color: colors[next], key: 'Tab',
          })
          return
        }
        if (ed.editorMode === EDITOR_MODE.DRAW_WALL) {
          e.preventDefault()
          const curId = ed.wallMaterial?.id
          const idx = Math.max(0, MATERIAL_LIST.findIndex((m) => m.id === curId))
          const dir = e.shiftKey ? -1 : 1
          const next = MATERIAL_LIST[(idx + dir + MATERIAL_LIST.length) % MATERIAL_LIST.length]
          ed.setWallMaterial(next)
          // If a wall is also selected, rewrite its material in the same
          // stroke — mirrors the prior 1-6 behaviour.
          if (ed.selectedId && ed.selectedType === 'wall') {
            const fid = useFloorStore.getState().activeFloorId
            if (fid) useWallStore.getState().updateWall(fid, ed.selectedId, { material: next })
          }
          useMaterialToastStore.getState().showToast({
            label: next.label, color: next.color, key: 'Tab',
          })
          return
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const s = useEditorStore.getState()
        const fid = useFloorStore.getState().activeFloorId
        if (!fid) return
        // 47-14: read-only modes (STATS / CLIENT_VIEW) can still hold a
        // selection (a dashboard row calls setSelected to locate an object),
        // but keyboard delete must not mutate — the mode is a viewer.
        if (getModeCapability(s.editorMode).readOnly) return

        // Batch (marquee multi-select): confirm before deleting >1 objects
        // (ui-spec §2.4 delete policy) — the actual removal happens in the
        // ConfirmDialog rendered below.
        if (s.selectedItems.length > 1) {
          setPendingBatchDelete([...s.selectedItems])
          return
        }

        if (!s.selectedId) return
        // Single object: delete immediately + undo-hint toast (ui-spec §2.4).
        const typeLabel = DELETE_TYPE_LABEL[s.selectedType]
        if (typeLabel) showUiToast(`已刪除 ${typeLabel}（Ctrl+Z 可復原）`)
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
        } else if (s.selectedType === 'scope') {
          useScopeStore.getState().removeScope(fid, s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'floor_hole') {
          useFloorHoleStore.getState().removeFloorHole(fid, s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'cable_riser') {
          useCableStore.getState().removeRiser(s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'camera') {
          useCameraStore.getState().removeCamera(fid, s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'tripwire') {
          useCameraStore.getState().removeTripwire(fid, s.selectedId)
          s.clearSelected()
        } else if (s.selectedType === 'camera_zone') {
          useCameraStore.getState().removeZone(fid, s.selectedId)
          s.clearSelected()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keydown', onShiftDown)
      window.removeEventListener('keyup',   onShiftUp)
      unsubModeForDraft()
      if (detachLayerVisibility) detachLayerVisibility()
      if (detachAlignTransform) detachAlignTransform()
      if (detachRefOverlay) detachRefOverlay()
      if (detachHandles) detachHandles()
      if (detachDraftOverlay) detachDraftOverlay()
      if (detachGhostAPs) detachGhostAPs()
      if (detachClientViewLayer) detachClientViewLayer()
      if (detachStatsOverlay) detachStatsOverlay()
      if (detachClientView) detachClientView()
      if (detachHeatmapHover) detachHeatmapHover()
      if (detachFloorHoles) detachFloorHoles()
      if (detachScopes) detachScopes()
      if (detachHover) detachHover()
      if (detachSelection) detachSelection()
      if (detachHeatmap) detachHeatmap()
      if (detachCables) detachCables()
      if (detachTrays) detachTrays()
      if (detachTracking) detachTracking()
      if (analyticsCtl) analyticsCtl.detach()
      if (detachGapMarker) detachGapMarker()
      if (detachOverlap) detachOverlap()
      if (detachBlindSpots) detachBlindSpots()
      if (detachOccupancy) detachOccupancy()
      if (detachTracks) detachTracks()
      if (detachCameras) detachCameras()
      if (detachRisers) detachRisers()
      if (detachSwitches) detachSwitches()
      if (detachAPs) detachAPs()
      if (detachWalls) detachWalls()
      if (detachFloorImage) detachFloorImage()
      if (detachModeAdapter) detachModeAdapter()
      if (detachViewport) detachViewport()
      if (detachRenderOnDemand) detachRenderOnDemand.forEach((u) => u())
      clearActiveScene(scene)
      if (scene) scene.destroy()
      if (import.meta.env.DEV) {
        delete window.__pixiApp
        delete window.__scene
      }
    }
  }, [])

  // oldSrc rounds pixel distance for the label / dialog readout — match
  // that so 「量測長度：N px」 reads as a whole number.
  const pxDist = scaleDialog
    ? Math.round(Math.hypot(scaleDialog.p1.x - scaleDialog.p0.x, scaleDialog.p1.y - scaleDialog.p0.y))
    : 0

  // oldSrc Editor2D handleScaleConfirm/Cancel both reset to SELECT — so
  // hitting Esc / clicking the backdrop leaves the user in pointer mode,
  // not stuck in DRAW_SCALE waiting for another click.
  const closeScaleDialog = () => {
    setScaleDialog(null)
    useDraftStore.getState().clearScalePreview()
    useEditorStore.getState().setEditorMode(EDITOR_MODE.SELECT)
  }

  // Floor switch invalidates any in-flight scale measurement — the pt1 /
  // pt2 coords belong to the previous floor's image space. Mirrors oldSrc
  // Editor2D's blanket "clear all drawing state on floor switch" reset.
  useEffect(() => {
    let prevFid = useFloorStore.getState().activeFloorId
    const unsub = useFloorStore.subscribe((s) => {
      if (s.activeFloorId !== prevFid) {
        prevFid = s.activeFloorId
        setScaleDialog(null)
        useDraftStore.getState().clearScalePreview()
      }
    })
    return unsub
  }, [])

  // Marquee batch delete — runs the same per-type removals the keydown
  // handler used to do inline, now behind a ConfirmDialog (ui-spec §2.4).
  const confirmBatchDelete = () => {
    const items = pendingBatchDelete ?? []
    setPendingBatchDelete(null)
    const fid = useFloorStore.getState().activeFloorId
    if (!fid || items.length === 0) return
    const byType = {}
    for (const it of items) {
      (byType[it.type] ??= []).push(it.id)
    }
    if (byType.ap?.length)          useAPStore.getState().removeAPs(fid, byType.ap)
    if (byType.wall?.length)        useWallStore.getState().removeWalls(fid, byType.wall)
    if (byType.scope?.length)       useScopeStore.getState().removeScopes(fid, byType.scope)
    if (byType.floor_hole?.length)  useFloorHoleStore.getState().removeFloorHoles(fid, byType.floor_hole)
    if (byType.switch?.length)      useCableStore.getState().removeSwitches(fid, byType.switch)
    if (byType.cable_tray?.length)  useCableStore.getState().removeTrays(fid, byType.cable_tray)
    if (byType.cable_riser?.length) useCableStore.getState().removeRisers(byType.cable_riser)
    useEditorStore.getState().clearSelected()
    showUiToast(`已刪除 ${items.length} 個物件（Ctrl+Z 可復原）`)
  }

  // Subscribe to viewMode so the 2D ↔ 3D switch re-renders the canvas
  // visibility. The PIXI canvas stays mounted (cheaper than tearing it
  // down on every toggle); CSS just hides it when 3D is up.
  const viewMode = useEditorStore((s) => s.viewMode)
  const is3D = viewMode === VIEW_MODE.THREE_D

  return (
    <div className="floorplan-system">
      {/* 2D PIXI canvas — always mounted. Stays VISIBLE underneath the 3D
          viewer (z-index lower) so it acts as the backdrop while the 3D
          canvas fades in: no blank flash during the 2D→3D switch. Only its
          pointer events are disabled in 3D. */}
      <div
        ref={containerRef}
        className="floorplan-system__canvas"
        style={is3D ? { pointerEvents: 'none' } : null}
      />
      {/* Viewer3D — also ALWAYS mounted (per the .sass note). Keeping the
          Three.js <Canvas> alive means its WebGL context + floor textures are
          already warm, so switching to 3D is instant. We toggle visibility via
          a class instead of conditional mount; Viewer3D freezes itself while
          hidden (frameloop 'never' + skipped scene updates) so it costs no
          GPU or CPU in 2D. */}
      <div
        className={`floorplan-system__viewer3d${is3D ? ' floorplan-system__viewer3d--active' : ''}`}
      >
        <Viewer3D />
      </div>
      <MaterialToast />
      {pendingBatchDelete && (
        <ConfirmDialog
          title="刪除多個物件"
          message={`確定要刪除選取的 ${pendingBatchDelete.length} 個物件？（刪除後可用 Ctrl+Z 復原）`}
          confirmLabel="刪除"
          cancelLabel="取消"
          danger
          onConfirm={confirmBatchDelete}
          onCancel={() => setPendingBatchDelete(null)}
        />
      )}
      {scaleDialog && (
        <ScaleDialog
          pixelDist={pxDist}
          onConfirm={(meters) => {
            const fid = useFloorStore.getState().activeFloorId
            // oldSrc Editor2D handleScaleConfirm: pxPerM = pixelDist / meters.
            if (fid && meters > 0) useFloorStore.getState().setFloorScale(fid, pxDist / meters)
            closeScaleDialog()
          }}
          onCancel={closeScaleDialog}
        />
      )}
    </div>
  )
}

export default FloorplanSystem

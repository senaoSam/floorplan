import { buildScenario } from '@/features/heatmap/buildScenario'
import { getClientDeviceById } from '@/constants/clientDevices'
import { simulateClient, buildCandidates } from './simulate'
import { computeAssociationArea, computeSingleApArea } from './association'
import { EDITOR_MODE } from '@/store/useEditorStore'

// Owns Client View pointer interaction + simulation. Active only while the
// editor is in CLIENT_VIEW mode. On pointerdown it places (or grabs) the
// virtual client; dragging moves it; each move re-runs simulateClient and
// writes the result to useClientViewStore for the panel + overlay to render.
//
// Pointer ownership: the viewport binder skips its pan/marquee setup while in
// CLIENT_VIEW (see bindViewport's isClientViewMode guard), so this binder is
// free to treat the whole stage as the client-placement surface without the
// canvas panning out from under the drag.
//
// Scenario caching mirrors heatmapHoverBinder: rebuild lazily on a reference
// signature so per-move cost stays in probeAt's per-AP loop only.

const THROTTLE_MS = 16  // ~60 hz; drag follows the cursor smoothly

export function bindClientView({
  scene,
  useEditorStore,
  useFloorStore,
  useWallStore,
  useAPStore,
  useScopeStore,
  useClientViewStore,
  useHeatmapStore,
}) {
  const stage = scene.app.stage
  let cachedSig = ''
  let cachedScenario = null
  let dragging = false
  let lastFireAt = 0

  const isActive = () => useEditorStore.getState().editorMode === EDITOR_MODE.CLIENT_VIEW

  const getScenario = () => {
    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)
    if (!floor || !floor.scale) return { scenario: null, floor: null }
    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    const aps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
    if (aps.length === 0) return { scenario: null, floor }
    const scopes = useScopeStore.getState().scopesByFloor?.[activeFloorId] ?? []
    const sig = `${activeFloorId}::${walls.length}::${aps.length}::${scopes.length}::${floor.scale}`
    if (sig === cachedSig && cachedScenario) return { scenario: cachedScenario, floor }
    cachedSig = sig
    cachedScenario = buildScenario(floor, walls, aps, scopes, null)
    return { scenario: cachedScenario, floor }
  }
  const invalidate = () => { cachedSig = '' }

  // Assemble the simulation opts from the current store state. Shared by the
  // reading (simulateClient) and the association-area sweep so both honour the
  // same device / link-direction / noise / power settings.
  const buildOpts = (cv) => ({
    device: getClientDeviceById(cv.deviceId),
    sixGHzOn: cv.sixGHzOn,
    wifi7On: cv.wifi7On,
    linkDirection: cv.linkDirection,
    clientTxDbm: cv.clientTxDbm,
    clientHeightM: cv.clientHeightM,
    noiseFloor: cv.noiseFloor,
    minInterferingRssiDbm: cv.minInterferingRssiDbm,
    coverageThresholdDbm: cv.coverageThresholdDbm,
    priorServingId: cv.servingApId,
    lockedApId: cv.lockedApId,
  })

  // Re-run the simulation for the current client position. Called on drag-move
  // and whenever any sim input (device / params / AP / wall) changes, so the
  // panel stays live even when the client isn't moving.
  const recompute = () => {
    const cv = useClientViewStore.getState()
    if (cv.pos == null) return
    const { scenario, floor } = getScenario()
    // 53-G6 (23n): clearing only `reading` left the cached overlay polygons
    // behind, so the big translucent association region stayed painted over the
    // whole plan after the last AP was deleted and the heatmap was switched off
    // — the toggle looked off, the legend was gone, and the wash was still
    // there. Only leaving Client View mode cleared it. The areas are derived
    // from the same scenario as `reading`, so they have to die together.
    if (!scenario || !floor?.scale) {
      cv.setReading(null)
      cv.setAssociationArea(null)
      cv.setSingleApArea(null)
      return
    }
    // Same reasoning with a live scenario but nothing to associate to: an empty
    // AP list cannot produce a coverage union, and a stale one must not survive.
    if ((scenario.aps?.length ?? 0) === 0) {
      cv.setReading(null)
      cv.setServingApId(null)
      cv.setAssociationArea(null)
      cv.setSingleApArea(null)
      return
    }
    const rx = { x: cv.pos.x / floor.scale, y: cv.pos.y / floor.scale }
    const opts = buildOpts(cv)
    const { reading, servingApId } = simulateClient(scenario, rx, opts)
    cv.setReading(reading)
    if (servingApId !== cv.servingApId) cv.setServingApId(servingApId)

    // Association area: recompute the blue region whenever it's enabled and we
    // have a serving AP. Setting pos/params already cleared the cached cells in
    // the store, so this is the single place that refills them. Skipped when
    // the toggle is off (cheap) so dragging stays fast. Uses the same opts so
    // the region's serving logic matches the panel exactly.
    if (cv.showAssociationArea) {
      // Coverage union across all usable APs — independent of which AP the
      // client is currently served by (Hamina's association area = coverage).
      const area = computeAssociationArea(scenario, floor.scale, opts)
      cv.setAssociationArea(area)
    }

    // Single-AP coverage outline: the AP whose good-signal region is outlined =
    // manual choice if set, else the serving AP (auto-follow). Recompute its
    // outline so it tracks serving changes / param changes. Null target → clear.
    const outlineApId = cv.singleApAreaId ?? servingApId
    const singleArea = outlineApId
      ? computeSingleApArea(scenario, floor.scale, outlineApId, opts)
      : null
    cv.setSingleApArea(singleArea)
  }

  // Move the client to a world (canvas px) point and resimulate.
  const placeAt = (wp) => {
    useClientViewStore.getState().setPos({ x: wp.x, y: wp.y })
    recompute()
  }

  // Nearest active-floor AP to a world (canvas-px) point, within `screenPx` of
  // it on screen. Returns the AP id or null. Used by the right-click menu to
  // decide "right-clicked an AP" vs "right-clicked empty space".
  const apIdNear = (wp, screenPx = 22) => {
    const fid = useFloorStore.getState().activeFloorId
    const aps = useAPStore.getState().apsByFloor[fid] ?? []
    const worldScale = scene.world.scale?.x || 1
    const tol = screenPx / worldScale            // canvas-px tolerance
    let best = null, bestD = tol
    for (const a of aps) {
      const d = Math.hypot(a.x - wp.x, a.y - wp.y)
      if (d <= bestD) { bestD = d; best = a.id }
    }
    return best
  }

  const onDown = (e) => {
    if (!isActive()) return
    if ((e.button ?? 0) !== 0) return     // right-click handled via native contextmenu below
    // Menu open → this left-click only dismisses it; it does NOT place/move the
    // client. The client moves only when a click lands with no menu open.
    if (useClientViewStore.getState().cvMenu) {
      useClientViewStore.getState().closeCvMenu()
      return
    }
    dragging = true
    const wp = scene.world.toLocal(e.global)
    placeAt(wp)
  }
  const onMove = (e) => {
    if (!isActive() || !dragging) return
    const now = performance.now()
    if (now - lastFireAt < THROTTLE_MS) return
    lastFireAt = now
    const wp = scene.world.toLocal(e.global)
    placeAt(wp)
  }
  const onUp = () => { dragging = false }

  // Right-click menu via the NATIVE contextmenu event. PIXI v8's federated
  // layer does not emit pointerdown for the secondary (right) button, so a
  // stage 'pointerdown' handler never sees button===2 — we listen on the canvas
  // DOM element instead. Convert clientX/Y → world (canvas-px) for the AP
  // hit-test, then open the lightweight client-view menu.
  const canvasEl = scene.app.canvas
  const onContextMenu = (e) => {
    if (!isActive()) return
    e.preventDefault()                    // suppress the browser menu
    // Menu already open → this right-click only dismisses it (same as left).
    // The user must right-click again to open a fresh menu elsewhere.
    if (useClientViewStore.getState().cvMenu) {
      useClientViewStore.getState().closeCvMenu()
      return
    }
    const rect = canvasEl.getBoundingClientRect()
    const wp = scene.world.toLocal({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    const apId = apIdNear(wp)
    // Reachability of the right-clicked AP FROM THE CLIENT'S current position:
    // "manual connect" means "make the client use this AP", so the client's
    // location decides whether it's reachable (RSSI ≥ usable floor + band).
    // Reuse buildCandidates (already band-filtered + usable-floor-filtered):
    // the AP is reachable iff it's among the candidates at the client point.
    // null when no client placed → menu disables connect with a "place first" hint.
    let apReachable = null
    if (apId != null) {
      const cv = useClientViewStore.getState()
      const { scenario, floor } = getScenario()
      if (cv.pos != null && scenario && floor?.scale) {
        const rx = { x: cv.pos.x / floor.scale, y: cv.pos.y / floor.scale }
        const { candidates } = buildCandidates(scenario, rx, buildOpts(cv))
        apReachable = candidates.some((c) => c.ap.id === apId)
      } else {
        apReachable = false // no client placed yet → can't connect
      }
    }
    useClientViewStore.getState().openCvMenu({
      screenX: e.clientX,
      screenY: e.clientY,
      apId,
      apReachable,
      clientPlaced: useClientViewStore.getState().pos != null,
    })
  }
  canvasEl.addEventListener('contextmenu', onContextMenu)

  stage.on('pointerdown', onDown)
  stage.on('pointermove', onMove)
  stage.on('pointerup', onUp)
  stage.on('pointerupoutside', onUp)

  // Keep the reading live when inputs change without the client moving.
  const unsubAP = useAPStore.subscribe(() => { invalidate(); if (isActive()) recompute() })
  const unsubWall = useWallStore.subscribe(() => { invalidate(); if (isActive()) recompute() })
  const unsubScope = useScopeStore.subscribe(() => { invalidate(); if (isActive()) recompute() })
  const unsubFloor = useFloorStore.subscribe(() => { invalidate(); if (isActive()) recompute() })
  // Restore the heatmap if association area had hidden it. Idempotent — clears
  // the remembered flag so a following reset()/toggle-off won't double-restore.
  const restoreHeatmapIfHidden = () => {
    if (!useHeatmapStore) return
    if (useClientViewStore.getState().heatmapWasEnabled) {
      useHeatmapStore.getState().setEnabled(true)
      useClientViewStore.getState().setHeatmapWasEnabled(false)
    }
  }

  // Resimulate from the same position whenever any sim input changes. Track the
  // prior values manually (don't rely on the subscribe(state, prev) signature).
  // showAssociationArea additionally drives heatmap mutual exclusion (Hamina:
  // "Show association area: Disables the current heatmap").
  let prev = snapshot()
  function snapshot() {
    const s = useClientViewStore.getState()
    return {
      deviceId: s.deviceId, sixGHzOn: s.sixGHzOn, wifi7On: s.wifi7On,
      linkDirection: s.linkDirection, clientTxDbm: s.clientTxDbm,
      clientHeightM: s.clientHeightM, noiseFloor: s.noiseFloor,
      minInterferingRssiDbm: s.minInterferingRssiDbm,
      coverageThresholdDbm: s.coverageThresholdDbm,
      lockedApId: s.lockedApId,
      singleApAreaId: s.singleApAreaId,
      showAssociationArea: s.showAssociationArea,
    }
  }
  // Re-entrancy guard: this handler writes BACK to the CV store
  // (setHeatmapWasEnabled / via recompute → setReading / setServingApId /
  // setAssociationCells), each of which re-fires this very subscription. We
  // snapshot + advance `prev` first, then ignore the nested re-entrant calls so
  // a single user change does exactly one pass (no infinite recursion).
  let handling = false
  const unsubCV = useClientViewStore.subscribe(() => {
    if (handling) return
    const cur = snapshot()
    const assocChanged = cur.showAssociationArea !== prev.showAssociationArea
    const simChanged = cur.deviceId !== prev.deviceId
      || cur.sixGHzOn !== prev.sixGHzOn
      || cur.wifi7On !== prev.wifi7On
      || cur.linkDirection !== prev.linkDirection
      || cur.clientTxDbm !== prev.clientTxDbm
      || cur.clientHeightM !== prev.clientHeightM
      || cur.noiseFloor !== prev.noiseFloor
      || cur.minInterferingRssiDbm !== prev.minInterferingRssiDbm
      || cur.coverageThresholdDbm !== prev.coverageThresholdDbm
      || cur.lockedApId !== prev.lockedApId
      || cur.singleApAreaId !== prev.singleApAreaId
      || assocChanged
    prev = cur                              // advance BEFORE any store writes
    if (!simChanged && !assocChanged) return
    handling = true
    try {
      // Association-area toggle → hide / restore the heatmap (Hamina互斥).
      if (assocChanged && useHeatmapStore) {
        if (cur.showAssociationArea) {
          const hm = useHeatmapStore.getState()
          useClientViewStore.getState().setHeatmapWasEnabled(hm.enabled)
          if (hm.enabled) hm.setEnabled(false)
        } else if (useClientViewStore.getState().heatmapWasEnabled) {
          useHeatmapStore.getState().setEnabled(true)
          useClientViewStore.getState().setHeatmapWasEnabled(false)
        }
      }
      if (simChanged && isActive()) recompute()
    } finally {
      handling = false
    }
  })
  // Apply the association↔heatmap mutual exclusion for the CURRENT state.
  // Used on mode entry: since association area defaults ON, there's no
  // false→true toggle event to trigger the subscription, so we hide the heatmap
  // here. Idempotent — only remembers/hides when association is on and we
  // haven't already stashed the heatmap state.
  const applyAssociationExclusion = () => {
    if (!useHeatmapStore) return
    const cv = useClientViewStore.getState()
    if (!cv.showAssociationArea) return
    const hm = useHeatmapStore.getState()
    cv.setHeatmapWasEnabled(hm.enabled)
    if (hm.enabled) hm.setEnabled(false)
  }

  // Leaving CLIENT_VIEW resets the placed client (clean slate next entry).
  let prevMode = useEditorStore.getState().editorMode
  const unsubMode = useEditorStore.subscribe(() => {
    const mode = useEditorStore.getState().editorMode
    if (mode === prevMode) return
    const left = prevMode === EDITOR_MODE.CLIENT_VIEW && mode !== EDITOR_MODE.CLIENT_VIEW
    const entered = mode === EDITOR_MODE.CLIENT_VIEW && prevMode !== EDITOR_MODE.CLIENT_VIEW
    const involvesClientView = mode === EDITOR_MODE.CLIENT_VIEW || prevMode === EDITOR_MODE.CLIENT_VIEW
    prevMode = mode
    if (entered) {
      // Association area is on by default → hide the heatmap to match Hamina's
      // device-perspective default. Keep the subscription's `prev` in sync so
      // it doesn't re-fire the exclusion on the next unrelated change.
      applyAssociationExclusion()
      prev = snapshot()
      // Position memory: if a client was placed in a previous session, recompute
      // from the remembered pos so the marker + lines + reading come straight
      // back without the user re-clicking. (servingApId starts null after
      // leave(), so hysteresis picks the strongest AP — fine for re-entry.)
      if (useClientViewStore.getState().pos != null) recompute()
    }
    if (left) {
      dragging = false
      // Restore the heatmap BEFORE leave() so showAssociationArea is still
      // readable for the restore decision.
      restoreHeatmapIfHidden()
      // leave() keeps pos (position memory) and only clears transient sim
      // output — so re-entry restores the client at its last spot.
      useClientViewStore.getState().leave()
    }
    // CLIENT_VIEW suppresses the context menu (ContextMenuMount returns null),
    // but a layer's right-click may still have written contextMenu state.
    // Clear it on any transition involving CLIENT_VIEW so a stale menu can't
    // flash when switching back to a mode that does render it.
    if (involvesClientView) useEditorStore.getState().closeContextMenu()
  })

  return () => {
    stage.off('pointerdown', onDown)
    stage.off('pointermove', onMove)
    stage.off('pointerup', onUp)
    stage.off('pointerupoutside', onUp)
    canvasEl.removeEventListener('contextmenu', onContextMenu)
    unsubAP()
    unsubWall()
    unsubScope()
    unsubFloor()
    unsubCV()
    unsubMode()
  }
}

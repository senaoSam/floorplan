import { EDITOR_MODE } from '@/store/useEditorStore'
import { MATERIALS } from '@/constants/materials'
import { DEFAULT_TRAY } from '@/store/useCableStore'
import { generateId } from '@/utils/id'
import { snapTrayPoint } from '@/features/draft/traySnap'
import { isAnyBodyDragging } from '@/store/useDragOverlayStore'

// Owns the draft-mode click / move / commit / cancel flow.
// Returns the callback set viewport.bindViewport reads, plus a separate
// keyboard handler (Enter / Esc) for FloorplanSystem to attach.

const DRAW_MODES = new Set([
  EDITOR_MODE.DRAW_WALL,
  EDITOR_MODE.DRAW_SCOPE,
  EDITOR_MODE.DRAW_FLOOR_HOLE,
  EDITOR_MODE.DRAW_CABLE_TRAY,
  EDITOR_MODE.DRAW_SCALE,
  EDITOR_MODE.CROP_IMAGE,
])

// Screen-px radius for the "click back on the first vertex to close the
// polygon" gesture in DRAW_SCOPE / DRAW_FLOOR_HOLE (oldSrc Editor2D SNAP_PX
// = 12, applied as SNAP_PX / viewport.scale so it stays a constant on-screen
// distance at any zoom). The close-suggestion ring is drawn by
// draftOverlayLayer once points.length >= 3.
const CLOSE_SNAP_PX = 12

export function createDraftModeController({
  useEditorStore,
  useFloorStore,
  useWallStore,
  useScopeStore,
  useFloorHoleStore,
  useCableStore,
  useDraftStore,
  useViewportStore,                            // for tray snap radius (screen-px / scale)
  onRequestScaleDialog, // ({ p0, p1 }) => void — caller opens dialog and writes floor.scale
}) {
  const isDrawMode = () => DRAW_MODES.has(useEditorStore.getState().editorMode)

  // DRAW_CABLE_TRAY: snap raw cursor onto tray vertex / wall endpoint /
  // wall segment foot / parallel-wall lock and surface the snap kind so
  // draftOverlayLayer can render the matching halo.
  // DRAW_WALL: snap to existing wall endpoint within 12 screen-px (oldSrc
  // SNAP_PX / Editor2D snapToWallEndpoint) + Shift-held angle lock to
  // 0/45/90° from the first click (parity with tray).
  // Other modes pass through unchanged.
  const snapDraftPoint = (raw, mode) => {
    const fid = useFloorStore.getState().activeFloorId
    if (mode === EDITOR_MODE.DRAW_CABLE_TRAY) {
      if (!fid) return { pos: raw, kind: null }
      return snapTrayPoint(raw, {
        walls: useWallStore.getState().wallsByFloor[fid] ?? [],
        trays: useCableStore.getState().traysByFloor[fid] ?? [],
        draftPoints: useDraftStore.getState().points,
        scale: useViewportStore?.getState?.()?.scale ?? 1,
        shiftHeld: !!useDraftStore.getState()._shiftHeld,
      })
    }
    if (mode === EDITOR_MODE.DRAW_WALL) {
      if (!fid) return { pos: raw, kind: null }
      // Run the exact same snap chain as DRAW_CABLE_TRAY (shift angle-lock
      // → wall endpoint → wall segment foot → parallel-wall intent lock).
      // trays=[] makes the tray-vertex branch a no-op so the chain reduces
      // to wall + parallel — byte-for-byte the behaviour tray uses.
      return snapTrayPoint(raw, {
        walls: useWallStore.getState().wallsByFloor[fid] ?? [],
        trays: [],
        draftPoints: useDraftStore.getState().points,
        scale: useViewportStore?.getState?.()?.scale ?? 1,
        shiftHeld: !!useDraftStore.getState()._shiftHeld,
      })
    }
    return { pos: raw, kind: null }
  }

  // Wall ids committed during the CURRENT draw chain (since the last anchor was
  // dropped fresh). Backspace step-back removes only these — never a wall that
  // already existed on the floor before this draw session started (47-18).
  //
  // 53-G6 (P4#2): the list is meaningless outside the floor it was built on, so
  // it carries that floor's id and every reader checks it. Previously the ids
  // survived a floor switch: draw three segments on 1F, switch to 2F, click
  // once, press Backspace — and the step-back popped all three of 1F's ids,
  // deleting walls on a floor the user was no longer looking at while 1F's own
  // step-back history was gone for good.
  //
  // Self-describing payload rather than a cleanup call, matching
  // useAutoPlaceStore: even if nothing resets it, a stale list cannot act on
  // the wrong floor.
  let sessionWallIds = []
  let sessionFloorId = null
  const resetWallSession = () => {
    sessionWallIds = []
    sessionFloorId = useFloorStore.getState().activeFloorId
  }

  const commitWall = (a, b) => {
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return
    const floor = useFloorStore.getState().floors.find((f) => f.id === fid)
    // Use editor.wallMaterial so Tab / Shift+Tab cycling (FloorplanSystem
    // keydown) takes effect for the next drawn wall.
    const material = useEditorStore.getState().wallMaterial ?? MATERIALS.CONCRETE
    const id = generateId('wall')
    useWallStore.getState().addWall(fid, {
      id,
      name: useWallStore.getState().nextWallName({ floor }),
      startX: a.x, startY: a.y,
      endX:   b.x, endY:   b.y,
      material,
      topHeight: 3.0,
      bottomHeight: 0,
      openings: [],
    })
    // 53-G6: stamp ownership on first commit so the guard above has a floor to
    // compare against even if the chain began before this controller was wired.
    if (sessionFloorId !== fid) { sessionWallIds = []; sessionFloorId = fid }
    sessionWallIds.push(id)
  }

  const commitScope = (points, type = 'in') => {
    if (points.length < 3) return
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return
    const floor = useFloorStore.getState().floors.find((f) => f.id === fid)
    const flat = []
    for (const p of points) { flat.push(p.x); flat.push(p.y) }
    useScopeStore.getState().addScope(fid, {
      id: generateId('scope'),
      name: useScopeStore.getState().nextScopeName({ floor }),
      type,
      points: flat,
    })
  }

  const commitHole = (points) => {
    if (points.length < 3) return
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return
    const floor = useFloorStore.getState().floors.find((f) => f.id === fid)
    const flat = []
    for (const p of points) { flat.push(p.x); flat.push(p.y) }
    useFloorHoleStore.getState().addFloorHole(fid, {
      id: generateId('hole'),
      name: useFloorHoleStore.getState().nextFloorHoleName({ floor }),
      points: flat,
    })
  }

  const commitTray = (points) => {
    if (points.length < 2) return
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return
    const floor = useFloorStore.getState().floors.find((f) => f.id === fid)
    useCableStore.getState().addTray(fid, {
      id: generateId('tray'),
      name: useCableStore.getState().nextTrayName({ floor }),
      points: points.map((p) => ({ x: p.x, y: p.y })),
      magnetDistance: 100,
      ...DEFAULT_TRAY,
    })
  }

  const onDrawModeClick = (worldPt) => {
    const editor = useEditorStore.getState()
    const draft = useDraftStore.getState()
    const mode = editor.editorMode

    // Apply tray snap so the committed point lands on the snapped xy
    // (not the raw cursor). Other modes pass through.
    const snapped = snapDraftPoint(worldPt, mode).pos

    if (draft.mode !== mode || draft.points.length === 0) {
      // Fresh chain: reset the DRAW_WALL step-back session so Backspace can't
      // reach back into walls drawn before this anchor (47-18). 53-G6: also
      // re-stamps the floor id, so a chain started after a floor switch owns
      // its ids on the floor the user is actually on.
      if (mode === EDITOR_MODE.DRAW_WALL) resetWallSession()
      useDraftStore.getState().beginDraft(mode, snapped)
      return
    }

    if (mode === EDITOR_MODE.DRAW_WALL) {
      commitWall(draft.points[0], snapped)
      useDraftStore.getState().beginDraft(mode, snapped)
      return
    }
    if (mode === EDITOR_MODE.DRAW_SCALE) {
      // Keep the measured line visible behind the dialog (matches oldSrc
      // Editor2D where scalePt1 / scalePt2 persist until onConfirm/onCancel).
      useDraftStore.getState().setScalePreview({ p0: draft.points[0], p1: snapped })
      if (typeof onRequestScaleDialog === 'function') {
        onRequestScaleDialog({ p0: draft.points[0], p1: snapped })
      }
      useDraftStore.getState().clearDraft()
      return
    }
    if (mode === EDITOR_MODE.CROP_IMAGE) {
      // Second click → commit crop rect to the floor record + return to
      // SELECT mode and select the floor image (oldSrc Editor2D 1279-1296).
      // Floor image sprite sits at world (0,0) so world coords == image
      // coords; no toImagePos conversion needed.
      const p0 = draft.points[0]
      const p1 = snapped
      const x = Math.min(p0.x, p1.x)
      const y = Math.min(p0.y, p1.y)
      const w = Math.abs(p1.x - p0.x)
      const h = Math.abs(p1.y - p0.y)
      const fid = useFloorStore.getState().activeFloorId
      if (w > 2 && h > 2 && fid) {
        useFloorStore.getState().updateFloor(fid, { cropX: x, cropY: y, cropWidth: w, cropHeight: h })
      }
      useDraftStore.getState().clearDraft()
      useEditorStore.getState().setEditorMode(EDITOR_MODE.SELECT)
      if (fid) useEditorStore.getState().setSelected(fid, 'floor_image')
      return
    }
    // DRAW_SCOPE / DRAW_FLOOR_HOLE: clicking back on (or near) the first
    // vertex closes & commits the polygon — the gesture the close-ring at
    // points[0] advertises (oldSrc Editor2D 1237-1276). Needs >= 3 points so a
    // real polygon exists; threshold is CLOSE_SNAP_PX / scale (constant screen
    // distance). Falls through to addPoint when the click isn't near the start.
    if (mode === EDITOR_MODE.DRAW_SCOPE || mode === EDITOR_MODE.DRAW_FLOOR_HOLE) {
      if (draft.points.length >= 3) {
        const scale = useViewportStore?.getState?.()?.scale ?? 1
        const snapDist = CLOSE_SNAP_PX / scale
        const first = draft.points[0]
        if (Math.hypot(snapped.x - first.x, snapped.y - first.y) < snapDist) {
          if (mode === EDITOR_MODE.DRAW_SCOPE) commitScope(draft.points, 'in')
          else commitHole(draft.points)
          useDraftStore.getState().clearDraft()
          return
        }
      }
    }

    useDraftStore.getState().addPoint(snapped)
  }

  const onDrawModeMove = (worldPt) => {
    const mode = useEditorStore.getState().editorMode
    const s = snapDraftPoint(worldPt, mode)
    useDraftStore.getState().setCursor(s.pos)
    // While a body drag is in flight (e.g. dragging an existing wall in
    // DRAW_WALL) the per-object drag handler owns snapHint — it knows
    // which endpoint of the dragged object is snapping to what. Without
    // this guard our cursor-relative snap and the drag handler's
    // endpoint-relative snap would race on draftStore.snapHint and the
    // halo would flicker between two locations.
    if (isAnyBodyDragging()) return
    // Snap halos are a "if you click here, snap will happen" cue —
    // useful BEFORE the 1st click (lets the user position the start of
    // the wall onto an existing wall's endpoint / segment) as well as
    // between 1st and 2nd click. parallelWall is the one exception: it
    // measures angle against an anchor, so it only makes sense after a
    // 1st point exists.
    const hasDraft = useDraftStore.getState().points.length > 0
    if (mode === EDITOR_MODE.DRAW_CABLE_TRAY) {
      let visibleKind = null
      if (s.kind === 'trayVertex' || s.kind === 'wallEndpoint' || s.kind === 'wallSegment' || s.kind === 'traySegment') {
        visibleKind = s
      } else if (hasDraft && s.kind === 'parallelWall') {
        visibleKind = s
      }
      useDraftStore.getState().setSnapHint(visibleKind)
    } else if (mode === EDITOR_MODE.DRAW_WALL) {
      // Wall draw — surface endpoint (cyan ring), wall-segment foot
      // (orange square) any time the cursor is in range. parallelWall
      // still needs an anchor point.
      if (s.kind === 'wallEndpoint') {
        useDraftStore.getState().setSnapHint({ kind: 'wallEndpoint', pos: s.pos })
      } else if (s.kind === 'wallSegment') {
        useDraftStore.getState().setSnapHint({ kind: 'wallSegment', pos: s.pos, ref: s.ref })
      } else if (hasDraft && s.kind === 'parallelWall') {
        useDraftStore.getState().setSnapHint({
          kind: 'parallelWall',
          pos: s.pos,
          ref: s.ref,
          lockedAngle: s.lockedAngle,
        })
      } else {
        if (useDraftStore.getState().snapHint) useDraftStore.getState().setSnapHint(null)
      }
    } else {
      // Other modes — clear any stale hint left over from the previous mode.
      if (useDraftStore.getState().snapHint) useDraftStore.getState().setSnapHint(null)
    }
  }

  const commitDraft = () => {
    const draft = useDraftStore.getState()
    const mode = draft.mode
    if (!mode) return
    if (mode === EDITOR_MODE.DRAW_SCOPE)        commitScope(draft.points, 'in')
    else if (mode === EDITOR_MODE.DRAW_FLOOR_HOLE) commitHole(draft.points)
    else if (mode === EDITOR_MODE.DRAW_CABLE_TRAY) commitTray(draft.points)
    useDraftStore.getState().clearDraft()
  }

  const cancelDraft = () => useDraftStore.getState().clearDraft()

  const onDrawModeRightClick = commitDraft
  const onDrawModeDoubleClick = commitDraft

  // FloorplanSystem's keydown handler routes Enter / Esc here when a
  // draft is in flight.
  const handleKey = (key) => {
    if (key === 'Enter')  { commitDraft();  return true }
    if (key === 'Escape') {
      // Only consume Esc if a draft is alive; otherwise let the existing
      // Esc-clears-selection path run.
      const draft = useDraftStore.getState()
      if (draft.mode != null && draft.points.length > 0) {
        cancelDraft()
        return true
      }
    }
    return false
  }

  // Backspace step-back during a draw (oldSrc Editor2D tray draft 417-426,
  // here generalised to every multi-point draw mode). Returns true when it
  // consumed the key so FloorplanSystem skips its global undo / delete paths.
  //   - DRAW_SCOPE / DRAW_FLOOR_HOLE / DRAW_CABLE_TRAY accumulate vertices in
  //     the draft store, so step-back just pops the last draft point.
  //   - DRAW_WALL commits each segment to the wall store immediately and keeps
  //     a 1-point draft anchor at the last vertex, so step-back removes the
  //     most-recently-drawn wall and rewinds the anchor to that wall's start —
  //     the chain continues from the previous vertex.
  // Single-click modes (DRAW_SCALE, CROP_IMAGE) and modes with no draft in
  // flight return false (Backspace falls through to the delete handler).
  const handleDraftBackspace = () => {
    const draft = useDraftStore.getState()
    const mode = useEditorStore.getState().editorMode

    if (mode === EDITOR_MODE.DRAW_SCOPE
      || mode === EDITOR_MODE.DRAW_FLOOR_HOLE
      || mode === EDITOR_MODE.DRAW_CABLE_TRAY) {
      if (draft.mode === mode && draft.points.length > 0) {
        useDraftStore.getState().popPoint()
        return true
      }
      return false
    }

    if (mode === EDITOR_MODE.DRAW_WALL && draft.mode === mode && draft.points.length > 0) {
      const fid = useFloorStore.getState().activeFloorId
      const walls = fid ? (useWallStore.getState().wallsByFloor[fid] ?? []) : []
      // 53-G6 (P4#2): the session list only means anything on the floor that
      // built it. Reading it on another floor would pop ids that live elsewhere
      // — the ids wouldn't be found in THIS floor's walls, so the loop would
      // drain the whole list and silently destroy the original floor's
      // step-back history. Drop the list instead.
      if (sessionFloorId !== fid) resetWallSession()
      // Only step back into walls THIS draw chain committed — pop the newest
      // session id that still exists. Never walls[length-1], which could be a
      // wall that existed before the session (47-18).
      let last = null
      while (sessionWallIds.length > 0) {
        const id = sessionWallIds.pop()
        const w = walls.find((x) => x.id === id)
        if (w) { last = w; break }
      }
      if (last) {
        useWallStore.getState().removeWall(fid, last.id)
        // Rewind the anchor to the removed segment's start so the next click
        // continues the chain from the previous vertex.
        useDraftStore.getState().beginDraft(EDITOR_MODE.DRAW_WALL, { x: last.startX, y: last.startY })
      } else {
        // No session-committed wall left (only the anchor exists) — drop the
        // anchor. Existing floor walls are untouched.
        useDraftStore.getState().clearDraft()
      }
      return true
    }

    return false
  }

  return {
    isDrawMode,
    onDrawModeClick,
    onDrawModeMove,
    onDrawModeRightClick,
    onDrawModeDoubleClick,
    handleKey,
    handleDraftBackspace,
  }
}

import { EDITOR_MODE } from '@/store/useEditorStore'
import { MATERIALS } from '@/constants/materials'
import { DEFAULT_TRAY } from '@/store/useCableStore'
import { generateId } from '@/utils/id'
import { snapTrayPoint, angleLockToAnchor, parallelWallLock } from '@/features/draft/traySnap'

// oldSrc Editor2D SNAP_PX (= 12 screen px) — wall draw endpoint snap radius.
const WALL_SNAP_PX_SCREEN = 12

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
      const draftPoints = useDraftStore.getState().points
      const shiftHeld = !!useDraftStore.getState()._shiftHeld
      const scale = useViewportStore?.getState?.()?.scale ?? 1
      const walls = useWallStore.getState().wallsByFloor[fid] ?? []
      const anchor = draftPoints.length > 0 ? draftPoints[0] : null

      // (1) Shift + anchor → 0/45/90° lock (matches tray angleLockToAnchor).
      let pos = raw
      if (shiftHeld && anchor) {
        pos = angleLockToAnchor(raw, anchor)
      }
      // (2) Existing-wall endpoint snap within 12 screen-px (oldSrc SNAP_PX).
      const snapDist = WALL_SNAP_PX_SCREEN / (scale || 1)
      for (const w of walls) {
        for (const ep of [{ x: w.startX, y: w.startY }, { x: w.endX, y: w.endY }]) {
          if (Math.hypot(pos.x - ep.x, pos.y - ep.y) < snapDist) {
            return { pos: { x: ep.x, y: ep.y }, kind: 'wallEndpoint' }
          }
        }
      }
      // (3) Parallel / perpendicular-wall lock — strictly matches tray's
      // defaults so the user keeps a free draft angle most of the time
      // and only sees the angle auto-correct when the cursor is already
      // close to parallel / perpendicular with a nearby wall (6° gate,
      // 180 px proximity).
      if (!shiftHeld && anchor) {
        const par = parallelWallLock(raw, anchor, walls, scale)
        if (par) {
          return {
            pos: par.pos,
            kind: 'parallelWall',
            ref: par.refWall,
            lockedAngle: par.lockedAngle,
          }
        }
      }
      return { pos, kind: shiftHeld && anchor ? 'angleLock' : null }
    }
    return { pos: raw, kind: null }
  }

  const commitWall = (a, b) => {
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return
    const floor = useFloorStore.getState().floors.find((f) => f.id === fid)
    // Use editor.wallMaterial so number-key 1-6 (FloorplanSystem keydown)
    // takes effect for the next drawn wall (oldSrc Editor2D 585).
    const material = useEditorStore.getState().wallMaterial ?? MATERIALS.CONCRETE
    useWallStore.getState().addWall(fid, {
      id: generateId('wall'),
      name: useWallStore.getState().nextWallName({ floor }),
      startX: a.x, startY: a.y,
      endX:   b.x, endY:   b.y,
      material,
      topHeight: 3.0,
      bottomHeight: 0,
      openings: [],
    })
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
      useDraftStore.getState().beginDraft(mode, snapped)
      return
    }

    if (mode === EDITOR_MODE.DRAW_WALL) {
      commitWall(draft.points[0], snapped)
      useDraftStore.getState().beginDraft(mode, snapped)
      return
    }
    if (mode === EDITOR_MODE.DRAW_SCALE) {
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
    useDraftStore.getState().addPoint(snapped)
  }

  const onDrawModeMove = (worldPt) => {
    const mode = useEditorStore.getState().editorMode
    const s = snapDraftPoint(worldPt, mode)
    useDraftStore.getState().setCursor(s.pos)
    // Wall + parallel snap kinds drive an extra halo overlay. Tray-vertex
    // snap has its own green halo path already inside draftOverlayLayer
    // (findVertexAt looks up cursor xy against existing trays).
    if (mode === EDITOR_MODE.DRAW_CABLE_TRAY) {
      const visibleKind = (s.kind === 'wallEndpoint' || s.kind === 'wallSegment' || s.kind === 'parallelWall')
        ? s
        : null
      useDraftStore.getState().setSnapHint(visibleKind)
    } else if (mode === EDITOR_MODE.DRAW_WALL) {
      // Wall draw — surface endpoint snap (cyan ring + black halo) and
      // parallel-wall lock (purple guide + tinted reference wall).
      if (s.kind === 'wallEndpoint') {
        useDraftStore.getState().setSnapHint({ kind: 'wallEndpoint', pos: s.pos })
      } else if (s.kind === 'parallelWall') {
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

  return {
    isDrawMode,
    onDrawModeClick,
    onDrawModeMove,
    onDrawModeRightClick,
    onDrawModeDoubleClick,
    handleKey,
  }
}

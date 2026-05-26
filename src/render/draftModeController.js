import { EDITOR_MODE } from '@/store/useEditorStore'
import { MATERIALS } from '@/constants/materials'
import { DEFAULT_TRAY } from '@/store/useCableStore'
import { generateId } from '@/utils/id'

// Owns the draft-mode click / move / commit / cancel flow.
// Returns the callback set viewport.bindViewport reads, plus a separate
// keyboard handler (Enter / Esc) for FloorplanSystem to attach.

const DRAW_MODES = new Set([
  EDITOR_MODE.DRAW_WALL,
  EDITOR_MODE.DRAW_SCOPE,
  EDITOR_MODE.DRAW_FLOOR_HOLE,
  EDITOR_MODE.DRAW_CABLE_TRAY,
  EDITOR_MODE.DRAW_SCALE,
])

export function createDraftModeController({
  useEditorStore,
  useFloorStore,
  useWallStore,
  useScopeStore,
  useFloorHoleStore,
  useCableStore,
  useDraftStore,
  onRequestScaleDialog, // ({ p0, p1 }) => void — caller opens dialog and writes floor.scale
}) {
  const isDrawMode = () => DRAW_MODES.has(useEditorStore.getState().editorMode)

  const commitWall = (a, b) => {
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return
    const floor = useFloorStore.getState().floors.find((f) => f.id === fid)
    useWallStore.getState().addWall(fid, {
      id: generateId('wall'),
      name: useWallStore.getState().nextWallName({ floor }),
      startX: a.x, startY: a.y,
      endX:   b.x, endY:   b.y,
      material: MATERIALS.CONCRETE,
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

    // Begin a new draft if mode just changed or no points yet.
    if (draft.mode !== mode || draft.points.length === 0) {
      useDraftStore.getState().beginDraft(mode, worldPt)
      return
    }

    if (mode === EDITOR_MODE.DRAW_WALL) {
      // Two clicks → 1 wall + reset for next wall (chain mode).
      commitWall(draft.points[0], worldPt)
      useDraftStore.getState().beginDraft(mode, worldPt)
      return
    }
    if (mode === EDITOR_MODE.DRAW_SCALE) {
      // Two clicks → ask caller to open a scale dialog. The dialog
      // resolves px-per-meter from the user's meter input.
      if (typeof onRequestScaleDialog === 'function') {
        onRequestScaleDialog({ p0: draft.points[0], p1: worldPt })
      }
      useDraftStore.getState().clearDraft()
      return
    }
    // Polygon / polyline modes — accumulate.
    useDraftStore.getState().addPoint(worldPt)
  }

  const onDrawModeMove = (worldPt) => {
    useDraftStore.getState().setCursor(worldPt)
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

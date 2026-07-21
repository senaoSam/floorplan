import { Container, Graphics, Circle, Text, TextStyle } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useViewportStore } from '@/store/useViewportStore'
import { useHoverStore } from '@/store/useHoverStore'
import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii } from './fovPolygon'
import { isCameraDetecting, anyDetecting, subscribeDetection } from './detectionBus'
import { deviceStatus, STATUS_COLOR, DEVICE_STATUS } from './deviceStatus'

// Camera markers + FOV cones adapter (Phase 34-1). Active only in CAMERA
// mode — both layer containers are hidden in every other mode (per design:
// camera system is mode-exclusive; outside it the canvas stays RF-planning
// only, and inside it everything except walls + floor image is hidden by
// layerVisibilityBinder).
//
// Two scene layers:
//   cameraFov — world-space Graphics UNDER the walls layer, so wall lines
//               stay crisp on top of the translucent view cones.
//   cameras   — per-camera interactive Container (marker + label + rotate
//               handle) above devices, inverse-scaled like AP markers.
//
// Interactions (CAMERA mode only):
//   click empty   → place camera (viewport place-mode path, FloorplanSystem)
//   drag marker   → move camera (live store updates, rAF-coalesced)
//   click marker  → select → CameraPanel on the right
//   drag handle   → rotate azimuth (small dot on the view axis; Shift = 15°)

export const CAMERA_COLOR = '#10b981'      // emerald — FOV cone + accents
const SELECT_STROKE = '#e74c3c'
const BODY_STROKE_NORMAL = '#1e3a8a'
const BODY_FILL_NORMAL = '#ffffff'

const CAM_RADIUS = 10
const HIT_RADIUS = 14
const LENS_RADIUS = 4.5
const HANDLE_DIST = 30           // rotate handle distance from body (screen px)
const HANDLE_RADIUS = 5
const FOV_FILL_ALPHA = 0.16
const FOV_EDGE_ALPHA = 0.55

// No scale (px/m) set yet → assume this so cameras still show a usable cone.
// CameraPanel surfaces a hint when the fallback is in effect.
export const FALLBACK_PX_PER_M = 40

// White fill + black outline — the map-label classic: the white core reads on
// dark floors, the dark rim keeps it legible on white plans. Camera mode has
// no oldSrc to match, so all its labels share this adaptive treatment.
const NAME_TEXT_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  fontWeight: '600',
  align: 'center',
  stroke: { color: '#0f172a', width: 3, join: 'round' },
  dropShadow: { color: '#000000', blur: 4, distance: 0, alpha: 0.6 },
})

export function attachCamerasLayer({
  scene,
  useFloorStore,
  useWallStore,
  useCameraStore,
}) {
  const fovLayer = scene.layers.cameraFov
  const layer = scene.layers.cameras
  layer.eventMode = 'passive'

  const fovG = new Graphics()
  fovG.eventMode = 'none'
  fovLayer.addChild(fovG)

  const containers = new Map()   // id → { container, graphics, handleG, nameText, camera, floorId, hovered }

  const isCameraMode = () => useEditorStore.getState().editorMode === EDITOR_MODE.CAMERA

  const activeFloor = () => {
    const { floors, activeFloorId } = useFloorStore.getState()
    return floors.find((f) => f.id === activeFloorId) ?? null
  }

  const pxPerM = () => activeFloor()?.scale ?? FALLBACK_PX_PER_M

  // ── FOV cones — one Graphics pass for all cameras ──────────────────────
  // Blocking segments are cached on a reference signature (walls array
  // identity) — recomputed only when walls / floor actually change.
  let segCacheKey = null
  let segCache = []
  const blockingSegments = () => {
    const fid = useFloorStore.getState().activeFloorId
    const walls = useWallStore.getState().wallsByFloor[fid] ?? []
    if (walls !== segCacheKey) {
      segCacheKey = walls
      segCache = buildBlockingSegments(walls)
    }
    return segCache
  }

  // Pulse phase (0..1, a sine "breath") driven by a wall-clock timer, set each
  // frame by the pulse loop. A detecting camera's cone brightens with this.
  let pulse = 0
  // Continuous wall-clock seconds, set each frame by the pulse loop — drives
  // the radar "ripple" rings that travel outward from a detecting camera.
  let waveSec = 0
  const WAVE_PERIOD = 2.2    // seconds for a ring to travel lens → far edge
  const WAVE_RINGS = 2       // concurrent rings, evenly phase-offset

  // Draw expanding ripple rings radiating from a detecting camera's lens
  // (radar-sweep feel). Each ring is an arc at radius r = phase·reach that
  // fades as it expands. `hits` is the per-bearing wall-clipped reach from
  // computeFovPolygon: a ring point only exists at a bearing whose reach is
  // ≥ r, so the arc breaks at walls instead of leaking through them — the
  // ripple stays strictly inside the green visible cone.
  const drawWaveRings = (cam, minRangePx, rangePx, hits) => {
    if (!hits || hits.length < 2) return
    const cx = cam.x, cy = cam.y
    const span = rangePx - minRangePx
    if (span <= 1) return
    for (let k = 0; k < WAVE_RINGS; k++) {
      const phase = ((waveSec / WAVE_PERIOD) + k / WAVE_RINGS) % 1
      const r = minRangePx + phase * span
      const ringAlpha = (1 - phase) * 0.85   // bright near the lens, fades out
      if (r <= minRangePx + 1 || ringAlpha < 0.03) continue
      // Build the arc as visible spans: walk bearings, emit a point where the
      // wall-clipped reach covers r, lift the pen across occluded bearings.
      const buildArc = () => {
        let pen = false
        for (const h of hits) {
          if (Math.min(h.t, rangePx) >= r) {
            const px = cx + Math.cos(h.ang) * r
            const py = cy + Math.sin(h.ang) * r
            if (!pen) { fovG.moveTo(px, py); pen = true }
            else fovG.lineTo(px, py)
          } else {
            pen = false   // wall break — next visible span starts a new sub-path
          }
        }
      }
      // White ring pops out of the green cone fill: a soft wide halo under a
      // crisp bright core, so the ripple reads clearly against the tint.
      buildArc()
      fovG.stroke({ width: 5, color: '#ffffff', alpha: ringAlpha * 0.35 })
      buildArc()
      fovG.stroke({ width: 2, color: '#ffffff', alpha: ringAlpha })
    }
  }

  const redrawFov = () => {
    fovG.clear()
    if (!isCameraMode()) return
    const fid = useFloorStore.getState().activeFloorId
    const cameras = useCameraStore.getState().camerasByFloor[fid] ?? []
    if (cameras.length === 0) return
    const segs = blockingSegments()
    const scale = pxPerM()
    const editor = useEditorStore.getState()
    for (const cam of cameras) {
      const { minRangePx, rangePx } = cameraCoverageRadii(cam, scale)
      const detecting = !!isCameraDetecting(cam.id) && deviceStatus(cam) !== DEVICE_STATUS.OFFLINE
      const hits = detecting ? [] : null   // only need per-bearing reach for the ripple
      const poly = computeFovPolygon({
        cx: cam.x,
        cy: cam.y,
        azimuthDeg: cam.azimuth ?? 0,
        fovDeg: cam.fovDeg ?? 90,
        rangePx,
        minRangePx,
        segments: segs,
        outHits: hits,
      })
      if (!poly) continue
      const selected = editor.selectedId === cam.id && editor.selectedType === 'camera'
      // Offline cameras aren't recording → their coverage is void: draw the
      // cone greatly dimmed and skip the detection pulse entirely.
      if (deviceStatus(cam) === DEVICE_STATUS.OFFLINE) {
        fovG.poly(poly).fill({ color: CAMERA_COLOR, alpha: 0.05 })
        fovG.poly(poly).stroke({ width: 1, color: CAMERA_COLOR, alpha: 0.2 })
        continue
      }
      // Detecting → cone pulses (Verkada parity): fill/edge alpha breathe up
      // by `pulse`. Selection emphasis still wins on a static cone.
      const fillA = detecting
        ? FOV_FILL_ALPHA + 0.06 + pulse * 0.16
        : (selected ? FOV_FILL_ALPHA + 0.08 : FOV_FILL_ALPHA)
      const edgeA = detecting
        ? 0.6 + pulse * 0.4
        : (selected ? 0.9 : FOV_EDGE_ALPHA)
      fovG.poly(poly).fill({ color: CAMERA_COLOR, alpha: fillA })
      fovG.poly(poly).stroke({ width: detecting ? 2 : 1.5, color: CAMERA_COLOR, alpha: edgeA })
      // Radar ripple rings radiating from the lens while detecting — clipped
      // to the wall-occluded reach so they don't leak past walls.
      if (detecting) drawWaveRings(cam, minRangePx, rangePx, hits)
    }
  }

  // ── Camera markers ──────────────────────────────────────────────────────
  const ensureContainer = (camera, floorId) => {
    let entry = containers.get(camera.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'grab'
      c.hitArea = new Circle(0, 0, HIT_RADIUS)
      const g = new Graphics()
      g.eventMode = 'none'
      const nameText = new Text({ text: '', style: NAME_TEXT_STYLE })
      nameText.anchor.set(0.5, 1)
      nameText.y = -14
      nameText.eventMode = 'none'
      // Rotate handle — pure visual. PIXI prunes the whole subtree when the
      // pointer is outside the container's hitArea, so an interactive child
      // outside that circle is unreachable; instead the container's hitArea
      // grows while selected and pointerdown disambiguates body vs handle by
      // local distance (see bindInteractions).
      const handleG = new Graphics()
      handleG.eventMode = 'none'
      handleG.visible = false
      c.addChild(g)
      c.addChild(handleG)
      c.addChild(nameText)
      layer.addChild(c)
      entry = { container: c, graphics: g, handleG, nameText, camera, floorId, hovered: false, handleHover: false }
      containers.set(camera.id, entry)
      bindInteractions(entry)
    } else {
      entry.camera = camera
      entry.floorId = floorId
    }
    return entry
  }

  const removeContainer = (id) => {
    const entry = containers.get(id)
    if (!entry) return
    layer.removeChild(entry.container)
    entry.container.destroy({ children: true })
    containers.delete(id)
  }

  const drawCamera = (entry) => {
    const { graphics, handleG, nameText, camera } = entry
    graphics.clear()
    entry.container.position.set(camera.x, camera.y)

    const editor = useEditorStore.getState()
    const isSelected = editor.selectedId === camera.id && editor.selectedType === 'camera'
    const hover = useHoverStore.getState()
    const isHovered = entry.hovered || (hover.type === 'camera' && hover.id === camera.id)
    const isInvert = isHovered && !isSelected

    const azRad = ((camera.azimuth ?? 0) % 360) * Math.PI / 180

    const bodyFill = isInvert ? BODY_STROKE_NORMAL : BODY_FILL_NORMAL
    const bodyStroke = isSelected ? SELECT_STROKE : (isInvert ? BODY_FILL_NORMAL : BODY_STROKE_NORMAL)
    const bodyWidth = isSelected ? 3 : (isHovered ? 2.5 : 2)

    graphics
      .circle(0, 0, CAM_RADIUS)
      .fill({ color: bodyFill, alpha: 1 })
      .stroke({ width: bodyWidth, color: bodyStroke, alpha: 1 })

    // Lens — emerald dot offset along the view axis, reads as "this way".
    const lx = Math.cos(azRad) * 3.5
    const ly = Math.sin(azRad) * 3.5
    graphics.circle(lx, ly, LENS_RADIUS).fill({ color: CAMERA_COLOR, alpha: 1 })
    graphics.circle(lx, ly, 1.8).fill({ color: '#0b3b2e', alpha: 1 })

    // Operational-status dot (Verkada parity) — top-right of the body, green =
    // online, orange = offline. White rim keeps it legible on any body fill.
    const status = deviceStatus(camera)
    const sdx = CAM_RADIUS * 0.72, sdy = -CAM_RADIUS * 0.72
    graphics.circle(sdx, sdy, 3.4).fill({ color: '#ffffff', alpha: 1 })
    graphics.circle(sdx, sdy, 2.6).fill({ color: STATUS_COLOR[status], alpha: 1 })

    // Calibration badge (stage 2) — top-LEFT of the body, opposite the status
    // dot. Calibrated = solid emerald dot; uncalibrated = nothing (calibration
    // is a deliberate manual step).
    if (camera.calibration) {
      const cdx = -CAM_RADIUS * 0.72, cdy = -CAM_RADIUS * 0.72
      graphics.circle(cdx, cdy, 3.4).fill({ color: '#ffffff', alpha: 1 })
      graphics.circle(cdx, cdy, 2.6).fill({ color: '#10b981', alpha: 1 })
    }

    // Rotate handle — only when selected: axis tick + draggable dot. Hovering
    // the dot inverts it (emerald fill, white ring, slightly larger) so the
    // "this is draggable" affordance is unmistakable.
    handleG.clear()
    handleG.visible = isSelected
    if (isSelected) {
      const hx = Math.cos(azRad) * HANDLE_DIST
      const hy = Math.sin(azRad) * HANDLE_DIST
      const hot = entry.handleHover
      handleG.moveTo(Math.cos(azRad) * (CAM_RADIUS + 2), Math.sin(azRad) * (CAM_RADIUS + 2))
        .lineTo(hx, hy)
        .stroke({ width: hot ? 2 : 1.5, color: CAMERA_COLOR, alpha: 0.9 })
      handleG.circle(hx, hy, hot ? HANDLE_RADIUS + 1.5 : HANDLE_RADIUS)
        .fill({ color: hot ? CAMERA_COLOR : '#ffffff', alpha: 1 })
        .stroke({ width: 2, color: hot ? '#ffffff' : CAMERA_COLOR, alpha: 1 })
    }

    // Selected → hit circle grows to cover the rotate handle ring; the
    // pointerdown handler splits body / handle / pass-through by distance.
    entry.container.hitArea = new Circle(
      0, 0, isSelected ? HANDLE_DIST + HANDLE_RADIUS + 6 : HIT_RADIUS,
    )

    nameText.text = camera.name ?? ''
  }

  const bindInteractions = (entry) => {
    const { container } = entry

    container.on('pointerdown', (e) => {
      if (!isCameraMode()) return
      // Right-click → context menu (mirror apsLayer.js bindInteractions). While
      // a tripwire/zone draw tool is armed, right-click means "cancel the draw"
      // (analyticsLayer's canvas-level contextmenu listener) — so skip the menu
      // here and let that gesture through.
      if (e.button === 2) {
        if (useCameraStore.getState().drawTool) return
        e.stopPropagation()
        useEditorStore.getState().openContextMenu({
          targetType: 'camera',
          targetId: entry.camera.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      // Armed tripwire/zone tool → the click belongs to the two-click draw
      // (stage handler); don't grab/select the camera underneath.
      if (useCameraStore.getState().drawTool) return
      const editor = useEditorStore.getState()
      const isSelected = editor.selectedId === entry.camera.id && editor.selectedType === 'camera'
      const local = e.getLocalPosition(container)
      const dBody = Math.hypot(local.x, local.y)
      if (dBody <= HIT_RADIUS) {
        e.stopPropagation()
        editor.setSelected(entry.camera.id, 'camera')
        beginDrag(entry, e)
        return
      }
      if (isSelected) {
        const azRad = ((entry.camera.azimuth ?? 0) % 360) * Math.PI / 180
        const hx = Math.cos(azRad) * HANDLE_DIST
        const hy = Math.sin(azRad) * HANDLE_DIST
        if (Math.hypot(local.x - hx, local.y - hy) <= HANDLE_RADIUS + 6) {
          e.stopPropagation()
          beginRotate(entry, e)
          return
        }
      }
      // Neither body nor handle — let the event bubble to the stage so the
      // place-mode click drops a new camera there (same as empty canvas).
    })
    container.on('pointerover', () => {
      if (!isCameraMode()) return
      entry.hovered = true
      // mirror into the store so the roster panel row highlights in sync
      useHoverStore.getState().setHover(entry.camera.id, 'camera')
      lastHoverId = entry.camera.id
      drawCamera(entry)
      scene.requestRender()
    })
    container.on('pointerout', () => {
      if (!entry.hovered && !entry.handleHover) return
      entry.hovered = false
      entry.handleHover = false
      const hover = useHoverStore.getState()
      if (hover.type === 'camera' && hover.id === entry.camera.id) {
        useHoverStore.getState().clearHoverIf(entry.camera.id)
        lastHoverId = null
      }
      drawCamera(entry)
      scene.requestRender()
    })
    // Hover affordance for the rotate handle: track whether the pointer sits
    // on the dot while the camera is selected, redraw on transitions only.
    container.on('pointermove', (e) => {
      if (!isCameraMode()) return
      const editor = useEditorStore.getState()
      const isSelected = editor.selectedId === entry.camera.id && editor.selectedType === 'camera'
      let over = false
      if (isSelected) {
        const local = e.getLocalPosition(container)
        const azRad = ((entry.camera.azimuth ?? 0) % 360) * Math.PI / 180
        const hx = Math.cos(azRad) * HANDLE_DIST
        const hy = Math.sin(azRad) * HANDLE_DIST
        over = Math.hypot(local.x - hx, local.y - hy) <= HANDLE_RADIUS + 6
      }
      if (over !== entry.handleHover) {
        entry.handleHover = over
        drawCamera(entry)
        scene.requestRender()
      }
    })
  }

  // Drag-move: live store writes, rAF-coalesced (FOV recompute is cheap —
  // no drag-overlay indirection needed; history debounce folds the whole
  // gesture into one undo step).
  const beginDrag = (entry, downEvent) => {
    const stage = scene.app.stage
    const startWorld = scene.world.toLocal(downEvent.global)
    const startX = entry.camera.x
    const startY = entry.camera.y
    let pending = null
    let rafId = 0
    const flush = () => {
      rafId = 0
      if (pending) {
        useCameraStore.getState().updateCamera(entry.floorId, entry.camera.id, pending)
        pending = null
      }
    }
    const onMove = (e) => {
      // 47-21: if the mode changed mid-drag (e.g. a hotkey switched away from
      // CAMERA), stop writing camera position — the drag no longer belongs to
      // an active camera interaction.
      if (!isCameraMode()) return
      const wp = scene.world.toLocal(e.global)
      pending = { x: startX + (wp.x - startWorld.x), y: startY + (wp.y - startWorld.y) }
      if (rafId === 0) rafId = requestAnimationFrame(flush)
    }
    const onUp = () => {
      if (rafId !== 0) { cancelAnimationFrame(rafId); rafId = 0 }
      flush()
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  // Drag-rotate: azimuth follows the cursor around the camera. Shift snaps
  // to 15° increments (matches tray draw's angle-lock convention).
  const beginRotate = (entry) => {
    const stage = scene.app.stage
    let rafId = 0
    let pendingAz = null
    const flush = () => {
      rafId = 0
      if (pendingAz != null) {
        useCameraStore.getState().updateCamera(entry.floorId, entry.camera.id, { azimuth: pendingAz })
        pendingAz = null
      }
    }
    const onMove = (e) => {
      // 47-21: stop writing azimuth if the mode changed mid-rotate.
      if (!isCameraMode()) return
      const wp = scene.world.toLocal(e.global)
      const cam = entry.camera
      const dx = wp.x - cam.x
      const dy = wp.y - cam.y
      if (Math.hypot(dx, dy) < 1e-6) return
      let deg = Math.atan2(dy, dx) * 180 / Math.PI
      deg = ((deg % 360) + 360) % 360
      const snap = e.originalEvent?.shiftKey ? 15 : 1
      pendingAz = Math.round(deg / snap) * snap % 360
      if (rafId === 0) rafId = requestAnimationFrame(flush)
    }
    const onUp = () => {
      if (rafId !== 0) { cancelAnimationFrame(rafId); rafId = 0 }
      flush()
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  // ── Reconciler ──────────────────────────────────────────────────────────
  let lastFloorId
  let lastCameras
  let lastCamById = new Map()
  const reconcile = () => {
    const fid = useFloorStore.getState().activeFloorId
    const cameras = useCameraStore.getState().camerasByFloor[fid] ?? []
    if (fid === lastFloorId && cameras === lastCameras) return
    const floorChanged = fid !== lastFloorId
    lastFloorId = fid
    lastCameras = cameras

    const next = new Set(cameras.map((c) => c.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    const nextById = new Map()
    for (const cam of cameras) {
      const entry = ensureContainer(cam, fid)
      if (floorChanged || lastCamById.get(cam.id) !== cam) drawCamera(entry)
      nextById.set(cam.id, cam)
    }
    lastCamById = nextById
  }

  const applyInverseScale = () => {
    const vp = useViewportStore.getState()
    const inv = 1 / (vp.scale || 1)
    for (const entry of containers.values()) entry.container.scale.set(inv)
  }

  // Mode gate — both layers exist only for CAMERA mode.
  const applyModeVisibility = () => {
    const on = isCameraMode()
    fovLayer.visible = on
    layer.visible = on
  }

  // ── Subscriptions ───────────────────────────────────────────────────────
  let lastSelectedId = useEditorStore.getState().selectedId
  let lastMode = useEditorStore.getState().editorMode
  const onEditorChange = () => {
    const s = useEditorStore.getState()
    if (s.editorMode !== lastMode) {
      lastMode = s.editorMode
      applyModeVisibility()
      redrawFov()
    }
    if (s.selectedId !== lastSelectedId) {
      const prevId = lastSelectedId
      lastSelectedId = s.selectedId
      const prev = prevId ? containers.get(prevId) : null
      const next = s.selectedId ? containers.get(s.selectedId) : null
      if (prev) drawCamera(prev)
      if (next) drawCamera(next)
      redrawFov()   // selection emphasis on the cone
    }
  }

  // ── FOV pulse loop ────────────────────────────────────────────────────────
  // While ≥1 camera is detecting, animate `pulse` as a sine breath and repaint
  // the cones. Self-contained rAF: starts when detection begins, stops when it
  // ends, so render-on-demand idle is preserved when nothing is being seen.
  let pulseRaf = 0
  const PULSE_HZ = 1.4   // breaths per second
  const pulseTick = (ts) => {
    if (!isCameraMode() || !anyDetecting()) { pulseRaf = 0; pulse = 0; redrawFov(); scene.requestRender(); return }
    pulse = 0.5 + 0.5 * Math.sin((ts / 1000) * PULSE_HZ * Math.PI * 2)
    waveSec = ts / 1000
    redrawFov()
    scene.requestRender()
    pulseRaf = requestAnimationFrame(pulseTick)
  }
  const syncPulse = () => {
    if (isCameraMode() && anyDetecting() && pulseRaf === 0) {
      pulseRaf = requestAnimationFrame(pulseTick)
    }
  }

  // Roster-panel hover → highlight the matching marker (and un-highlight the
  // previous one). Cheap: redraw only the two affected containers. The hover
  // bus is shared across object types, so only camera-typed hovers count here.
  const cameraHoverId = () => {
    const s = useHoverStore.getState()
    return s.type === 'camera' ? s.id : null
  }
  let lastHoverId = cameraHoverId()
  const onHoverChange = () => {
    const id = cameraHoverId()
    if (id === lastHoverId) return
    const prev = lastHoverId ? containers.get(lastHoverId) : null
    const next = id ? containers.get(id) : null
    lastHoverId = id
    if (prev) drawCamera(prev)
    if (next) drawCamera(next)
    scene.requestRender()
  }

  const unsubCamera = useCameraStore.subscribe(() => { reconcile(); redrawFov(); applyInverseScale() })
  const unsubFloor = useFloorStore.subscribe(() => { reconcile(); redrawFov(); applyInverseScale() })
  const unsubWall = useWallStore.subscribe(redrawFov)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  const unsubViewport = useViewportStore.subscribe(applyInverseScale)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  // Detection membership changed → repaint cones now and make sure the pulse
  // loop is running (it self-stops when detection clears).
  const unsubDetection = subscribeDetection(() => { redrawFov(); scene.requestRender(); syncPulse() })

  reconcile()
  redrawFov()
  applyInverseScale()
  applyModeVisibility()
  syncPulse()

  return () => {
    unsubCamera()
    unsubFloor()
    unsubWall()
    unsubEditor()
    unsubViewport()
    unsubHover()
    unsubDetection()
    if (pulseRaf !== 0) cancelAnimationFrame(pulseRaf)
    for (const id of Array.from(containers.keys())) removeContainer(id)
    fovLayer.removeChild(fovG)
    fovG.destroy()
  }
}

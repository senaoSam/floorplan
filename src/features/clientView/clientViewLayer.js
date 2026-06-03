import { Container, Graphics } from 'pixi.js'
import { useViewportStore } from '@/store/useViewportStore'
import { EDITOR_MODE } from '@/store/useEditorStore'
import { PERSON, PERSON_FILL, PERSON_BORDER } from './personGeometry'

// Renders the Client View overlay on scene.layers.overlays:
//   - the placed client marker (little person, black body + white border,
//     feet-anchored at the sampled point)
//   - a SOLID cyan line from the figure's HEART to the serving AP
//   - DASHED grey lines from the heart to roaming-candidate APs
//   - (when showAssociationArea) a translucent blue region of all points that
//     would stay associated to the serving AP — computed in clientViewBinder /
//     association.js and handed in via store (33-4).
//
// All geometry is in canvas px (world space); stroke widths use 1/scale so the
// lines stay a constant on-screen thickness as the user zooms. Colours here are
// NEW (Hamina has no oldSrc to match) — placeholder values pending the user's
// sign-off after the first MCP screenshot (.claude/client-view-spec.md).

const SERVING_COLOR = '#00e5ff'   // serving association — cyan (ghost-line family)
const CANDIDATE_COLOR = '#9ca3af' // roaming candidate — grey
const HALO_COLOR = '#000000'
const CLIENT_FILL = '#ffffff'
const ASSOC_FILL = '#3b82f6'
// Client figure colours + geometry (PERSON) live in personGeometry.js so the
// canvas marker and the SVG cursor stay identical. Feet anchor the sampled
// point; association lines emanate from the heart, not the feet.

function drawDashed(g, ax, ay, bx, by, color, width, dashOn, dashOff, alpha) {
  const len = Math.hypot(bx - ax, by - ay)
  if (len <= 1e-9) return
  const ux = (bx - ax) / len
  const uy = (by - ay) / len
  let cursor = 0
  let phaseOn = true
  let remain = dashOn
  while (cursor < len) {
    const step = Math.min(len - cursor, remain)
    if (phaseOn) {
      g.moveTo(ax + ux * cursor, ay + uy * cursor)
        .lineTo(ax + ux * (cursor + step), ay + uy * (cursor + step))
        .stroke({ width, color, alpha })
    }
    cursor += step
    remain -= step
    if (remain <= 1e-9) { phaseOn = !phaseOn; remain = phaseOn ? dashOn : dashOff }
  }
}

export function attachClientViewLayer({
  scene,
  useClientViewStore,
  useFloorStore,
  useAPStore,
  useEditorStore,
}) {
  const layer = scene.layers.overlays
  const root = new Container()
  root.eventMode = 'none'
  layer.addChild(root)
  const g = new Graphics()
  g.eventMode = 'none'
  root.addChild(g)

  // Look up the active floor's AP record (canvas px position) by id.
  const apPosById = (id) => {
    const fid = useFloorStore.getState().activeFloorId
    const aps = useAPStore.getState().apsByFloor[fid] ?? []
    const ap = aps.find((a) => a.id === id)
    return ap ? { x: ap.x, y: ap.y } : null
  }

  const redraw = () => {
    g.clear()
    // Only paint inside CLIENT_VIEW. pos now survives leaving the mode
    // (position memory), so without this gate the marker would linger on the
    // canvas in SELECT / other modes.
    if (useEditorStore.getState().editorMode !== EDITOR_MODE.CLIENT_VIEW) return
    const cv = useClientViewStore.getState()
    if (cv.pos == null) return
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale
    const cx = cv.pos.x
    const cy = cv.pos.y
    const reading = cv.reading

    // Association area (Hamina-style, verified): the blue region IS the
    // coverage — fill the smooth coverage polygons directly. Blue = covered
    // (usable signal), uncovered stays clear. Drawn first so lines + marker sit
    // on top; a faint boundary stroke defines the edge.
    const area = cv.associationArea
    if (cv.showAssociationArea && area) {
      for (const poly of (area.polygons ?? [])) {
        if (poly.length >= 6) g.poly(poly).fill({ color: ASSOC_FILL, alpha: 0.22 })
      }
      for (const poly of (area.polygons ?? [])) {
        if (poly.length >= 6) g.poly(poly).stroke({ width: 1.5 * s, color: ASSOC_FILL, alpha: 0.55 })
      }
    }

    // Association lines emanate from the figure's HEART (chest height), not the
    // feet — the feet are the position anchor, but a line into the chest reads
    // as "this person's connection". heartY sits in the upper torso.
    const heartY = cy - PERSON.heartDy * s
    const hx = cx
    const hy = heartY

    // Roaming-candidate dashed grey lines (under the serving line).
    if (reading && Array.isArray(reading.candidates)) {
      for (const c of reading.candidates) {
        const p = apPosById(c.id)
        if (!p) continue
        drawDashed(g, hx, hy, p.x, p.y, CANDIDATE_COLOR, 1.5 * s, 7 * s, 5 * s, 0.8)
      }
    }

    // Serving solid cyan line (with dark halo for contrast on light floors).
    if (reading && reading.servingApId) {
      const p = apPosById(reading.servingApId)
      if (p) {
        g.moveTo(hx, hy).lineTo(p.x, p.y)
          .stroke({ width: 4 * s, color: HALO_COLOR, alpha: 0.4 })
        g.moveTo(hx, hy).lineTo(p.x, p.y)
          .stroke({ width: 2.5 * s, color: SERVING_COLOR, alpha: 1 })
        // Small ring at the serving AP end so it reads as the association
        // target.
        g.circle(p.x, p.y, 9 * s).stroke({ width: 2 * s, color: SERVING_COLOR, alpha: 0.9 })
      }
    }

    // Client marker — a little person (black body, white border), foot-anchored
    // at (cx, cy) so the feet sit on the sampled point as it's dragged. Drawn
    // last so it sits on top of the lines emanating from its heart. The head
    // turns red when the device can't associate anywhere (out of range).
    drawPerson(g, cx, cy, s, reading && reading.outOfRange)
  }

  // Draws a stylised standing person (black fill, white border), scaled to
  // screen px via `s` (1/viewScale) and anchored at the feet (fx, fy). Built
  // from rounded primitives: a head circle, a bell-shaped body, and two legs.
  // The white border is rendered by stroking each primitive; the black fill
  // sits inside. `outOfRange` swaps the head to red as a warning.
  function drawPerson(g, fx, fy, s, outOfRange) {
    const P = PERSON
    const headR = P.headR * s
    const headCy = fy - P.headDy * s
    const neckY = fy - P.neckDy * s
    const hipY = fy - P.hipDy * s
    const halfShoulder = P.halfShoulder * s
    const halfHip = P.halfHip * s
    const footSpread = P.footSpread * s
    const border = P.border * s

    // Body silhouette: shoulders taper down to the hips (a rounded bell).
    const body = [
      fx - halfShoulder, neckY,
      fx + halfShoulder, neckY,
      fx + halfHip,      hipY,
      fx - halfHip,      hipY,
    ]

    // White border pass — stroke every primitive fat & white first, fill black
    // on top. Legs first so the body overlaps their tops cleanly.
    const legStroke = (x2) => g.moveTo(fx, hipY - 1 * s).lineTo(x2, fy)
    // legs — white border
    legStroke(fx - footSpread).stroke({ width: P.legW * s + border * 2, color: PERSON_BORDER, alpha: 1, cap: 'round' })
    legStroke(fx + footSpread).stroke({ width: P.legW * s + border * 2, color: PERSON_BORDER, alpha: 1, cap: 'round' })
    // body — white border
    g.poly(body).stroke({ width: border * 2, color: PERSON_BORDER, alpha: 1, join: 'round' })
    g.poly(body).fill({ color: PERSON_BORDER, alpha: 1 })
    // head — white border
    g.circle(fx, headCy, headR + border).fill({ color: PERSON_BORDER, alpha: 1 })

    // Black fill pass.
    legStroke(fx - footSpread).stroke({ width: P.legW * s, color: PERSON_FILL, alpha: 1, cap: 'round' })
    legStroke(fx + footSpread).stroke({ width: P.legW * s, color: PERSON_FILL, alpha: 1, cap: 'round' })
    g.poly(body).fill({ color: PERSON_FILL, alpha: 1 })
    g.circle(fx, headCy, headR).fill({ color: outOfRange ? '#ef4444' : PERSON_FILL, alpha: 1 })
  }

  const unsubCV = useClientViewStore.subscribe(redraw)
  const unsubViewport = useViewportStore.subscribe(redraw)
  const unsubFloor = useFloorStore.subscribe(redraw)
  const unsubAP = useAPStore.subscribe(redraw)
  // Mode change → redraw, so the marker clears when leaving CLIENT_VIEW and
  // reappears (at the remembered pos) when re-entering.
  const unsubEditor = useEditorStore.subscribe(redraw)
  redraw()

  return () => {
    unsubCV()
    unsubViewport()
    unsubFloor()
    unsubAP()
    unsubEditor()
    layer.removeChild(root)
    root.destroy({ children: true })
  }
}

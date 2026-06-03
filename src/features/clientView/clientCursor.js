// Mouse cursor for CLIENT_VIEW mode — the SAME little person the canvas marker
// draws (clientViewLayer.drawPerson), generated from the shared PERSON geometry
// so the two never drift, then rendered at 50% size via the SVG width/height.
// Hotspot is at the figure's FEET so clicking drops the client where the feet
// point (matching the marker's anchor convention).

import { PERSON, PERSON_FILL, PERSON_BORDER } from './personGeometry'

// Build the SVG in PERSON's own coordinate units (feet at the origin, figure
// extends upward), with a margin for the white border + round leg caps. Each
// shape is black-filled with a white stroke of 2×border — a centred stroke
// gives `border` px on each side, matching the layer's "fat white under, black
// over" passes.
const P = PERSON
const MARGIN = P.border + P.legW / 2 + 1        // room for stroke + round caps
const HALF_W = Math.max(P.halfShoulder, P.footSpread) + MARGIN
const VB_W = HALF_W * 2
const VB_H = P.headDy + P.headR + MARGIN        // feet (y=VB_H-MARGIN) → head top
const FX = HALF_W                                // figure centre x
const FY = VB_H - MARGIN                          // feet y (baseline)

const y = (dy) => FY - dy                         // height-above-feet → svg y

// Body silhouette (shoulders → hips), same 4 points as drawPerson.
const body = [
  [FX - P.halfShoulder, y(P.neckDy)],
  [FX + P.halfShoulder, y(P.neckDy)],
  [FX + P.halfHip,      y(P.hipDy)],
  [FX - P.halfHip,      y(P.hipDy)],
].map((p) => p.join(',')).join(' ')

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W / 2}" height="${VB_H / 2}" viewBox="0 0 ${VB_W} ${VB_H}">
  <g fill="${PERSON_FILL}" stroke="${PERSON_BORDER}" stroke-linejoin="round" stroke-linecap="round">
    <line x1="${FX}" y1="${y(P.hipDy - 1)}" x2="${FX - P.footSpread}" y2="${FY}" stroke-width="${P.legW + P.border * 2}"/>
    <line x1="${FX}" y1="${y(P.hipDy - 1)}" x2="${FX + P.footSpread}" y2="${FY}" stroke-width="${P.legW + P.border * 2}"/>
    <polygon points="${body}" stroke-width="${P.border * 2}"/>
    <circle cx="${FX}" cy="${y(P.headDy)}" r="${P.headR}" stroke-width="${P.border * 2}"/>
  </g>
</svg>`

const DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`

// Hotspot at the feet, in the HALF-scale pixel space the cursor renders at.
const HOT_X = Math.round(FX / 2)
const HOT_Y = Math.round(FY / 2)

export const CLIENT_CURSOR = `url("${DATA_URI}") ${HOT_X} ${HOT_Y}, crosshair`

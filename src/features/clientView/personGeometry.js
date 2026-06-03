// Client-figure geometry in base (screen) px, measured upward from the feet
// anchor. Single source of truth shared by:
//   - clientViewLayer.js  → draws the marker on the canvas at this size
//   - clientCursor.js     → renders the SAME figure as the mouse cursor, at 50%
// so the painted marker and the cursor are unmistakably the same little person.
export const PERSON = {
  headR: 6,        // head radius
  headDy: 30,      // head centre height above feet
  neckDy: 22,      // shoulders height
  hipDy: 11,       // hips height
  heartDy: 19,     // heart height (association-line origin)
  halfShoulder: 7, // half shoulder width
  halfHip: 4.5,    // half hip width
  footSpread: 5.5, // half-distance between the two feet
  legW: 4,         // leg stroke width
  border: 1.6,     // white border thickness
}

export const PERSON_FILL = '#1f2937'    // near-black body
export const PERSON_BORDER = '#ffffff'  // white outline

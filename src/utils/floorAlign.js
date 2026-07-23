// Meter-space floor alignment — the single canonical definition of the
// inter-floor align transform.
//
// A floor's align fields (alignOffsetX/Y in its own canvas px, alignScale,
// alignRotation in degrees) describe a similarity transform in METER space:
//
//   worldM = s·R·(q − Cm) + Cm + Om
//
// where q = a point in the floor's own meters (px × pxToM), Cm = image
// center in meters, Om = offset in meters (offset px × pxToM). This is the
// same map Viewer3D's FloorStack drives its <group> with; the 2D ALIGN_FLOOR
// wrap is the equivalent px-space projection (multiply through by the
// floor's own scale), and refOverlayLayer compensates a ref floor's px/m
// density difference with the scaleActive/scaleRef factor derived from it.
//
// Callers pass pxToM explicitly because the fallback differs by context:
// viewer3d uses the conventional 100 px/m pseudo-scale before calibration,
// while the RF engine refuses to run without a real scale.

// Returns a 2×3 affine matrix {a, b, tx, ty} such that
//   x' = a·x − b·y + tx
//   y' = b·x + a·y + ty
export function makeAlignMatrixM(floor, pxToM) {
  const s = floor.alignScale ?? 1
  const th = ((floor.alignRotation ?? 0) * Math.PI) / 180
  const a = s * Math.cos(th)
  const b = s * Math.sin(th)
  const cx = ((floor.imageWidth ?? 0) / 2) * pxToM
  const cy = ((floor.imageHeight ?? 0) / 2) * pxToM
  const ox = (floor.alignOffsetX ?? 0) * pxToM
  const oy = (floor.alignOffsetY ?? 0) * pxToM
  return {
    a, b,
    tx: cx + ox - (a * cx - b * cy),
    ty: cy + oy - (b * cx + a * cy),
  }
}

export function applyAlignMatrix(m, x, y) {
  return { x: m.a * x - m.b * y + m.tx, y: m.b * x + m.a * y + m.ty }
}

// Inverse of a similarity {a, b, tx, ty}: p = A⁻¹(p' − t). A = s·R maps to
// the complex number a + i·b, so A⁻¹ = (a − i·b) / (a² + b²).
export function invertAlignMatrix(m) {
  const det = m.a * m.a + m.b * m.b
  const ia = m.a / det
  const ib = -m.b / det
  return {
    a: ia,
    b: ib,
    tx: -(ia * m.tx - ib * m.ty),
    ty: -(ib * m.tx + ia * m.ty),
  }
}

// composeAlignMatrix(m2, m1) = m2 ∘ m1 (apply m1 first, then m2).
export function composeAlignMatrix(m2, m1) {
  return {
    a: m2.a * m1.a - m2.b * m1.b,
    b: m2.b * m1.a + m2.a * m1.b,
    tx: m2.a * m1.tx - m2.b * m1.ty + m2.tx,
    ty: m2.b * m1.tx + m2.a * m1.ty + m2.ty,
  }
}

// True when every align field is at its default — callers skip the matrix
// work entirely (the overwhelmingly common case).
export function isIdentityAlign(floor) {
  return (floor.alignOffsetX ?? 0) === 0 &&
         (floor.alignOffsetY ?? 0) === 0 &&
         (floor.alignScale ?? 1) === 1 &&
         (floor.alignRotation ?? 0) === 0
}

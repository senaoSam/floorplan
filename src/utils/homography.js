// Homography (planar perspective transform) from 4 point correspondences.
//
// Used by camera heat-map calibration (Verkada parity, see .claude/verkada-notes.md
// §L): the user clicks 4 points on the floorplan and the 4 matching points on the
// camera frame; solving for the 3×3 matrix H lets us project a detection in camera-
// frame coordinates onto the floorplan (and back). This is the REAL function —
// feed it real corner correspondences and it works; the mock data is only the input,
// not the maths.
//
// A homography maps homogeneous points: [x',y',w'] = H · [x,y,1], then divide by w'.
// With H normalised so h22 = 1, four correspondences give 8 linear equations in the
// 8 unknowns h00..h21 — solved here by Gaussian elimination with partial pivoting.

// Solve the 8×8 linear system A·x = b for x. Mutates copies, returns length-8 array
// or null if the system is singular (degenerate point configuration).
function solveLinear8(A, b) {
  const n = 8
  // augmented matrix
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    // partial pivot: find the largest-magnitude entry in this column
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null   // singular
    if (pivot !== col) { const t = M[pivot]; M[pivot] = M[col]; M[col] = t }
    // eliminate below
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  // back-substitution
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c]
    x[r] = s / M[r][r]
  }
  return x
}

// src, dst: arrays of exactly 4 {x,y} points (corresponding order).
// Returns the 3×3 matrix (row-major number[9]) mapping src → dst, or null if the
// points are degenerate (collinear / coincident).
export function solveHomography(src, dst) {
  if (!src || !dst || src.length < 4 || dst.length < 4) return null
  const A = []
  const b = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: X, y: Y } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X)
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y)
  }
  const h = solveLinear8(A, b)
  if (!h) return null
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

// Apply a 3×3 homography (number[9], row-major) to a {x,y} point. Returns {x,y}.
export function applyHomography(H, p) {
  const x = H[0] * p.x + H[1] * p.y + H[2]
  const y = H[3] * p.x + H[4] * p.y + H[5]
  const w = H[6] * p.x + H[7] * p.y + H[8]
  return { x: x / w, y: y / w }
}

// Mean reprojection error (px): how far each src point lands from its dst target
// under H. A useful calibration-quality readout for the user.
export function reprojectionError(H, src, dst) {
  if (!H) return Infinity
  let sum = 0
  for (let i = 0; i < src.length; i++) {
    const q = applyHomography(H, src[i])
    sum += Math.hypot(q.x - dst[i].x, q.y - dst[i].y)
  }
  return sum / src.length
}

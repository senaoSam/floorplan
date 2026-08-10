import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial'
import { useScopeStore } from '@/store/useScopeStore'

// Match 2D ScopeLayer color choices so the 3D overlay reads as the same
// object type across views. Floor holes have moved to FloorHoleVolume3D
// (rendered as vertical columns spanning bottomFloorId → topFloorId).
const STYLES = {
  in:  { fill: '#2ed573', fillAlpha: 0.40, stroke: '#2ed573' },
  out: { fill: '#ff4757', fillAlpha: 0.18, stroke: '#ff4757' },
}

// 51-11: scope boundary thickness in world units. Thinner than the floor-hole
// ring (0.12) and the cables (0.10) on purpose — a scope is a PLANNING
// boundary, not a physical object, so it should read as an annotation rather
// than something you could bump into. Same reasoning that set the camera
// coverage footprint to 0.07 in 51-10.
const SCOPE_WIDTH_M = 0.07

// Build a flat (XY) THREE.Shape from a flat [x0,y0,x1,y1,...] point list in
// meters. The caller rotates it onto the XZ ground plane.
function buildShape(pointsM) {
  if (!pointsM || pointsM.length < 6) return null
  const shape = new THREE.Shape()
  shape.moveTo(pointsM[0], pointsM[1])
  for (let i = 2; i < pointsM.length; i += 2) {
    shape.lineTo(pointsM[i], pointsM[i + 1])
  }
  shape.closePath()
  return shape
}

// 51-11: the closed boundary ring, drawn with real width via Line2. The old
// `lineBasicMaterial linewidth={2}` was a WebGL no-op on desktop backends
// (same trap as the floor-hole rings in 51-8) — it always rasterised as a
// 1px hairline, which on the translucent fill left the zone edge ambiguous:
// where a scope stops is exactly what the user is checking when they draw one.
function ScopeOutline({ positions, color, opacity }) {
  const size = useThree((s) => s.size)

  const geom = useMemo(() => {
    const g = new LineGeometry()
    g.setPositions(positions)
    return g
  }, [positions])
  React.useEffect(() => () => geom.dispose(), [geom])

  const material = useMemo(() => new LineMaterial({
    color: new THREE.Color(color),
    // World units so the boundary keeps a constant physical thickness while
    // the user zooms, matching cables (51-7) and hole rings (51-8).
    worldUnits: true,
    linewidth: SCOPE_WIDTH_M,
    transparent: true,
    opacity,
    // Same reasoning as 51-3: green vs red IS the in-/out-of-scope reading,
    // so distance must not tint it toward a common colour.
    fog: false,
  }), [color, opacity])
  React.useEffect(() => () => material.dispose(), [material])

  // LineMaterial sizes its quads with help from the drawing-buffer size even
  // in worldUnits mode; keep it in sync with the canvas.
  React.useEffect(() => {
    material.resolution.set(size.width, size.height)
  }, [material, size.width, size.height])

  const line = useMemo(() => {
    const l = new Line2(geom, material)
    l.computeLineDistances()
    // The ring lies flat across the floor; letting it swallow clicks would
    // steal selection from whatever sits inside the zone.
    l.raycast = () => null
    return l
  }, [geom, material])

  return <primitive object={line} />
}

// Polygon outline as a continuous Line Loop on the ground plane. Slightly
// lifted off the floor so z-fighting with the floor image doesn't flicker.
function PolygonFill({ pointsM, yOffset, style, dimOpacity = 1 }) {
  const shape = useMemo(() => buildShape(pointsM), [pointsM])
  const geom  = useMemo(() => (shape ? new THREE.ShapeGeometry(shape) : null), [shape])

  const outlinePts = useMemo(() => {
    if (!pointsM || pointsM.length < 4) return null
    const arr = new Float32Array((pointsM.length / 2 + 1) * 3)
    for (let i = 0, j = 0; i < pointsM.length; i += 2, j += 3) {
      arr[j]     = pointsM[i]
      arr[j + 1] = 0
      arr[j + 2] = pointsM[i + 1]
    }
    // Close the loop.
    arr[arr.length - 3] = pointsM[0]
    arr[arr.length - 2] = 0
    arr[arr.length - 1] = pointsM[1]
    return arr
  }, [pointsM])

  if (!geom || !outlinePts) return null

  return (
    <group position={[0, yOffset, 0]}>
      {/* Shape geometry is authored in XY; tilt onto XZ with +π/2 around X so
          the shape's +Y maps to world +Z (canvas y-down → world z-forward),
          matching the canvas-px → world convention used by walls/APs. Using
          −π/2 would mirror the polygon along Z. DoubleSide material keeps the
          fill visible from both above and below. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <primitive object={geom} attach="geometry" />
        <meshBasicMaterial
          color={style.fill}
          transparent
          opacity={style.fillAlpha * dimOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
          // 51-3: opt out of scene fog. Green vs red is the only thing
          // distinguishing an in-scope zone from an out-of-scope one, so two
          // zones at different depths must not drift toward a common tint.
          fog={false}
        />
      </mesh>

      <ScopeOutline positions={outlinePts} color={style.stroke} opacity={dimOpacity} />
    </group>
  )
}

// Convert canvas-pixel polygon [x,y,...] to meters using pxToM.
function pointsToMeters(pts, pxToM) {
  const out = new Array(pts.length)
  for (let i = 0; i < pts.length; i++) out[i] = pts[i] * pxToM
  return out
}

export default function ScopeLayer3D({ floorId, pxToM, dimOpacity = 1 }) {
  const scopes = useScopeStore((s) => s.scopesByFloor[floorId] ?? [])

  if (!pxToM) return null
  if (!scopes.length) return null

  return (
    <group>
      {scopes.map((z) => {
        const style = STYLES[z.type] ?? STYLES.in
        return (
          <PolygonFill
            key={z.id}
            pointsM={pointsToMeters(z.points, pxToM)}
            yOffset={0.005}
            style={style}
            dimOpacity={dimOpacity}
          />
        )
      })}
    </group>
  )
}

import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useScopeStore } from '@/store/useScopeStore'

// Match 2D ScopeLayer color choices so the 3D overlay reads as the same
// object type across views. Floor holes have moved to FloorHoleVolume3D
// (rendered as vertical columns spanning bottomFloorId → topFloorId).
const STYLES = {
  in:  { fill: '#2ed573', fillAlpha: 0.40, stroke: '#2ed573' },
  out: { fill: '#ff4757', fillAlpha: 0.18, stroke: '#ff4757' },
}

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
        />
      </mesh>

      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={outlinePts.length / 3}
            array={outlinePts}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={style.stroke} transparent opacity={dimOpacity} linewidth={2} />
      </line>
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

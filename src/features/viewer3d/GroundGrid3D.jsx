import React, { useMemo, useEffect } from 'react'
import * as THREE from 'three'

// 51-4 Ground grid.
//
// Replaces `<gridHelper>`, which draws a fixed number of equal-weight line
// segments and stops at a hard rectangular edge — the boundary read as "the
// world ends here" rather than as ground receding.
//
// This draws the grid procedurally in the fragment shader on a single large
// plane instead. Two things that buys us:
//
//  - Distance fade. Alpha falls off with radius, so the grid dissolves into
//    the backdrop rather than terminating. 51-3's fog can't do this job: fog
//    tints toward the fog colour but leaves the lines fully opaque, so the
//    outer edge would still be visible as a rectangle.
//  - Line width that holds up under perspective. Screen-space derivatives
//    (`fwidth`) keep each line roughly one pixel wide wherever it lands, so
//    lines near the horizon stay crisp instead of aliasing into moire.
//
// Two weights: a minor line every `cell` metres, and a major line every
// `major` cells, which gives a sense of scale that a uniform grid can't.
//
// The plane is a single quad — the grid's apparent resolution comes from the
// shader, not geometry, so there is no vertex cost to making it large.

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

// `grid()` returns line coverage in [0,1] for a given cell size. Dividing the
// distance-to-nearest-gridline by fwidth converts it to a screen-space
// measure, so the result is a consistently thin line at any depth.
const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vWorld;

  uniform vec3  uCenter;
  uniform float uCell;
  uniform float uMajor;
  uniform vec3  uMinorColor;
  uniform vec3  uMajorColor;
  uniform float uMinorAlpha;
  uniform float uMajorAlpha;
  uniform float uFadeStart;
  uniform float uFadeEnd;

  float gridCoverage(vec2 p, float cell, float thickness) {
    vec2 coord = p / cell;
    vec2 deriv = fwidth(coord);
    // Distance to the nearest line, in cell units, normalised by the pixel
    // footprint so the line keeps a constant screen width.
    vec2 g = abs(fract(coord - 0.5) - 0.5) / max(deriv, vec2(1e-5));
    float line = min(g.x, g.y);
    return 1.0 - min(line / thickness, 1.0);
  }

  void main() {
    vec2 p = vWorld.xz - uCenter.xz;

    float minor = gridCoverage(p, uCell, 1.0);
    float major = gridCoverage(p, uCell * uMajor, 1.4);

    // Major lines win where they coincide with minor ones.
    vec3  color = mix(uMinorColor, uMajorColor, major);
    float alpha = max(minor * uMinorAlpha, major * uMajorAlpha);

    // Radial fade so the grid dissolves instead of ending at the plane edge.
    float d = length(p);
    alpha *= 1.0 - smoothstep(uFadeStart, uFadeEnd, d);

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(color, alpha);
  }
`

// Fraction of the radius the grid holds full strength before fading out.
const FADE_START_FRAC = 0.45

export default function GroundGrid3D({
  center,          // [x, y, z] world position the grid centres on
  radius,          // metres from centre to where the grid has fully faded
  cell = 1,        // minor gridline spacing, metres
  major = 10,      // a major line every N cells
}) {
  const uniforms = useMemo(() => ({
    uCenter:     { value: new THREE.Vector3(...center) },
    uCell:       { value: cell },
    uMajor:      { value: major },
    // Cool slate, matching the pre-51-4 gridHelper colours so the change
    // reads as "the grid now fades" rather than a palette shift. Lifted a
    // step from those values because the old helper drew every line at full
    // opacity, and against the 51-3 backdrop the faded version needs the
    // extra contrast to stay readable near the building.
    uMinorColor: { value: new THREE.Color('#3d4d66') },
    uMajorColor: { value: new THREE.Color('#5b6e8c') },
    uMinorAlpha: { value: 0.55 },
    uMajorAlpha: { value: 0.9 },
    // Hold full strength across the near field, then fade over the outer
    // half. Fading from 25% made the grid read as washed out right where it
    // is most useful as a ground reference.
    uFadeStart:  { value: radius * FADE_START_FRAC },
    uFadeEnd:    { value: radius },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep uniforms in step with props without rebuilding the material (which
  // would recompile the shader on every floor switch).
  useEffect(() => { uniforms.uCenter.value.set(center[0], center[1], center[2]) }, [uniforms, center])
  useEffect(() => { uniforms.uCell.value = cell }, [uniforms, cell])
  useEffect(() => { uniforms.uMajor.value = major }, [uniforms, major])
  useEffect(() => {
    uniforms.uFadeStart.value = radius * FADE_START_FRAC
    uniforms.uFadeEnd.value = radius
  }, [uniforms, radius])

  // Plane spans the full fade radius so the fade completes before the quad's
  // own edge is reachable.
  const size = radius * 2

  return (
    <mesh
      position={[center[0], center[1], center[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      // Never let the grid intercept clicks — it covers the whole view and
      // would swallow the "click empty space to deselect" behaviour.
      raycast={() => null}
      renderOrder={-1}
    >
      <planeGeometry args={[size, size]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        // The grid is a reference overlay, not lit geometry; fogging it would
        // double up with the radial fade it already has.
        fog={false}
      />
    </mesh>
  )
}

import * as THREE from 'three'

// Fresnel glass, shared by glass walls (WallLayer3D) and window panes
// (OpeningDetail3D) so the two still read as the same material (51-6).
//
// Replaces meshPhysicalMaterial `transmission`. Transmission makes three
// render the whole opaque scene a second time into an offscreen target every
// frame, just so the glass can sample a refracted, blurred copy of what is
// behind it — a plan viewer never needs refraction, and the cost grew with
// every AP and wall in the scene.
//
// Real glass is nearly invisible looked at straight on and turns into a mirror
// at grazing angles. That angle dependence is what makes a pane read as glass
// rather than as a tinted plastic sheet, and it is cheap to fake: Schlick-style
// f = (1 − |N·V|)^POW drives both alpha (face-on almost clear, edge-on nearly
// opaque) and a blend toward the sky colour. The standard material's own
// specular term already reflects scene.environment (the sky, skyEnvironment.js)
// at roughness 0.05; the extra alpha at grazing angles is what lets that
// reflection actually show instead of being faded out with the pane.
//
// Visual only — RF attenuation is material.dbLoss in the engines.

export const GLASS_FACE_ALPHA = 0.14
export const GLASS_EDGE_ALPHA = 0.85
const GLASS_FRESNEL_POW = 3.0
// How far the grazing reflection pulls toward the sky colour.
const GLASS_SKY_MIX = 0.55
// Matches the horizon band of the environment sky.
const GLASS_SKY = new THREE.Color('#c9d6e3')

const f3 = (v) => v.toFixed(3)

// Module-level (not per-material) so every glass material shares one compiled
// program: three's default cache key is onBeforeCompile.toString().
export function glassOnBeforeCompile(shader) {
  shader.uniforms.uGlassSky = { value: GLASS_SKY }
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uGlassSky;')
    .replace(
      '#include <opaque_fragment>',
      `{
        // normal / vViewPosition are both view space here; abs() because the
        // pane is double-sided and either face can point at the camera.
        float gNdV = abs(dot(normalize(normal), normalize(vViewPosition)));
        float gF = pow(1.0 - gNdV, ${f3(GLASS_FRESNEL_POW)});
        outgoingLight = mix(outgoingLight, uGlassSky, gF * ${f3(GLASS_SKY_MIX)});
        diffuseColor.a *= mix(${f3(GLASS_FACE_ALPHA)}, ${f3(GLASS_EDGE_ALPHA)}, gF);
      }
      #include <opaque_fragment>`,
    )
}

// Props for a JSX <meshStandardMaterial>. `opacity` is a dimming factor on top
// of the Fresnel alpha (1 = normal; ghost floors pass their dimOpacity).
export function glassMaterialProps(color, opacity = 1) {
  return {
    color,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    opacity,
    depthWrite: false,
    onBeforeCompile: glassOnBeforeCompile,
  }
}

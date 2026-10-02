import * as THREE from 'three'

// Procedural sky the PMREM bake renders instead of RoomEnvironment. A studio
// box lights every face from every side about equally, so walls read flat and
// glass reflects a grey room. An outdoor sky gives the lighting a direction:
// a bright horizon band, a cooler zenith, a dark ground bounce and a soft sun
// lobe on the KeyLight axis. Glass and metal then reflect a believable horizon,
// and up-facing faces pick up a different tint from side faces.
//
// Colours are authored as sRGB hex; THREE.Color converts them to the linear
// working space, which is what the PMREM render target stores (ShaderMaterial
// writes its output raw — no colour-space conversion on the way in).
const SKY_ZENITH = '#5b7fb3'
const SKY_HORIZON = '#c9d6e3'
const SKY_GROUND = '#3b4250'
const SKY_SUN = '#fff1d6'

// Sun lobe: a tight core plus a wide glow. Core weight is what a glossy
// surface shows as a highlight; the glow is what tips diffuse lighting toward
// the KeyLight side without fighting the real shadow-casting light.
const SUN_CORE_POW = 256
const SUN_CORE_GAIN = 8
const SUN_GLOW_POW = 8
const SUN_GLOW_GAIN = 0.35

const VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 c = h >= 0.0
      ? mix(uHorizon, uZenith, pow(h, 0.55))
      : mix(uHorizon, uGround, pow(min(-h * 3.0, 1.0), 0.7));
    float s = max(dot(d, uSunDir), 0.0);
    c += uSun * (pow(s, ${SUN_CORE_POW.toFixed(1)}) * ${SUN_CORE_GAIN.toFixed(2)}
               + pow(s, ${SUN_GLOW_POW.toFixed(1)}) * ${SUN_GLOW_GAIN.toFixed(2)});
    gl_FragColor = vec4(c, 1.0);
  }
`

// Returns a throwaway scene for PMREMGenerator.fromScene plus its disposer.
// `sunDir` is the KeyLight offset direction (any length).
export function buildSkyEnvScene(sunDir) {
  const scene = new THREE.Scene()
  const geometry = new THREE.SphereGeometry(1, 64, 32)
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color(SKY_ZENITH) },
      uHorizon: { value: new THREE.Color(SKY_HORIZON) },
      uGround: { value: new THREE.Color(SKY_GROUND) },
      uSun: { value: new THREE.Color(SKY_SUN) },
      uSunDir: { value: new THREE.Vector3(...sunDir).normalize() },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  })
  scene.add(new THREE.Mesh(geometry, material))
  return {
    scene,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

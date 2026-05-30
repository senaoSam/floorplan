// Production-safe accessor for the live PIXI scene refs that export paths
// (PNG plan-view, PDF planning report) need to bake the canvas.
//
// Previously the only handle on the scene was window.__pixiApp / window.__scene,
// assigned ONLY under import.meta.env.DEV in FloorplanSystem. That made PNG /
// PDF export silently fail in production builds (the export code hit its
// "scene not ready" guard and produced nothing). FloorplanSystem now calls
// setActiveScene() in ALL build modes so consumers have a real ref to read
// regardless of DEV; the DEV-only window.* bridge stays purely for the
// MCP / devtools console.
//
// Single active scene (the app mounts exactly one Editor2D stage), mirroring
// how oldSrc relied on Konva.stages[0] being globally available.

let activeScene = null

export function setActiveScene(scene) {
  activeScene = scene
}

export function clearActiveScene(scene) {
  // Only clear if the caller still owns the registered scene (guards against a
  // late unmount of an old instance wiping a freshly-mounted one).
  if (!scene || activeScene === scene) activeScene = null
}

// Returns { app, world } for the export helpers, or null when no scene is
// mounted yet. capturePlanPng / buildPlanningPdf accept exactly this shape.
export function getSceneRefs() {
  if (!activeScene || !activeScene.app || !activeScene.world) return null
  return { app: activeScene.app, world: activeScene.world }
}

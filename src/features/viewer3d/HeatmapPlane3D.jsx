import React, { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
import { subscribeHeatmapFrame, getHeatmapFrame } from '@/render/heatmapFrameBus'

// 3D heatmap plane for one floor — a THIN consumer of the 2D heatmap
// adapter's painted canvas (render/heatmapFrameBus). The plane runs NO
// propagation compute of its own: the 2D adapter already drives the same
// engine with better ergonomics (coarse-first two-stage, large-scene
// downgrade, fingerprint skip, drag paths), so 3D simply re-uploads the
// composited canvas as a texture whenever the 2D sprite repaints. This
// guarantees 2D/3D pixel parity by construction and makes the 3D heatmap
// free even on heavy scenes.
//
// (History: the plane used to own a heatmapGL context and call
// sampleFieldGLAsync itself. That doubled every field compute, needed its
// own freeze/warm-up logic while Viewer3D was hidden, and — lacking the 2D
// adapter's large-scene downgrade — took tens of seconds to appear on
// 300-AP scenes.)
//
// The shared canvas covers the PADDED sample region (heatmapAdapter pads
// unframed floor edges by PAD_M) while the plane spans only the floor rect,
// so the texture is UV-cropped via offset/repeat. CanvasTexture flips Y, so
// canvas rows padTpx..padTpx+imgH map to v ∈ [padBpx, padBpx+imgH] / fullH
// with padBpx measured from the canvas bottom.
//
// Scope clipping: the 2D sprite is vector-masked by scopes in PIXI — that
// mask is not part of the canvas, so the plane shows the unclipped field.
// Same as the previous self-computed plane (the scope clip moved out of the
// sampled field into the 2D vector mask in fix/scope-vector-clip).

// 51-11 note: the plan-edge alpha feather is NOT applied here. It is baked into
// the shared canvas by heatmapGL's colormap pass (see EDGE_FEATHER_M in
// render/heatmapAdapter), so this plane inherits the identical ramp the 2D
// sprite shows — which is the whole point of the shared-canvas design. Adding a
// second feather on this material would double-apply it and desynchronise 3D
// from 2D.

export default function HeatmapPlane3D({ floorId, elevation }) {
  const floors = useFloorStore((s) => s.floors)
  const floor  = floors.find((f) => f.id === floorId) ?? null
  const isVisible = useEditorStore((s) => s.viewMode === VIEW_MODE.THREE_D)

  // Subscribe to repaint broadcasts ONLY while the 3D view is visible — the
  // adapter publishes per paint (60 fps during ripple transitions and solo
  // drags), and a hidden plane re-rendering per publish would put React work
  // right back on the 2D drag path. On the hidden→visible edge the effect
  // catches up with the latest frame, so entry is always current.
  const [frame, setFrame] = useState(getHeatmapFrame)
  useEffect(() => {
    if (!isVisible) return undefined
    setFrame(getHeatmapFrame())
    return subscribeHeatmapFrame(setFrame)
  }, [isVisible])


  // Recreate the CanvasTexture only when the canvas identity changes (adapter
  // teardown/rebuild). Repaints of the same canvas are handled below with a
  // needsUpdate re-upload — no texture churn.
  const canvas = frame?.canvas ?? null
  const texture = useMemo(() => {
    if (!canvas) return null
    const tex = new THREE.CanvasTexture(canvas)
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
    else tex.encoding = THREE.sRGBEncoding
    return tex
  }, [canvas])
  useEffect(() => () => { texture?.dispose() }, [texture])

  // Per publish: refresh the padding crop (padding changes when walls near a
  // floor edge appear/disappear) and flag the pixels for re-upload.
  useEffect(() => {
    if (!texture || !frame) return
    const padBpx = frame.fullH - frame.padTpx - frame.imgH
    texture.offset.set(frame.padLpx / frame.fullW, padBpx / frame.fullH)
    texture.repeat.set(frame.imgW / frame.fullW, frame.imgH / frame.fullH)
    texture.needsUpdate = true
  }, [texture, frame])

  if (!frame || !texture || !floor?.scale) return null
  // Frames are computed for the ACTIVE floor; don't paste another floor's
  // field onto this one (brief mismatch window right after a floor switch,
  // before the adapter's recompute lands).
  if (frame.floorId !== floorId) return null

  const wM = floor.imageWidth  / floor.scale
  const hM = floor.imageHeight / floor.scale

  // Sit a hair above the floor image (which lives at the parent group's
  // y=elevation) so we don't z-fight with the floor texture. 0.02 m = 2 cm
  // — invisible, but enough margin against fp32 depth-buffer noise on
  // tilted views. The `elevation` prop is unused inside the mesh because
  // FloorStack mounts us inside a group already translated to elevation;
  // the prop is kept on the API for documentation and a future "all floors"
  // mode that may mount these planes outside the per-floor group.
  void elevation
  const yLift = 0.02

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[wM / 2, yLift, hM / 2]}
    >
      <planeGeometry args={[wM, hM]} />
      <meshBasicMaterial
        map={texture}
        side={THREE.DoubleSide}
        transparent
        opacity={0.7}
        depthWrite={false}
        // 51-3: opt out of the scene fog. These colours ARE the RSSI reading;
        // letting distance tint them would make the same signal level look
        // different at the near and far end of the floor.
        fog={false}
      />
    </mesh>
  )
}

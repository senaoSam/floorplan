import React from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import {
  MATERIAL_LIST,
  DEFAULT_WALL_THICKNESS_M,
  MIN_WALL_THICKNESS_CM,
  MAX_WALL_THICKNESS_CM,
  mToCm,
  cmToM,
} from '@/constants/materials'
import { NumberInput } from '@/components/PanelRight/_shared/PanelControls'
import './WallDefaultsPanel.sass'

// Draw-wall defaults — material + thickness stamped onto the next drawn wall.
//
// Before this panel the material was Tab-cycled with only a 1.5 s toast to
// show for it, so the setting was invisible the moment the toast faded. The
// picker replaced the Tab binding outright: a persistent control beats a
// hidden keystroke, and two ways to change one value is one too many.
function WallDefaultsPanel() {
  const editorMode    = useEditorStore((s) => s.editorMode)
  const wallMaterial  = useEditorStore((s) => s.wallMaterial)
  const wallThickness = useEditorStore((s) => s.wallThickness)
  const setWallMaterial  = useEditorStore((s) => s.setWallMaterial)
  const setWallThickness = useEditorStore((s) => s.setWallThickness)

  if (editorMode !== EDITOR_MODE.DRAW_WALL) return null

  const handleThickness = (cm) => {
    if (isNaN(cm)) return
    const clamped = Math.min(MAX_WALL_THICKNESS_CM, Math.max(MIN_WALL_THICKNESS_CM, cm))
    setWallThickness(cmToM(clamped))
  }

  return (
    <div className="wall-defaults">
      <div className="wall-defaults__header">
        <span className="wall-defaults__title">畫牆預設</span>
      </div>

      <div className="wall-defaults__body">
        <p className="wall-defaults__label">材質</p>
        <div className="wall-defaults__mats">
          {MATERIAL_LIST.map((mat) => (
            <button
              key={mat.id}
              type="button"
              className={`wall-defaults__mat${wallMaterial?.id === mat.id ? ' wall-defaults__mat--active' : ''}`}
              onClick={() => setWallMaterial(mat)}
              title={`${mat.label} — ${mat.dbLoss} dB`}
            >
              <span className="wall-defaults__dot" style={{ background: mat.color }} />
              <span className="wall-defaults__mat-label">{mat.label}</span>
            </button>
          ))}
        </div>

        <div className="wall-defaults__row">
          <p className="wall-defaults__label">厚度</p>
          <NumberInput
            value={mToCm(wallThickness ?? DEFAULT_WALL_THICKNESS_M)}
            min={MIN_WALL_THICKNESS_CM}
            max={MAX_WALL_THICKNESS_CM}
            step={1}
            unit="cm"
            width={64}
            onChange={handleThickness}
          />
        </div>
      </div>
    </div>
  )
}

export default WallDefaultsPanel

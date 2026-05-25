import React from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import './ActiveModeBadge.sass'

// Phase 24-4 — small badge just under the Toolbar showing the active
// mode + the group it belongs to. Mode-hint banner ancestor; lives in
// CanvasArea right under the Toolbar.

const MODE_LABEL = {
  [EDITOR_MODE.SELECT]:           { group: '指標',    name: '選取',  accent: 'pointer'   },
  [EDITOR_MODE.MARQUEE_SELECT]:   { group: '指標',    name: '框選',  accent: 'pointer'   },
  [EDITOR_MODE.PAN]:              { group: '指標',    name: '平移',  accent: 'pointer'   },
  [EDITOR_MODE.DRAW_WALL]:        { group: '結構',    name: '畫牆',  accent: 'structure' },
  [EDITOR_MODE.DOOR_WINDOW]:      { group: '結構',    name: '門窗',  accent: 'structure' },
  [EDITOR_MODE.DRAW_FLOOR_HOLE]:  { group: '結構',    name: '中庭',  accent: 'structure' },
  [EDITOR_MODE.PLACE_AP]:         { group: '無線',    name: '放置 AP', accent: 'wireless'  },
  [EDITOR_MODE.DRAW_SCOPE]:       { group: '無線',    name: '範圍',  accent: 'wireless'  },
  [EDITOR_MODE.PLACE_SWITCH]:     { group: '布線',    name: '放置 Switch', accent: 'cable' },
  [EDITOR_MODE.DRAW_CABLE_TRAY]:  { group: '布線',    name: '繪製線槽', accent: 'cable' },
  [EDITOR_MODE.PLACE_RISER]:      { group: '布線',    name: '放置 Riser', accent: 'cable' },
  [EDITOR_MODE.DRAW_SCALE]:       { group: '量測',    name: '比例尺', accent: 'measure' },
  [EDITOR_MODE.CROP_IMAGE]:       { group: '樓層',    name: '裁切', accent: 'meta'      },
  [EDITOR_MODE.ALIGN_FLOOR]:      { group: '樓層',    name: '對齊', accent: 'meta'      },
}

function ActiveModeBadge() {
  const editorMode = useEditorStore((s) => s.editorMode)
  const placeApBand = useEditorStore((s) => s.placeApBand)
  const placeSwitchKind = useEditorStore((s) => s.placeSwitchKind)
  const toolbarMenuOpen = useEditorStore((s) => s.toolbarMenuOpen)

  if (toolbarMenuOpen) return null

  const cfg = MODE_LABEL[editorMode] ?? MODE_LABEL[EDITOR_MODE.SELECT]
  let name = cfg.name
  if (editorMode === EDITOR_MODE.PLACE_AP) name += ` · ${placeApBand} GHz`
  else if (editorMode === EDITOR_MODE.PLACE_SWITCH) {
    const kindLabel = { switch: 'Switch', idf: 'IDF', mdf: 'MDF', router: 'Router' }[placeSwitchKind] ?? 'Switch'
    name += ` · ${kindLabel}`
  }

  return (
    <div className={`active-mode-badge active-mode-badge--${cfg.accent}`}>
      <span className="active-mode-badge__group">{cfg.group}</span>
      <span className="active-mode-badge__sep">/</span>
      <span className="active-mode-badge__name">{name}</span>
    </div>
  )
}

export default ActiveModeBadge

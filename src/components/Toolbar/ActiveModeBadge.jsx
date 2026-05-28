import React from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import './ActiveModeBadge.sass'

// Mode-hint banner under the Toolbar. Ports oldSrc Editor2D.modeHintMap so
// every editor mode surfaces its **full descriptive hint** (keyboard
// shortcuts, gesture rules, sub-mode chiclets). The new src had a slim
// "group / name" pill only — that drops most of the hint text and leaves
// users guessing at the keymap.

const MODE_HINT = {
  [EDITOR_MODE.SELECT]:           { group: '操作',     name: '選取模式',  accent: 'pointer',   hint: '左鍵選取、拖曳；右鍵物件開選單' },
  [EDITOR_MODE.MARQUEE_SELECT]:   { group: '操作',     name: '框選模式',  accent: 'pointer',   hint: '左鍵拖曳框選多物件；Ctrl+Click 追加選取' },
  [EDITOR_MODE.PAN]:              { group: '操作',     name: '平移模式',  accent: 'pointer',   hint: '拖曳畫布移動視角' },
  [EDITOR_MODE.DRAW_SCALE]:       { group: '標註',     name: '比例尺模式', accent: 'measure',  hint: '點擊兩點設定比例' },
  [EDITOR_MODE.DRAW_WALL]:        { group: '結構',     name: '畫牆模式',  accent: 'structure', hint: '左鍵點擊設定端點，右鍵或 Esc 結束｜Tab / Shift+Tab 切換材質' },
  [EDITOR_MODE.DRAW_DOOR]:        { group: '結構',     name: '門模式',    accent: 'structure', hint: '點擊牆體兩點設定門的位置；右鍵或 Esc 取消' },
  [EDITOR_MODE.DRAW_WINDOW]:      { group: '結構',     name: '窗模式',    accent: 'structure', hint: '點擊牆體兩點設定窗的位置；右鍵或 Esc 取消' },
  [EDITOR_MODE.DRAW_FLOOR_HOLE]:  { group: '結構',     name: '中庭模式',  accent: 'structure', hint: '左鍵點擊設定端點，靠近起點閉合區域；右鍵或 Esc 取消' },
  [EDITOR_MODE.PLACE_AP]:         { group: '無線',     name: '放置 AP',   accent: 'wireless',  hint: '左鍵點擊放置；Tab 切換 2.4 / 5 / 6 GHz（Shift+Tab 反向）' },
  [EDITOR_MODE.DRAW_SCOPE]:       { group: '無線',     name: '範圍模式',  accent: 'wireless',  hint: '左鍵點擊設定端點，靠近起點閉合區域；右鍵或 Esc 取消' },
  [EDITOR_MODE.PLACE_SWITCH]:     { group: '網路布線', name: '放置 Switch', accent: 'cable',   hint: '左鍵點擊放置；Tab 切換 Switch / IDF / MDF / Router（Shift+Tab 反向）' },
  [EDITOR_MODE.DRAW_CABLE_TRAY]:  { group: '網路布線', name: '繪製線槽模式', accent: 'cable',   hint: '左鍵新增頂點；Shift 鎖 0/45/90°；自動 snap 到 tray / 牆角 / 牆邊；近牆方向自動平行；Backspace / Ctrl+Z 退一步；Enter / 右鍵 / Esc 完成（≥ 2 點才會建立）' },
  [EDITOR_MODE.PLACE_RISER]:      { group: '網路布線', name: '放置 Riser 模式', accent: 'cable', hint: '左鍵點擊放置 Riser；放完用右側面板加入跨樓層' },
  [EDITOR_MODE.CROP_IMAGE]:       { group: '樓層',     name: '裁切模式',  accent: 'meta',      hint: '左鍵點擊兩點定義裁切區域；右鍵或 Esc 取消' },
  [EDITOR_MODE.ALIGN_FLOOR]:      { group: '樓層',     name: '樓層對齊模式', accent: 'meta',   hint: '使用右側面板的偏移/縮放/旋轉對齊本樓層；其他樓層以半透明疊影顯示' },
}

const SWITCH_KIND_LABEL = { switch: 'Switch', idf: 'IDF', mdf: 'MDF', router: 'Router' }

function ActiveModeBadge() {
  const editorMode = useEditorStore((s) => s.editorMode)
  const placeApBand = useEditorStore((s) => s.placeApBand)
  const placeSwitchKind = useEditorStore((s) => s.placeSwitchKind)
  const toolbarMenuOpen = useEditorStore((s) => s.toolbarMenuOpen)

  if (toolbarMenuOpen) return null

  const cfg = MODE_HINT[editorMode] ?? MODE_HINT[EDITOR_MODE.SELECT]
  let name = cfg.name
  if (editorMode === EDITOR_MODE.PLACE_AP) {
    name = `放置 AP — ${placeApBand} GHz`
  } else if (editorMode === EDITOR_MODE.PLACE_SWITCH) {
    name = `放置 Switch — ${SWITCH_KIND_LABEL[placeSwitchKind] ?? 'Switch'}`
  }

  return (
    <div className={`active-mode-badge active-mode-badge--${cfg.accent}`}>
      <span className="active-mode-badge__group">{cfg.group}</span>
      <span className="active-mode-badge__sep">/</span>
      <span className="active-mode-badge__name">{name}</span>
      <span className="active-mode-badge__hint">{cfg.hint}</span>
    </div>
  )
}

export default ActiveModeBadge

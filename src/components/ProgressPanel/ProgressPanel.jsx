import React, { useState } from 'react'
import './ProgressPanel.sass'

const FEATURES = [
  { icon: '🗺', text: '平面圖匯入：支援 PNG / JPG / PDF，PDF 多頁自動拆分為獨立樓層' },
  { icon: '📐', text: '比例尺設定：在圖上點兩點並輸入實際距離，自動建立 px/m 換算' },
  { icon: '🧱', text: '牆體繪製：連續線段繪製，支援端點吸附，可設定材質（玻璃到混凝土）與高度' },
  { icon: '📍', text: 'AP 放置：點擊畫布放置，左鍵或右鍵按住可拖曳，支援頻段、發射功率、天線模式設定' },
  { icon: '🟩', text: '範圍區域：繪製建築覆蓋範圍多邊形，區分涵蓋內／外區域；熱力圖自動遮罩至範圍內' },
  { icon: '⬛', text: '挑高區域：標記中庭、挑高等信號可跨樓層穿透的區域' },
  { icon: '🔥', text: '多模式熱力圖：RSSI / SINR / SNR / 頻道重疊 / 預估速率 / AP 數量，WebGL 即時渲染' },
  { icon: '🎨', text: '柔和色階（Ekahau 風格）+ 頻段相關牆體衰減 + 可調路徑損耗指數（環境類型）' },
  { icon: '🖱', text: '右鍵操作：對任意物件按下右鍵可顯示屬性面板（停止繪製），按住右鍵可拖曳物件' },
]

const PHASES = [
  {
    phase: 'Phase 1 — 2D 規劃核心',
    groups: [
      {
        layer: 'Layer 1 — 畫布基礎',
        items: [
          { id: '1-1', done: true, text: 'UI 骨架佈局' },
          { id: '1-2', done: true, text: 'Konva Stage 初始化' },
          { id: '1-3', done: true, text: 'Pan / Zoom' },
          { id: '1-4', done: true, text: 'PNG / JPG 匯入' },
          { id: '1-5', done: true, text: 'PDF 單頁匯入' },
          { id: '1-6', done: true, text: 'PDF 多頁自動拆樓層' },
        ],
      },
      {
        layer: 'Layer 2 — 比例尺',
        items: [
          { id: '2-1', done: true, text: '手動比例尺（點兩點 + 輸入公尺）' },
        ],
      },
      {
        layer: 'Layer 3 — 環境建模',
        items: [
          { id: '3-1', done: true, text: '牆體繪製工具' },
          { id: '3-2', done: true, text: '牆體材質面板' },
          { id: '3-3', done: true, text: 'Scope Zone 多邊形' },
          { id: '3-4', done: true, text: 'Floor Hole 多邊形' },
        ],
      },
      {
        layer: 'Layer 4 — 設備部署',
        items: [
          { id: '4-1', done: true, text: 'AP 放置' },
          { id: '4-2', done: true, text: 'AP 屬性面板' },
          { id: '4-3', done: true, text: '拖曳牆體、Scope、Floor Hole、AP' },
        ],
      },
      {
        layer: 'Layer 5 — Heatmap',
        items: [
          { id: '5-1', done: true, text: '基礎 RSSI 計算（FSPL）' },
          { id: '5-2', done: true, text: 'Ray-casting 牆體衰減（Web Worker）' },
          { id: '5-3', done: true, text: 'WebGL Fragment Shader 即時渲染' },
          { id: '5-4', done: true, text: 'Co-channel 干擾 SINR 熱圖' },
          { id: '5-5', done: true, text: '多模式熱圖（RSSI/SINR/SNR/頻道重疊/速率/AP數）' },
          { id: '5-6', done: true, text: '柔和色階 + 頻段牆體衰減 + 環境路徑損耗' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 2 — 平面圖增強 & 編輯效率',
    groups: [
      {
        layer: 'Layer 6 — 平面圖操作',
        items: [
          { id: '6-1', done: true, text: '平面圖旋轉' },
          { id: '6-2', done: true, text: '平面圖透明度調整' },
          { id: '6-3', done: false, text: '平面圖裁切' },
          { id: '6-4', done: false, text: '平面圖去色（灰階模式）' },
        ],
      },
      {
        layer: 'Layer 7 — 編輯效率',
        items: [
          { id: '7-1', done: false, text: '牆體材質快捷鍵切換' },
          { id: '7-2', done: false, text: '批次選取（框選多物件）' },
          { id: '7-3', done: false, text: '門窗結構（牆體上的門/窗段）' },
          { id: '7-4', done: false, text: 'Undo / Redo 操作歷史' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 3 — AP 進階規劃',
    groups: [
      {
        layer: 'Layer 8 — AP 型號與自動規劃',
        items: [
          { id: '8-1', done: false, text: 'AP 型號資料庫（多廠商）' },
          { id: '8-2', done: false, text: '天線模式擴充（Directional / 自訂）' },
          { id: '8-3', done: false, text: '自動頻道規劃' },
          { id: '8-4', done: false, text: '自動功率規劃' },
          { id: '8-5', done: false, text: '頻寬設定（20/40/80/160 MHz）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 4 — 多樓層',
    groups: [
      {
        layer: 'Layer 9 — 多樓層管理',
        items: [
          { id: '9-1', done: false, text: '樓層切換' },
          { id: '9-2', done: false, text: '樓層對齊（偏移、縮放、旋轉）' },
          { id: '9-3', done: false, text: '樓板衰減' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 5 — 網路基礎設施',
    groups: [
      {
        layer: 'Layer 10 — Switch & PoE',
        items: [
          { id: '10-1', done: false, text: 'Switch 放置與屬性面板' },
          { id: '10-2', done: false, text: 'AP ↔ Switch 連線' },
          { id: '10-3', done: false, text: 'PoE 電力預算 + 過載警告' },
          { id: '10-4', done: false, text: 'MDF / IDF 堆疊設定' },
        ],
      },
      {
        layer: 'Layer 11 — 走線管路',
        items: [
          { id: '11-1', done: false, text: 'Cable Tray 路徑繪製' },
          { id: '11-2', done: false, text: '自動計算線長' },
          { id: '11-3', done: false, text: 'Cable Riser 垂直升降點' },
        ],
      },
      {
        layer: 'Layer 12 — 多設備支援',
        items: [
          { id: '12-1', done: false, text: 'IPCam 放置與屬性面板' },
          { id: '12-2', done: false, text: 'Gateway 放置與屬性面板' },
          { id: '12-3', done: false, text: '通用 IoT 設備放置' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 6 — 容量規劃 & Client 模擬',
    groups: [
      {
        layer: 'Layer 13 — 容量規劃',
        items: [
          { id: '13-1', done: false, text: '容量區域繪製 + 子區域' },
          { id: '13-2', done: false, text: '區域 client 數與頻段分佈設定' },
          { id: '13-3', done: false, text: 'AP radio 負載視覺化' },
          { id: '13-4', done: false, text: '6 GHz client 比例調整' },
        ],
      },
      {
        layer: 'Layer 14 — Client 體驗模擬',
        items: [
          { id: '14-1', done: false, text: 'Client 裝置類型設定' },
          { id: '14-2', done: false, text: 'Client 連線品質模擬（MCS）' },
          { id: '14-3', done: false, text: 'Client 漫遊路徑視覺化' },
          { id: '14-4', done: false, text: 'Wi-Fi 6E / Wi-Fi 7 模擬' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 7 — 3D 視圖',
    groups: [
      {
        layer: 'Layer 15 — 3D 視覺化',
        items: [
          { id: '15-1', done: false, text: 'R3F 基礎場景（平面圖貼圖）' },
          { id: '15-2', done: false, text: '3D 牆體生成' },
          { id: '15-3', done: false, text: '3D AP 標記' },
          { id: '15-4', done: false, text: '3D Scope / Floor Hole 視覺化' },
          { id: '15-5', done: false, text: '3D 多樓層堆疊 + 訊號穿透視覺化' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 8 — AI 輔助 & 進階視覺化',
    groups: [
      {
        layer: 'Layer 16 — AI 自動化',
        items: [
          { id: '16-1', done: false, text: 'AI 自動量測比例尺' },
          { id: '16-2', done: false, text: 'AI 自動描繪建築範圍' },
          { id: '16-3', done: false, text: 'AI 自動偵測牆壁/門/窗' },
          { id: '16-4', done: false, text: 'AI 自動建議 AP 位置' },
        ],
      },
      {
        layer: 'Layer 17 — 進階顯示',
        items: [
          { id: '17-1', done: false, text: '人流熱區顯示' },
          { id: '17-2', done: false, text: 'WiFi Client 訊號模擬顯示' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 8 — 進階視覺化',
    groups: [
      {
        layer: 'Layer 17 — 進階顯示',
        items: [
          { id: '17-1', done: false, text: '人流熱區顯示' },
          { id: '17-2', done: false, text: 'WiFi Client 訊號模擬顯示' },
        ],
      },
    ],
  },
  {
    phase: '整合（未來）',
    groups: [
      {
        layer: '系統整合',
        items: [
          { id: 'I-1', done: false, text: '串接真實 API（替換 mock data）' },
          { id: 'I-2', done: false, text: '封裝為可嵌入主產品的元件' },
          { id: 'I-3', done: false, text: '專案管理（國家頻段 + 環境類型）' },
        ],
      },
    ],
  },
]

const ALL_ITEMS = PHASES.flatMap((p) => p.groups.flatMap((g) => g.items))

function ProgressPanel() {
  const [open, setOpen] = useState(false)
  const [tab, setTab]   = useState('features') // 'features' | 'tasks'

  const totalDone  = ALL_ITEMS.filter((i) => i.done).length
  const totalCount = ALL_ITEMS.length

  return (
    <>
      {/* 觸發按鈕 */}
      <button
        className="progress-trigger"
        onClick={() => setOpen((v) => !v)}
        title="查看目前進度"
      >
        <span className="progress-trigger__bar" style={{ width: `${(totalDone / totalCount) * 100}%` }} />
        <span className="progress-trigger__label">📋 進度 {totalDone}/{totalCount}</span>
      </button>

      {/* 面板 */}
      {open && (
        <div className="progress-panel">
          <div className="progress-panel__header">
            <span className="progress-panel__title">Floorplan Planner — 全階段進度</span>
            <button className="progress-panel__close" onClick={() => setOpen(false)}>✕</button>
          </div>

          {/* Tab 切換 */}
          <div className="progress-panel__tabs">
            <button
              className={`progress-panel__tab${tab === 'features' ? ' progress-panel__tab--active' : ''}`}
              onClick={() => setTab('features')}
            >已實現功能</button>
            <button
              className={`progress-panel__tab${tab === 'tasks' ? ' progress-panel__tab--active' : ''}`}
              onClick={() => setTab('tasks')}
            >任務進度</button>
          </div>

          <div className="progress-panel__body">
            {tab === 'features' && (
              <ul className="progress-panel__features">
                {FEATURES.map((f, i) => (
                  <li key={i} className="progress-panel__feature">
                    <span className="progress-panel__feature-icon">{f.icon}</span>
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            )}

            {tab === 'tasks' && (
              <div className="progress-panel__tasks">
                {PHASES.map((phase) => {
                  const phaseDone = phase.groups.flatMap((g) => g.items).filter((i) => i.done).length
                  const phaseTotal = phase.groups.flatMap((g) => g.items).length
                  return (
                    <div key={phase.phase} className="progress-panel__phase">
                      <div className="progress-panel__phase-title">
                        {phase.phase}
                        <span className="progress-panel__phase-count">{phaseDone}/{phaseTotal}</span>
                      </div>
                      {phase.groups.map((group) => (
                        <div key={group.layer} className="progress-panel__group">
                          <div className="progress-panel__group-title">{group.layer}</div>
                          {group.items.map((item) => (
                            <div key={item.id} className={`progress-panel__item${item.done ? ' progress-panel__item--done' : ''}`}>
                              <span className="progress-panel__item-icon">{item.done ? '✅' : '⬜'}</span>
                              <span className="progress-panel__item-id">{item.id}</span>
                              <span className="progress-panel__item-text">{item.text}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 進度條 */}
          <div className="progress-panel__footer">
            <div className="progress-panel__progress-bar">
              <div className="progress-panel__progress-fill" style={{ width: `${(totalDone / totalCount) * 100}%` }} />
            </div>
            <span className="progress-panel__progress-text">
              完成 {totalDone} / {totalCount} 項（{Math.round((totalDone / totalCount) * 100)}%）
            </span>
          </div>
        </div>
      )}
    </>
  )
}

export default ProgressPanel

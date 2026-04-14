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

const TASKS = [
  {
    layer: 'Layer 1 — 畫布基礎',
    items: [
      { id: '1-1', done: true,  text: 'UI 骨架佈局' },
      { id: '1-2', done: true,  text: 'Konva Stage 初始化' },
      { id: '1-3', done: true,  text: 'Pan / Zoom' },
      { id: '1-4', done: true,  text: 'PNG / JPG 匯入' },
      { id: '1-5', done: true,  text: 'PDF 單頁匯入' },
      { id: '1-6', done: true,  text: 'PDF 多頁自動拆樓層' },
    ],
  },
  {
    layer: 'Layer 2 — 比例尺',
    items: [
      { id: '2-1', done: true,  text: '手動比例尺（點兩點 + 輸入公尺）' },
    ],
  },
  {
    layer: 'Layer 3 — 環境建模',
    items: [
      { id: '3-1', done: true,  text: '牆體繪製工具' },
      { id: '3-2', done: true,  text: '牆體材質面板' },
      { id: '3-3', done: true,  text: 'Scope Zone 多邊形' },
      { id: '3-4', done: true,  text: 'Floor Hole 多邊形' },
    ],
  },
  {
    layer: 'Layer 4 — 設備部署',
    items: [
      { id: '4-1', done: true,  text: 'AP 放置' },
      { id: '4-2', done: true,  text: 'AP 屬性面板' },
      { id: '4-3', done: true,  text: '拖曳牆體、Scope、Floor Hole、AP' },
    ],
  },
  {
    layer: 'Layer 5 — Heatmap',
    items: [
      { id: '5-1', done: true,  text: '基礎 RSSI 計算（FSPL）' },
      { id: '5-2', done: true,  text: 'Ray-casting 牆體衰減（Web Worker）' },
      { id: '5-3', done: true,  text: 'WebGL Fragment Shader 即時渲染' },
      { id: '5-4', done: true,  text: 'Co-channel 干擾 SINR 熱圖' },
      { id: '5-5', done: true,  text: '多模式熱圖（RSSI/SINR/SNR/頻道重疊/速率/AP數）' },
      { id: '5-6', done: true,  text: '柔和色階 + 頻段牆體衰減 + 環境路徑損耗' },
    ],
  },
  {
    layer: 'Layer 6 — 3D 視圖',
    items: [
      { id: '6-1', done: false, text: 'R3F 基礎場景（平面圖貼圖）' },
      { id: '6-2', done: false, text: '3D 牆體生成' },
      { id: '6-3', done: false, text: '3D AP 標記' },
    ],
  },
  {
    layer: 'Layer 7 — 多樓層',
    items: [
      { id: '7-1', done: false, text: '樓層切換' },
      { id: '7-2', done: false, text: '樓層對齊（offsetX/Y）' },
      { id: '7-3', done: false, text: '樓板衰減' },
    ],
  },
  {
    layer: '整合（未來）',
    items: [
      { id: 'I-1', done: false, text: '串接真實 API（替換 mock data）' },
      { id: 'I-2', done: false, text: '封裝為可嵌入主產品的元件' },
    ],
  },
]

function ProgressPanel() {
  const [open, setOpen] = useState(false)
  const [tab, setTab]   = useState('features') // 'features' | 'tasks'

  const totalDone  = TASKS.flatMap((g) => g.items).filter((i) => i.done).length
  const totalCount = TASKS.flatMap((g) => g.items).length

  return (
    <>
      {/* 觸發按鈕 */}
      <button
        className="progress-trigger"
        onClick={() => setOpen((v) => !v)}
        title="查看目前進度"
      >
        <span className="progress-trigger__bar" style={{ width: `${(totalDone / totalCount) * 100}%` }} />
        <span className="progress-trigger__label">📋 Phase 1 進度 {totalDone}/{totalCount}</span>
      </button>

      {/* 面板 */}
      {open && (
        <div className="progress-panel">
          <div className="progress-panel__header">
            <span className="progress-panel__title">Floorplan Planner — Phase 1 進度</span>
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
                {TASKS.map((group) => (
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

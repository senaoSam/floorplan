import React, { useState } from 'react'
import './FormulaNote.sass'

const SECTIONS = [
  {
    title: 'Log-Distance Path Loss',
    rows: [
      { label: '公式', value: 'PL(dB) = 10·n·log₁₀(d) + 20·log₁₀(f) − 27.55' },
      { label: 'd', value: '距離（公尺）' },
      { label: 'f', value: '頻率（MHz）' },
      { label: 'n', value: '路徑損耗指數（環境相關）' },
      { label: '說明', value: 'n=2.0 為自由空間 (FSPL)，n=3.0 為辦公室，n=3.5 為密集隔間，n=1.8 為走廊' },
    ],
  },
  {
    title: 'RSSI 接收訊號強度',
    rows: [
      { label: '公式', value: 'RSSI(dBm) = P_tx − PL − L_wall' },
      { label: 'P_tx', value: '發射功率（dBm）' },
      { label: 'L_wall', value: 'Ray-casting 牆體衰減總和（dB），依頻段調整' },
    ],
  },
  {
    title: '牆體衰減（Ray-casting + 頻段修正）',
    rows: [
      { label: '方法', value: '從像素到 AP 畫一條線段，計算與所有牆段的相交次數' },
      { label: '衰減', value: 'L_wall = Σ (基準 dBLoss × 頻段乘數)' },
      { label: '玻璃', value: '2 dB × [1.0 / 1.5 / 2.0] (2.4/5/6 GHz)' },
      { label: '石膏板', value: '3 dB × [1.0 / 1.3 / 1.7]' },
      { label: '木板', value: '4 dB × [1.0 / 1.25 / 1.5]' },
      { label: '磚牆', value: '8 dB × [1.0 / 1.4 / 1.6]' },
      { label: '混凝土', value: '12 dB × [1.0 / 1.5 / 1.8]' },
      { label: '金屬', value: '20 dB × [1.0 / 1.25 / 1.4]' },
    ],
  },
  {
    title: 'SINR 訊號干擾噪聲比',
    rows: [
      { label: '公式', value: 'SINR(dB) = 10·log₁₀( S / (I + N) )' },
      { label: 'S', value: '最佳服務 AP 的線性接收功率（mW）' },
      { label: 'I', value: 'Σ 同頻道干擾 AP 的線性功率（mW）' },
      { label: 'N', value: '底噪 −95 dBm → 線性功率' },
      { label: '同頻條件', value: '相同 channel 編號 且 相同頻段（2.4 / 5 / 6 GHz）' },
    ],
  },
  {
    title: 'SNR 訊號噪聲比',
    rows: [
      { label: '公式', value: 'SNR(dB) = RSSI(dBm) − Noise(dBm)' },
      { label: 'Noise', value: '底噪 = −95 dBm' },
      { label: '說明', value: '不考慮干擾，僅反映訊號對底噪的餘量' },
    ],
  },
  {
    title: '頻道重疊（Channel Overlap）',
    rows: [
      { label: '方法', value: '計算每個像素位置能收到幾顆同頻道 AP（RSSI > −85 dBm）' },
      { label: '理想', value: '1 顆 = 無重疊（綠）' },
      { label: '注意', value: '2+ 顆 = 同頻干擾風險（黃→紅）' },
    ],
  },
  {
    title: '預估速率（Data Rate）',
    rows: [
      { label: '方法', value: '由 SINR 映射到 MCS 等級，再乘以空間串流數（預設 2×2）' },
      { label: 'MCS 0', value: 'SINR ≥ 2 dB → 13 Mbps' },
      { label: 'MCS 4', value: 'SINR ≥ 15 dB → 78 Mbps' },
      { label: 'MCS 7', value: 'SINR ≥ 22 dB → 130 Mbps' },
      { label: 'MCS 9', value: 'SINR ≥ 29 dB → 173 Mbps' },
    ],
  },
  {
    title: '可用 AP 數（AP Count）',
    rows: [
      { label: '方法', value: '統計每點 RSSI > −85 dBm 的 AP 數量' },
      { label: '1 顆', value: '紅 — 冗餘不足，AP 故障即無覆蓋' },
      { label: '2 顆', value: '綠 — 理想，具備基本冗餘' },
      { label: '4+ 顆', value: '黃 — 可能過密，浪費資源或增加干擾' },
    ],
  },
  {
    title: '環境路徑損耗指數',
    rows: [
      { label: '開放空間', value: 'n = 2.0（自由空間，最樂觀）' },
      { label: '辦公室', value: 'n = 3.0（含家具、人員）' },
      { label: '密集隔間', value: 'n = 3.5（高密度環境）' },
      { label: '走廊', value: 'n = 1.8（波導效應，比自由空間好）' },
    ],
  },
  {
    title: 'SINR 色階對照（Cisco 風格）',
    rows: [
      { label: '≥ 25 dB', value: '紅（極佳）' },
      { label: '20 dB',   value: '橘' },
      { label: '15 dB',   value: '黃' },
      { label: '10 dB',   value: '綠' },
      { label: '5 dB',    value: '青' },
      { label: '0 dB',    value: '藍' },
      { label: '< 0 dB',  value: '透明（無效覆蓋）' },
    ],
  },
  {
    title: '比例尺校正',
    rows: [
      { label: '公式', value: 'scale(px/m) = 像素距離 / 實際距離(m)' },
      { label: '用途', value: '將畫布像素座標換算為公尺，供路徑損耗計算使用' },
    ],
  },
]

function FormulaNote() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className="formula-note-btn"
        onClick={() => setOpen((v) => !v)}
        title="計算公式說明"
      >
        ƒ(x)
      </button>

      {open && (
        <div className="formula-note-panel">
          <div className="formula-note-panel__header">
            <span>計算公式</span>
            <button className="formula-note-panel__close" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="formula-note-panel__body">
            {SECTIONS.map((sec) => (
              <section key={sec.title} className="formula-note-panel__section">
                <p className="formula-note-panel__section-title">{sec.title}</p>
                {sec.rows.map((row) => (
                  <div key={row.label} className="formula-note-panel__row">
                    <span className="formula-note-panel__row-label">{row.label}</span>
                    <span className="formula-note-panel__row-value">{row.value}</span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export default FormulaNote

import React, { useState } from 'react'
import './FormulaNote.sass'

const SECTIONS = [
  {
    title: 'Free-Space Path Loss (FSPL)',
    rows: [
      { label: '公式', value: 'FSPL(dB) = 20·log₁₀(d) + 20·log₁₀(f) − 27.56' },
      { label: 'd', value: '距離（公尺）' },
      { label: 'f', value: '頻率（MHz）' },
      { label: '說明', value: '常數 −27.56 = 32.44 − 60，為距離單位從 km 換算至 m 的修正' },
    ],
  },
  {
    title: 'RSSI 接收訊號強度',
    rows: [
      { label: '公式', value: 'RSSI(dBm) = P_tx − FSPL − L_wall' },
      { label: 'P_tx', value: '發射功率（dBm）' },
      { label: 'L_wall', value: 'Ray-casting 牆體衰減總和（dB）' },
    ],
  },
  {
    title: '牆體衰減（Ray-casting）',
    rows: [
      { label: '方法', value: '從像素到 AP 畫一條線段，計算與所有牆段的相交次數' },
      { label: '衰減', value: 'L_wall = Σ 各交叉牆體的 dBLoss' },
      { label: '玻璃', value: '2 dB' },
      { label: '石膏板', value: '3 dB' },
      { label: '木板', value: '4 dB' },
      { label: '磚牆', value: '8 dB' },
      { label: '混凝土', value: '12 dB' },
      { label: '金屬', value: '20 dB' },
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
    title: 'SINR 色階對照',
    rows: [
      { label: '≥ 25 dB', value: '萊姆綠（優）' },
      { label: '20 dB',   value: '黃綠' },
      { label: '15 dB',   value: '黃' },
      { label: '10 dB',   value: '橘' },
      { label: '5 dB',    value: '紅' },
      { label: '0 dB',    value: '暗紅' },
      { label: '< 0 dB',  value: '透明（無效覆蓋）' },
    ],
  },
  {
    title: '比例尺校正',
    rows: [
      { label: '公式', value: 'scale(px/m) = 像素距離 / 實際距離(m)' },
      { label: '用途', value: '將畫布像素座標換算為公尺，供 FSPL 使用' },
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

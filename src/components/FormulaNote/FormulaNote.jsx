import React, { useState } from 'react'
import './FormulaNote.sass'

const SECTIONS = [
  {
    title: 'Log-Distance Path Loss (PHY-1)',
    rows: [
      { label: '公式', value: 'PL(d) = FSPL(1m, f) + 10·n·log₁₀(max(d, 0.1))' },
      { label: 'FSPL(1m,f)', value: '20·log₁₀(f_MHz) − 27.55（自由空間 1m 參考點）' },
      { label: 'd', value: '3D 距離 = √(d_2D² + (z_AP − z_client)²)（公尺），clamp ≥ 0.1m' },
      { label: 'n', value: 'per-band PLE（2.4/5/6 GHz 各自）' },
      { label: '規格來源', value: '.tmp-heatmap/08-implementation-guide.md §3.2' },
      { label: '環境 preset', value: '開放空間 (2.0/2.0/2.0) / 辦公室 (3.0/3.3/3.5) / 密集 (3.5/3.8/4.0) / 走廊 (1.8/1.8/1.8)' },
    ],
  },
  {
    title: 'RSSI 接收訊號強度 (RX-1)',
    rows: [
      { label: '公式', value: 'RSSI(dBm) = P_tx + G_ant(θ,φ) − PL − L_wall − L_slab' },
      { label: 'P_tx', value: '發射功率（dBm）' },
      { label: 'G_ant', value: '天線增益（dB，omni=0；directional cosine-squared；custom pattern lookup）' },
      { label: 'PL', value: 'PHY-1 距離損耗（含 3D 高度差）' },
      { label: 'L_wall', value: 'ITU-R P.2040 頻率外推 + 1/cos(θ) 入射角修正（PHY-2/4）' },
      { label: 'L_slab', value: '跨樓層樓板累積衰減（dB），同樓層為 0；3D 斜線在中間樓層 Floor Hole 內則 bypass' },
      { label: 'Cutoff', value: '3D 距離 > 50m 的 AP 跳過計算（PHY-7）' },
      { label: '規格來源', value: '.tmp-heatmap §2.1' },
    ],
  },
  {
    title: 'Client 接收平面與 AP 安裝高度 (PHY-6)',
    rows: [
      { label: 'client 平面', value: 'heatmap 在接收面高度 1.0m 切片（預設；規格範圍 1.0~1.5m）' },
      { label: 'AP 高度', value: 'ap.z（公尺，預設 2.4m）' },
      { label: '距離', value: 'd_3D = √(d_2D² + (ap.z − clientH)²)' },
      { label: '規格來源', value: '.tmp-heatmap §5.3' },
    ],
  },

  {
    title: '跨樓層樓板衰減 (9-3)',
    rows: [
      { label: '情境', value: 'AP 在樓層 A，目標像素在樓層 B（B = active）。跨越樓板 slab_i，i ∈ [min(A,B), max(A,B))' },
      { label: 'L_slab', value: 'Σ floorSlabAttenuationDb(i)，對每個中間樓層 i 加總' },
      { label: 'dB 預設', value: '玻璃 2 / 石膏板 3 / 木板 4 / 磚 8 / 混凝土 12 / 金屬 20（同牆體材質，可覆寫）' },
      { label: 'Bypass', value: '9-3d per-pixel：AP↔pixel 3D 斜線在 floor i+0.5 的水平穿越點若落在該樓 Floor Hole 內 → slab_i 視為 0' },
      { label: '穿越點', value: 'crossWorld = mix(apWorld, pxWorld, t)，t = (i + 0.5 − srcIdx) / (actIdx − srcIdx)' },
      { label: '座標空間', value: '世界座標經各樓 align transform 換算；AP 與 pixel 先用 active 樓的 align 推到共用基準' },
      { label: '垂直範圍', value: '9-3e：每個 Floor Hole 可設 bottomFloorId / topFloorId，貫穿多層自動生效（預設僅本樓層）' },
    ],
  },
  {
    title: '天線增益（Directional / Custom）',
    rows: [
      { label: 'Omni', value: 'G_ant ≡ 0（無方向性）' },
      { label: 'Directional', value: 'G_ant(θ) = max( −12·(Δθ / (BW/2))², −FB )' },
      { label: 'Δθ', value: '目標方向與方位角夾角（wrap 到 [0°, 180°]）' },
      { label: 'BW', value: '波瓣寬度 HPBW（使用者設定，10°~180°）' },
      { label: 'FB', value: 'Front-to-Back 最大背面衰減（預設 20 dB）' },
      { label: 'Custom', value: 'G_ant(θ) = patternLookup(36-sample, 線性內插)' },
      { label: '內建', value: 'Patch（cos² 漸降）/ Sector 90° / Sector 120°' },
      { label: '說明', value: 'Cosine-squared / 3GPP 抛物近似：中軸 0 dB，HPBW 邊緣約 −3 dB，背面至多 −20 dB' },
    ],
  },
  {
    title: '牆體衰減 ITU-R P.2040 (PHY-2) + 入射角 (PHY-4)',
    rows: [
      { label: '方法', value: '從像素到 AP 連線 ray-casting 交點；每面相交牆累加頻率外推後的 dB × 1/cos(θ)' },
      { label: 'ITU-R 公式', value: 'η\'(f)=a·f^b, σ(f)=c·f^d；α(f)=f·√η\'·Im(√(1 − j·18σ/(f_GHz·η\')))' },
      { label: '頻率外推', value: 'loss_tgt = refAttDb × (α_tgt / α_ref)（isConductor=true 則保持 refAttDb）' },
      { label: '入射角修正', value: 'loss *= 1/max(cos(θ), 0.1)；θ 為射線與牆法線夾角' },
      { label: '材質 (a,b,c,d)', value: '規格 §1.2 P.2040-3 表格：concrete/brick/drywall/wood/glass/metal' },
      { label: '實測 2.4/5/6 GHz', value: '玻璃 2/5.4/6.0 ｜ 石膏板 3/5.4/5.7 ｜ 木板 4/9.7/10.7 ｜ 磚 8/8/8 ｜ 混凝土 12/23.5/25.2 ｜ 金屬 20/20/20' },
      { label: '規格來源', value: '.tmp-heatmap §1.2/1.3/§2.2' },
    ],
  },
  {
    title: 'SINR 訊號干擾噪聲比 (RX-3)',
    rows: [
      { label: '公式', value: 'SINR(dB) = RSSI_primary − 10·log₁₀(10^(N/10) + Σ 10^(RSSI_i/10) × overlap_factor)' },
      { label: 'overlap_factor', value: '同 primary channel = 1.0；2.4G 相鄰頻道 rejection 表：diff 1=0.72, 2=0.27, 3=0.04, 4=0.004, ≥5=0' },
      { label: '5G / 6G', value: '僅 primary channel 相同才算干擾（原生非重疊頻道設計）' },
      { label: 'N (底噪)', value: 'per-band wifiNoiseFloor + 10·log₁₀(W/20)（寬頻吃進更多噪聲）' },
      { label: '規格來源', value: '.tmp-heatmap §2.5（IEEE 802.11 adjacent rejection 表為業界共識）' },
    ],
  },

  {
    title: 'Per-band 噪聲底 (PHY-5)',
    rows: [
      { label: '2.4 GHz', value: '−95 dBm @ 20MHz（wifiNoiseFloor2_4GHz）' },
      { label: '5 GHz',   value: '−95 dBm @ 20MHz' },
      { label: '6 GHz',   value: '−95 dBm @ 20MHz' },
      { label: '頻寬修正', value: 'N(BW) = wifiNoiseFloor[band] + 10·log₁₀(BW/20)；40→+3, 80→+6, 160→+9 dB' },
      { label: '規格來源', value: '.tmp-heatmap §6 wifiNoiseFloor*' },
    ],
  },
  {
    title: '頻寬（Channel Width）',
    rows: [
      { label: '可選', value: '20 / 40 / 80 / 160 MHz' },
      { label: 'Cisco 建議', value: '2.4G→20（唯一）、5G→20 或 40、6G→80' },
      { label: '中心頻率', value: '2.4G: 2407+5N　5G: 5000+5N　6G: 5950+5N（MHz）' },
      { label: '速率倍率 (RX-4)', value: '20→×1、40→×2.14、80→×4.29、160→×8.58（規格 §2.4 sample 表推得）' },
    ],
  },
  {
    title: 'SNR 訊號噪聲比 (RX-2)',
    rows: [
      { label: '公式', value: 'SNR(dB) = RSSI_primary − N_floor(band, BW)' },
      { label: '說明', value: '不考慮干擾，僅反映訊號對底噪的餘量；N_floor 見 Per-band 噪聲底' },
      { label: '規格來源', value: '.tmp-heatmap §2.3' },
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
    title: '預估速率 Data Rate — 802.11ax (RX-4)',
    rows: [
      { label: '方法', value: 'Mbps = base20(SNR) × bwMul × streamCount；base20 依規格三錨點線性內插' },
      { label: '規格錨點 (§2.4)', value: 'MCS 0 (SNR 2) = 8.6 ｜ MCS 7 (SNR 19) = 72 ｜ MCS 11 (SNR 30) = 143（20MHz × 1SS）' },
      { label: '頻寬倍率', value: '20→×1、40→×2.14、80→×4.29、160→×8.58（規格 80/20 = 309/72）' },
      { label: 'Streams', value: '線性倍率（每 AP model per-band streamCount；clamp 1~4）' },
      { label: 'SNR < 2', value: '0 Mbps（低於 MCS 0 門檻）' },
      { label: '規格來源', value: '.tmp-heatmap §2.4' },
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
    title: '環境路徑損耗指數 (PHY-1 per-band)',
    rows: [
      { label: '格式', value: 'n = { 2.4 GHz / 5 GHz / 6 GHz }，三頻段獨立（規格 pathLossExponent[3]）' },
      { label: '開放空間', value: '2.0 / 2.0 / 2.0（自由空間，最樂觀）' },
      { label: '辦公室',   value: '3.0 / 3.3 / 3.5（含家具、人員；高頻衰減稍快）' },
      { label: '密集隔間', value: '3.5 / 3.8 / 4.0（高密度環境）' },
      { label: '走廊',     value: '1.8 / 1.8 / 1.8（波導效應，比自由空間好）' },
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
    title: '自動功率規劃（Min-Power Cell Overlap）',
    rows: [
      { label: '公式', value: 'P_tx = RSSI_target − G_ant + PL(d_nearest)' },
      { label: 'RSSI_target', value: '目標邊緣覆蓋強度（預設 −67 dBm，Cisco 語音等級）' },
      { label: 'G_ant', value: 'AP 模型在該頻段的天線增益（dBi）' },
      { label: 'PL', value: 'PHY-1 公式（每 AP 用其頻段對應的 per-band PLE）' },
      { label: 'd_nearest', value: '取相同頻段鄰居 AP；孤立 AP（無鄰居）→ 使用模型最大功率' },
      { label: '範圍', value: '結果夾限於 [5 dBm, 模型 maxTxPower]，四捨五入到整數' },
      { label: '前提', value: '需已設定比例尺（floor.scale）才能將畫布像素換算為公尺' },
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
  // Expanded state per section title; all collapsed by default for overview.
  const [expanded, setExpanded] = useState({})

  const allOpen = SECTIONS.every((s) => expanded[s.title])
  const toggleAll = () => {
    if (allOpen) setExpanded({})
    else setExpanded(Object.fromEntries(SECTIONS.map((s) => [s.title, true])))
  }
  const toggleSection = (title) =>
    setExpanded((prev) => ({ ...prev, [title]: !prev[title] }))

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
            <div className="formula-note-panel__header-actions">
              <button className="formula-note-panel__toggle-all" onClick={toggleAll}>
                {allOpen ? '全部收合' : '全部展開'}
              </button>
              <button className="formula-note-panel__close" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>
          <div className="formula-note-panel__body">
            {SECTIONS.map((sec) => {
              const isOpen = !!expanded[sec.title]
              return (
                <section key={sec.title} className={`formula-note-panel__section${isOpen ? ' formula-note-panel__section--open' : ''}`}>
                  <button
                    type="button"
                    className="formula-note-panel__section-header"
                    onClick={() => toggleSection(sec.title)}
                    aria-expanded={isOpen}
                  >
                    <span className="formula-note-panel__section-caret">{isOpen ? '▾' : '▸'}</span>
                    <span className="formula-note-panel__section-title">{sec.title}</span>
                  </button>
                  {isOpen && (
                    <div className="formula-note-panel__section-body">
                      {sec.rows.map((row) => (
                        <div key={row.label} className="formula-note-panel__row">
                          <span className="formula-note-panel__row-label">{row.label}</span>
                          <span className="formula-note-panel__row-value">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

export default FormulaNote

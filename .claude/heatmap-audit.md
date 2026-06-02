# Heatmap Polish Audit（27-1）

> 2026-06-01 MCP 實測（Demo 5 AP / shader engine / refl+diff ON / contour ON / blur 8）。
> 逐項列「現象 + 程式碼位置 + 嚴重度」，供 27-2 動手依據。
> 嚴重度：🔴 影響正確性 / 🟡 視覺品質 / 🟢 OK 免動。

---

## A. 27-2 已點名的三項（確認現況）

### A-1 ⛔ won't-fix — Hover readout 與熱圖用「不同物理」（2026-06-02 量測後決定不做）
- **現象**：hover probe 寫死 `reflections:false, diffraction:false`
  （[heatmapHoverBinder.js:69](src/render/heatmapHoverBinder.js#L69)），熱圖場用使用者設定（預設 refl+diff ON），同點讀數可差。
- **量測（refl/diff OFF vs ON 的 RSSI 差，依 AP 密度，同 floor 45 牆）**：

  | AP 數 | 平均差 | 差>5dB 點佔比 | 開 refl/diff 單次 probe |
  |---|---|---|---|
  | 5（稀疏）| 3.15 dB | 23% | 0.6ms |
  | 50（中等）| **0.43 dB** | **0%** | 5.2ms |
  | 150（密集）| 1.27 dB | 2% | 14.4ms |

- **結論**：影響隨 AP 密度遞減。真實使用密度（50-150 AP）差 <1.3 dB、肉眼無感；只有 5 AP 稀疏早期規劃才明顯，
  但那階段對 hover 精度要求也最低。且 AP 多時開 refl/diff 反而貴（150 AP=14.4ms，逼近 33ms throttle，再多會卡）——
  「最需要精確時最便宜、開了沒差時最貴」的反向權衡。修物理 = 過度工程。
- **使用者決定（2026-06-02）**：不修物理、**也不加 user 標註**。hover readout 維持「快速直線估算」定位，精確值看熱圖本身。
- 位置記錄：[hoverProbe.js](src/features/heatmap/hoverProbe.js)、[heatmapHoverBinder.js](src/render/heatmapHoverBinder.js)（throttle 33ms @ :8）。

### A-2 🟡 Contour（等高線）antialiasing — 放大後邊緣鋸齒
- **現象**：fit 視角下 contour 還算平滑；放大 3× 後黑色等高線邊緣出現階梯狀鋸齒、線偏粗。
- **位置**：contour 在 shader 路徑繪製，查 [heatmapGL.js](src/features/heatmap/heatmapGL.js) / [sampleFieldGL.js](src/features/heatmap/sampleFieldGL.js)（待 27-2 開工時定位確切 contour pass）。
- **27-2 方向**：contour line 做 screen-space AA（smoothstep on iso-distance）或提高 contour 取樣解析度。

### A-3 🟡 Colormap 寫死一套，無國際標/自訂 toggle
- **現象**：四模式（RSSI/SINR/SNR/CCI）共用同一組 5-anchor 配色（灰→綠→黃→橙→紅），
  使用者無法切換成業界常見配色或自訂。
- **位置**：[modes.js:14-49](src/features/heatmap/modes.js#L14)（`*_ANCHORS` 寫死）。
- **27-2 方向**：抽出 colormap preset 集合（如 Hamina-like / jet / viridis / 自訂），HeatmapControl 加 toggle；
  legend bar 跟著切（[HeatmapLegend.jsx](src/components/HeatmapControl/HeatmapLegend.jsx) 已讀 anchors，改 preset 即可同步）。
  ⚠️ 配色是主觀 + 業界標準問題，動手前需跟使用者確認要哪幾組 preset、預設用哪組。

---

## B. 新發現（audit 額外列出）

### B-1 🟡 熱圖填色溢出樓層邊界
- **現象**：放大後可見熱圖填到牆體外圍 / floor image 邊緣外的區域（非 scope 限定時整張 image bbox 都填）。
- **待確認**：是否該以 floor image 邊界 / scope mask 裁切（probeAt 有 `scopeMaskFn`，但無 scope 時不裁）。
  需跟使用者確認預期行為（Hamina 是填滿掃描範圍還是裁到房間）。

### B-2 🟡 SINR/CCI 模式 contour 過密
- **現象**：SINR 模式因場變化劇烈，contour 線非常密集，疊在熱圖上偏雜亂（demo 5 AP 同 5G 頻段、干擾大）。
- **27-2 方向**：可考慮各模式獨立 contour 間距，或 contour 密度上限。優先度低於 A 三項。

---

## C. 確認 OK（免動）

- 🟢 熱圖漸層平滑：blur 8 生效，放大無像素塊感。
- 🟢 Legend bar：四模式各自 unit/stops 正確（RSSI dBm / SINR dB / SNR dB / CCI dBm），CCI sign='low' 反向正確。
- 🟢 Readout 數值格式：`toFixed(1)` dB、座標 `toFixed(2)` m，精度足夠（A-1 是物理一致性問題，非位數）。
- 🟢 Console：0 error；2 warning 是 floor image ImageSource 轉換（非 heatmap）。
- 🟢 `viewport.reset()` = {0,0,scale1}（非 fit）是既有語意，非 bug。

---

## 27-2 建議施作順序

- ~~A-1 hover 物理一致~~ → **⛔ won't-fix**（量測後決定不做，見上）
1. **A-3 colormap toggle**（需先跟使用者確認 preset 清單）
2. **A-2 contour AA**（純視覺）
3. B-1 / B-2 視使用者意願再評

> 每項動手前若涉及配色/裁切預期行為（A-3、B-1），依 CLAUDE.md「不確定就問」先跟使用者確認。

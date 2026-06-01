# Heatmap Polish Audit（27-1）

> 2026-06-01 MCP 實測（Demo 5 AP / shader engine / refl+diff ON / contour ON / blur 8）。
> 逐項列「現象 + 程式碼位置 + 嚴重度」，供 27-2 動手依據。
> 嚴重度：🔴 影響正確性 / 🟡 視覺品質 / 🟢 OK 免動。

---

## A. 27-2 已點名的三項（確認現況）

### A-1 🔴 Hover readout 與熱圖顏色用「不同物理」→ 讀數對不上顏色
- **現象**：hover readout 顯示的 RSSI/SINR 跟游標所在位置的熱圖顏色不一致。
- **真因**：hover probe 寫死 `reflections:false, diffraction:false`
  （[heatmapHoverBinder.js:69](src/render/heatmapHoverBinder.js#L69) `probeAt(scenario, rx, { reflections: false, diffraction: false })`），
  而熱圖場 sample 用使用者當前設定（demo 預設 refl+diff **ON**）。兩者同點可差數 dB。
- **註**：`hoverProbe.js` 註解說明這是「per-mousemove 成本考量」刻意關閉反射/繞射。
- **27-2 方向**：讓 hover probe 跟隨當前 `reflections`/`diffraction` 設定（或至少在 readout 標註「直線估算」以免誤導）。
  成本評估需量 per-mousemove probe 開 refl/diff 後是否仍流暢（hover 已有節流）。
- 位置：[hoverProbe.js](src/features/heatmap/hoverProbe.js)、[heatmapHoverBinder.js](src/render/heatmapHoverBinder.js)、
  readout 顯示格式 [HeatmapControl.jsx:53](src/components/HeatmapControl/HeatmapControl.jsx#L53)（`toFixed(1)` dB、座標 `toFixed(2)` m，格式本身 OK）。

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

1. **A-1 hover 物理一致**（🔴 正確性，且改動小）
2. **A-3 colormap toggle**（需先跟使用者確認 preset 清單）
3. **A-2 contour AA**（純視覺）
4. B-1 / B-2 視使用者意願再評

> 每項動手前若涉及配色/裁切預期行為（A-3、B-1），依 CLAUDE.md「不確定就問」先跟使用者確認。

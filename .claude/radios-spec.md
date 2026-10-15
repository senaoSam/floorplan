# Phase 58 — 多射頻 AP（`radios[]`）規格

2026-10-12 立項（原 57-38 / 47-8b）。決策全部由使用者拍板。

## 1. 資料模型

一台 AP = 一個裝置物件，射頻放在 `radios[]`。

```js
ap = {
  id, name, x, y, z, modelId, mountType, color, mockStatus?,
  // 天線：裝置層，各射頻共用
  antennaMode, azimuth, tilt, beamwidth, patternId,
  radios: [
    { band: 2.4 | 5 | 6, enabled, channel, channelWidth, txPower, antennaPeakGainDbi? },
  ],
}
```

- 移除扁平欄位 `frequency` / `channel` / `channelWidth` / `txPower` / `antennaPeakGainDbi`。
- `radios` 依 `band` 由低到高排序；每個頻段最多一個。
- 射頻清單由型號 `supportedBands` 決定（`radiosForModel`）。換型號時：保留仍支援頻段的設定，新增頻段用預設值，不支援的頻段移除；`txPower` 依新型號上限截斷。國家頻段沒有該頻段頻道時（中國 6 GHz），新增的射頻預設關閉。
- 手動放置的頻寬：2.4 → 20、5 → 80、6 → 80（沿用舊放置行為）；其他建立路徑用 `DEFAULT_CHANNEL_WIDTH`。
- 使用者可以個別關閉射頻（`enabled:false`）；不能新增型號沒有的頻段，也不支援雙頻切換射頻。
- 增益覆寫 `antennaPeakGainDbi` 放射頻層；空白 = 型號該頻段的自動增益。
- 目前沒有存檔/載入，不需要資料轉換；復原/重做用 `structuredClone`，結構無關。

## 2. 物理：展開成訊號源

`buildScenario` 把每個 `enabled` 射頻展開成一個 scenario entry：

- `id = radioKey(ap.id, band)`（`${apId}#${band}`），`deviceId = ap.id`，`name = ap.name`，`frequency = band`。
- 引擎（熱圖 JS/GLSL、Client View、AP 間聽到、頻道衝突）一律以 entry 為單位，不需知道裝置。
- 依 entry id 做快取或對應的地方（grid cache、liveApIds、hearing、txMap、頻道指派）都用射頻 key。

## 3. 計數：裝置層

AP 數量、線材路由、PoE、交換器埠、BOM、統計 AP 總數、PDF 都以裝置計（不變）。

- 次要覆蓋（redundancy ≥2 AP）改成計「不同裝置」數，同一台的兩個射頻不算兩台。
- 頻道衝突以射頻配對（同頻段才可能衝突）；同一台裝置的射頻不會互相配對。

## 4. 規劃工具

- **自動頻道**：每個射頻各自規劃，結果寫回 `radios[i].channel`。
- **自動功率**：每個射頻各自規劃 `txPower`；**每個頻段分開規劃**（各自的射頻、各自的覆蓋目標，同 AP RRM 的分頻段 TPC）。2026-10-13 決定。
- **自動放置**：仍選目標頻段；新放的裝置沿用本層既有同頻段裝置最常見的型號（沒有才用頻段預設型號），帶完整射頻並排頻道；「重新規劃」移除整台裝置（含其他頻段），模態框提示。
- **自動功率壓到最低值**：預覽「建議關閉」，套用時關閉該射頻。
- **放置 AP**：工具列三個頻段工具合併成一個「放置 AP」，放下預設型號的完整裝置；移除 Tab 切換頻段。

## 5. 顯示

- **2D 圖示**：本體外圍上方一排小色點，每個開著的射頻一點（2.4 橙 / 5 藍 / 6 紫）；本體中間不再寫頻段數字。定向扇形用最高開啟頻段的顏色。
- **3D 圖示**：本體外環依開啟的射頻分段上色（色點在 3D 太小看不出來，2026-10-13 改）；選取時整圈紅色。
- **資訊標籤**：名稱下方每個開著的射頻一行，例如 `5G CH36/80 18 dBm`（EIRP 截斷時 `18→15`）。
- **熱圖頻段篩選**：只用該頻段的射頻；沒有該頻段開啟射頻的裝置變淡。
- **圖層頻段顯示開關**（showAPBand）：裝置所有開啟射頻的頻段都被隱藏時，才隱藏該裝置；部分頻段隱藏時，該頻段的色點、資訊行、3D 外環分段不畫。
- **覆蓋率標示**：規劃面板 / PDF 標明計算的頻段（全部頻段含 2.4 GHz / 篩選頻段）。
- **AP 面板**：裝置區（名稱、型號、安裝、天線）+ 射頻表（開關、頻段、頻道、頻寬、功率、增益覆寫、EIRP 提示）。
- **批次面板**：裝置欄位照舊；射頻欄位依頻段分組批次設定。
- **Client View / hover / 統計 / PDF**：顯示「AP-01 · 5 GHz」；鎖定與單 AP 範圍以裝置為單位（含其所有射頻）。
- **Client View 範圍**：關聯範圍與單 AP 範圍以客戶端實際會連的射頻（5/6 GHz 優先）判斷。
- **客戶端選頻**（Client View、統計模擬客戶端）：5/6 GHz 有可用射頻（≥ `MIN_USABLE_RSSI_DBM` -85）就只在 5/6 GHz 中選最強，都不可用才連 2.4 GHz（依 Hamina Client View 文件「沒有 5 GHz 選項時才連 2.4」）。2026-10-13 決定。
  - **2026-10-14 修訂（58-11，待實作）**：「5/6 可用」門檻改為 -77 dBm（-85 仍是任何頻段的連線下限）；5 vs 6 比較時每高一頻段 +2 dB；換頻段沿用 `ROAM_HYSTERESIS_DB` 6 dB 遲滯。依據見 `.claude/client-band-research.md`。

## 6. Demo / 壓測

- Demo：改成真實多頻，每台依型號開全部射頻並自動排頻道（覆蓋會變強）。
- StressLoader：維持只開 5 GHz（效能基準可比）。

## 7. 效能

熱圖「全部頻段」時訊號源 = 開啟的射頻總數（約裝置數 × 2～3），計算量等比例增加；單頻段篩選時與現在相同。

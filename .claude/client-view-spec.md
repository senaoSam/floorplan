# Client View / Client Experience — 規格（討論共識，2026-06-02）

> 對標 Hamina「Client experience / Client view」。
> 來源：https://docs.hamina.com/planner/simulation/client-view 、
> https://artofrf.com/2022/11/12/hamina-client-view/ 、`.claude/youtube.md`（34:00–40:30）。
> 本檔是**動工前的設計共識**，實作時細節以本檔為準；偏離須先與使用者討論。

---

## 一句話

把一個「虛擬客戶端裝置」放到平面圖上，**從這台裝置的角度**看網路：
連到哪台 AP、收訊多少、會在哪裡漫遊切換。拖著它走可模擬移動路線。
受眾＝設計師（驗證最壞裝置/邊角體驗、sticky client、切換點）＋非技術客戶（把覆蓋圖變成具體故事）。

## 範圍（使用者已拍板：**完整版**）

標準版（放置＋拖曳＋serving AP 連線＋面板）＋ **漫遊候選線＋association area** ＋ **裝置 profile ＋ data rate(MCS)**。

| 子功能 | 說明 |
|---|---|
| 放置 client | 點地圖放一個虛擬 client（單一，不是多顆） |
| 拖曳 client | 拖著走，面板＋連線即時更新 |
| Serving AP 連線 | **藍色虛線**連到目前 serving AP |
| 漫遊候選線 | **灰色虛線**連到候選 AP（可漫遊到的其他 AP） |
| Association area | 切換顯示模式：藍色區域＝client 在此範圍內都黏著目前 serving AP（壓 heatmap） |
| Client Experience 面板 | RSSI / SINR / SNR / data rate / current band / MCS / spatial streams / channel width / serving AP 名稱 / 距離 |
| 裝置 profile 下拉 | 手寫一組 mock 裝置（見下）；切換改變 band 支援/串流/能力 |
| 裝置設定 | 6 GHz capable、（其餘 noise floor / tx power / client height 視實作斟酌，優先做 band 支援） |

## 漫遊模型（使用者拍板：**hysteresis 遲滯**）

- serving AP 維持一個狀態（目前黏著的 AP id）。
- 候選 AP 的 RSSI 要**強過目前 serving AP 一個門檻（預設 6 dB）**才切換。
- 邊界不抖動、切換點可信——這是 Client View 最核心的賣點。
- 效能：漫遊判斷只是在 `probeAt` 已算好的 `perAp[]` 上做減法比較，奈秒級，**與純 RSSI 模型效能無差**。瓶頸只在 `probeAt` 本身（與現有 hover readout 同路徑，已驗證順暢）。

## 引擎複用（核心已存在，不重寫）

- **`probeAt(scenario, rx, opts)`** — `src/features/heatmap/hoverProbe.js`：單點回傳 `{ at, perAp[], rssiDbm, sinrDb, snrDb, cciDbm, bestApIndex, apList }`。**這就是 Client View 的引擎核心。**
- `aggregateApContributions` — `src/features/heatmap/propagation.js`：serving AP（最強）＋ SINR/SNR/CCI。
- `buildScenario(floor, walls, aps, scopes, crossFloor)` — `src/features/heatmap/buildScenario.js`：把 store 狀態轉成 scenario（含 px→m、scopeMaskFn、cross-floor）。Client View 直接共用同一 scenario。
- 拖曳 client 每次 `pointermove` 只呼叫一次 `probeAt`（單 rx）；hover 預設關反射/繞射。

### 需新增的引擎能力

1. **SNR → MCS → data rate 對照**（新檔，例如 `src/features/clientView/dataRate.js`）：
   依 PHY（Wi-Fi 5/6/6E/7）＋ channel width ＋ spatial streams ＋ SNR 查 MCS index → PHY rate（Mbps）。查表即可，純函式。
2. **裝置 profile**（新檔，例如 `src/constants/clientDevices.js`，比照 `apModels.js` 風格）：手寫 mock，欄位含
   `{ id, name, phy, bands:[2.4,5,6?], spatialStreams, maxChannelWidth, sixGHzCapable }`。
   代表性 5–8 顆：新手機(Wi-Fi7/6E,2ss)、舊手機(Wi-Fi5,2ss)、筆電(Wi-Fi6,2ss)、平板、IoT(2.4GHz,1ss) 等。
   - profile 影響：可連的 band（過濾 perAp 中不支援 band 的 AP）、可達 MCS（PHY/串流上限）、data rate。
3. **漫遊 serving-AP 狀態**：Client View 自己維護（store 或 mode controller 局部狀態），不污染熱圖。

## 互動層（要新做）

- 新 EDITOR_MODE（如 `CLIENT_VIEW`）＋ `modeCapabilities.js` 一條 cap（cursor、keepLayers＝floorImage/devicesAP/heatmap 之類、dim 其餘）。
- 新 PIXI overlay layer 畫 client marker＋連線（藍實/虛、灰虛），比照現有 layer 命令式風格。
- 面板：右側 Client Experience pane（沿用 PanelShell/PanelShell 風格）。
- Toolbar 入口一顆按鈕。

## 嚴格規則沿用

- mock data only（裝置 profile、MCS 表都手寫，符合 CLAUDE.md「pure-frontend + mock data」）。
- Zustand 直接訂閱資料、不訂閱 getter。
- canvas 座標儲存、screen↔canvas 用既有 `toCanvasPos`。
- 視覺常數（藍/灰、虛線、marker 大小）——**Hamina 無 oldSrc 可照，屬全新功能**；色彩沿用專案既有語彙（連線藍可參考 ghost line cyan 系、association 藍），動工時與使用者確認具體色值再定，不自行拍板上線色。

## 待實作時再決定（非阻塞）

- noise floor / client tx power / client height / min-interfering-RSSI 設定要不要全做（先做 band 支援＋6E toggle，其餘視時間）。
- Link direction（uplink/downlink/worstlink）—— Hamina Plus 才有，可暫不做。
- Wi-Fi 7 capable toggle —— profile 已含 phy，可由 profile 表達，不一定要獨立 toggle。
- 具體視覺色值/marker 樣式 —— 動工畫第一版後 MCP 截圖給使用者定。

# 10. 場景物件的簡化：Door / Window / Opening 真實狀態

## 為何這份文件存在

早期分析（00~09）只靠 index.js + GraphQL schema，結論是「NPv1 沒有 Door/Window」。
2026-04-19 分析 `hamina.wasm` 二進位 strings dump 後發現此結論**部分錯誤**。本文件記錄正確狀態。

---

## 1. 真實狀態總結

| 問題 | 答案 | 證據位置 |
|---|---|---|
| 有 Door 獨立物件類別嗎？ | ❌ 沒有 | 無 `addDoor` API |
| 有 Window 獨立物件類別嗎？ | ❌ 沒有 | 無 `addWindow` API |
| 有 Door/Window 這個**概念**嗎？ | ✅ 有 | `MlWallType` enum + `AutoWall` enum |
| 有預設的 Door/Window WallType 嗎？ | ✅ 有 | wasm 字串 `door (wooden)`, `window (tinted)` |
| 有 opening / 開洞 概念嗎？ | ❌ 沒有 | index.js `opening` 全是程式用語 |
| 有門 / 窗開關狀態嗎？ | ❌ 沒有 | enum 無 `DOOR_OPEN` / `DOOR_CLOSED` |

---

## 2. enum 定義（wasm 證據）

### 2.1 `MlWallType`（ML 自動辨識用分類）

hamina.wasm strings dump L639527 起：
```
DEFAULT
DOOR
ELEVATOR
...
```

出現於 `N6hamina3api7graphql10MlWallTypeE` 類型簽章附近。這是給 ML pipeline（PDF / DWG 圖面匯入自動辨識）的分類標籤，不是獨立物件。

### 2.2 `AutoWall`（自動建牆的輸出 struct）

hamina.wasm strings dump L639675 起：
```
DOOR
ELEVATOR
EXTERIOR
WINDOW
```

對應 C++ struct `N6hamina3api7graphql8AutoWallE`，欄位之一是 `wallType`（指回 `MlWallType`）。
API：`setAutoWalls(mapId, autoWalls)` — 前端把 ML 偵測結果送進 wasm。

### 2.3 預設 WallType 名稱字串

hamina.wasm strings dump：
- `door (wooden)`
- `window (tinted)`
（與其他預設材料如 concrete, brick, drywall, glass, metal 同列）

代表 NPv1 在 material library 裡有預先準備好門 / 窗的 WallType 讓使用者挑選。

---

## 3. 實際資料流

```
PDF/DWG 匯入
    ↓
NPv1 ML pipeline（server 側，非 wasm）
    ↓
偵測出 線段 + 分類（DOOR/WINDOW/EXTERIOR/...）
    ↓
setAutoWalls(mapId, autoWalls)  ← wasm API
    ↓
使用者在 UI 確認 / 修改 wallTypeId
    ↓
最終資料：Wall { start, end, materialId } + WallType { attenuation, ITU params, ... }
```

計算階段**完全不管**這面牆是 DOOR 還是 WINDOW 還是 CONCRETE——只讀 `WallType.attenuation` 與 ITU-R 參數做衰減累加。

---

## 4. 為何這樣設計（而不是獨立 Door / Window 物件類別）

1. **RF 計算角度**：穿透損耗只看材質，不看語意。「門」和「牆」在電磁波眼中只是介質不同的長方體
2. **衰減量級差異有限**：門 / 窗衰減 2-5 dB @2.4G，相比混凝土牆 12-20 dB，在 NPv1 的 ±5dB 預測誤差內影響不大
3. **動態狀態成本高**：門打開 / 關上會讓 heatmap 不同，但：
   - 需要增加狀態管理（per-door state machine）
   - 需要重算觸發（每次切狀態重跑 heatmap）
   - 商業場景客戶關注「平均覆蓋」而非「某時某刻實況」
4. **ML 輸出語意保留**：雖然 RF 不用，但 UI 顯示「這是門」對使用者比較好理解

---

## 5. 對新版設計的建議

### 選項 A：照搬 NPv1 方案（預設）
- Wall 一類，WallType 內建 door / window 預設材料
- 簡單、相容 NPv1 資料格式、與 ML pipeline 對接容易

### 選項 B：擴充為獨立物件（未來 spec 可擴展點）
- `Opening { wall_id, position_on_wall (0~1), length, state: open|closed, open_attenuation_db, closed_attenuation_db }`
- 好處：UI 可直接操作「把這扇門打開看看覆蓋」
- 成本：Wall 線段需要支援「插入 opening」的幾何運算；RF 計算需處理 per-segment 分段
- 建議優先級：低（V2 再考慮）

### 選項 C：AttenuatingZone 近似（舊系統「替代方案 1」）
- 在門窗位置畫小多邊形 Zone
- 靈活但精度差，端點位置難對齊真實牆線
- 不推薦作為主路徑，僅當特殊情境（如旋轉門、落地窗）備案

---

## 6. 新版實作 checklist

- [ ] WallType library 至少包含：concrete, brick, drywall, wood, glass (window), door (wooden), metal
- [ ] 每個 WallType 載 `{ attenuationDB, referenceFrequencyMHz, wallTopHeightM, wallBottomHeightM, isConductor, iturmodel_a/b/c/d }`
- [ ] UI 的 WallType 選單分類顯示（牆體 / 門 / 窗 / 電梯 / 外牆）
- [ ] 資料模型**不要**另外開 Door / Window table（遵循 NPv1 方案）
- [ ] 保留 `wallType` 語意字段（string enum `DEFAULT|DOOR|WINDOW|ELEVATOR|EXTERIOR`）給未來 ML 或 UI 用

---

## 7. 證據索引

| 來源 | 證據 |
|---|---|
| hamina.wasm L639527 | `MlWallType` enum: DEFAULT, DOOR, ELEVATOR, ... |
| hamina.wasm L639675 | `AutoWall` enum: DOOR, ELEVATOR, EXTERIOR, WINDOW |
| hamina.wasm L624775 | 字串 `door (wooden)` |
| hamina.wasm L624849 | 字串 `window (tinted)` |
| hamina.wasm L624699 | API `setAutoWalls(mapId, autoWalls)` |
| index.js grep `Door\|Window\|Opening` | 0 場景物件識別符（只有 browser window） |
| 07-graphql-schema.md | GraphQL 只暴露 Wall / WallType，無 Door/Window type |

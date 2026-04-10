# Floorplan — Task List

> ✅ 完成　🔄 進行中　⬜ 待做

---

## Layer 1 — 畫布基礎

| # | 狀態 | Task |
|---|------|------|
| 1-1 | ✅ | UI 骨架：Toolbar + SidebarLeft + CanvasArea 佈局 |
| 1-2 | ✅ | Konva Stage 初始化（ResizeObserver 自動填滿容器） |
| 1-3 | ✅ | Pan / Zoom（滾輪縮放、左鍵平移、中鍵平移） |
| 1-4 | ✅ | 匯入圖片 PNG/JPG（Drag & Drop + 點擊選檔、auto fit-to-screen） |
| 1-5 | ✅ | PDF 匯入（單頁，PDF.js 渲染為圖片） |
| 1-6 | ✅ | PDF 多頁自動拆樓層（每頁建立獨立樓層） |

---

## Layer 2 — 比例尺

| # | 狀態 | Task |
|---|------|------|
| 2-1 | ✅ | 手動比例尺：點擊兩點畫量測線，輸入公尺數計算 px/m |

---

## Layer 3 — 環境建模

| # | 狀態 | Task |
|---|------|------|
| 3-1 | ✅ | 牆體繪製工具：連續線段、ghost 線預覽、右鍵/ESC 停止 |
| 3-2 | ✅ | 牆體材質面板：選取牆體後右側面板顯示材質、高度設定、刪除 |
| 3-3 | ⬜ | Scope Zone：繪製建築範圍多邊形（In-Scope / Out-of-Scope） |
| 3-4 | ⬜ | Floor Hole（中庭/挑高）：定義信號可跨樓層穿透區域 |

---

## Layer 4 — 設備部署

| # | 狀態 | Task |
|---|------|------|
| 4-1 | ✅ | AP 放置：點擊畫布放置 AP 圖標，存入 useAPStore |
| 4-2 | ✅ | AP 屬性面板：頻段、發射功率、安裝高度、天線模式、名稱、刪除 |

---

## Layer 5 — Heatmap

| # | 狀態 | Task |
|---|------|------|
| 5-1 | ⬜ | 基礎 RSSI 計算（FSPL，不含牆體）+ Canvas 疊加顯示 |
| 5-2 | ⬜ | Ray-casting 牆體衰減（Web Worker 背景計算） |
| 5-3 | ⬜ | WebGL Fragment Shader 即時渲染（取代 CPU Canvas） |

---

## Layer 6 — 3D 視圖

| # | 狀態 | Task |
|---|------|------|
| 6-1 | ⬜ | R3F 基礎場景：平面圖貼圖到地板平面 |
| 6-2 | ⬜ | 3D 牆體：依 startX/Y → endX/Y 與 topHeight/bottomHeight 生成 |
| 6-3 | ⬜ | 3D AP 標記：依 x/y/z 座標顯示，含安裝高度差異 |

---

## Layer 7 — 多樓層

| # | 狀態 | Task |
|---|------|------|
| 7-1 | ⬜ | 樓層切換：SidebarLeft 點選樓層，畫布切換對應圖資與牆體 |
| 7-2 | ⬜ | 樓層對齊：手動設定各樓層偏移（offsetX/Y），確保樓層間對齊 |
| 7-3 | ⬜ | 樓板衰減：設定樓板材質與 dB 值，影響跨樓層信號傳播 |

---

## 整合（未來）

| # | 狀態 | Task |
|---|------|------|
| I-1 | ⬜ | 將 floorplanService 切換為真實 API（替換 mock data） |
| I-2 | ⬜ | 封裝為可嵌入主產品的 `<FloorplanSystem>` 元件（props in / callback out） |

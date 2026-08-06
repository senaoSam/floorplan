import React, { useState } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import './ProgressPanel.sass'

const FEATURES = [
  { icon: '🗺', text: '平面圖匯入：支援 PNG / JPG / PDF，PDF 多頁自動拆分為獨立樓層' },
  { icon: '📐', text: '比例尺設定：在圖上點兩點並輸入實際距離，自動建立 px/m 換算' },
  { icon: '🧱', text: '牆體繪製：連續線段繪製，支援端點吸附，可設定材質（玻璃到混凝土）與高度' },
  { icon: '📍', text: 'AP 放置：點擊畫布放置，左鍵或右鍵按住可拖曳，支援頻段、發射功率、天線模式設定' },
  { icon: '🟩', text: '範圍區域：繪製建築覆蓋範圍多邊形，區分涵蓋內／外區域' },
  { icon: '⬛', text: '挑高區域：標記中庭、挑高等信號可跨樓層穿透的區域' },
  { icon: '🖱', text: '右鍵操作：對任意物件按下右鍵可顯示屬性面板（停止繪製），按住右鍵可拖曳物件' },
  { icon: '📹', text: 'Camera 模式：放置監視器（FOV 被牆遮擋、玻璃可穿透）、模擬人車軌跡與偵測、人流熱圖、盲區圖、計數線、分析區域、回放時間軸' },
]

const PHASES = [
  {
    phase: 'Phase 1 — 2D 規劃核心',
    groups: [
      {
        layer: 'Layer 1 — 畫布基礎',
        items: [
          { id: '1-1', done: true, text: 'UI 骨架佈局' },
          { id: '1-2', done: true, text: 'Konva Stage 初始化' },
          { id: '1-3', done: true, text: 'Pan / Zoom' },
          { id: '1-4', done: true, text: 'PNG / JPG 匯入' },
          { id: '1-5', done: true, text: 'PDF 單頁匯入' },
          { id: '1-6', done: true, text: 'PDF 多頁自動拆樓層' },
        ],
      },
      {
        layer: 'Layer 2 — 比例尺',
        items: [
          { id: '2-1', done: true, text: '手動比例尺（點兩點 + 輸入公尺）' },
        ],
      },
      {
        layer: 'Layer 3 — 環境建模',
        items: [
          { id: '3-1', done: true, text: '牆體繪製工具' },
          { id: '3-2', done: true, text: '牆體材質面板' },
          { id: '3-3', done: true, text: 'Scope Zone 多邊形' },
          { id: '3-4', done: true, text: 'Floor Hole 多邊形' },
        ],
      },
      {
        layer: 'Layer 4 — 設備部署',
        items: [
          { id: '4-1', done: true, text: 'AP 放置' },
          { id: '4-2', done: true, text: 'AP 屬性面板' },
          { id: '4-3', done: true, text: '拖曳牆體、Scope、Floor Hole、AP' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 2 — 平面圖增強 & 編輯效率',
    groups: [
      {
        layer: 'Layer 6 — 平面圖操作',
        items: [
          { id: '6-1', done: true, text: '平面圖旋轉' },
          { id: '6-2', done: true, text: '平面圖透明度調整' },
          { id: '6-3', done: true, text: '平面圖裁切' },
        ],
      },
      {
        layer: 'Layer 7 — 編輯效率',
        items: [
          { id: '7-1', done: true, text: '牆體材質快捷鍵切換' },
          { id: '7-2', done: true, text: '批次選取（框選多物件）' },
          { id: '7-3', done: true, text: '門窗結構（牆體上的門/窗段）' },
          { id: '7-4', done: true, text: 'Undo / Redo 操作歷史' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 3 — AP 進階規劃',
    groups: [
      {
        layer: 'Layer 8 — AP 型號與自動規劃',
        items: [
          { id: '8-1', done: true, text: 'AP 型號資料庫（多廠商）' },
          { id: '8-2a', done: true, text: '天線模式資料模型 + APPanel UI' },
          { id: '8-2b', done: true, text: 'APLayer 定向扇形視覺化' },
          { id: '8-2c', done: true, text: 'Heatmap 納入定向增益（WebGL）' },
          { id: '8-2d', done: true, text: 'Custom pattern 內建預設 + 預覽' },
          { id: '8-3a', done: true, text: '國家頻段資料庫 + 頻道選單過濾' },
          { id: '8-3b', done: true,  text: '自動頻道規劃演算法（批次）' },
          { id: '8-3c', done: true,  text: '放置新 AP 自動挑頻道' },
          { id: '8-5', done: true, text: '頻寬設定（20/40/80/160 MHz）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 4 — 多樓層',
    groups: [
      {
        layer: 'Layer 9 — 多樓層管理',
        items: [
          { id: '9-1', done: true, text: '樓層切換' },
          { id: '9-2a', done: true,  text: '樓層對齊模式（偏移、縮放、旋轉 + 疊影 + 離開確認）' },
          { id: '9-2b', done: true,  text: '參考樓層疊影（選層、顯示開關、透明度）' },
          { id: '9-2c', done: true,  text: '參考樓層進階視覺化（色調、牆體輪廓）' },
          { id: '9-2d', done: true,  text: '參考樓層向量物件疊影（AP / Scope / Floor Hole）' },
          { id: '9-3a', done: true,  text: '樓板衰減資料模型 + UI' },
          { id: '9-3b', done: true,  text: '樓板衰減納入熱圖（跨樓層）' },
          { id: '9-3c', done: true,  text: '中庭穿透例外 v1（AP 正投影）' },
          { id: '9-3d', done: true,  text: '中庭穿透例外 v2（3D 斜線 per-pixel）' },
          { id: '9-3e', done: true,  text: '中庭垂直延伸範圍（貫穿多層）' },
        ],
      },
    ],
  },
  {
    // 第二版 heatmap：純 Friis + image-source 反射 + UTD knife-edge 繞射 +
    // 複數 Fresnel + 多頻點寬頻平均。先前 Phase 5/5.5/6 的 NPv1 方案已於
    // 2026-04-21 全數移除。
    phase: 'Phase 5 — Heatmap 重寫',
    groups: [
      {
        layer: 'MVP — CPU 實作',
        items: [
          { id: 'HM-1',  done: true, text: 'buildScenario 橋接層（px→m、openings 展開、scope mask）' },
          { id: 'HM-2',  done: true, text: '引擎整合 + 頻率 per-AP 參數化（band+channel+width）' },
          { id: 'HM-3',  done: true, text: '同頻 SINR — 只加頻譜重疊的 AP' },
          { id: 'HM-4',  done: true, text: '門窗穿透用 opening.material.dbLoss' },
          { id: 'HM-5',  done: true, text: 'Scope 過濾（out-of-scope 透明）' },
          { id: 'HM-6',  done: true, text: 'HeatmapLayer（跟隨 floor 旋轉/裁切）' },
          { id: 'HM-7',  done: true, text: 'useHeatmapStore（開關 + 參數）' },
          { id: 'HM-8',  done: true, text: '拖曳中即時重算（useDragOverlayStore live overrides）' },
          { id: 'HM-9',  done: true, text: 'Canvas 左下 Heatmap 按鈕 + hover RSSI/SINR 讀值' },
          { id: 'HM-10', done: true, text: 'FormulaNote 更新（新演算法公式說明）' },
        ],
      },
      {
        layer: '未來擴充',
        items: [
          { id: 'HM-F1', done: true, text: '天線方向性（antennaPattern 進計算）' },
          { id: 'HM-F7', done: true, text: '熱圖指標切換：SNR / CCI 模式' },
          { id: 'HM-F3a', done: true,  text: '樓板衰減計算' },
          { id: 'HM-F2b', done: true,  text: 'Cross-floor 熱圖呈現' },
          { id: 'HM-F2a', done: true, text: 'FloorHole bypass slab loss' },
          { id: 'HM-F3c', done: true, text: 'Slab 斜入射放大 sec θ' },
          { id: 'HM-F2c', done: true, text: '跨樓層射線的牆穿透' },
          { id: 'HM-F2e', done: true, text: '牆 Z 範圍過濾（wall bottom/topHeight）' },
          { id: 'HM-F3b', done: true, text: '樓板材質 UI' },
          { id: 'HM-F8',  done: true,  text: '頻率相依的牆損失（ITU-R P.2040-3 lossB；2.4 GHz anchor）' },
        ],
      },
      {
        layer: 'GPU 即時化（目標天花板：3000 AP / 150K walls 拖 ~25ms / 放 ~150ms）',
        items: [
          { id: 'HM-T1', done: true,  text: 'Golden test fixture（雙 baseline：full + friis）' },
          { id: 'HM-T2', done: true,  text: 'Diff harness — Node CLI（JS 引擎 vs golden, --html）' },
          { id: 'HM-T3', done: true,  text: '引擎切換（HeatmapControl 設定面板下拉）' },
          { id: 'HM-T3b', done: true, text: '瀏覽器 diff page（#/heatmap-diff，JS+Shader vs 雙 baseline）' },
          { id: 'HM-T4', done: true,  text: 'F5 子階段驗收門檻 + 雙 baseline 表（README）' },
          { id: 'HM-T5', done: true,  text: 'Edge-case fixtures（refl-min / dense-aps / dense-walls / cross-floor-tunneling）' },
          { id: 'HM-F5a', done: true, text: 'WebGL shader MVP（Friis + 牆穿透 + Z 過濾 + slab + opening + omni/directional）' },
          { id: 'HM-F5b', done: true,  text: 'Uniform Grid 空間加速（DDA 走 cell + SEEN_BUF=16 cyclic dedup）' },
          { id: 'HM-F5c+d', done: true, text: '反射 + 複數 Fresnel + 繞射 + 多頻點相干（部分：basic 1-cell metal-axis fp32 outlier known issue）' },
          { id: 'HM-F5g', done: true, text: 'per-fragment all-AP loop + AP 距離 culling（100 AP × 500 walls：JS 15.9s → Shader 58.6ms = 271×）' },
          { id: 'HM-F5h', done: true, text: 'Cascade tiling（粗→細 2 pass，apCount≥50 觸發；coarse free-space mask + fine early-exit）' },
          { id: 'HM-drag-lod', done: true, text: '拖曳期間降畫質（refl/diff off + cull -95 dBm + blur 0 + RSSI-only when applicable）' },
          { id: 'HM-drag-solo', done: true, text: 'Hamina 風格拖曳（Live / Solo 雙模式：Solo 拖 AP single-AP overlay、拖牆/Scope freeze）' },
          { id: 'HM-F5i', done: true, text: 'Refl/Diff 接上 wall grid（DDA 走格 + skip semantics）' },
          { id: 'HM-F5j', done: true, text: 'Per-AP LOS field bake（drag 期間取回完整 refl/diff）' },
          { id: 'HM-F5k', done: true, text: 'AP→corner / AP→wall 鏡像 precompute texture' },
          { id: 'HM-F5l', done: true, text: 'Coarse-fine 擴張到 refl/diff（物理 upper bound mask）' },
          { id: 'HM-F5f', done: true, text: '大場景調優（diff loop cull 重排，dense-aps 1.78×）' },
        ],
      },
      {
        layer: '備援與延伸',
        items: [
          { id: 'HM-F4', done: true, text: 'autoPowerPlan 自動功率規劃（greedy + 多起點 ±1 dB；cost v2 = 4 個獨立 loss term L_coverage / L_outlier / L_quality / L_excess 加權）' },
          { id: 'HM-F9', done: true, text: 'autoPowerPlan 進 Web Worker（不卡 main thread + 真實 progress + cancel + 規劃品質分數）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 6.5 — 3D 視圖',
    groups: [
      {
        layer: 'Layer 10 — 3D 視覺化',
        items: [
          { id: '10-1', done: true, text: 'R3F 基礎場景（平面圖貼圖）' },
          { id: '10-2', done: true, text: '3D 牆體生成（實心 Box）' },
          { id: '10-2b', done: true, text: '3D 牆體 openings 鏤空 + 結構化門窗' },
          { id: '10-2c', done: true, text: '3D 牆體選取 / hover 視覺化' },
          { id: '10-3', done: true, text: '3D AP 標記（圓柱 + 環 + 垂直桿）' },
          { id: '10-3b', done: true, text: '3D AP 天線方向性視覺化' },
          { id: '10-3c', done: true, text: '3D AP 選取 / hover + 名稱 label' },
          { id: '10-3d', done: true, text: 'AP mountType UI + 3D 差異' },
          { id: '10-4', done: true, text: '3D Scope / Floor Hole 視覺化' },
          { id: '10-5a', done: true, text: '3D 多樓層堆疊（floorHeight 預設 3m + 相機平滑切換）' },
          { id: '10-5b', done: true, text: '非 active 樓層的牆/AP/Scope 視覺弱化' },
          { id: '10-5c', done: true, text: '單樓層 / 全樓層顯示切換' },
          { id: '10-5d', done: true, text: 'floor.floorHeight 編輯 UI' },
          { id: '10-5e', done: true, text: '3D heatmap 樓板貼圖（依賴 HM-F2/F3）' },
          { id: '10-5f', done: true, text: '3D FloorHole 立體柱體（跨樓層 ExtrudeGeometry）' },
        ],
      },
    ],
  },
  {
    // 設計依據：.claude/cable-spec.md
    phase: 'Phase 7 — 網路基礎設施（Cable）',
    groups: [
      {
        layer: 'Layer 11 — Switch & 邏輯連線（base layer）',
        items: [
          { id: '11-1', done: true, text: 'Switch / IDF / MDF 放置與屬性面板（port 數、PoE budget、kind）' },
          { id: '11-2', done: true, text: 'AP↔Switch 預設 Manhattan 連線（+20% slack + Z_drop，same floor 限制）' },
          { id: '11-3', done: true, text: 'PoE 預算 + port 容量 over-capacity warning（不進 routing）' },
        ],
      },
      {
        layer: 'Layer 12 — Cable Tray / Riser',
        items: [
          { id: '12-1', done: true, text: 'Cable Tray polyline 繪製 + magnet 半徑視覺化' },
          { id: '12-2a', done: true, text: 'Graph builder Steps 1-7（endpoint snap 只挑最近 tray + tray intersection + chainage sort）' },
          { id: '12-2b', done: true, text: 'Stage 3 routing（Dijkstra + connected component + same-floor fallback + unroutable 標記）' },
          { id: '12-2c', done: true, text: '線長計算（chainage-based）+ CableLayer 渲染（tray / fallback / unroutable 三態）' },
          { id: '12-2d', done: true, text: 'Tray 端點 exact-coincidence merge（同 xy 視為共用 nodeId）' },
          { id: '12-3a', done: true, text: 'Cable Riser 點 + magnet（跨樓層共用 xy + floorIds）' },
          { id: '12-3b', done: true, text: 'Riser graph 整合（Steps 6/9/10：snap 多 tray + 相鄰樓層垂直邊）' },
          { id: '12-4', done: true, text: '撤回 — Hybrid routing。17-3 switch hub 落地後痛點消失；MVP 嚴格版已足夠' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 8 — Cable Summary & QA',
    groups: [
      {
        layer: 'Layer 13 — Cable Summary / Warnings',
        items: [
          { id: '13-1', done: true, text: 'CableSummaryPanel — 全建築 BOM（總線長、per-floor、per-routeStatus、unroutable 列表）' },
          { id: '13-2', done: true, text: 'Warnings 顯示 — buildGraph 已產生的 warnings（tray touching、共線重疊）' },
          { id: '13-3', done: true, text: 'DemoLoader cable 範例 — 既有 demo 加上 switch + tray + riser 種子資料' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 10 — Cable 進階：S2S / BOM 分類 / 3D',
    groups: [
      {
        layer: 'Layer 14 — Switch-to-switch + BOM 分類',
        items: [
          { id: '14-1', done: true, text: 'Switch uplink 屬性 + UI（target switch + 線材偏好）' },
          { id: '14-2', done: true, text: 'Switch-to-switch routing（用既有 graph 算 S2S 線）' },
          { id: '14-3', done: true, text: 'BOM 分類顯示（AP-link vs S2S、copper/fiber、長度級距）' },
        ],
      },
      {
        layer: 'Layer 15 — 3D Cable 視覺化',
        items: [
          { id: '15-1', done: true, text: 'Tray 3D 渲染（沿 polyline 在天花板高度）' },
          { id: '15-2', done: true, text: 'Cable 3D 渲染（路徑線在 3D 顯示，對齊 2D 虛實線樣式）' },
          { id: '15-3', done: true, text: 'Switch / IDF / MDF / Router 3D chassis（深灰本體 + 前面板 LED 條）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 11 — Cable UX Polish',
    groups: [
      {
        layer: 'Layer 17 — Cable 視覺 + 選取上下文',
        items: [
          { id: '17-1', done: true, text: 'Tray 通道風格視覺（border + 虛線中線 + 半透明 body）' },
          { id: '17-2', done: true, text: '選取裝置 highlight 連線 + device halo（cable + AP/SW peer）' },
          { id: '17-3', done: true, text: 'Switch 視為 hub（spec §4 例外）：snap 到 magnet 內所有 tray' },
          { id: '17-4', done: true, text: 'Switch snap 視覺提示（角落狀態 dot + 未 snap warning + 已 snap 顯示 foot drop）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 12 — Tray 編輯能力（P0）',
    groups: [
      {
        layer: 'Layer 18 — Tray Edit',
        items: [
          { id: '18-1', done: true, text: 'Vertex edit — drag / insert / delete / extend from endpoint / split segment' },
          { id: '18-2', done: true, text: '整條 tray drag 搬位置（保留 vertex 結構、更新 magnet / graph / cable route）' },
          { id: '18-3', done: true, text: 'Drawing UX — Backspace undo vertex；Shift 鎖 0/45/90°；Enter 完成' },
          { id: '18-4', done: true, text: 'Tray naming — auto TRAY-{floor}-{system}-{seq}、可手動覆寫' },
          { id: '18-5', done: true, text: 'Selected 顯示 vertex handles + segment + 可 snap 的 endpoint' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 13 — Tray 工程屬性與診斷',
    groups: [
      {
        layer: 'Layer 19 — Tray Engineering',
        items: [
          { id: '19-1', done: true, text: 'Tray kind（ladder / wire basket / solid / conduit / PVC）+ width × depth + material' },
          { id: '19-2', done: true, text: 'mountHeight per-tray（2D 編輯，3D 視覺跟著）' },
          { id: '19-3', done: true, text: 'System 屬性（Data / Power / Fire / Backbone / Mixed）+ owner color legend' },
          { id: '19-4', done: true, text: 'capacityProfile + per-tray fill ratio + 三段 warning（不寫死 40%）' },
          { id: '19-5', done: true, text: 'CableTrayPanel 升級為 health panel（Identity / Load / Path / Issues）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 14 — Planning BOM + 施工前檢查',
    groups: [
      {
        layer: 'Layer 20 — Planning BOM',
        items: [
          { id: '20-1', done: true, text: 'Tray Planning BOM — 總長 / L 接 / T 接 / 跨接 / 餘料係數' },
          { id: '20-2', done: true,  text: 'Per-tray AP/cable 列表 + 容量瓶頸列表' },
          { id: '20-3', done: true,  text: 'Drawing snap 增強 — snap to wall / parallel / angle lock' },
          { id: '20-4', done: true,  text: 'Right-click context menu — rename / split / extend / merge / convert / delete' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 15 — 進階拓撲',
    groups: [
      {
        layer: 'Layer 21 — Advanced Topology',
        items: [
          { id: '21-2', done: true, text: '撤回 — Zone box 是工位 cabling 的概念，AP planning 用 IDF/MDF 已涵蓋' },
          { id: '21-3', done: true, text: '撤回 — Routing 支援 zone box（隨 21-2 撤回）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 16 — CAD Handoff',
    groups: [
      {
        layer: 'Layer 22 — Export',
        items: [
          { id: '22-1', done: true,  text: 'CSV Planning BOM export（4 區塊：AP CABLES / S2S / CABLE TRAYS / SUMMARY）' },
          { id: '22-2', done: true,  text: 'PDF report — 封面 + 每樓層平面圖 + AP / S2S / Tray 詳表 + 警告（jsPDF + autotable）' },
          { id: '22-3a', done: true,  text: 'PNG plan view export（樓層 ⋯ 選單「匯出 PNG」，fit-to-content，2× pixelRatio）' },
          { id: '22-3b', done: true,  text: '撤回 — SVG export（Konva 無 SVG renderer + PNG/PDF 已覆蓋 95% 需求）' },
          { id: '22-4',  done: true,  text: '撤回 — DXF export（AutoCAD 交付不在 AP planner 工作流；Hamina 也無）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 17 — Mode Interaction Cleanup（左右鍵分工）',
    groups: [
      {
        layer: 'Layer 23 — Mode capability matrix + 左右鍵分工',
        items: [
          { id: '23-1',  done: true, text: 'Mode × interaction audit + `.claude/mode-matrix.md`（14 mode × 9 surface + 8 gap）' },
          { id: '23-2a', done: true, text: 'Wall / Scope / FloorHole 加 `name` 欄位 + auto-naming' },
          { id: '23-2b', done: true, text: '`modeCapabilities.js` — `getModeCapability(mode)` 9-flag 單一真實來源' },
          { id: '23-2c', done: true, text: 'useEditorStore.contextMenu slice + open/closeContextMenu' },
          { id: '23-2d', done: true, text: '共用 `<ObjectContextMenu>` 框架（inline rename / submenu / 外部 click 關）' },
          { id: '23-3a', done: true, text: '8 Layer refactor — 拔掉 isXMode、移除 hover DeleteButton、cursor 條件化' },
          { id: '23-3b', done: true, text: 'Editor2D onContextMenu dispatcher（draft cancel vs open menu vs no-op）' },
          { id: '23-3c', done: true, text: '7 物件 context menu items（最小版：rename + delete）' },
          { id: '23-3d', done: true, text: 'Playwright MCP 真實滑鼠驗證（7 物件 × right-click + hover X 消失）' },
          { id: '23-3e', done: true, text: '左右鍵完全分離：右鍵不動 selection、刪除只清「被選的」物件' },
          { id: '23-3f', done: true, text: '任何 mode 都可右鍵開選單（無 draft 時）+ 弱 hover 視覺 + menu 加「選取」item' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 18 — UI/UX 釐清與分群',
    groups: [
      {
        layer: 'Layer 24 — Function grouping & panel scaffold',
        items: [
          { id: '24-1', done: true,  text: 'Group 分類定案（7 群實作版：操作 / 結構 / 無線 / 網路布線 / 標註 / 編輯 / 輔助）' },
          { id: '24-2', done: true,  text: 'Toolbar 改為畫布上方中央浮動 panel、icon-only（SVG）、群分隔線 + tooltip portal' },
          { id: '24-3', done: true,  text: '9 panels 全跑在 PanelShell + form primitives、5 群 accent 彩條、canonical 中文 section 名' },
          { id: '24-4', done: true,  text: 'Active mode badge — 永遠顯示「群 / 模式名 — 提示」+ group accent 左邊條' },
          { id: '24-5', done: true,  text: '`.claude/color-legend.md` — 5 群色票 + sub-type 色 + cross-surface check + 新物件 checklist' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 19 — 自動 IDF 推薦（已撤回）',
    groups: [
      {
        layer: 'Layer 25 — Auto IDF placement（撤回）',
        items: [
          { id: '25-1', done: true, text: '撤回 — Spec / 演算法 / UI / 預覽全部移除。理由：IDF 真實選位仰賴房間 / 弱電間語意，本工具沒這層資料，演算法給的建議無法反映實務' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 20 — 效能優化',
    groups: [
      {
        layer: 'Layer 26 — Performance',
        items: [
          { id: '26-1', done: true,  text: 'Perf profile（50 / 150 / 300 AP）找 lag 主來源 + 視覺 baseline' },
          { id: '26-2-P1', done: true,  text: 'APMarker React.memo（中性 — 證明 reconciliation 不是瓶頸）' },
          { id: '26-2-P2', done: true,  text: 'HeatmapLayer 同值跳過 recompute（單 AP no-op -27%）' },
          { id: '26-2-P3c', done: true,  text: 'HM dragMode 預設 solo（150 AP drag 0.98 → 60 FPS）' },
          { id: '26-2-P3b', done: true,  text: 'CableLayer 拖曳時凍結 cable（300 AP drag ×215）' },
          { id: '26-2-P3a', done: true,  text: 'APLayer imperative Konva（click commit 5.8s → 0.56s）' },
          { id: '26-3', done: true, text: '`.claude/perf-baseline.md` 紀錄 before / after FPS' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 21 — 熱圖 Polish',
    groups: [
      {
        layer: 'Layer 27 — Heatmap polish',
        items: [
          { id: '27-1', done: true, text: 'Audit — `.claude/heatmap-audit.md` 列出 bug / 視覺缺陷' },
          { id: '27-2', done: true, text: '根據 audit 結果動手（實測後全項不修 / 跳過 / 不需做）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 22 — 3D 視覺強化',
    groups: [
      {
        layer: 'Layer 28 — 3D enhancements',
        items: [
          { id: '28-1', done: true, text: '3D AP label — sprite 跟著 camera 旋轉' },
          { id: '28-2', done: true, text: '3D 樓層切換 UI（不用切回 2D）' },
          { id: '28-3', done: true, text: '3D camera presets — top / iso / front' },
          { id: '28-4', done: true, text: '3D hover readout — AP tooltip（freq / channel / power）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 23 — Switch kind 真的差別化',
    groups: [
      {
        layer: 'Layer 29 — Switch kind differentiation',
        items: [
          { id: '29-1', done: true, text: 'Spec — `.claude/switch-kind-spec.md` 定 default / uplink port type / 階層約束' },
          { id: '29-2', done: true, text: 'DEFAULTS 重設 — 每 kind 一組 `DEFAULT_SWITCH_BY_KIND`，改 kind 時面板提示套用' },
          { id: '29-3', done: true, text: '階層 enforcement — uplinkTo 下拉只列允許目標（SW→IDF/MDF/Router 等）' },
          { id: '29-4', done: true, text: 'Routing 階層偏好 — backbone link 優先走指定 tray system' },
          { id: '29-5', done: true, text: 'BOM 細分 — S2S link 加 tier（backbone / distribution）；panel 三段顯示' },
          { id: '29-6', done: true, text: 'UI / 顏色 polish — 各 kind 顯示專屬欄位，對齊 color-legend' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 34 — Camera 模式（監視器規劃 + 人流可視化）',
    groups: [
      {
        layer: 'Layer 30 — Camera 基礎',
        items: [
          { id: '34-1a', done: true, text: 'CAMERA 編輯模式 — 畫布只剩底圖+牆，RF/cable 圖層與浮動面板全部隱藏' },
          { id: '34-1b', done: true, text: 'Camera 放置 / 拖曳 / 旋轉 handle（hover 變色、Shift 15° 吸附）+ CameraPanel' },
          { id: '34-1c', done: true, text: 'FOV visibility polygon — 牆遮擋視野、玻璃牆/窗可穿透、360° 環景' },
        ],
      },
      {
        layer: 'Layer 31 — 模擬人流與回放',
        items: [
          { id: '34-2a', done: true, text: 'Mock 軌跡產生器 — 一天 08:00–22:00、POI 吸引、避牆（門可通行）、seedable' },
          { id: '34-2b', done: true, text: 'Live 偵測 icon — FOV 內實色（人橘/車形）、外灰 ghost、漸淡 trail、hover 資訊' },
          { id: '34-4', done: true, text: '回放時間軸 — scrubber / 播放暫停 / 1x10x60x 倍速 / 日循環' },
        ],
      },
      {
        layer: 'Layer 32 — 分析可視化',
        items: [
          { id: '34-3', done: true, text: '人流熱圖 — 人流量 / 停留時間兩指標 + 統計時段篩選（冷清處透明）' },
          { id: '34-5a', done: true, text: '盲區圖 — 所有 camera 視野聯集取反的暗色遮罩' },
          { id: '34-5b', done: true, text: '計數線 — 兩擊繪製、分方向穿越人次、端點/整條可拖曳' },
          { id: '34-5c', done: true, text: '分析區域 — 進入人次 / 平均停留 / 尖峰時段 + 逐時長條圖、全區可選可拖' },
          { id: '34-5d', done: true, text: '動線圖 — 每格平均行進方向箭頭場' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 25 — PixiJS Hybrid 全功能 Port',
    groups: [
      {
        layer: 'Layer — Konva → PixiJS 渲染遷移',
        items: [
          { id: '25-port', done: true, text: 'PixiJS hybrid 全功能 port（Bundle 1–52 + parity gaps）— 所有 2D 圖層改走 PixiJS Container 階層' },
          { id: '25-heatmap', done: true, text: 'Heatmap 等高線 byte-identical 對齊（遷移前後像素一致）' },
          { id: '32-C', done: true, text: '增量 routing（只重算受影響路徑）' },
          { id: '32-E', done: true, text: 'Cable 靜動分層（gStatic/gDynamic；殘影回歸已驗證消除）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 26–27 — Perf baseline + Heatmap polish audit',
    groups: [
      {
        layer: 'Layer — 文件與實測',
        items: [
          { id: '26-1c', done: true, text: 'perf-baseline 文件脈絡警示（避免誤讀 before/after 數字）' },
          { id: '27-audit', done: true, text: 'Heatmap polish audit — 實測後全部不做（品質已達標）' },
        ],
      },
    ],
  },
  {
    // 設計依據：.claude/client-view-spec.md
    phase: 'Phase 33 — Client View（單點查詢視圖）',
    groups: [
      {
        layer: 'Layer — Client View 模擬',
        items: [
          { id: '33-mode', done: true, text: 'CLIENT_VIEW 模式 + simulate（band / hysteresis / MCS / data rate）' },
          { id: '33-panel', done: true, text: 'ClientPanel + association/coverage（藍色＝RSSI≥門檻 -67 可調，非連不連得到）' },
          { id: '33-model', done: true, text: 'indoorLoss 距離模型 + 位置記憶' },
          { id: '33-lock', done: true, text: '手動鎖定 AP（右鍵選單）+ 單台 AP 涵蓋（紅色）+ CV hover 回饋' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 34-V — Verkada parity 擴充',
    groups: [
      {
        layer: 'Layer — 即時動態 + 狀態',
        items: [
          { id: '34V-1', done: true, text: '熱圖 timelapse 時間推移（占用窗沿日滑動 + 自動縮窗）' },
          { id: '34V-2', done: true, text: 'FOV 偵測脈動 + 由內而外水波擴散環（牆裁切）' },
          { id: '34V-3', done: true, text: '裝置線上/離線狀態（綠/橘點、離線錐暗 + 不偵測 + 計盲區）' },
          { id: '34V-5', done: true, text: '即時影像 mock popover（canvas CCTV 畫面、離線雪花）' },
        ],
      },
      {
        layer: 'Layer — 覆蓋分析 + 規劃輔助',
        items: [
          { id: '34V-4', done: true, text: '占用趨勢面板（逐時長條、可拖、左下）' },
          { id: '34V-6', done: true, text: '覆蓋率報表（涵蓋%/盲區/重疊備援/平均重疊 + 目標門檻 pass/fail + 最大盲區定位）' },
          { id: '34V-7', done: true, text: '重疊覆蓋 overlay（黃=1台 / 藍綠=≥2台）' },
          { id: '34V-8', done: true, text: '型號預設（dome / bullet / turret / wide / fisheye）' },
          { id: '34V-9', done: true, text: '相機清單面板（多選批次改型號/狀態/刪除、區域分組、可收合、點列定位）' },
          { id: '34V-10', done: true, text: '複製相機 + 高度快設 + 方位角 ±15°/對準中心' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 35 — Camera 校正 + 導覽 polish',
    groups: [
      {
        layer: 'Layer 33 — 相機 4 點校正（homography）',
        items: [
          { id: '35-1a', done: true, text: '4+4 點校正 modal — 平面圖點 4 點 + 相機畫面點 4 點，求 frame→floor homography（utils/homography solveHomography）' },
          { id: '35-1b', done: true, text: '校正品質防呆 — 四邊形過小/共線即時警告（不顯示重投影誤差，4 點恆為 0 無意義）；步驟提示跟著 active pane' },
          { id: '35-1c', done: true, text: '階段 2 — 軌跡綁定相機 FOV + 經 homography 投影；first-freeze 模型（首次校正不位移、重校才位移），消費者零改動' },
          { id: '35-1d', done: true, text: '純手動校正（對標 Verkada，無 auto 預設）；已校正綠徽記 + 未校正提示' },
        ],
      },
      {
        layer: 'Layer 34 — 導覽 + 分析 polish',
        items: [
          { id: '35-2a', done: true, text: 'Device List hover — 清單列↔畫布 marker 雙向高亮 + mock CCTV live 縮圖氣泡' },
          { id: '35-2b', done: true, text: '占用趨勢面板點長條 → 跳到該小時（clockSec 連動）' },
          { id: '35-2c', done: true, text: '回放時鐘 + live HUD 顯示到秒（HH:MM:SS）' },
        ],
      },
      {
        layer: 'Layer 35 — 重構',
        items: [
          { id: '35-3a', done: true, text: '抽共用 FOV rasteriser（coverageStats + overlapLayer 去重）+ wrapAzimuth 抽 utils/angle' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 36 — Verkada Tier 1&2 擴充',
    groups: [
      {
        layer: 'Layer 36 — Device List + 即時影像',
        items: [
          { id: '36-1', done: true, text: 'Device List 側欄（對標 Verkada，只列攝影機）— CameraListPanel 從 floating 浮窗升級成 docked 常駐左欄（SidebarLeft↔CanvasArea 間、預設顯示、切走自動回收空間）' },
          { id: '36-2', done: true, text: '清單列 📹 鈕直接開即時影像（openLiveView，不誤觸列選取）' },
          { id: '36-3', done: true, text: '統一 hover store（cameras 遷到 useHoverStore type:camera，刪 hoverCameraId）' },
          { id: '36-4', done: true, text: '抽共用 mockCctv.drawCctvFrame（合併 3 處重複畫格 + mock|stream seam）' },
        ],
      },
      {
        layer: 'Layer 37 — 全樓層占用趨勢報表',
        items: [
          { id: '36-5', done: true, text: '7 日 mock 軌跡（generateWeekTracks，seed-per-day）+ computeDayRollup（day-level 去重）' },
          { id: '36-6', done: true, text: 'TrendPanel 逐時/逐日切換 + 人數/人·秒/車數 metric 切換' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 37 — Camera 右鍵選單 + 3D 強化',
    groups: [
      {
        layer: 'Layer 38 — Camera 右鍵 context menu',
        items: [
          { id: '37-1', done: true, text: 'Camera 右鍵選單（對標 AP）：重新命名/選取/複製相機/📹即時影像/校正熱圖/刪除（CAMERA_CAP allowContextMenu + camerasLayer button=2 + ContextMenuMount camera 分支）' },
        ],
      },
      {
        layer: 'Layer 39 — 3D camera 三分析圖',
        items: [
          { id: '37-2', done: true, text: '3D 顯示盲區/重疊/占用熱圖（CameraOverlay3D：重用 2D rasteriser 投影成地面紋理，跟隨 2D 開關）' },
          { id: '37-4', done: true, text: '3D 動線（flow）立體箭頭（FlowArrows3D：單一 InstancedMesh cyan cone，重用 computeFlowGrid，580 箭頭效能無虞）' },
        ],
      },
      {
        layer: 'Layer 40 — 3D 唯一光源光影',
        items: [
          { id: '37-3', done: true, text: '3D 唯一主光投影（Canvas shadows + KeyLight directionalLight castShadow 跟樓層 center；弱化 ambient 保留微弱補光；不分 mode）' },
          { id: '37-5', done: true, text: '全物件參與陰影（Switch/Tray/Riser/Track 人車 castShadow；AP/相機/門框窗框 receiveShadow；line/sprite/玻璃 three.js 無法投影故跳過）' },
        ],
      },
      {
        layer: 'Layer 41 — 3D 控制面板整理',
        items: [
          { id: '37-6', done: true, text: '移除 Log Camera（debug-only）' },
          { id: '37-7', done: true, text: '新增「🔄 自動旋轉」toggle（沿用 OrbitControls autoRotate idle spin，拖曳即停並同步按鈕狀態）' },
          { id: '37-8', done: true, text: '右上角控制項整理成統一深色玻璃面板（外框+標題「3D 視圖」+ 可收合）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 51 — 3D 視覺美化',
    groups: [
      {
        layer: 'Layer 42 — 全域光影',
        items: [
          { id: '51-1', done: true,  text: 'IBL 環境貼圖（RoomEnvironment + PMREMGenerator → scene.environment，全場景 PBR 材質一次到位；ambient/hemi 降 0.12 避免重複計算；順修 r3f 7 在 three 0.167 失效的 outputEncoding → outputColorSpace）' },
          { id: '51-2', done: true,  text: '陰影品質（KeyLight frustum 從固定 ±80m 改依可見樓層算包圍半徑：貼圖使用率 4.3%→66.3%，面積 15.4x；光源位置跟著縮放 + bias 下修配 normalBias）' },
          { id: '51-3', done: false, text: '背景漸層 + 場景霧（CSS 垂直漸層 + THREE.Fog 讓遠景淡出）' },
          { id: '51-4', done: false, text: '漸隱格線（gridHelper → shader 格線，fwidth 抗鋸齒 + 距離淡出）' },
          { id: '51-5', done: false, text: '樓板厚度（貼圖平面下加 10–15cm 樓板盒，疊樓從紙片變建築）' },
        ],
      },
      {
        layer: 'Layer 43 — 物件細節',
        items: [
          { id: '51-6',  done: false, text: '牆描邊 + 玻璃牆（EdgesGeometry 細描邊；Glass/Low-E 牆體改半透明）' },
          { id: '51-7',  done: false, text: '纜線實體化（1px line → Line2 fat line，真 px 線寬）' },
          { id: '51-8',  done: false, text: 'Riser / FloorHole 輪廓修正（wireframe 網子 → EdgesGeometry；segment 16→32）' },
          { id: '51-9',  done: false, text: 'Switch / AP 造型（RoundedBoxGeometry 圓角、port 貼圖、選取脈衝環、label DPR 提升）' },
          { id: '51-10', done: false, text: '相機 FOV 漸層衰減（頂點 alpha 由近至遠衰減 + 地面 footprint 輪廓線）' },
          { id: '51-11', done: false, text: 'Scope / 熱圖平面收尾（Line2 描邊、熱圖邊緣羽化）' },
        ],
      },
      {
        layer: 'Layer 44 — 後製特效（效能評估後才做）',
        items: [
          { id: '51-12', done: false, text: 'EffectComposer 後製鏈（OutlinePass 選取描邊 + 微量 Bloom + SSAO；做前先在 SW 渲染機 300 AP 量測）' },
        ],
      },
    ],
  },
  {
    phase: 'Phase 9 — AI 輔助',
    groups: [
      {
        layer: 'Layer 16 — AI 自動化',
        items: [
          { id: '16-3a', done: true,  text: 'OpenCV.js 整合 + 二值化 pipeline（worker）' },
          { id: '16-3c', done: true,  text: 'Deskew（Hough 角度直方圖 + warpAffine）' },
          { id: '16-3e', done: true,  text: '分方向 morph long-line mask（保留原始線厚）' },
          { id: '16-3f', done: true,  text: 'HoughLinesP 線段抽取' },
          { id: '16-3h', done: true,  text: 'Graph-based collinear merge + endpoint extension' },
          { id: '16-3i', done: true,  text: 'Wall thickness pair detection（牆 vs 家具/尺寸線）' },
          { id: '16-3l', done: true,  text: 'Confidence scoring 整合（length+paired+density minimal viable）' },
          { id: '16-3m', done: true,  text: 'Web Worker 化（隨 16-3a 提前完成）' },
          { id: '16-3o', done: true,  text: 'Toolbar「AI 偵測牆壁」入口 + 三桶分寫 + Undo/Redo 整合' },
        ],
      },
      {
        layer: 'Layer 50 — cv+graph pipeline API',
        items: [
          { id: '50-1', done: true, text: 'AI 牆改接 cv+graph pipeline（砍 Gemini 清圖 + API key + 解析度 remap）' },
          { id: '50-2', done: true, text: '非同步 job 流程：POST /jobs → 輪詢 → lines[]（不打 /coords，省一次往返）' },
          { id: '50-3', done: true, text: '演算法選單 7 種（預設 cnn）+ 重新偵測不必關窗' },
          { id: '50-4', done: true, text: '/denoised 中間圖（4 色線稿診斷；依 denoised_url 判定不硬寫規則）' },
          { id: '50-5', done: true, text: 'ApiTestModal：header 入口，一鍵跑完 7 支 + 逐列狀態/耗時' },
          { id: '50-6', done: true, text: 'ImageLightbox 共用放大檢視（原尺寸、框內捲動、Esc 不連帶關 modal）' },
        ],
      },
    ],
  },
]

const ALL_ITEMS = PHASES.flatMap((p) => p.groups.flatMap((g) => g.items))

function ProgressPanel() {
  const [open, setOpen] = useState(false)
  const [tab, setTab]   = useState('features') // 'features' | 'tasks'
  const sidebarCollapsed = useEditorStore((s) => s.sidebarCollapsed)

  const totalDone  = ALL_ITEMS.filter((i) => i.done).length
  const totalCount = ALL_ITEMS.length

  return (
    <div className="progress-wrap">
      {/* 觸發按鈕 */}
      <button
        className={`progress-trigger${sidebarCollapsed ? ' progress-trigger--compact' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={sidebarCollapsed ? `進度 ${totalDone}/${totalCount}` : '查看目前進度'}
      >
        <span className="progress-trigger__bar" style={{ width: `${(totalDone / totalCount) * 100}%` }} />
        <span className="progress-trigger__label">
          {sidebarCollapsed ? '📋' : `📋 進度 ${totalDone}/${totalCount}`}
        </span>
      </button>

      {/* 面板 */}
      {open && (
        <div className="progress-panel">
          <div className="progress-panel__header">
            <span className="progress-panel__title">Floorplan Planner — 全階段進度</span>
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
                {PHASES.map((phase) => {
                  const phaseDone = phase.groups.flatMap((g) => g.items).filter((i) => i.done).length
                  const phaseTotal = phase.groups.flatMap((g) => g.items).length
                  return (
                    <div key={phase.phase} className="progress-panel__phase">
                      <div className="progress-panel__phase-title">
                        {phase.phase}
                        <span className="progress-panel__phase-count">{phaseDone}/{phaseTotal}</span>
                      </div>
                      {phase.groups.map((group) => (
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
                  )
                })}
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
    </div>
  )
}

export default ProgressPanel

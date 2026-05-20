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
          { id: '12-4', done: false, text: '⏸️ 延後：Hybrid routing（走一段 tray 再 Manhattan 收尾）' },
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
          { id: '15-2', done: false, text: '⏸️ 延後：Cable 3D 渲染（路徑線在 3D 顯示）' },
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
          { id: '17-4', done: false, text: '⏸️ 待評估：「snap 了但不通」視覺提示' },
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
          { id: '19-3', done: false, text: 'System 屬性（Data / Power / Fire / Backbone / Mixed）+ owner color legend' },
          { id: '19-4', done: false, text: 'capacityProfile + per-tray fill ratio + 三段 warning（不寫死 40%）' },
          { id: '19-5', done: false, text: 'CableTrayPanel 升級為 health panel（Identity / Load / Path / Issues）' },
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
          { id: '20-1', done: false, text: 'Tray Planning BOM — 總長 / 彎頭 / T 接 / 跨接 / 餘料係數' },
          { id: '20-2', done: false, text: 'Per-tray AP/cable 列表 + 容量瓶頸列表' },
          { id: '20-3', done: false, text: 'Drawing snap 增強 — snap to wall / parallel / angle lock' },
          { id: '20-4', done: false, text: 'Right-click context menu — rename / split / extend / merge / convert / delete' },
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
          { id: '21-1', done: false, text: 'Vertical tray / conduit（獨立物件，不是 Riser）' },
          { id: '21-2', done: false, text: 'Zone box / consolidation point — trunk → zone → short drop' },
          { id: '21-3', done: false, text: 'Routing 支援 zone box（home-run vs via zone box 路徑）' },
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
          { id: '22-1', done: false, text: 'CSV Planning BOM export' },
          { id: '22-2', done: false, text: 'PDF report（平面圖 + 統計 + warnings）' },
          { id: '22-3', done: false, text: 'SVG / PNG plan view export' },
          { id: '22-4', done: false, text: 'DXF export（DWG 之後再評估）' },
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
    <>
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
    </>
  )
}

export default ProgressPanel

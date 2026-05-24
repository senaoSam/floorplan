# Switch Kind Differentiation Spec

> Phase 23 / Layer 29 — make `switch / idf / mdf / router` 真的不同。
> 設計原則：盡量符合真實世界（Cisco / Aruba / Juniper / TIA-942 / BICSI 標準），不為時程妥協。
> 業界研究依據：Cisco Catalyst 1300/9200/9300/9500、Aruba CX 6100/6200/6300/8400、Juniper EX2300/EX4400/QFX5120、TIA-942、TIA-568、BICSI TDMM。

---

## 1. 角色定位（Real-world reference）

| Kind | 名稱（業界用詞）| 在拓撲中的角色 |
|---|---|---|
| **access** | Access Switch / Edge Switch | 收末端（AP / 工位 / IP phone / camera）的 PoE 交換器，掛機櫃或牆面 |
| **idf** | Intermediate Distribution Frame（樓層 / 區域配線間）| 聚合該樓層 / 區域的 access switches，再用 fiber 上連 MDF |
| **mdf** | Main Distribution Frame（主機房）| 全建築的核心 / 聚合層，所有 IDF 都連到這裡；TIA-942 §5.4「Main Distribution Area」 |
| **router** | Edge Router / WAN Router / SD-WAN Gateway | WAN 邊界，連 ISP / 多 ISP failover / SD-WAN overlay |

註：本 spec 沿用既有 store 內的小寫值 `switch` / `idf` / `mdf` / `router`。`switch` = access switch（不重新命名以免改散落引用）。

---

## 2. 每種 Kind 的 Default 規格

業界規格表（access 是 Cisco C9200-24P，IDF 是 C9300-24S，MDF 是 C9500-48Y4C，Router 是 ISR 4451 / Cat 8300 系列當基準）：

| Spec | access | idf | mdf | router |
|---|---|---|---|---|
| **portCount** | 24 | 48 | 48 | 8（4 WAN + 4 LAN）|
| **poeBudget (W)** | 370 | 740 | **0** | **0** |
| **uplinkPortType** | sfp+ (10G fiber) | sfp+ / sfp28 (10/25G fiber) | qsfp28 (100G fiber) | sfp+ / mixed (10G fiber + copper) |
| **uplinkCount** | 4 | 2 (dual-homed) | 2 (dual-homed) | 2 (dual WAN failover) |
| **cableType（uplink 預設）**| `fiber`（access→IDF 上連已習慣走 fiber）| `fiber` | `fiber` | `fiber` |
| **portSpeed (Gbps)** | 1G + 10G uplink | 10G + 25G uplink | 25G + 100G uplink | 1G WAN + 10G LAN |
| **isCoreLayer** | false | false | true | true |
| **mountHeight (m)** | 2.4（牆掛）或 0.5（rack）| 0.5（機櫃內 rack）| 0.5（機房 rack）| 0.5（機房 rack）|

> 註：`poeBudget = 0` 表示「不提供 PoE」，UI 上不允許設 > 0（強制 0）。

### Default object 結構

`useCableStore.js` 新增 `DEFAULT_SWITCH_BY_KIND`：

```js
export const DEFAULT_SWITCH_BY_KIND = {
  switch: {
    kind: 'switch',
    mountHeight: 2.4,
    model: 'Catalyst 9200-24P',
    portCount: 24,
    poeBudget: 370,
    uplinkPortType: 'sfp+',
    uplinkCount: 4,
    cableType: 'fiber',
    isCoreLayer: false,
  },
  idf: {
    kind: 'idf',
    mountHeight: 0.5,
    model: 'Catalyst 9300-48S',
    portCount: 48,
    poeBudget: 740,
    uplinkPortType: 'sfp28',
    uplinkCount: 2,
    cableType: 'fiber',
    isCoreLayer: false,
  },
  mdf: {
    kind: 'mdf',
    mountHeight: 0.5,
    model: 'Catalyst 9500-48Y4C',
    portCount: 48,
    poeBudget: 0,
    uplinkPortType: 'qsfp28',
    uplinkCount: 2,
    cableType: 'fiber',
    isCoreLayer: true,
  },
  router: {
    kind: 'router',
    mountHeight: 0.5,
    model: 'Catalyst 8300',
    portCount: 8,
    poeBudget: 0,
    uplinkPortType: 'sfp+',
    uplinkCount: 2,
    cableType: 'fiber',
    isCoreLayer: true,
    wanPortCount: 4,
    lanPortCount: 4,
  },
}
```

**現有 `DEFAULT_SWITCH` 保留**作為 access 的同義舊指向（避免破壞既有匯入），但新建用 `DEFAULT_SWITCH_BY_KIND[kind]`。

### 改 kind 時的行為

切換 kind 時的方案是「**自動套新 default**」（跟其他 numeric default 一致行為，且符合 UX：使用者不會期待 switch → MDF 還是 24 port / 370 W）。

> **不**做 confirm dialog（會打斷 flow，使用者可隨時手動覆寫單一欄位）。
> 切換瞬間若使用者已手動改過 portCount 等，會被覆寫 → 用 inline hint「已套用 IDF 預設」放在面板頂端，可手動再改回。

---

## 3. 階層 Enforcement（uplinkTo 規則）

業界拓撲規則（Cisco Enterprise Campus 3.0 + TIA-942）：

| 來源 kind \ uplinkTo | access | idf | mdf | router | null（頂層）|
|---|---|---|---|---|---|
| **access** | ❌ enforce 擋 | ✅ 主選 | ⚠ warn（collapsed core 合法）| ❌ enforce 擋 | ❌ 不允許（access 必須有上連）|
| **idf** | ❌ enforce 擋 | ⚠ warn（同階互連，僅 MC-LAG pair 合法）| ✅ 主選 | ❌ enforce 擋 | ❌ 不允許 |
| **mdf** | ❌ enforce 擋 | ❌ enforce 擋 | ⚠ warn（VSS / StackWise-Virtual pair 合法）| ✅ 主選 | ✅（小場館 collapsed core）|
| **router** | ❌ enforce 擋 | ❌ enforce 擋 | ❌ enforce 擋（router 不上連 mdf）| ❌ enforce 擋（多 router 用 BGP 不算這層）| ✅ 頂層 |

### Enforcement 落地

1. **uplinkTo 下拉只列「✅」「⚠」目標**（不顯示 ❌ enforce 擋的 kind）
2. **「⚠ warn」目標選下去可以，但屬性面板顯示 warning**：「access switch 直接上連 MDF 屬於 collapsed core 拓撲，僅推薦小場館 ≤2 樓使用」
3. **既有資料違反新規則**（從舊版升級上來）→ 顯示 warning 但**不強制重設**（破壞使用者意圖）
4. `nextSwitchName` 不變（仍 SW-/IDF-/MDF-/RTR- prefix）

### Auto-default uplinkTo

放置新 switch 時，依 kind 找最近的「主選」目標 auto-fill：
- access → 找最近 IDF；沒 IDF 找最近 MDF；都沒就 null
- idf → 找最近 MDF；沒 MDF 找最近 Router；都沒就 null
- mdf → 找最近 Router；沒 Router 就 null
- router → null

「最近」用 Manhattan 距離（跟現有 routing 一致）。

---

## 4. Routing 階層偏好（29-4）

S2S link 走最短路徑（既有），但**加上「tray system 偏好」**：

| Link tier（來源 kind → 目標 kind）| 偏好 tray system | cost 折扣 |
|---|---|---|
| **backbone**：mdf ↔ router、idf ↔ mdf | `'backbone'` | × 0.7 |
| **distribution**：access ↔ idf | `'data'` | × 0.9 |
| **access**：AP ↔ access switch | `'data'` 或任何 | × 1.0（不偏好）|

實作：`buildBuildingGraph` 在 tray edge weight 計算時，依該 link 的 tier 對「該 tray system 不符」加 penalty。或更乾淨：在 Dijkstra 階段給每條 link 一個 `preferredSystem`，traversal 時 cost = `baseWeight × (tray.system === preferredSystem ? discount : 1.0)`。

選後者：保留 buildBuildingGraph 的 system-agnostic 性質，分層偏好在 routing 階段套用。需要 `buildBuildingGraph` 在 edge data 上保留 `traySystem`（已存在於 tray object，傳遞即可）。

---

## 5. BOM 細分（29-5）

`computeRoutes` 已輸出 `switchLinks: Map<srcId, link>`。link 加 `tier` 欄位：

```js
// New field on switchLink:
{
  srcId, targetId,
  tier: 'backbone' | 'distribution' | 'access-to-access',
  // ... existing fields
}
```

tier 推導：
- `tier = 'backbone'` if (srcKind, targetKind) ∈ {(idf,mdf), (mdf,router), (mdf,null)}
- `tier = 'distribution'` if (srcKind, targetKind) === (access, idf)
- `tier = 'access-to-access'` if 兩端都是 access（理論上不該發生但 fallback 用）
- 其他組合（如 access → mdf 的 collapsed core）→ `'distribution'`（功能上等價）

CableSummaryPanel 加「BOM by tier」段：

```
Backbone      ▮▮▮▮▮▮  84 m   (fiber 84 m)
Distribution  ▮▮▮▮     56 m   (fiber 56 m)
Access (AP)   ▮▮▮      71 m   (copper 71 m)
─────────────────────────────────
Total                  211 m
```

per-tier copper / fiber 切分也顯示（業界 BOM 通常分開計價）。

---

## 6. UI / 視覺差異化（29-6）

### 6.1 2D Switch icon（依 kind 不同形狀）

| Kind | 形狀提案 |
|---|---|
| access | 既有矩形（不變）|
| idf | 矩形 + 上方一條小橫線（代表 distribution layer）|
| mdf | 矩形 + 上方兩條橫線 + chassis 寬度略大（代表 core layer）|
| router | 圓角矩形 + 上方天線符號（代表 WAN edge）|

實作：`SwitchLayer.jsx` 依 `sw.kind` 切換 Konva shape。顏色維持既有（`SWITCH_KINDS` 內 color）。

### 6.2 3D chassis 高度 / 寬度

依 `portCount` 調整 chassis 視覺尺寸（rack unit RU 比照真實）：
- 24-port = 1U 高
- 48-port = 1U 高、寬 1.5×
- Core (MDF / Router) = 2U 高（多功能模組）

實作：`SwitchLayer3D.jsx` 用 `sw.portCount` + `sw.isCoreLayer` 算 boxGeometry args。

### 6.3 屬性面板（SwitchPanel）

依 kind 露出不同欄位：

| 欄位 | access | idf | mdf | router |
|---|---|---|---|---|
| Model | ✅ | ✅ | ✅ | ✅ |
| Port count | ✅ | ✅ | ✅ | ✅ |
| PoE budget | ✅ | ✅ | ❌（強制 0）| ❌ |
| Uplink port type | ✅ readonly | ✅ readonly | ✅ readonly | ✅ readonly |
| Uplink count | ✅ | ✅ | ✅ | ✅ |
| Uplink to | ✅ | ✅ | ✅ | ❌（router 沒 uplink）|
| Cable type | ✅ | ✅ | ✅ | ✅ |
| **下游裝置數**（唯讀）| ✅（直連 AP 數）| ✅（access switch 數 + AP 數）| ✅（IDF 數 + total）| ✅（MDF 數 + total）|
| **WAN / LAN port** | ❌ | ❌ | ❌ | ✅（router 才有）|

「下游裝置數」用 `useFocusedDevices`（既有）或新 helper 直接從 `apsByFloor` + `switchesByFloor` 算。

### 6.4 顏色 legend 對齊

更新 `.claude/color-legend.md` 加上「Switch kind 階層化」段，列每個 kind 的 SVG 形狀 + 3D chassis 尺寸對照。

---

## 7. 不做的事（明確排除）

- ❌ **CLI / SSH 模擬**：本工具是 planner，不是 NMS
- ❌ **真實 model SKU 庫**：使用者輸入字串即可，不限定品牌
- ❌ **VLAN / L3 routing 配置**：超出 planning 範圍
- ❌ **redundant pair（MC-LAG / StackWise）的自動 mesh**：使用者可手動連兩條 uplinkTo，不自動配對

---

## 8. Task 落地順序

| Task | 依賴 | 主要動作 |
|---|---|---|
| 29-2 | spec done | `useCableStore` 加 `DEFAULT_SWITCH_BY_KIND`；`addSwitch` / `updateSwitch` kind 切換 hook：自動套 default + inline hint |
| 29-3 | 29-2 | `SwitchPanel` uplink dropdown 過濾、warning 顯示；新建 switch auto-fill uplinkTo |
| 29-4 | 29-2/29-3 | `buildBuildingGraph` 在 tray edge 上保留 `traySystem`；`computeRoutes` 算 S2S link 時 cost 套 tier preference 折扣 |
| 29-5 | 29-4 | `computeRoutes` switchLink 加 `tier` 欄位；`CableSummaryPanel` 加 BOM tier section |
| 29-6 | 29-2 | `SwitchLayer.jsx` / `SwitchLayer3D.jsx` 形狀分化；`SwitchPanel` 條件式欄位；`.claude/color-legend.md` 更新 |

29-2 / 29-3 是地基（資料模型 + 階層規則）。29-4 / 29-5 是 routing / BOM 細分。29-6 是視覺 polish。

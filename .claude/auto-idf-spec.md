# Auto IDF Placement — Algorithm Spec

> 對應 task 25-1（spec）/ 25-2（純函式 `src/features/cable/autoIdfPlan.js`）/ 25-3（UI）/ 25-4（ghost preview）
> 設計依據：兩輪外部專家 review + 使用者拍板（2026-05-24）
> 上下游：對齊 `cable-spec.md` 的 cable graph / Dijkstra routing；`computeRoutes.js` 為事後驗證來源

---

## 1. Problem Statement

給定一層樓的 N 個 AP 座標，自動建議：

1. 要放幾個 IDF（switch kind = 'idf'）
2. 每個 IDF 的 (x, y)
3. 每個 AP 對應哪個 IDF

### Hard Constraints

| Constraint | 預設 | 說明 |
|---|---|---|
| Ports per IDF | 24 | 每個 AP 佔 1 port |
| Max cable length per AP | 90 m | Cat6 上限；超過 → hard fail（不自動 fiber，由使用者後續處理） |
| IDF 位置必須來自候選點集合 | — | 不允許任意 centroid |

### Soft Constraint (Warning Only)

| Constraint | 預設 | 行為 |
|---|---|---|
| PoE budget per IDF | 370 W | 超過 → warning，建議升級 PSU / 高 PoE switch；不 fail |

### Distance Metric

- **k-means iteration 期間**：Manhattan × 1.20 slack + Z-drop（fast，O(1) per pair）
- **最終驗證**：呼叫既有 `computeRoutes` 走真實 tray graph Dijkstra（accurate）
- Final 階段若任一 AP 真實線長 > 90m → eject、k++ 再跑

---

## 2. Input / Output Shape

```js
autoIdfPlan({
  aps,                            // Array<{ id, x, y, poeWattage }>  座標單位 = meters
  constraints: {
    portsPerIdf: 24,
    maxCableM: 90,
    poeBudgetW: 370,              // soft warning only
  },
  candidatePoints,                // Array<{ x, y, source: 'switch'|'tray'|'grid' }>
  existingIdfs?: [],              // Array<{ id, x, y, portCount, poeBudget }>  warm-start fixed
  options?: {
    restartCount: 8,              // random restart 次數
    seed: 0,                      // 決定性 RNG seed
    allowMoveExisting: false,     // 預設：固定既有 IDF 不動；進階模式可設 true
  },
})
```

回傳：

```js
{
  idfs: [
    {
      x, y,
      candidateSource: 'tray' | 'switch' | 'grid',
      assignedAPs: ['ap-1', 'ap-3', ...],
      portsUsed: 17,
      poeUsedW: 280,
      poeWarning: false,         // 若 poeUsedW > poeBudgetW 為 true
    },
    ...
  ],
  totalCableM: 423.5,
  maxCableM: 78.2,
  unassigned: [],                 // 任一 AP 無法滿足 hard constraints 時填入
  warnings: [
    'Candidate points include grid fallback because no cable tray exists',
    'IDF-2 PoE budget exceeded (390 W of 370 W)',
    ...
  ],
  meta: {
    k: 4,
    restartsRun: 8,
    bestRestartIndex: 3,
    durationMs: 412,
  },
}
```

---

## 3. Algorithm — K-Means Seed + Candidate Snap + Reassign

### 拍板決策（Q1）

**C+：k-means centroid → snap 到候選點 → reassign → 驗證 → 若不滿足 k++/restart**

> 正確完整講法：k-means produces **seed locations**; final locations **must be snapped candidate facilities**; assignment **must be recomputed after snapping**.

Snap 後**必須**重新 assignment，否則容易產生 false feasible result（centroid 看似滿足 90m，但 snap 到候選點後線長爆掉）。

### 高階流程

```
function autoIdfPlan(aps, candidatePoints, constraints, options):
    if aps.length == 0: return empty
    if aps.length == 1: return single IDF at nearest candidate to that AP

    k_lower = ceil(aps.length / constraints.portsPerIdf)
    k_max   = min(aps.length, 30)              // safety cap

    bestResult = null

    for k in k_lower..k_max:
        for restart in 0..options.restartCount:
            seed = hash(options.seed, k, restart)
            result = runOnce(aps, candidatePoints, k, constraints, existingIdfs, seed)
            if result.feasible:
                if bestResult == null || isBetter(result, bestResult):
                    bestResult = result

        if bestResult != null && bestResult.k == k:
            break          // 找到最小可行 k，不再 k++

    if bestResult == null:
        return bestEffortResult(...)

    // Final validation using real tray graph Dijkstra
    validated = revalidateWithTrayGraph(bestResult)
    if !validated.allUnder90m:
        // eject offending APs, k++ and retry (or return with unassigned[])
        ...

    return bestResult
```

### `runOnce` — 單次 k-means + snap + reassign

```
function runOnce(aps, candidates, k, constraints, existingIdfs, seed):
    // Step 1: initialize centroids
    fixedCentroids = existingIdfs.map(idf => ({ x: idf.x, y: idf.y, fixed: true }))
    needed = k - fixedCentroids.length
    if needed > 0:
        freshCentroids = kmeansPlusPlusInit(aps, needed, seed)
        centroids = [...fixedCentroids, ...freshCentroids]
    else:
        centroids = fixedCentroids.slice(0, k)

    // Step 2: k-means iteration (fast metric)
    for iter in 0..MAX_ITER (50):
        assignments = capacityAwareAssign(aps, centroids, constraints)
        newCentroids = centroids.map((c, i) =>
            c.fixed ? c : meanOf(assignments[i])
        )
        if converged(centroids, newCentroids, eps=0.01m): break
        centroids = newCentroids

    // Step 3: snap each non-fixed centroid to nearest candidate
    snapped = centroids.map(c =>
        c.fixed ? c : nearestCandidate(c, candidates)
    )

    // Step 4: REASSIGN after snap (critical — do not skip)
    finalAssignments = capacityAwareAssign(aps, snapped, constraints)

    // Step 5: check feasibility
    feasible = checkPortLimits(finalAssignments, constraints)
             && checkCableLimits(aps, snapped, finalAssignments, constraints.maxCableM)
             // NOTE: PoE is warning-only, does not affect feasibility

    return {
        k, feasible,
        idfs: zip(snapped, finalAssignments),
        totalCable: sumCableLength(...),
        maxCable: maxCableLength(...),
        poeWarnings: collectPoeWarnings(...),
    }
```

### Phase A — Capacity-Aware Assignment

```
function capacityAwareAssign(aps, centroids, constraints):
    // Sort APs by distance to nearest centroid descending
    // (hardest-to-place first; classic capacitated clustering trick)
    sorted = aps.sortBy(ap => -minDistance(ap, centroids))

    assignments = centroids.map(() => [])
    unplaced = []

    for ap in sorted:
        candidates = centroids
          .map((c, i) => ({ i, dist: manhattanDist(ap, c) * 1.20 + zDrop(ap) }))
          .filter(({ dist }) => dist <= constraints.maxCableM)
          .sortBy(c => c.dist)

        placed = false
        for { i } in candidates:
            if assignments[i].length < constraints.portsPerIdf:
                assignments[i].push(ap)
                placed = true
                break
        if !placed: unplaced.push(ap)

    return { assignments, unplaced }
```

### Phase B — K-Means++ Init

```
1. 第一個 centroid 從 AP 中隨機抽（seeded RNG）
2. 後續 centroid：對每個 AP 計算 D(ap) = 到最近已選 centroid 的距離
   下一個 centroid 以機率 ∝ D(ap)² 抽
3. 直到選滿 needed 個
```

`seed = hash(options.seed, k, restart)` 確保 deterministic — 同 input + 同 (seed, k, restart) 必得同結果。

---

## 4. Candidate Points

### 來源優先序（Q2 拍板）

| 來源 | MVP 使用 | 備註 |
|---|---|---|
| 1. Existing switch / IDF 位置 | ✅ | warm-start，最高優先 |
| 2. Cable tray graph node（vertex + intersection） | ✅ | tray 已存在則免費；最可靠 |
| 3. 牆角 / 牆邊 offset 1m 內側 | ❌ 未來 | 需處理外牆 vs 內牆語義 |
| 4. 走廊中線 | ❌ 未來 | 需要 scope 或人工 hint |
| 5. 規則 grid fallback | ✅ 帶 warning | 沒畫 tray 時退路 |

### Grid Fallback 規則（補強）

**重要警告**：grid fallback 不能無腦全平面亂撒，否則只是把「IDF 放在牆內」問題換個形式重現。

MVP 處理：
- Grid 間距：5 m（floor scale 換算）
- **過濾**：若 wall geometry 可用，剔除落在牆內 / 外牆外的點
- **優先**：靠近 AP density center 的 grid 點排前面
- **強制 warning**：使用 grid fallback 時必塞一條 warning：
  > "Candidate points are estimated because no cable tray exists. IDF positions may need manual adjustment."

未來補強（不在 25-2）：
- 新增 `IDFCandidateZone` 物件，使用者明確標弱電間範圍
- 牆角 + 牆邊 offset candidate

### 候選點生成時機

`autoIdfPlan` 不自己生成候選點 — 由呼叫者（25-3 UI 層）準備好傳進來。
理由：候選點來源涉及 wall / tray / floor store 多個 store 讀取，純函式不該背這個。

候選點生成器另寫一個函式 `collectCandidatePoints(floorId)`，放 `autoIdfPlan.js` 同檔或拆 helper。

---

## 5. Restart Strategy（Q3）

**MVP 在純函式內做 restart wrapper，Worker 留給 25-3**：

- 每個 k 跑 `restartCount`（預設 8）次 k-means + snap + reassign
- 用 `(baseSeed, k, restartIndex)` 組 seed，保證 deterministic
- 同 k 內取「feasible + total cable 最短」為最佳
- 找到最小可行 k 就 break，**不往上 k++ 再試**

**25-3 UI 階段必排 Worker**：N=300 + 8 restart + Dijkstra validation 有機會卡主 thread。不要等 demo 才發現。

---

## 6. Objective Function（Q4 拍板）

排序：

1. **Minimum IDF count（k）** — 由外層 k++ 自然保證
2. **All AP cable ≤ 90m** — hard constraint，違反則 infeasible
3. **Port hard limit (24 per IDF)** — hard constraint
4. **Minimize total cable length** — restart 之間的選擇標準
5. **Tie-breaker: minimize max cable length** — total cable 同分時用
6. **Warning only: PoE over budget** — 不影響 feasibility

`isBetter(a, b)`：
```js
function isBetter(a, b):
    if a.totalCable < b.totalCable: return true
    if a.totalCable > b.totalCable: return false
    return a.maxCable < b.maxCable
```

---

## 7. Edge Cases

| Case | 處理 |
|---|---|
| 0 APs | Return empty result, no warning |
| 1 AP | 單 IDF 放在最近候選點；若無候選點在 90m 內 → unassigned |
| 全部 AP 在 1 個 IDF 容量內且全部 ≤ 90m | k=1 |
| 孤島 AP（無候選點在 90m 內） | k++ 直到該 AP 有 dedicated IDF；若 k_max 仍失敗 → unassigned[] + warning |
| AP 全部同座標 | k=1, 無 warning |
| 緊密 cluster N > portsPerIdf | k = ceil(N / portsPerIdf), 多個 IDF 放在鄰近候選點 |
| Degenerate cluster（snap 後 IDF 無 AP 指派） | 該 IDF 標為 `unused: true`，從結果剔除 |
| `k_max` 達到仍 infeasible | 回傳 best-effort，`unassigned[]` 填入，給 warning |
| `existingIdfs.length > k_lower` | 直接以 existing 數量當 k 起跑；不會少於 existing |
| `existingIdfs.length > k_max` | warning「existing IDF 過多」，仍以 existing 為主 |

---

## 8. Existing IDF（Warm-start）

| 模式 | 預設 | 行為 |
|---|---|---|
| Fixed | ✅ | 既有 IDF 視為固定 centroid，不參與 k-means update；只補新的 |
| Optimize-move | ❌（進階選項） | 把既有當初始 seed，允許移動 |
| Clean-slate | ❌（比較模式） | 完全忽略既有，用於對照 |

UI 至少要有 Fixed / Clean-slate 兩種；Optimize-move 為 advanced toggle。

---

## 9. Complexity

| N | k 預期 | 計算量 | 預期時間（純 JS） |
|---|---|---|---|
| 50 | 3-5 | ~62 k distance ops × 8 restart ≈ 500 k | < 200 ms |
| 150 | 7-10 | ~750 k × 8 ≈ 6 M | 500 ms - 1 s |
| 300 | 15-20 | ~3.4 M × 8 ≈ 27 M | 2 - 5 s（**必須 Web Worker**） |

Final Dijkstra validation：每 AP 一次最短路徑查詢，視 tray graph 大小通常 < 500 ms。

**Hard caps**：
- `k_max = min(N, 30)`
- `MAX_ITER = 50` per k-means run
- `restartCount = 8` default（可由 options 調）
- UI 階段（25-3）：Worker timeout 10 s，超時 abort + 顯示 partial result

---

## 10. 不在本 spec 範圍

- **Physical placement validity beyond candidate snap**：演算法回傳 snapped IDF 位置；若使用者覺得不合理，由 UI 允許 drag adjust（25-3/25-4 範圍）
- **MDF recommendation**：本 spec 只建議 IDF；MDF 由使用者手動標記
- **Multi-floor optimization**：per-floor 各自跑；跨樓層 riser 共用未來再說
- **Redundancy / HA**：不考慮 single point of failure
- **Cable type 自動 fiber fallback**：超 90m 直接 hard fail；不在演算法內自動降級為 fiber

---

## 11. Open Items for 25-3 / 25-4

提到但不在 25-2 演算法本身解決：

- Web Worker 封裝 + progress callback + abort
- Modal UI（顯示建議結果 + Apply / Cancel / Re-run / Advanced toggle）
- Ghost preview 在畫布上的視覺（半透明 IDF + 連到 AP 的虛線）
- 候選點來源 = grid fallback 時的 warning banner
- Existing IDF 的 Fixed / Clean-slate 切換 UI
- Apply 時呼叫 useSwitchStore 寫入新 IDF（kind='idf', portCount=24, poeBudget=370, uplinkTo=null）

---

## 12. Review History

- 第一輪 spec：使用者 + handoff brief（2026-05-23）
- 第二輪外部 review：建議改 facility location；候選點來源限制；PoE 改 warning；random restart；目標函數排序；warm-start 三模式；Worker（2026-05-24）
- 拍板（2026-05-24）：
  - Q1 = C+（k-means seed → snap → **必須** reassign）
  - Q2 = `[switch, tray, grid]`，grid 帶 warning + 未來補 IDFCandidateZone
  - Q3 = 25-2 純函式 + restart wrapper，**25-3 必排 Worker**
  - Q4 = 目標函數排序如 §6

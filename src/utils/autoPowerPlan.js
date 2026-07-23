// HM-F4 — Greedy power planning with multi-start.
// 對指定樓層的一組 AP，調整 txPower 使得：
//   · scope 區域 RSSI ≥ targetRssiDbm 的格子比例最大化（coverage）
//   · 已覆蓋格子的 SINR 平均缺口最小化（quality）
//   · 死角（in-scope 中 RSSI 缺最深的尾巴）不被放棄（outlier）
//   · 不過量發射（excess）
//
// 演算法：3 個起點（max / mid / min txPower）× first-improvement 座標下降
// （步長排程 ±4 → ±2 → ±1 dB、輪轉掃描、同方向線搜尋）到收斂；取三起點
// 最小 cost 為解。粗 grid（gridStepM 預設 2.0 m）控成本。
//
// 為什麼不是 steepest descent：每接受 1 步先掃滿 2N 個候選挑最好，等於把
// 2N−1 次 evaluate 丟掉；first-improvement 遇到改善就接受，早期均攤 O(1)
// 次 evaluate 就走 1 步，總成本從 O(N³) 降到 ~O(N²)。代價是路徑不同、落在
// 略不同的局部最優（±1 dB 級），由三起點取最佳對沖。
//
// Scope clip：sampleField 對整張 plan 矩形取樣、不寫 NaN（scope 是 PIXI 端
// 的向量裁切），所以評分必須自己套 scopeMaskFn + plan 範圍 — 跟 planQuality
// 同款。in-scope 格子索引跨 evaluate 不變，建一次快取重複用。
//
// 評分（4 個獨立 loss term，每項 [0, 1]）：
//   gap_rssi(c) = max(0, targetRssi − rssi(c))   對所有 in-scope c
//   gap_sinr(c) = max(0, targetSinr − sinr(c))
//   covered     = { c : rssi(c) ≥ targetRssi }
//
//   L_coverage  = 1 − coverage                                        // 主：達標率
//   L_outlier   = clip(P95(gap_rssi over in-scope) / 20, 0, 1)         // 公平：別放棄死角
//   L_quality   = covered = ∅ → 1
//                 否則      → clip(mean(gap_sinr | covered) / 15, 0, 1) // 次：品質
//   L_excess    = clip(mean(max(0, tx − txReasonable)) / 10, 0, 1)     // 過量罰
//
//   cost = w1 L_coverage + w2 L_outlier + w3 L_quality + w4 L_excess
//          (預設 0.50 / 0.20 / 0.20 / 0.10，總和 = 1，cost ∈ [0, 1])
//
// 設計理由（為什麼這樣拆）：
//   · L_coverage 跟 L_quality 拆兩個獨立 term ─ 不能合成一個（會讓
//     greedy「放棄邊緣 cell 換 quality 變好」，反直覺解）。獨立後兩者梯度
//     正交：coverage 變動只影響 L_coverage、quality 變動只影響 L_quality。
//   · L_outlier 用 P95 而非 max ─ max 對單一極端死角過敏（被牆完全擋死的
//     cell 會永遠是 max → 整體被那一格綁架）；P95 抓「最差 5%」的趨勢。
//     用 in-scope 而非 covered 是關鍵：死角 *剛好* 不在 covered 集合內，
//     對 covered 取 P95 等於看不到死角，跟「別放棄死角」目標背道而馳。
//   · L_quality 在 covered=∅ 時設 1（最差） ─ 避免「沒覆蓋 = 品質沒問題」
//     的反直覺數值；min 起點全 0 dBm 起手也能被推離無覆蓋區。
//   · 每項都先正規化到 [0, 1] 再加權 ─ 權重才表達「優先序」而不是被各項
//     原始量級隨機放大。正規化常數的物理意義：
//       20 dB RSSI 缺 = 100× 訊號弱，視為「完全失敗」
//       15 dB SINR 缺 = MCS-7 (20 dB) 降到 5 dB，連線跑不動
//       10 dB tx_excess = AP 已打到接近頂
//
// 效能優化：
//   · scenario 只建一次（walls/corners/scope mask 不變）。
//   · evaluate 用一階傳播（反射/繞射關閉，同 planQuality）。
//   · per-AP 場快取 — rssiFromAp 對 txDbm 是純 dB 偏移（每條 path 都加
//     txDbm），所以 rssi(tx) = base(tx=0) + tx *精確*成立。把每顆 AP 的
//     基準場對 in-scope 格子算一次存起來，之後每次 evaluate 只做
//     「平移 + aggregate」：單次成本從 O(格子 × N × 牆段) 掉到
//     O(格子 × N)，整體搜尋從 O(N³·牆段) 降為 O(N³)（射線追蹤只跑
//     建快取那一次）。

import { buildScenario } from '@/features/heatmap/buildScenario'
import { rssiFromAp, aggregateApContributions } from '@/features/heatmap/propagation'
import {
  getAPModelById,
  getDefaultTxPower,
  DEFAULT_AP_MODEL_ID,
} from '@/constants/apModels'

const DEFAULTS = {
  targetRssiDbm: -65,    // RSSI 覆蓋目標：≥ 此值算「已覆蓋」
  targetSinrDb: 20,      // SINR 品質目標：≥ 此值算「夠用」(MCS-7 5G 80MHz)
  gridStepM: 2.0,        // 評分用的粗 grid 解析度
  maxIter: null,         // 接受步數上限；null → max(40, 12 × N_planned)。
                         // 上限必須隨 AP 數縮放，否則 AP 多時三個起點都會
                         // 在收斂前被截斷（步長排程下通常遠早於此收斂）。
  stepSchedule: [4, 2, 1],  // 粗到細步長：先 ±4 dB 大步逼近、±1 dB 收尾
  txMinDbm: 0,

  // Cost weights (sum = 1 → cost ∈ [0, 1] → qualityScore = 100 × (1 − cost))
  wCoverage: 0.50,
  wOutlier:  0.20,
  wQuality:  0.20,
  wExcess:   0.10,

  // Normalization caps (in dB) — see header comment for physical meaning.
  rssiGapCap: 20,
  sinrGapCap: 15,
  excessCap:  10,
}

// Per-band reasonable-tx headroom & clamps. txReasonable = clamp(maxTxPower − 6,
// minReasonableTx, maxReasonableTx). The minimum is band-aware: at 6 GHz a
// "modest" AP is naturally weaker than 2.4 GHz, so the floor differs.
const TX_REASONABLE_HEADROOM_DB = 6
const MIN_REASONABLE_TX = { 2.4: 12, 5: 12, 6: 10 }
const MAX_REASONABLE_TX = { 2.4: 22, 5: 22, 6: 20 }

function txReasonableFor(ap) {
  const model = getAPModelById(ap.modelId ?? DEFAULT_AP_MODEL_ID)
  const band = ap.frequency
  const maxTx = model.maxTxPower[band] ?? 23
  const lo = MIN_REASONABLE_TX[band] ?? 12
  const hi = MAX_REASONABLE_TX[band] ?? 22
  return Math.max(lo, Math.min(hi, maxTx - TX_REASONABLE_HEADROOM_DB))
}

// 取得每顆 AP 的 tx 上限 (依 model + 當前 frequency)。
function maxTxFor(ap) {
  const model = getAPModelById(ap.modelId ?? DEFAULT_AP_MODEL_ID)
  return model.maxTxPower[ap.frequency] ?? 23
}

// 建立 scenario 一次（walls / corners / scope mask 不會隨 tx 改變）。
// 回傳 { scenario, baseAps } — baseAps 是 scenario.aps 同序的快照。
function buildBaseScenario(floor, walls, aps, scopes) {
  const scenario = buildScenario(floor, walls, aps, scopes, null)
  if (!scenario) return null
  // scenario.aps 跟 aps 同序（buildScenario 走 map）。保留參考供 evaluate 改 txDbm。
  return { scenario, baseAps: scenario.aps }
}

// nth-percentile (0..1) on an in-place sortable array. Uses linear-interp
// between adjacent samples for stability with small n.
function percentile(sortedArr, p) {
  const n = sortedArr.length
  if (n === 0) return 0
  if (n === 1) return sortedArr[0]
  const idx = p * (n - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedArr[lo]
  const frac = idx - lo
  return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac
}

const clip01 = (x) => Math.max(0, Math.min(1, x))

// 一階傳播就好：反射/繞射對 ±1 dB greedy 的「候選排序」影響有限，
// 關掉可把單次 evaluate 壓低數倍（同 planQuality 的取捨）。
const EVAL_FIELD_OPTS = { maxReflOrder: 0, enableDiffraction: false }

// Per-AP 場快取（存在 baseScenario 上，三個起點共用）。
//
// 格子：自己 clip in-scope — scope 是 PIXI sprite 端的向量裁切，引擎端
// 取樣不會排除 scope 外格子（同 planQuality 的做法）：(1) 丟掉 grid「+1」
// 出界的尾列/欄，(2) 丟掉 scope 外格子。
//
// 場：每顆 AP 對每個 in-scope 格子存 tx=0 dBm 的基準 RSSI。rssiFromAp 的
// 每條 path 都以 txDbm 作 dB 偏移 → rssi(tx) = base + tx 精確成立，
// 之後 evaluate 完全不再做射線追蹤。
// 記憶體：cells × N × 4 bytes（50 AP × ~650 格 ≈ 130 KB）。
function ensureFieldCache(baseScenario, opts) {
  if (baseScenario.fieldCache) return baseScenario.fieldCache
  const { scenario, baseAps } = baseScenario
  const step = opts.gridStepM
  const { w, h } = scenario.size
  const nx = Math.ceil(w / step) + 1
  const ny = Math.ceil(h / step) + 1
  const maskFn = scenario.scopeMaskFn ?? (() => true)
  const rxZM = scenario.rxElevationM ?? 0
  const propOpts = { ...EVAL_FIELD_OPTS, floorBoundaries: scenario.floorBoundaries ?? null }
  const nAps = baseAps.length

  const xs = []
  const ys = []
  for (let j = 0; j < ny; j++) {
    const y = j * step
    if (y > h) continue
    for (let i = 0; i < nx; i++) {
      const x = i * step
      if (x > w) continue
      if (!maskFn(x, y)) continue
      xs.push(x)
      ys.push(y)
    }
  }
  const cellCount = xs.length

  const base = new Float32Array(cellCount * nAps)
  const savedTx = baseAps.map((a) => a.txDbm)
  for (const a of baseAps) a.txDbm = 0
  for (let k = 0; k < cellCount; k++) {
    const rx = { x: xs[k], y: ys[k], zM: rxZM }
    const off = k * nAps
    for (let i = 0; i < nAps; i++) {
      base[off + i] = rssiFromAp(baseAps[i], rx, scenario.walls, scenario.corners, propOpts).rssiDbm
    }
  }
  for (let i = 0; i < nAps; i++) baseAps[i].txDbm = savedTx[i]

  baseScenario.fieldCache = {
    cellCount,
    base,
    // 每次 evaluate 重複使用的暫存（避免熱迴圈裡配置）。
    txArr: new Float64Array(nAps),
    perAp: new Float64Array(nAps),
    gapRssiArr: new Float64Array(cellCount),
  }
  return baseScenario.fieldCache
}

// 給定 baseScenario + tx override map 評分（快取場 + tx 平移，零射線追蹤）。
// 回傳 { cost, terms, coverage, sampledCells } — terms 是四項細節給 UI 用。
function evaluate(baseScenario, aps, txMap, opts) {
  const { baseAps } = baseScenario
  const cache = ensureFieldCache(baseScenario, opts)
  const { cellCount, base, txArr, perAp, gapRssiArr } = cache
  const nAps = baseAps.length
  // txMap 涵蓋全部 AP（規劃中 + 固定），依 scenario.aps 同序展開。
  for (let i = 0; i < nAps; i++) {
    const tx = txMap.get(aps[i].id)
    txArr[i] = tx != null ? tx : baseAps[i].txDbm
  }

  // Single pass: accumulate gap_rssi (for in-scope), gap_sinr (for covered),
  // covered count, and a gap_rssi array for P95.
  let inScope = 0
  let covered = 0
  let gapSinrCoveredSum = 0
  for (let k = 0; k < cellCount; k++) {
    const off = k * nAps
    for (let i = 0; i < nAps; i++) perAp[i] = base[off + i] + txArr[i]
    const agg = aggregateApContributions(perAp, baseAps)
    const r = agg.rssiDbm
    if (Number.isNaN(r)) continue
    const gapR = Math.max(0, opts.targetRssiDbm - r)
    gapRssiArr[inScope] = gapR
    inScope++
    if (r >= opts.targetRssiDbm) {
      covered++
      const gapS = Math.max(0, opts.targetSinrDb - agg.sinrDb)
      gapSinrCoveredSum += gapS
    }
  }
  if (inScope === 0) {
    return {
      cost: Infinity,
      terms: { L_coverage: 1, L_outlier: 1, L_quality: 1, L_excess: 0 },
      coverage: 0,
      sampledCells: 0,
    }
  }

  const coverage = covered / inScope
  const L_coverage = 1 - coverage

  // P95 of gap_rssi over all in-scope cells (covers death corners that fell
  // outside `covered` — those are exactly what L_outlier needs to flag).
  // gapRssiArr 是重複使用的暫存，只有前 inScope 格有效 — sort 子區段就好
  // （subarray 共用 buffer，原地排序）。
  const validGaps = gapRssiArr.subarray(0, inScope)
  validGaps.sort()
  const p95Gap = percentile(validGaps, 0.95)
  const L_outlier = clip01(p95Gap / opts.rssiGapCap)

  // Quality: ∅ covered → 1 (worst), avoids "no coverage = good quality" trap.
  const L_quality = covered === 0
    ? 1
    : clip01((gapSinrCoveredSum / covered) / opts.sinrGapCap)

  // Excess: mean per-AP (tx − reasonable)+ across the *planned* APs only.
  // txMap 涵蓋全部 AP（未規劃者也有 fixed tx），若不用 planSet 過濾，
  // 選子集規劃時罰則分母會被未規劃 AP 灌水、稀釋掉過量訊號。
  let excessSum = 0
  let apsConsidered = 0
  for (const ap of aps) {
    if (opts.planSet && !opts.planSet.has(ap.id)) continue
    const tx = txMap.get(ap.id)
    if (tx == null) continue
    const reasonable = txReasonableFor(ap)
    excessSum += Math.max(0, tx - reasonable)
    apsConsidered++
  }
  const L_excess = apsConsidered === 0
    ? 0
    : clip01((excessSum / apsConsidered) / opts.excessCap)

  const cost = opts.wCoverage * L_coverage
             + opts.wOutlier  * L_outlier
             + opts.wQuality  * L_quality
             + opts.wExcess   * L_excess

  return {
    cost,
    terms: { L_coverage, L_outlier, L_quality, L_excess },
    coverage,
    sampledCells: inScope,
  }
}

// 對單一起點跑 first-improvement 座標下降。txMap 會被原地更新。
//
// 三個機制疊在一起（見檔頭說明）：
//   · 步長排程：stepSchedule 由粗到細，每個步長跑到「一整輪無改善」才換細。
//   · first-improvement：候選一有改善立刻接受，不掃滿全場挑最好。
//   · 線搜尋：接受某顆 AP 的 ±delta 後沿同方向繼續推到不再改善，
//     需要大調的 AP 一次走完，不用等下一輪。
//   · 輪轉掃描：每輪的起始 AP 輪轉，避免固定順序讓排前面的 AP 永遠優先。
// 全程決定性（無隨機），同輸入必得同輸出。
// stats（in/out 共用）：累計本次起點的 evaluate 次數 + 耗時。
async function greedyFromStart(baseScenario, aps, apsToPlan, txMap, opts, onProgress, stats) {
  const t0 = performance.now()
  let best = evaluate(baseScenario, aps, txMap, opts)
  stats.startEvals++
  const n = apsToPlan.length
  let accepted = 0
  let sweepCount = 0

  // 每 8 次 evaluate 回報一次進度（worker 內 postMessage；也是中止檢查點）。
  const tick = async (phase) => {
    if (!onProgress) return true
    updateMsPerEvalEma(stats)
    const cont = await onProgress({
      iter: accepted,
      cost: best.cost,
      coverage: best.coverage,
      terms: best.terms,
      phase,
      elapsedMs: performance.now() - stats.startedAt,
      etaMs: estimateEtaMs(stats),
    })
    return cont !== false
  }

  outer:
  for (const stepSize of opts.stepSchedule) {
    while (accepted < opts.maxIter) {
      let improvedInSweep = false
      const offset = sweepCount % n
      sweepCount++
      for (let k = 0; k < n; k++) {
        const ap = apsToPlan[(k + offset) % n]
        const maxTx = maxTxFor(ap)
        for (const delta of [+stepSize, -stepSize]) {
          let moved = false
          // 線搜尋：同方向推到不再改善（最後一次失敗的 evaluate 是停損成本）。
          for (;;) {
            const cur = txMap.get(ap.id)
            const next = cur + delta
            if (next < opts.txMinDbm || next > maxTx) break
            txMap.set(ap.id, next)
            const score = evaluate(baseScenario, aps, txMap, opts)
            stats.startEvals++
            const improved = score.cost < best.cost - 1e-9
            if (improved) {
              best = score
              accepted++
              improvedInSweep = true
              moved = true
            } else {
              txMap.set(ap.id, cur)  // 還原
            }
            if (stats.startEvals % 8 === 0) {
              if (!(await tick(improved ? 'step' : 'searching'))) {
                return { ...best, aborted: true }
              }
            }
            if (!improved || accepted >= opts.maxIter) break
          }
          if (moved) break  // 這顆已沿一個方向走到底，換下一顆 AP
        }
      }
      if (!improvedInSweep) break  // 此步長收斂 → 換更細步長
      if (accepted >= opts.maxIter) break outer
    }
  }
  // Record this start's total cost for ETA calibration on later starts.
  stats.startEndedAt = performance.now()
  stats.lastStartMs = stats.startEndedAt - t0
  stats.lastStartEvals = stats.startEvals
  // Track the max evaluate count we've seen across completed starts. Apply a
  // 30% headroom so a slightly slower next start doesn't immediately blow
  // past the budget and force the live-bump branch on every progress tick.
  const HEADROOM = 1.3
  const seen = Math.ceil(stats.startEvals * HEADROOM)
  if (seen > (stats.expectedStartEvals ?? 0)) {
    stats.expectedStartEvals = seen
  }
  return best
}

// EMA on per-evaluate cost. Snapshot total elapsed / total evaluates each
// progress tick; let alpha smooth out short-term jitter. Called inside the
// progress wrapper in runAutoPowerPlan below.
function updateMsPerEvalEma(stats) {
  const now = performance.now()
  const totalEvals = stats.cumulativeEvals + stats.startEvals
  if (totalEvals <= 0) return
  const elapsed = now - stats.startedAt
  const sample = elapsed / totalEvals
  const alpha = 0.2
  stats.msPerEvalEma = stats.msPerEvalEma == null
    ? sample
    : (1 - alpha) * stats.msPerEvalEma + alpha * sample
}

// ETA 估算（per-evaluate model）：
//
// 舊版用「上一個起點的總耗時」當每起點預期成本，問題是 max/mid/min 三起點
// 的收斂速度差異很大（min 通常比 max 慢 ~2×），切換起點瞬間 ETA 大幅跳動。
//
// 新版用兩個指標：
//   (a) msPerEvalEma — 每次 evaluate 平均耗時，EMA(α=0.2) 平滑跨起點
//   (b) expectedStartEvals — 後續起點預期 evaluate 數的上界
//
// expectedStartEvals 兩條動態擴展，避免「ETA 倒數到 0 → 又跳回 12 秒」：
//   1. 起點完成後 → max(seen, headroom × seen)，給 30% buffer 避免下一個
//      起點稍慢就突破上界
//   2. 當前起點 startEvals 已超過上界 → 當場提升為「當前 evals × 1.2」，
//      讓 ETA 在起點末尾平滑遞減而不是 clamp 到 0 後突然回升
//
// 起點 1 期間沒有 expectedStartEvals 樣本 → 回傳 null（顯示「校準中…」）。
function estimateEtaMs(stats) {
  if (stats.startsCompleted === 0) return null
  if (!stats.expectedStartEvals || !stats.msPerEvalEma) return null

  // Dynamic upper-bound bump: if the current start has already eaten through
  // the expected budget, bump expectation to "current + 20%" so the user
  // sees a smoothly extending ETA instead of "5s remaining" stuck while the
  // search keeps churning, then a sudden jump to "12s remaining".
  const liveBudget = stats.startEvals > stats.expectedStartEvals
    ? Math.ceil(stats.startEvals * 1.2)
    : stats.expectedStartEvals

  const startsRemaining = stats.totalStarts - stats.startsCompleted - 1
  const currentRemaining = Math.max(0, liveBudget - stats.startEvals)
  const evalsLeft = startsRemaining * liveBudget + currentRemaining
  return stats.msPerEvalEma * evalsLeft
}

// 主入口。回傳 { txMapBest, score } 或 { aborted: true }。
//
// floor / walls / aps / scopes：當前樓層完整資料（單樓層模式）。
// apIdsToPlan：要規劃的 AP id 子集；其餘 AP 維持原 txPower 但仍納入 scenario。
// userOpts：覆蓋 DEFAULTS。
// onProgress(state)：每次接受 step 後呼叫；回傳 false 可中止。
export async function runAutoPowerPlan({
  floor,
  walls,
  aps,
  scopes,
  apIdsToPlan,
  userOpts = {},
  onProgress = null,
}) {
  const opts = { ...DEFAULTS, ...userOpts }
  const planSet = new Set(apIdsToPlan)
  const apsToPlan = aps.filter((a) => planSet.has(a.id))
  if (apsToPlan.length === 0) {
    return { aborted: false, error: 'no-aps', txMap: null, score: null }
  }
  opts.planSet = planSet
  // 每次迭代只動 1 顆 AP ±1 dB → 步數上限得隨 AP 數縮放（12 步/AP 足夠
  // 從 max 起點降到典型工作點；收斂了會提早 break，寬鬆無害）。
  opts.maxIter = opts.maxIter ?? Math.max(40, 12 * apsToPlan.length)

  // 三個起點：max / mid / min。walls / corners / scope 不隨 tx 改變 —
  // baseScenario（含 in-scope 格子快取）建一次、三個起點共用。
  const baseScenario = buildBaseScenario(floor, walls, aps, scopes)
  if (!baseScenario) {
    return { aborted: false, error: 'invalid-floor', txMap: null, score: null }
  }

  const starts = ['max', 'mid', 'min']
  let bestTxMap = null
  let bestScore = null

  // ETA 校準狀態（跨 starts 累積）。
  const stats = {
    totalStarts: starts.length,
    startsCompleted: 0,
    startedAt: performance.now(),
    startEvals: 0,         // 當前起點累計 evaluate 次數
    cumulativeEvals: 0,    // 已完成起點的 evaluate 總和
    lastStartMs: 0,        // 上一個起點總耗時（向後相容，目前沒人讀）
    lastStartEvals: 0,
    expectedStartEvals: 0, // 後續起點預期 evaluate 數上界（含 headroom）
    msPerEvalEma: null,    // 每次 evaluate 平均耗時（EMA 平滑）
  }

  for (let s = 0; s < starts.length; s++) {
    const startKind = starts[s]
    const txMap = new Map()
    for (const a of aps) {
      if (planSet.has(a.id)) {
        const maxTx = maxTxFor(a)
        const tx = startKind === 'max' ? maxTx
                 : startKind === 'min' ? opts.txMinDbm
                 : Math.round((maxTx + opts.txMinDbm) / 2)
        txMap.set(a.id, tx)
      } else {
        // 未規劃 AP 維持現值；fallback 要跟 buildScenario 同源（per-band
        // 預設，47-12），否則 txPower 未設的 AP 會被模擬成跟實際熱圖不同的功率。
        txMap.set(a.id, a.txPower ?? getDefaultTxPower(a.frequency ?? 5))
      }
    }
    stats.startEvals = 0  // reset per start
    const score = await greedyFromStart(
      baseScenario, aps, apsToPlan, txMap, opts,
      onProgress
        ? (st) => onProgress({ ...st, startIdx: s, totalStarts: starts.length, startKind })
        : null,
      stats,
    )
    if (score.aborted) return { aborted: true, txMap: null, score: null }
    if (bestScore == null || score.cost < bestScore.cost) {
      bestScore = score
      bestTxMap = new Map(txMap)
    }
    // Roll the just-finished start's evaluate count into the cumulative
    // counter so msPerEval EMA stays accurate after we reset startEvals=0
    // for the next start.
    stats.cumulativeEvals += stats.startEvals
    stats.startsCompleted++
  }

  return { aborted: false, txMap: bestTxMap, score: bestScore, opts }
}

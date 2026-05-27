// HM-F4 — Greedy power planning with multi-start.
// 對指定樓層的一組 AP，調整 txPower 使得：
//   · scope 區域 RSSI ≥ targetRssiDbm 的格子比例最大化（coverage）
//   · 已覆蓋格子的 SINR 平均缺口最小化（quality）
//   · 死角（in-scope 中 RSSI 缺最深的尾巴）不被放棄（outlier）
//   · 不過量發射（excess）
//
// 演算法：3 個起點（max / mid / min txPower）× greedy ±1 dB 迭代到收斂；
// 取三起點最小 cost 為解。粗 grid（gridStepM 預設 2.0 m）控成本。
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
// 效能優化：scenario 只建一次（walls/corners/scope mask 不變），每次 evaluate
// 只 rebuild aps 陣列的 txDbm。

import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleField } from '@/features/heatmap/sampleField'
import { getAPModelById, DEFAULT_AP_MODEL_ID } from '@/constants/apModels'

const DEFAULTS = {
  targetRssiDbm: -65,    // RSSI 覆蓋目標：≥ 此值算「已覆蓋」
  targetSinrDb: 20,      // SINR 品質目標：≥ 此值算「夠用」(MCS-7 5G 80MHz)
  gridStepM: 2.0,        // 評分用的粗 grid 解析度
  maxIter: 50,
  txStep: 1,             // 每輪 ±1 dB
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

// 給定 baseScenario + tx override map，更新 ap.txDbm 並評分。
// 回傳 { cost, terms, coverage, sampledCells } — terms 是四項細節給 UI 用。
function evaluate(baseScenario, aps, txMap, opts) {
  const { scenario, baseAps } = baseScenario
  // 直接 mutate scenario.aps 的 txDbm（每次評分都重設，無 leak）。
  for (let i = 0; i < aps.length; i++) {
    const tx = txMap.get(aps[i].id)
    if (tx != null) baseAps[i].txDbm = tx
  }
  const field = sampleField(scenario, opts.gridStepM)
  const { rssi, sinr, nx, ny } = field
  const len = nx * ny

  // Single pass: accumulate gap_rssi (for in-scope), gap_sinr (for covered),
  // covered count, and a gap_rssi array for P95.
  const gapRssiArr = []
  let inScope = 0
  let covered = 0
  let gapSinrCoveredSum = 0
  for (let i = 0; i < len; i++) {
    const r = rssi[i]
    if (Number.isNaN(r)) continue
    inScope++
    const gapR = Math.max(0, opts.targetRssiDbm - r)
    gapRssiArr.push(gapR)
    if (r >= opts.targetRssiDbm) {
      covered++
      const gapS = Math.max(0, opts.targetSinrDb - sinr[i])
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
  gapRssiArr.sort((a, b) => a - b)
  const p95Gap = percentile(gapRssiArr, 0.95)
  const L_outlier = clip01(p95Gap / opts.rssiGapCap)

  // Quality: ∅ covered → 1 (worst), avoids "no coverage = good quality" trap.
  const L_quality = covered === 0
    ? 1
    : clip01((gapSinrCoveredSum / covered) / opts.sinrGapCap)

  // Excess: mean per-AP (tx − reasonable)+ across the AP set we're modeling.
  // Use the *modeled* APs (entries in txMap); APs outside txMap aren't being
  // optimized so their tx isn't our problem.
  let excessSum = 0
  let apsConsidered = 0
  for (const ap of aps) {
    if (!txMap.has(ap.id)) continue
    const tx = txMap.get(ap.id)
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

// 對單一起點跑 greedy。txMap 會被原地更新。
// stats（in/out 共用）：累計本次起點的 evaluate 次數 + 耗時。
async function greedyFromStart(baseScenario, aps, apsToPlan, txMap, opts, onProgress, stats) {
  const t0 = performance.now()
  let best = evaluate(baseScenario, aps, txMap, opts)
  stats.startEvals++
  for (let iter = 0; iter < opts.maxIter; iter++) {
    let bestApId = null
    let bestDelta = 0
    let bestCost = best.cost
    let bestSnapshot = null
    // 對每顆 AP 試 +1 / -1 取最大改善。每若干 candidate 讓出一次 main thread。
    for (const ap of apsToPlan) {
      const cur = txMap.get(ap.id)
      const maxTx = maxTxFor(ap)
      for (const delta of [+opts.txStep, -opts.txStep]) {
        const next = cur + delta
        if (next < opts.txMinDbm || next > maxTx) continue
        txMap.set(ap.id, next)
        const score = evaluate(baseScenario, aps, txMap, opts)
        stats.startEvals++
        if (score.cost < bestCost - 1e-9) {
          bestCost = score.cost
          bestApId = ap.id
          bestDelta = delta
          bestSnapshot = score
        }
        // 還原
        txMap.set(ap.id, cur)
        // 每 8 次 evaluate 讓出 main thread 一次，避免 UI 卡死。
        if (onProgress && stats.startEvals % 8 === 0) {
          updateMsPerEvalEma(stats)
          const cont = await onProgress({
            iter,
            cost: best.cost,
            coverage: best.coverage,
            terms: best.terms,
            phase: 'searching',
            elapsedMs: performance.now() - stats.startedAt,
            etaMs: estimateEtaMs(stats),
          })
          if (cont === false) return { ...best, aborted: true }
        }
      }
    }
    if (bestApId == null) break  // 收斂
    txMap.set(bestApId, txMap.get(bestApId) + bestDelta)
    best = bestSnapshot
    if (onProgress) {
      updateMsPerEvalEma(stats)
      const cont = await onProgress({
        iter: iter + 1,
        cost: best.cost,
        coverage: best.coverage,
        terms: best.terms,
        phase: 'step',
        elapsedMs: performance.now() - stats.startedAt,
        etaMs: estimateEtaMs(stats),
      })
      if (cont === false) return { ...best, aborted: true }
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

  // 三個起點：max / mid / min。每個起點重建一次 baseScenario（greedy 期間共用）。
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
        txMap.set(a.id, a.txPower ?? 20)
      }
    }
    const baseScenario = buildBaseScenario(floor, walls, aps, scopes)
    if (!baseScenario) {
      return { aborted: false, error: 'invalid-floor', txMap: null, score: null }
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

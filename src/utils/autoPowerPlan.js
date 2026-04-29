// HM-F4 — Greedy power planning with multi-start.
// 對指定樓層的一組 AP，調整 txPower 使得：
//   · scope 區域 RSSI ≥ targetRssiDbm 的格子比例最大化（coverage）
//   · scope 區域 SINR < targetSinrDb 的格子比例最小化（sinrShortfall）
//
// 評分：cost = (1 − coverage) + sinrWeight × sinrShortfall
//   - 主目標：訊號夠強（RSSI ≥ target）
//   - 副目標：訊號相對干擾夠強（SINR ≥ target，能跑得動 MCS）
//   - 權重 sinrWeight 預設 0.2：副目標不該主導，避免把 AP 壓得太低犧牲覆蓋
//
// 為什麼用 SINR 不用 CCI：CCI 只是干擾絕對強度，並沒考慮跟訊號的相對關係。
// 在同頻場景中 CCI 幾乎無處不在（cciRatio ≈ 1.0），會主導 cost；改用 SINR
// 直接看「能不能用」，跟 client 體驗強相關。
//
// 演算法：3 個起點（max / mid / min txPower）× greedy ±1 dB 迭代到收斂；
// 取三起點最小 cost 為解。粗 grid（gridStepM 預設 2.0 m）控成本。
//
// 效能優化：scenario 只建一次（walls/corners/scope mask 不變），每次 evaluate
// 只 rebuild aps 陣列的 txDbm。

import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleField } from '@/features/heatmap/sampleField'
import { getAPModelById, DEFAULT_AP_MODEL_ID } from '@/constants/apModels'

const DEFAULTS = {
  targetRssiDbm: -65,    // RSSI 覆蓋目標：≥ 此值算「已覆蓋」
  targetSinrDb: 20,      // SINR 品質目標：≥ 此值算「夠用」(MCS-7 5G 80MHz)
  sinrWeight: 0.2,       // SINR shortfall penalty 相對 coverage penalty 的權重
  gridStepM: 2.0,        // 評分用的粗 grid 解析度
  maxIter: 50,
  txStep: 1,             // 每輪 ±1 dB
  txMinDbm: 0,
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

// 給定 baseScenario + tx override map，更新 ap.txDbm 並評分。
// 回傳 { cost, coverage, sinrShortfall, sampledCells }。
function evaluate(baseScenario, aps, txMap, opts) {
  const { scenario, baseAps } = baseScenario
  // 直接 mutate scenario.aps 的 txDbm（每次評分都重設，無 leak）。
  for (let i = 0; i < aps.length; i++) {
    const tx = txMap.get(aps[i].id)
    if (tx != null) baseAps[i].txDbm = tx
  }
  const field = sampleField(scenario, opts.gridStepM)
  const { rssi, sinr, nx, ny } = field
  let inScope = 0, covered = 0, sinrLow = 0
  const len = nx * ny
  for (let i = 0; i < len; i++) {
    const r = rssi[i]
    if (Number.isNaN(r)) continue   // out-of-scope
    inScope++
    if (r >= opts.targetRssiDbm) covered++
    // SINR shortfall 只算「已覆蓋但 SINR 不夠」的 cells —— 訊號都收不到就不算數。
    if (r >= opts.targetRssiDbm && sinr[i] < opts.targetSinrDb) sinrLow++
  }
  if (inScope === 0) return { cost: Infinity, coverage: 0, sinrShortfall: 1, sampledCells: 0 }
  const coverage = covered / inScope
  const sinrShortfall = sinrLow / inScope
  // 越低越好；coverage shortfall 為主、sinrShortfall 為次。
  const cost = (1 - coverage) + opts.sinrWeight * sinrShortfall
  return { cost, coverage, sinrShortfall, sampledCells: inScope }
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
            iter, cost: best.cost, coverage: best.coverage, sinrShortfall: best.sinrShortfall,
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
        iter: iter + 1, cost: best.cost, coverage: best.coverage, sinrShortfall: best.sinrShortfall,
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

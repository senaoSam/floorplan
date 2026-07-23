// HM-F9 — autoPowerPlan in a Web Worker.
//
// Runs the greedy multi-start search off the main thread so the UI stays
// responsive (modal progress, scrolling) during long plans.
//
// Message protocol (main → worker):
//   { type: 'run', payload: { floor, walls, aps, scopes, apIdsToPlan, userOpts } }
//
// Message protocol (worker → main):
//   { type: 'progress', state: { ...iter info, elapsedMs, etaMs } }
//   { type: 'done',     result: { aborted, error?, txMapEntries?, score?, opts? } }
//   { type: 'error',    message }
//
// 取消：主線程直接 worker.terminate()。greedy 全程是一條同步 microtask 鏈，
// worker 的 event loop 跑完前不會處理任何 message —— in-band 'cancel' 訊息
// 會被餓死到規劃結束才送達，等於無效，所以不提供。
//
// scopeMaskFn (a closure inside the scenario) cannot cross postMessage, so we
// re-import buildScenario inside the worker and rebuild the scenario from raw
// floor/walls/aps/scopes here. txMap is serialized as entries array.

import { runAutoPowerPlan } from '@/utils/autoPowerPlan'

self.addEventListener('message', async (e) => {
  const msg = e.data
  if (!msg || msg.type !== 'run') return

  try {
    const { floor, walls, aps, scopes, apIdsToPlan, userOpts } = msg.payload
    const r = await runAutoPowerPlan({
      floor,
      walls,
      aps,
      scopes,
      apIdsToPlan,
      userOpts,
      onProgress: (st) => {
        self.postMessage({ type: 'progress', state: st })
        return true
      },
    })
    // Map cannot be cloned via structured clone for our use here (works for
    // simple Maps but we also need to be defensive) — convert to entries.
    // opts 帶回 UI 前先剝掉 planSet（Set 進 structured clone 沒問題，但 UI
    // 用不到且徒增 payload）。
    const { planSet: _planSet, ...optsOut } = r.opts ?? {}
    const out = {
      aborted: r.aborted,
      error: r.error ?? null,
      txMapEntries: r.txMap ? Array.from(r.txMap.entries()) : null,
      score: r.score ?? null,
      opts: r.opts ? optsOut : null,
    }
    self.postMessage({ type: 'done', result: out })
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) })
  }
})

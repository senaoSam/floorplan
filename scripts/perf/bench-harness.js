// Installed via browser_evaluate. Lives on window.__bench.
// All scenario fns return { name, dataUrl } where dataUrl is "data:image/png;base64,...".
// Caller (MCP) writes that to .playwright-mcp/perf-{before,after}/<name>.png.
//
// Why batchDraw() everywhere: react-konva's commit batches Konva updates via
// requestAnimationFrame. setState → React commit → react-konva queues redraw
// → next frame. If we read stage.toDataURL() too early we capture the stale
// canvas pixels (selection ring missing, etc). flush() forces both a layer
// redraw AND another rAF tick so the GPU has actually pushed pixels.

window.__bench = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const twoRafs = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const stage = () => window.Konva?.stages?.[0] ?? null
  const flush = async () => {
    await twoRafs()
    const s = stage(); if (s) s.batchDraw()
    await twoRafs()
  }
  const stageDataURL = () => {
    const s = stage()
    if (!s) throw new Error('no stage')
    s.batchDraw()
    return s.toDataURL({ pixelRatio: 1, mimeType: 'image/png' })
  }

  const clickByText = (re) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => re.test(x.textContent || ''))
    if (!b) throw new Error('no button matching ' + re)
    b.click(); return b
  }

  // Reset viewport to a canonical position so panning between scenarios doesn't poison diffs.
  const resetViewport = () => {
    const s = stage(); if (!s) return
    s.position({ x: 0, y: 0 }); s.scale({ x: 1, y: 1 }); s.batchDraw()
  }

  // Wait until two consecutive frames yield identical pixels.
  const waitForStable = async (timeoutMs = 8000, intervalMs = 250) => {
    const start = performance.now(); let prev = ''
    while (performance.now() - start < timeoutMs) {
      await flush()
      const cur = stageDataURL()
      if (cur === prev && cur.length > 0) return true
      prev = cur
      await sleep(intervalMs)
    }
    return false
  }

  const snap = async (name) => {
    await waitForStable()
    await flush()
    return { name, dataUrl: stageDataURL() }
  }

  // ---- Scenario primitives ---------------------------------------------------

  const ensureDemo = async () => {
    let waited = 0
    while (waited < 12000) {
      const apMod = await import('/floorplan/src/store/useAPStore.js')
      const total = Object.values(apMod.useAPStore.getState().apsByFloor).reduce((a, v) => a + v.length, 0)
      if (total > 0) return
      try { clickByText(/載入 Demo/) } catch {}
      await sleep(800); waited += 800
    }
    throw new Error('demo load timed out')
  }

  const setStress = async (n) => {
    const b = Array.from(document.querySelectorAll('button.stress-loader__btn'))
      .find((x) => x.textContent.trim().startsWith(String(n)))
    if (!b) throw new Error('no stress btn ' + n)
    b.click(); await sleep(500); await waitForStable()
  }

  const setHeatmap = async (on) => {
    const m = await import('/floorplan/src/store/useHeatmapStore.js')
    m.useHeatmapStore.getState().setEnabled(on)
    await sleep(400); await waitForStable()
  }

  const selectFirstAp = async () => {
    const apMod = await import('/floorplan/src/store/useAPStore.js')
    const fMod = await import('/floorplan/src/store/useFloorStore.js')
    const eMod = await import('/floorplan/src/store/useEditorStore.js')
    const fid = fMod.useFloorStore.getState().activeFloorId
    const ap = apMod.useAPStore.getState().apsByFloor[fid]?.[0]
    if (!ap) return
    eMod.useEditorStore.getState().setSelected(ap.id, 'ap')
    await flush(); await sleep(150); await flush()
  }

  const clearSelection = async () => {
    const eMod = await import('/floorplan/src/store/useEditorStore.js')
    eMod.useEditorStore.getState().clearSelected()
    await flush(); await sleep(150); await flush()
  }

  // ---- Scenarios -------------------------------------------------------------

  const scenarios = {
    async '01-blank'() { resetViewport(); return snap('01-blank') },
    async '02-demo-5ap'() { await ensureDemo(); await clearSelection(); resetViewport(); return snap('02-demo-5ap') },
    async '03-demo-5ap-selected'() { await ensureDemo(); await selectFirstAp(); resetViewport(); return snap('03-demo-5ap-selected') },
    async '04-stress-50ap'() { await ensureDemo(); await clearSelection(); await setStress(50); resetViewport(); return snap('04-stress-50ap') },
    async '05-stress-150ap'() { await ensureDemo(); await clearSelection(); await setStress(150); resetViewport(); return snap('05-stress-150ap') },
    async '06-stress-300ap'() { await ensureDemo(); await clearSelection(); await setStress(300); resetViewport(); return snap('06-stress-300ap') },
    async '07-stress-300ap-hm-off'() { await ensureDemo(); await clearSelection(); await setStress(300); await setHeatmap(false); resetViewport(); const out = await snap('07-stress-300ap-hm-off'); await setHeatmap(true); return out },
    async '08-stress-300ap-selected'() { await ensureDemo(); await setStress(300); await selectFirstAp(); resetViewport(); return snap('08-stress-300ap-selected') },
  }

  return { scenarios, list: () => Object.keys(scenarios), run: async (name) => scenarios[name](), stageDataURL }
})()
'__bench installed'

# Heatmap Golden Fixtures

Frozen snapshots of the JS heatmap engine's output, used as the reference
when porting the engine to GLSL (HM-F5a~f). The diff harness (HM-T2) runs
the shader version against the same scenarios and reports per-cell dB error
against `field.json` here.

## Layout

```
__fixtures__/
  build-golden.mjs         # generator (run via `pnpm heatmap:golden`)
  diff-golden.mjs          # CLI diff harness (run via `pnpm heatmap:diff`)
  README.md                # this file
  basic/
    scenario.js            # input — single source of truth, hand-written
    field-full.json        # baseline #1: full physics (reflections + diffraction on)
    field-friis.json       # baseline #2: Friis + walls + slab only (no refl/diff)
    field.json             # alias of field-full.json (back-compat)
    meta.json              # commit hash, timestamp, engine fingerprint, opts, both baselines' stats
    diff-report.html       # written by `pnpm heatmap:diff --html` (gitignored)
```

The browser diff page (`#/heatmap-diff`) is the primary visual validator
during shader development. It eagerly imports every `<name>/scenario.js` +
`field-{full,friis}.json` via Vite's `import.meta.glob`.

Each fixture lives in its own directory. The generator picks up every
subdirectory containing a `scenario.js`.

## Why two output files

- `field.json` is the binary payload, kept compact (base64 Float32Array)
  and rewritten as a single blob — no noisy per-cell diffs in git.
- `meta.json` is human-readable, captures provenance (commit hash, dirty
  flag, engine source fingerprint) and per-channel stats so a quick glance
  can confirm a regeneration didn't drift unexpectedly.

## Regenerating

```bash
pnpm heatmap:golden            # all fixtures
pnpm heatmap:golden basic      # just one
```

The generator boots a one-off Vite dev server (middleware mode, no HTTP)
purely to resolve `@/` aliases inside the engine. No HTTP port is opened.

## When to regenerate

- After **intentional** algorithm changes to `propagation.js`,
  `sampleField.js`, `buildScenario.js`, or `frequency.js`.
- After material constants change (`materials.js` ITU coefficients).

If you regenerate during shader work, the diff harness (HM-T2) will lose
its baseline — keep regeneration on `main`/JS-only branches.

## When NOT to regenerate

- During GPU/shader development (HM-F5a~f). The whole point of the
  fixture is to stay frozen so the shader can be diffed against it.
- When inspecting unexplained diffs — investigate first.

## Diff harness (HM-T2)

```bash
pnpm heatmap:diff                        # diff every fixture vs current JS engine
pnpm heatmap:diff basic                  # one fixture
pnpm heatmap:diff basic --html           # also write diff-report.html
pnpm heatmap:diff basic --engine shader  # diff shader engine vs golden (HM-F5a+)
pnpm heatmap:diff --ci                   # exit non-zero if any threshold breached
```

For each channel (rssi/sinr/snr/cci) the harness reports:

- **max / mean / p95 abs error** in dB
- counts of cells over **0.5 / 1.0 / 3.0 dB**
- **NaN mismatches** (one side NaN, other finite — always treated as failure)
- worst N cells with `(i, j, x_m, y_m, golden, current, |Δ|)`

Default per-channel pass threshold is **±1 dB**. Override via env, e.g.
`HEATMAP_DIFF_THRESHOLD_RSSI=3 pnpm heatmap:diff --ci`.

`--html` writes `diff-report.html` alongside the fixture: a 3-panel grid per
channel (golden / current / |diff|, with green ≤ thr / yellow thr–3·thr /
red &gt; 3·thr / magenta = NaN mismatch).

## Acceptance gates per HM-F5 sub-stage (HM-T4)

Each F5 sub-stage adds physics terms the previous stage didn't have, so a
naive "single golden, monotonically tightening threshold" gate would force
each stage to either inherit physics it doesn't implement (defeating the
staging plan) or accept a threshold so loose it stops catching regressions.

We solve this by **pinning each stage to a baseline that matches the physics
it implements**:

- **`field-friis.json`** — JS engine output with `maxReflOrder=0` and
  `enableDiffraction=false`. F5a/F5b's target. Comparing the shader against
  this baseline measures only the physics F5a/b actually implements (Friis
  + walls + slab + openings) — anything off is a real bug.
- **`field-full.json`** — JS engine output with full physics. F5c/F5d/F5e/F5f's
  target. Once reflections + diffraction + multi-frequency coherence land,
  the shader should converge to JS parity here.

Both baselines are regenerated together by `pnpm heatmap:golden` and stored
inside each fixture directory. `meta.json` records the per-baseline stats so
unintended drift is visible in `git diff`.

### Threshold table

| Stage | Adds | Baseline | All channels | Notes |
| ----- | ---- | -------- | ------------ | ----- |
| **F5a** MVP | Friis + walls (with Z filter), slab, openings | `field-friis` | ≤ **1.0 dB** | Full numerical parity expected against the friis baseline at this stage. fp32 round-off only. |
| **F5b** BVH | (perf only — same physics as F5a) | `field-friis` | ≤ **1.0 dB** | Must not regress F5a. |
| **F5c** Reflections + Fresnel + diffraction | image-source reflections w/ complex Fresnel, knife-edge diffraction | `field-full` | ≤ **1.5 dB** | First diff against full physics. Multi-frequency coherent sum still missing → small residual drift expected at multipath nulls. |
| **F5d** Multi-frequency coherent sum | per-channel N-sample frequency average | `field-full` | ≤ **1.0 dB** | Full parity with JS engine. |
| **F5e/f** Optimisations | (perf only) | `field-full` | ≤ **1.0 dB** | Must not regress F5d. |

NaN-mismatch count must be **0** at every stage — out-of-scope masking is
data-driven (scope polygon test) and does not depend on which physics terms
the shader implements. A nonzero `nanMis` always indicates a scope-mask
wiring bug, not a physics drift, regardless of the stage.

### How to run the gate

The browser diff page (`#/heatmap-diff`) provides a stage selector that
auto-picks the matching baseline + threshold for each stage. This is the
canonical workflow for shader development since headless WebGL2 isn't
available in Node.

The CLI diff harness (`pnpm heatmap:diff`) only loads `field.json` (the
back-compat alias of `field-full.json`) and only runs the JS engine. It's
useful for catching JS-side regressions during pure CPU work; for shader
verification use the browser diff page.

## Adding a new fixture

1. Create `__fixtures__/<name>/scenario.js` exporting `floors`, `wallsByFloor`,
   `apsByFloor`, `scopesByFloor`, `floorHolesByFloor`, `engineOpts`, `meta`.
2. Run `pnpm heatmap:golden <name>`.
3. Commit `scenario.js`, `field.json`, `meta.json` together.

Edge-case fixtures (`dense-walls/`, `dense-aps/`, `cross-floor-tunneling/`)
are tracked under HM-T5 and only added when their respective shader
sub-stage (HM-F5b/d) gets close to implementation.

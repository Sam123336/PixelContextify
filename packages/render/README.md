# @contextifly/render — RenderContextifly

A **UI execution compiler**. It compiles declarative UI source (React/Next + Tailwind, today) into a deterministic, measurable execution model, and validates that model against the framework itself — no browser recording, no screenshots, no AI in the core.

Sibling to the PixelContextifly packages (`mcp-server`, `backend`, `shared`): PixelContextifly compiles software *architecture* into a semantic graph; RenderContextifly compiles UI *execution* into an executable plan. Same philosophy — deterministic analysis first, explanation later.

## Pipeline

```
Source (.tsx)
  → Parser + Structural Compiler   extract.cjs   → React IR      (.react.ir.json)
  → Semantic Compiler (L2)         semantic.cjs  → Runtime IR    (.runtime.ir.json, .runtime.graph.json)
                                                 → env.auto.json (fixtures + variants, auto-solved)
  → Planner                        planner.cjs   → Execution Plan (.execution.plan.json) + explanations
  → VM (+ layout + rasterizer)     vm.cjs        → Scene Frames  (out/K*.scene.json, out/K*.svg)
  → Oracle (renders REAL React)    oracle/       → real.K*.json  (ground truth, via jsdom)
  → Diff engine                    diff.cjs      → fidelity metrics (Tree/Node/Binding/Layout/Style) + golden
```

Every stage is a serializable, diffable, benchmarkable artifact.

## Status (prototype, one component: `GeneralSettingsCard`)

- **Fully automatic** source→score, zero hand-written artifacts: **K1 86.6 / K2 94.0 / K3 91.3 / K4 90.7** vs real React (Tree/Node = 100%).
- **Extraction coverage** across 164 real components: 90.2% emit an IR (25.6% clean); dominant backlog `expr-node ×97`.
- **Explanations** (deterministic): why-rendered / why-skipped / why-disabled / why-N-changed (see `planner.cjs`).
- Cost: eval+layout+render ≈ 0.1 ms / 38-node screen; Scene Frame ~10 KB → 1.2 KB gzip.

### Honest gaps
- Layout ~69% / Style ~87% are **structural-compiler** debts (block-container facet normalization; leaf nodes lack `rounded`/`border`/`text-sm`). Real *pixel* geometry needs a headless-Chrome oracle (not built).
- The VM still **re-resolves** decisions instead of consuming the Execution Plan — the "stupid VM" refactor is pending.
- `.cjs` prototype; not yet TypeScript. One component validated; corpus fidelity distribution pending.

## Run

```bash
npm run compile     # source → React IR → Runtime IR → Execution Plan → Scene Frames
npm run oracle      # render the REAL component (deploys harness into the target app, jsdom)
npm run diff        # fidelity metrics vs real React, + golden compare
npm run all         # the whole loop
npm run coverage    # extraction coverage across the target app
npm run plan        # print the Execution Plan + deterministic explanations
```

The target app being compiled and the oracle deploy location are set in `config.cjs`. The oracle harness must run inside the target app (`<app>/.rcx-oracle/`) to resolve its React/Radix/shadcn; `oracle/` holds the canonical source that `npm run oracle` deploys there.

# RenderContextify — Phase 0/1 working notes

> Location is temporary (scratchpad). When the project gets a home (new repo vs
> monorepo package — an open decision), move `rendercontextify/` there.

## Phase 0 — coverage probe (DONE)
Ran `coverage-probe.cjs` on the real BELIVMART repos.

| App | Tailwind recognized | arbitrary | custom | geometry recog. | CSS-in-JS / comp-lib / CSS-mod |
|-----|--------------------|-----------|--------|-----------------|-------------------------------|
| belivmart-admin | 97.1% | 1.3% | 1.7% | 98.3% | 0 / 0 / 0 |
| belivmart-admin-nextjs | 98.0% | 1.5% | 0.6% | 98.2% | 0 / 0 / 0 |
| belivmart-frontend-nextjs | 95.0% | 4.5% | 0.5% | 96.7% | 0 / 0 / 0 |

"custom" tail is mostly the probe missing real Tailwind *plugin* utilities
(`tabular-nums`, `underline-offset-*`, `tailwindcss-animate` fade/zoom/slide, `prose`,
`@container/*`) + a few English-word false positives. True custom CSS < 0.5% (`bm-*` keyframes).

**Verdict: React-first validated (~98%). Target = `belivmart-admin`.**
Provider #2 (later, to force the VSIR) = the 3 Flutter apps (delivery/customer/merchant-mobile-app).

Real residuals to design for: arbitrary values `w-[..]` (parseable), inline `style={{}}`
(25/32/110 sites — literal=easy, computed=runtime), `bm-*` app keyframes, framer-motion (storefront only).

## Private React IR — node kinds (v0.0.1)
Read off real JSX, deliberately React-shaped (NOT a VSIR yet).

- `Component { props, state[], dataSources[], root }` — the *program*. `state[]` = free variables;
  each may have a `source` (`fetch` = data hole, `hook` = capability/env).
- `Box { layout, style, children }` — container; `layout` from Tailwind (direction/gap/align/justify/wrap),
  `style` = border/radius/padding. **Geometry NOT resolved here** — the VM resolves it against a viewport.
- `Text { el?, value, text }` — `value` is `{lit}` or `{expr,deps}`.
- `Icon { name, anim, size }`.
- `Prim { ref, props, children }` — shadcn/Radix component ref; resolves to its own IR from `components/ui/`.
- `Cond { cases:[{when,node}], else }` — **the sum-type**; `when` is a state predicate.
- `List { items, itemKey, template }` — `items.kind` = `static` (cardinality known) | `data` (cardinality hole → axis {0,1,3,many}).
- `Fragment { children }`.
- `Binding = { expr, deps[] }` — pure fn of state/props/item. **`deps` drives incremental eval + provenance.**

## The payoff: 4 structural keyframes, zero app execution
Discriminants that gate *structure* = `loading`, `extraDetails==null`, `canEdit`
(`saving`/`toggles`/`qrCode` change content/props, not the branch).

- **K1 Loading** — `loading=true` → spinner + "Loading…"
- **K2 Error** — `loading=false ∧ extraDetails=null` → "Failed to load…"
- **K3 Form (read-only)** — `…∧ canEdit=false` → perm note + 5 disabled toggles + disabled Save
- **K4 Form (editable)** — `…∧ canEdit=true` → 5 live toggles + input + live Save

Within K3/K4, `saving ∈ {false,true}` → Save label "Save"↔"Saving…" (a within-variant micro-replay).

### Fixture (from types, no backend)
`ExtraDetails` type + `TOGGLES` keys →
```
extraDetails = { isOnlinePaymentEnabled:true, isWhatsappNotificationEnabled:false,
  isCancelableEnabled:true, blockOrderCreationWhenNoPartnerAvailable:false,
  blockOnlinePaymentWhenNoPartnerAvailable:false, payment:{ qrCode:"https://…/qr.png" } }
```
`TOGGLES` cardinality is static (5) → no cardinality axis needed here (a *fetched* list would need it).

### Provenance / dirty-set (the moat, in miniature)
Flip `saving` false→true. Bindings with `saving` in `deps`: 5×`Switch.disabled`, `Input.disabled`,
`Button.disabled`, `Button.label`. Dirty set = those nodes only; header/labels/help/layout untouched.
→ "Why did Save re-render? `saving` changed; `Save.disabled` and `Save.label` depend on it."

## Next
1. **VM v0**: evaluate IR @ env → scene tree (resolve `Cond`/`List`/bindings; leave geometry symbolic).
2. **Layout solver v0**: resolve `Box` layout facets → px boxes at a chosen viewport (flexbox subset).
3. **SVG renderer v0**: scene tree → SVG (validation-grade, diffable).
4. **jsdom oracle**: render the real component at K1–K4, serialize, structural+geometric diff vs our SVG.
   Metric: node-set + containment + box-position within tolerance. This earns the fidelity claim.

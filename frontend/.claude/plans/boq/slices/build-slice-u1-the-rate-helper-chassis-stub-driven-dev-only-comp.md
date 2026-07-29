## Build slice U1 (the rate-helper CHASSIS -- stub-driven, DEV-only) COMPLETE

**What shipped.** The frontend chassis for in-editor rate suggestions: a "Suggest rates" button, per-rate-cell
suggestion badges, and a page-level panel that renders a typed helper CONTRACT generically -- driven by a DEV stub.
Session 1 of the locked U1+U2 box. Everything is DEV-only (guardrail G1) and NON-persistent (G2); the stub dies at
U2, replaced by the real telemetry + earthing-import helper. New code lives in `src/pages/boq-wizard/rate-helper/`.

**The registry contract (guardrail G3, N-generic).** `rateHelperTypes.ts`: a `RateHelper` = `{id, label,
compute(ctx, attrOverrides?) -> Suggestion | NoSuggestion}`. A `Suggestion` carries `values` per rate-kind, a
one-line `basis`, and STRUCTURED `workings` (editable `attributes` [id/label/options/value], `matchedRows`,
`derivation` lines, `finalValues` per kind). `NoSuggestion` carries a `reason`. **The panel renders ONLY the
contract -- zero helper-specific rendering**, so a new helper is a registry edit, never a panel change.
`rateHelperRegistry.ts` registers THREE: the live stub `Pricing sheet` + two ALWAYS-decline helpers
(`Previously priced BoQs` -> "No priced corpus for this category yet"; `Qty breakdown + live data` -> "Helper not
built -- planned") whose greyed cards PROVE the N-generic rendering. `stubRateHelper.ts` is canned + synchronous:
suggestions on some categories both kinds (earthing), a supply-only one (wiring_cabling), a no-table reason
(panels), and an editable-attributes set that reaches an honest "no match" WITHOUT collapsing (earthing Copper|50x6
-> empty values + attributes preserved).

**D8 gate-chain REUSE (never re-derived).** The button consumes the SAME predicates a rate write does, read straight
from the existing page vars (`SheetPricingPage.tsx`): `locked` (=> `onSaveRate` withheld), `formulasComplete`
(`areFormulasComplete`), `categoryGateOpen` (`isCategoryGateOpen`, which already folds the admin override).
`suggestRatesReason` surfaces the FIRST failing reason (title/tooltip); disabled when the chain says no. Running it
evaluates registered helpers over rate-editable rows into a page-owned `suggestionsByExcelRow` Map (`buildSuggestions`
in `rateSuggestionModel.ts`). Synchronous in U1 -- no modal/poller (that skeleton arrives in U2).

**The ONE write path (item 6): a NEW `PricingGridHandle.applyRate(excelRow, col, value)`.** The existing
`proposedRates` channel is DISPLAY-ONLY ("a proposal is never sent to the server"), so it was not a write path.
`applyRate` wraps the grid's existing typed-commit flow. **CRITICAL (a race found + fixed during the cert):
`applyRate` mirrors the typed `onChange` EXACTLY -- optimistic `setDraftRates` + clear proposal + the SAME 1s
debounced `scheduleAutoSave` -- it does NOT call `commitRate` synchronously.** A synchronous commit raced the
page's `dirty -> ensureLockAcquired` (which the typed path fires first, then commits on blur/debounce), tripping a
spurious "taken over by another user" banner on every Use. Deferring the commit lets the lock acquire first, so
"Use this value" is byte-identical to typing: same optimistic draft, undo history, `mutate()` refetch,
in-flight/takeover handling, and the `onSaveRate`/locked gate. No second save path, no endpoint.

**Badge + panel + memo shield (item 7, the P1 pattern).** The badge is a small count chip in the rate cell's
existing right-aligned flex strip (beside the priced dot); its own `onClick` `stopPropagation` opens the panel, so a
bare cell click still just places the cursor (the input is untouched). After a Use: chip -> Check (page-session
`used`). The grid receives per-row ONLY its own `rowSuggestions` entry (`RowSuggestions {byCol: {col: {count,
used}}}`), compared BY VALUE via `rowSuggestionsEqual` in `pricingRowPropsAreEqual`; the grid-level
`rowSuggestionsByExcelRow` Map + the reference-stable `onSuggestionBadgeClick` callback change only on a run / a Use
(like `categoriesByExcelRow`), NEVER on keystroke -- so a run re-renders only the rows that got a badge, and a Use
re-renders only that one row (`markSuggestionUsed` rebuilds a new Map but reuses every other entry's reference,
mirroring the gate-arc boolean-flip precedent). The panel mounts at PAGE level in a horizontal flex row around the
grid slot INSIDE the full-screen wrapper (grid keeps its own horizontal scroll + the frozen two-pane split +
virtualization -- all internal, untouched); EMBEDDED mode drops `max-w-5xl` (widen-while-open) and restores on close.
Panel state keyed by the durable `(excelRow, col)` -- col is the stable Excel column letter that DETERMINES the
rate-kind (1:1 on scalar/per-area sheets), never a window index.

**Dev-flag mechanism (item 8).** `rateHelperFlag.ts`: `RATE_HELPER_ENABLED = import.meta.env.DEV && localStorage
"nirmaan-rate-helper-off" !== "true"`, evaluated ONCE at module load (a stable const, memo-safe). A production
`vite build` sets `import.meta.env.DEV = false` -> the feature is UNREACHABLE in a shipped bundle (no button, no
badges, no panel). The localStorage kill-switch toggles it OFF at runtime for verification (V10) without a rebuild
(next page load); it can only turn the feature OFF, never ON in prod.

**Gates (in-container, bench-verified).** vitest **932 -> 952** (+20 for the pure leaves: stub compute incl. the
recompute + no-match paths, registry resolution + dead-helper declines, kind mapping, `buildSuggestions` per-kind
badging, `markSuggestionUsed` identity preservation, `rowSuggestionsEqual`). tsc: boq-wizard **0 new** (total 3240
pre-existing debt unchanged). vite build exit 0.

**Browser cert (`admins@nirmaan.app`, SYNTHETIC `BOQ-26-00144` -- LEFT INTACT for the owner's EXIT-CRITERIA review
per owner instruction; NOT deleted).** Sheets `U1 Open` (fully categorised + formulas complete -> gate OPEN) +
`U1 Shut` (1 blank category -> gate SHUT). V1 built; V2 button disabled on Shut with "Every eligible row needs a
category first" + enabled on Open; V3 badges only on rate-editable stub-suggested rows, per-kind (row 7 earthing
supply+install, row 8 wiring_cabling supply-only, row 9 panels none, preamble none); V4 typing on a badged cell
saves normally (275 typed into badged row-8 supply); V5 panel scoped to (row, kind) with all 3 cards + the two dead
reasons; V6 workings render, attribute edit recomputes live (50x6 -> 210), reaches honest "no match" (Copper|50x6,
attributes preserved), final field pre-filled + freely overridable (999); V7 Use lands the value through the real
save (row 7 supply 999 + install 45, DB-confirmed, "Saved as of ...", undo reverts to a new pricing_version like a
typed value); V8 chip -> check; V9 both pane modes -- frozen two-pane badges/panel/Use all work, embedded
widen-while-open; V10 flag OFF -> no button/badges/panel; V11 reload wipes suggestions but the saved rates remain.
**Seeding gotcha (env, not code): `save_amount_formula` acquires the single-editor pricing lock as its caller, so
seeding formulas as Administrator left a stale lock -- cleared out-of-band.** V12 cleanup INTENTIONALLY SKIPPED
(owner will manually review the synthetic BoQ); the feature is left flag-ON on `U1 Open`.

**U1 exit state / what U2 replaces.** The chassis (registry contract, badge, panel, `applyRate` write, D8 reuse,
dev flag) is DONE. U2 replaces the STUB with the real helper (telemetry + earthing rate-table import) and adds the
async run skeleton (modal + poller over a real server run, mirroring the Classify pattern). The stub file
(`stubRateHelper.ts`) + its test die at U2; the contract + panel + badge + write path stay.

**Files.** NEW `frontend/src/pages/boq-wizard/rate-helper/` (rateHelperTypes.ts, stubRateHelper.ts,
rateHelperRegistry.ts, rateHelperFlag.ts, rateSuggestionModel.ts, RateHelperPanel.tsx + 3 `.test.ts`). Edited
`PricingGrid.tsx` (applyRate handle + badge + row-suggestion prop/comparator) + `SheetPricingPage.tsx` (button,
run/badge/use handlers, panel mount, widen-while-open). No backend, no endpoints, no persistence.

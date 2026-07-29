### Phase 5 Pricing Editor -- Slice 3b -- inline rate editing + live amount compute (FRONTEND, feat pending, 2026-06-21)

**Goal.** Makes the 3a read-only grid editable for RATES ONLY: each rate cell is a numeric `<Input>` that saves on
blur/Enter via `save_cell_price`, the cell flips to priced after a `mutate()` refetch (markers re-derive
authoritatively), and the paired amount shows **amount = qty x rate live (display-only, NEVER persisted** -- the pricing
layer stores rates only; design v1.3 Sec.5). NO backend (save_cell_price + get_priced_rows already built), NO migrate.

**Editable rate cell.** `isRateDescriptor(d)` cells render a numeric Input (right-aligned); qty/amount/non-rate +
classification + structure stay READ-ONLY. **Save on BLUR or ENTER -- no Apply, no confirm** (Excel feel). Local
optimistic `draftRates` keyed `${row_index}:${col}`. `commitRate` guards: UNCHANGED-vs-saved -> no-op; blur+Enter
double-fire deduped via `committedAttemptRef`; blank/NaN -> 0 (endpoint coerces blank -> 0.0, still priced). On success
the draft is dropped (falls back to the refetched saved rate); on failure the draft is kept. When `onSaveRate` is absent
the grid is read-only (3a preserved).

**Page-owned save.** The grid calls up `onSaveRate(cell: RateCellSaveArgs, rate)`; the page owns boq/sheet/commit_version
+ `mutate` -> POSTs `save_cell_price` -> `await mutate()` (markers re-derive AUTHORITATIVELY -- no client-side marker
logic). On throw: inline `getFrappeError` strip AND re-throw so the grid keeps the draft. (Mirrors the
SheetReviewPage-owns-onSaved / ReviewTree-calls-up idiom.)

**descriptor -> save_cell_price args (pure `buildRateCell`, unit-tested).** excel_row = `row.source_row_number` (NOT
row_index); col_letter = `d.col`; committed_version = the payload's `commit_version`; area = per-area `d.value_key`
(scalar omitted); rate_kind = `d.rate_subkey` verbatim (per-area) / derived (scalar `rate_combined`->`combined_rate`) --
a guard field NOT the identity key; description = `row.description` (the copy-forward MATCH GUARD, ALWAYS sent). NEW
additive type `RateCellSaveArgs`.

**Live amount (display-only).** An amount cell paired to a rate column (same area + corresponding kind via the pure
`findPairedRateDescriptor` + the amount-kind<->rate-kind maps `total<->combined_rate` / `supply<->supply_rate` /
`install<->install_rate`) shows `computeAmount(qty, rate)`. NON-REGRESSIVE: effective rate = typed draft else the SAVED
rate IF priced; an un-priced not-editing amount cell keeps its committed value (no 3a regression). Multi-area
independence falls out of per-(row,col) keying.

**Deferred (NOT 3b):** subtotal roll-up; auto-save/force-save (3c); the single-editor lock (`editable`/`lock_info`
INERT); un-price; remarks/flag layer (4a/4b); Excel write-back (5); finalize/revert (6).

**Tests + verification.** `PricingGrid.test.ts` 8 -> **18** (+10 helper tests). Vitest **30/30 GREEN**; tsc 3178, 0 in
touched; Vite build exit 0 (PWA 166). Slice 3b unblocks 3c. (See frontend CLAUDE.md `**Status (... Slice 3b ...)**`.)


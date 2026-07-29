### Cluster B -- formula-vs-document reconciliation (per-cell choice) (FULL-STACK, MIGRATE [new doctype], base tip b2c1b1fa, 2026-06-24)

**What:** when a committed (DOCUMENT) amount and the formula-computed amount DIVERGE for the same amount cell, the editor
FLAGS the divergence (mismatch only -- never auto-fixes; the tendering doc is client-owned), lets the user CHOOSE per cell
which value wins (keep-document / use-formula), stores that choice stickily per committed version, and routes the CHOSEN
value to the grid cell AND the rollup/summary (single source of truth).

**Four LOCKED owner decisions:**
- **D1 DEFAULT = DOCUMENT.** An unset (or keep_document) divergent cell shows the DOCUMENT value in BOTH the grid and the
  rollup, with the divergence highlighted until resolved. This REVERSES the prior formula-wins display. Resolution map:
  unset -> document; keep_document -> document; take_formula -> formula.
- **D2 VISUALIZATION = BOTH CHANNELS.** (a) A STRONG cell cue: a solid VIOLET `ReconcileBadge` pill (a DISTINCT channel --
  background=priced tint / left-border=color / gutter=flag marker are all taken) + a chooser popover labelled with both
  numbers; a RESOLVED choice renders a MUTED grey pill (still visible, no nag). (b) A NEW "divergence" `ReviewEntry` kind in
  the unified strip carrying the unresolved count; click-jumps via `scrollToRow`; a resolved cell drops from the active strip.
- **D3 INVALIDATION = AUTO-RESET, SURGICAL, PER-CELL, COLUMN-AWARE.** A rate save clears a stored choice ONLY on amount
  cells (on that row) whose formula REFERENCES the edited rate operand (NOT the whole row -- more surgical than the per-row
  dismissal re-arm). A formula save/remove clears that column's cells (remove = silent). A re-commit mints a new version ->
  old choices orphaned (no live code). No "survive but warn" path.
- **D4 ROLLUP SINGLE SOURCE.** The chosen value resolves ONCE inside `pricingRollup.rowOwnAmount`, so Option-1 (tree) and
  Option-2 (flat) both read the same `ownByIdx` -> the reconciliation integrity guard stays balanced by construction.

**Divergence fires ONLY when the formula yields a real number** (`evaluateAmountCell` -> `cell.kind === "value"`).
not_yet / broken (`kind: "blank"`) and no-formula (`kind: "committed"`) carry NO computed number -> NO divergence (F1: the
mandatory formula gate guarantees coverage, NOT a number).

**Backend (`nirmaan_stack/api/boq/wizard/pricing.py` + NEW doctype):**
- NEW doctype **`BoQ Cell Reconciliation Choice`** (`nirmaan_stack/nirmaan_stack/doctype/boq_cell_reconciliation_choice/`):
  istable=0, track_changes=1, autoname `BRCC-.YY.-.#####`, bare-stub controller. Identity = (boq, sheet_name VERBATIM #152,
  excel_row, **col_letter**, committed_version) -- PER-CELL (carries col_letter, the difference from the per-ROW BoQ Cell
  Dismissal). `choice` Select keep_document/take_formula; "unset" = the absence of a current record. Own freeze-and-supersede
  triple `choice_version`/`is_current`/`chosen_at`+`chosen_by` + inert `is_finalized`. One-current ENDPOINT-enforced.
- `save_cell_reconciliation_choice(boq, sheet, excel_row, col_letter, committed_version, choice, description)` -- mirrors
  `save_cell_dismissal`: resolve committed row (NO priceability gate, col_letter not node-checked -- like save_cell_color),
  lock-on-write AFTER resolve / BEFORE freeze+insert (reject-mutates-nothing), freeze prior current via `set_value` (NEVER
  doc.save) then `doc.insert`; a blank/None/"unset" `choice` -> freeze-only (the CLEAR -> revert to document-default). Invalid
  token -> throw.
- `get_sheet_reconciliation_choices(boq, sheet, committed_version)` -- bare whitelist read; current (is_current=1) per-cell
  choices. Merged into `get_priced_rows` as a flat per-CELL `reconciliation_choices` key `[{excel_row, col_letter, choice}]`.
- INVALIDATION machinery (the surgical re-arm): `_committed_descriptors` (full descriptor list, refactored out of
  `_committed_amount_descriptors`); `_bind_ref` (wildcard leaf -> area; mirrors frontend `amountFormula.bindRef`);
  `_pick_formula_record` (override>wildcard, mirrors `pickFormula`); `_node_refs_rate` + `_amount_col_depends_on_rate`
  (the operand-tree walk -- direct rate-leaf match + transitive amount-refs-amount, cycle-guarded -- mirrors the F2
  evaluator resolution); `_rearm_cell_recon_choices` (resolves the edited rate descriptor by col_letter, clears choices on
  referencing amount cells of THAT row) wired into `save_cell_price` AFTER the price insert + the dismissal re-arm, BEFORE
  the single commit; `_rearm_column_recon_choices` (clears the formula target covered columns) wired into BOTH
  `save_amount_formula` paths (save + clear). Response keys `rearmed_choices` added (additive).

**Frontend (`frontend/src/pages/boq-wizard/`):**
- NEW pure leaf `reconcile.ts`: `RECON_EPSILON_ABS`(0.01)/`RECON_EPSILON_REL`(1e-9) + `amountsEqual` (the SHARED tolerance,
  now ALSO imported by `pricingRollup.ts` for its Option-1-vs-Option-2 integrity guard -- ONE epsilon, the private constants
  removed there), `amountsDiffer` (both sides must be real finite numbers), `resolveDivergence` (the D1 rule),
  `reconChoiceKey` + `buildReconChoiceMap`. A LEAF (imports only types) so PricingGrid/priceability/pricingRollup all import
  it with NO cycle (PricingGrid can NOT import pricingRollup -- the cycle reconcile.ts exists to dodge).
- `PricingGrid.tsx`: the `ReconcileBadge` component + divergence detection in the amount block (`cell.kind === "value"` ->
  `resolveDivergence(document, formula, choice)` -> shown value defaults to document); `reconChoices` -> a `useMemo`'d
  per-sheet `reconChoiceMap` (reference-stable like `columnFormulas`) threaded to the memoized row (`reconChoiceMap` +
  `onSaveReconChoice` added to `PricingGridRowProps` + the exhaustive `pricingRowPropsAreEqual` -- memo intact). The badge is
  read-only (static pill) when `onSaveReconChoice` is withheld (locked).
- `priceability.ts`: `buildDivergenceEntries` (imports `resolveDescriptorValue` from reviewRender + the reconcile helpers;
  one entry per row listing unresolved diverging cols; resolved cells drop out). `boqTypes.ts`: `ReconChoice` +
  `ReconciliationChoiceRef` + `ReconChoiceSaveArgs` + `reconciliation_choices` on `GetPricedRowsResponse` + `divergence`
  added to `ReviewFlagKind`.
- `pricingRollup.ts`: `rollupByParent` gains a `reconChoices` param -> builds the choice map -> `rowOwnAmount` resolves the
  chosen value ONCE (document-default) in the formula branch. `SummaryPanel.tsx` threads `reconChoices`.
- `SheetPricingPage.tsx`: reads `reconciliation_choices`, `handleSaveReconChoice` (mirrors `handleSaveDismiss`; `choice`
  null clears), passes `reconChoices` + `onSaveReconChoice` (withheld when `locked`) to the grid + `reconChoices` to the
  summary; `buildDivergenceEntries` feeds the strip; `REVIEW_ENTRY_META.divergence` (violet); the per-entry dismiss button
  is WITHHELD for a divergence entry (its kind is not a dismissal token; the chooser IS its resolution).

**Tests:** backend `test_pricing` 110 -> 126 (NEW `TestReconciliationChoice` 16: CRUD + freeze-and-supersede + keep-vs-take
+ clear + read + get_priced_rows merge + 6 NEG + the surgical re-arm [a rate save on E clears F@same-row, NOT I (qty-only)
nor F@other-row; a rate save on the unreferenced H re-arms nothing] + formula-remove-clears-silently + formula-save-rearms).
frontend vitest 245 -> 264 (NEW `reconcile.test` 12 + `pricingRollup` +4 [document-default / take_formula / keep_document /
Option-1==Option-2 mixed-set balance] + `priceability` +3 [buildDivergenceEntries: kind==="value"-only, resolved-drops-out,
agree-emits-nothing]). tsc 3175 (0 new). in-container Vite build exit 0 (built in 4m 48s, PWA 168 entries).

**MIGRATE note:** `bench --site localhost migrate` creates `tabBoQ Cell Reconciliation Choice` (12 custom + 11 Frappe
standard = 23 cols; model sync runs before patches). The migrate run ALSO surfaced a PRE-EXISTING unrelated failure --
`nirmaan_stack.patches.v3_0.backfill_cashflow_gap_limited` has no `execute` (from commit 4cc217f8, NOT this slice; no
patches/ file was touched). The doctype table synced before that patch ran; the test DB (which auto-migrates) is unaffected
(126 tests green). Flagged for the owner -- the broken patch is independent of Cluster B.

**Live-cert (pending Nitesh):** LC1 a divergent cell shows the DOCUMENT amount + a violet badge; LC2 click -> chooser shows
both numbers; "Use formula" -> cell shows formula + muted pill + Summary total tracks it; LC3 "Keep document" / "Use default"
-> document; LC4 the strip "Reconcile" entry click-jumps + drops once resolved; LC5 edit a rate the cell formula uses -> the
choice auto-resets (badge back to unresolved); LC6 a rate edit on an UNRELATED column leaves the choice intact; LC7
remove/replace the column formula -> choices clear; LC8 a locked/taken-over sheet shows static read-only pills; LC9
regression: rates / amounts / flags / dismiss / colors / remarks / summary / full-screen all unchanged on non-divergent cells.


## Build slice G3a (make the category gate VISIBLE + correct the message family) COMPLETE

FRONTEND + BACKEND-MESSAGES, NO MIGRATE. Branch `feature/boq-pricing-helper`, base tip `53b1a300`. Two
commits (feat / docs).

**What shipped.** The category gate was live server-side (G2b/G2c) and widened to the eligible master set
(G2e) but INVISIBLE -- a user typed a rate and only then got refused. G3a adds the visible half + corrects the
message family that still described the pre-G2e rule.

- **Scope 1 -- the live count (page).** `SheetPricingPage` derives `categoryBlankCount` via the new pure
  `PricingGrid.countMasterSetBlankRows(rows, categoriesByExcelRow)` -- the SAME `isMasterSetBlank` predicate the
  amber fill + Check-Category filter use (FOUR surfaces, ONE predicate). It ITERATES THE ROWS, never the
  categories map, so a never-classified row (absent from the map) is still counted. `useMemo` on
  `[rows, categoriesByExcelRow]`. `categoryGateOpen = isCategoryGateOpen(count, override) = (count === 0) ||
  override`. At load the client count == the server's `eligible_blank_category_count` == `get_freeze_summary`'s
  count (cert C1: 5 == 5 == 5).
- **Scope 2 -- only a BOOLEAN to the grid.** `categoryGateOpen` is threaded to `PricingGrid` exactly like
  `formulasComplete` (prop default true; row prop in `pricingRowPropsAreEqual`; passed per row). NEVER the count.
  Re-render profile per category pick: the top-level memo bails (categoriesByExcelRow ref changed) -> grid body
  re-executes once -> only the PICKED row's `<tr>` re-renders (its `category` entry changed); `categoryGateOpen`
  is unchanged on a non-flip pick so it adds ZERO row re-renders. On the FLIP (last blank categorised) the
  boolean changes and ALL rows re-render once -- correct, that IS when every row's editability flips (identical
  to `formulasComplete`'s profile).
- **Scope 3 -- cell gating.** `categoryGateOpen` is ANDed OUTSIDE `isRateEditableRow` in ALL THREE rate-write
  gates (the inline cell edit, `rateWritableAt` paste, `isDeltaWritable` undo/redo), mirroring `formulasComplete`
  -- so "Price any row" can never reach past it (cert C10). Consequence: while locked, rate cells are read-only,
  so a UI save cannot be ATTEMPTED; the server save-refusal is a BACKSTOP (verified at the endpoint, C7).
- **Scope 4 -- the banner.** In the page banner stack beside the formula banner, amber-note styling verbatim.
  Owner-approved copy with the live count (singular/plural handled); a distinct OVERRIDE variant naming
  `category_override_by` + `formatDate(category_override_at)` (dd-MMM-yyyy, the app convention). It NAMES the
  existing "Check Category" control -- no new button, no click-to-jump.
- **Scope 5 -- clear-path optimistic fix.** The pick handler now writes an optimistic override for BOTH a pick
  AND a clear (pure `buildOptimisticVerdict`): a clear yields a BLANK verdict (effective "" -> `isMasterSetBlank`
  TRUE) so the count RISES instantly and the sheet re-locks in the same interaction -- closing the
  drops-on-pick / rises-late-on-clear divergence window where the sheet briefly appeared unlocked. Reverts on
  save failure via the existing `dropOverride`; the refetch reconciles an auto-machine reversion (it only
  over-reports blank for the round-trip, never under-reports, so the gate never wrongly opens).
- **Scope 6 -- message family.** The save (`_guard_categories_complete`, now threading the blank count),
  copy-forward (`apply_copy_forward`), and cross-BoQ (`_APPLY_BLOCK_MESSAGE`) refusals use the owner-approved
  text, dropping "priceable"/"rate-editable" (correct only for the SEPARATE priceability gate). `_guard_categories_complete`
  inlines the override + eligible-blank checks (identical to `_categories_gate_ok`) ONLY to get the count length;
  the carry paths keep delegating to `_categories_gate_ok`. Audit: no other user-facing category-context
  "priceable"/"rate-editable" string remains.
- **Scope 7 -- payload types.** `GetPricedRowsResponse` (boqTypes.ts) declares `eligible_blank_category_count`,
  `categories_complete`, `category_gate_override`, `category_override_by`/`_at`/`_reason`.

**Tests (bench/vitest-verified).** `test_pricing` 228 -> **229** (`TestEligibleGateWidened.test_i` -- the save
message threads the count; `TestCopyForwardCategoryGate.test_a` strengthened to the new text + no-old-terms).
`test_cross_boq_carry` **49** (test_h re-asserts the new "Nothing was carried" text + all four G2c points + no
old terms). Frontend vitest 910 -> **920** (+10: `countMasterSetBlankRows` a/b/c/d + fixture + parity;
`isCategoryGateOpen` e/f; `buildOptimisticVerdict` pick + clear-g). `tsc --noEmit`: ZERO errors in any touched
file. Residence: all rules at baseline (delta 0).

**Browser live-cert RAN + PASSED** (owner session `admins@nirmaan.app`; mandatory de-stale done; BUNDLE-MARKER =
the BANNER on screen, which cannot exist in the old bundle). Synthetic data deleted + verified zero residual.
MAIN `BOQ-26-00140` / `G3A CERT ` (10 LI cat | 11/12 LI blank | 13 Preamble-qty blank | 14 qty-less Preamble
blank | 15 LI never-classified | 16 Other):
- C1 banner "5 rows still need a category…" == server count 5 == freeze 5. C2 cells read-only while locked
  (0 inputs, incl. the categorised row). C3 pick -> count 5->4 IMMEDIATELY, no reload/flicker. C4 clear ->
  count 4->5 IMMEDIATELY (the Scope-5 behaviour that did not exist before). C5 the FLIP: categorise the last
  blank -> banner gone + rate cells editable (5 inputs) same interaction. C6 the RE-LOCK: clear -> banner
  returns + cells read-only. C7 save backstop text (endpoint): "…Every line item and preamble needs a category,
  and 1 still don't have one. Use the Check Category filter…" (count threaded, no old terms). C10 "Price any
  row" ON keeps cells read-only + banner shown. C11 filter parity: amber {15} == filter {15} == count 1.
- C8 (carry `BOQ-26-00141`/`BOQ-26-00142` / `G3A XB `) refusal ON SCREEN: "Nothing was carried. The destination
  sheet 'G3A XB ' still has rows without a category - …" -- all four G2c points present, no old terms.
- C9 override banner (set via endpoint, no UI): "Category check overridden by admins@nirmaan.app on 26-Jul-2026.
  1 row still has no category — rate editing is unlocked anyway." + cells editable; clear -> lock banner returns.
- C12 REGRESSION real `BOQ-26-00114` / `Electrical `: NO banner, cells editable; save 45321 succeeded, restored
  to 45000, rowset identical.

**OWED / follow-ups:** **G3b** (the admin override SET/CLEAR control -- G3a only DISPLAYS override state).
**G2d** (clear the override on re-classify, plus the copy-forward carry-atomicity test gap). The pre-G2e
save-path "rate-editable" wording is now CORRECTED (this slice). The `rate_editable` mode stays unused until the
tendering-module rate helpers arrive.


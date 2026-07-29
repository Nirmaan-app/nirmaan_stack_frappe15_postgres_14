## Build slice G2e (widen the gate to "empty is empty" + match the filter to amber) COMPLETE

BACKEND + FRONTEND, NO MIGRATE. Branch `feature/boq-pricing-helper`, base tip `3945eca4`. THREE commits
(chore re-baseline / feat / docs).

**OWNER RULING (in full, "empty is empty", 2026-07-26).** (1) MASTER SET = every row the classification logic
says needs a category: `node_type` Line Item OR Preamble, on the current committed version. Notes / spacers /
subtotals / any other type are NOT in it. (2) BLANK = the Category cell the USER SEES is EMPTY -- the path to
empty is IRRELEVANT (never classified, classified-and-returned-nothing, AI never ran, human cleared it,
whitespace id). (3) The gate opens ONLY when the master set has ZERO blanks; one blank locks the sheet.
**PRICEABILITY IS NO LONGER PART OF THE GATE -- a qty-less Preamble IS in the master set.** The owner has seen
and ACCEPTED the measured cost (on real sheets 122->316, 196->378 blanks) and directed it not be re-raised.

**What changed (Scopes 1-6).**
- **Scope 1 -- widen the population:** `pricing._categories_gate_ok` switched from `population="rate_editable"`
  to the DEFAULT `"eligible"`. Both carry gates (`apply_copy_forward` inline throw, `cross_boq_carry._apply_sheet_carry`
  reason tuple) inherit it automatically -- they call the SAME `_categories_gate_ok` (verified, not assumed;
  `cross_boq_carry.py` unedited). The `"rate_editable"` MODE of `blank_category_eligible_rows` + its batched qty
  helper + its `TestRateEditableBlankCount` mode tests are RETAINED but currently UNUSED (kept for the future
  tendering-module rate helpers, which operate on exactly that population). Documented here rather than in
  `persist.py` (out of scope).
- **Scope 2 -- rename the surfaced key:** `rate_editable_blank_category_count` -> **`eligible_blank_category_count`**
  in `get_priced_rows` (both the default dict + the computed value), now counting the eligible set. Recon 5
  verified NO consumer existed (`GetPricedRowsResponse` did not even declare it), so the rename was free.
  `categories_complete` keeps its name (still accurate, wider population). Browser-verified live: the OLD key is
  absent from the payload.
- **Scope 3 -- close the node_type trim asymmetry:** client `PricingGrid.isPriceableType` now TRIMS `node_type`
  (`(nodeType ?? "").trim()`), matching the server's `(node_type or "").strip()`. Server side unchanged.
- **Scope 4 -- ONE shared predicate:** new exported `PricingGrid.isMasterSetBlank(row, cat)` =
  `isPriceableType(node_type) && deriveVerdictState(cat) === "unclassified"`. BOTH the grid's amber Category-cell
  fill AND the page's Check-Category view filter (`passesViewFilter`) now call it, so they can never drift. The
  amber fill's old `|| needsReview` disjunct was REMOVED (unreachable from resolved data -- Recon 6 Q8c -- and the
  owner ruled amber == master-set-blank); the `needsReview` var still drives the dot/text-colour (untouched).
  `isNeedsReviewCategory` was RETIRED from `ClassifySheetDialog.tsx` (it returned FALSE for a never-classified row
  and could not surface rows the widened gate counts); its sole functional caller was `passesViewFilter` and its
  vitest block moved to `PricingGrid.test.ts` as `isMasterSetBlank` cases.
- **Scope 5 -- widen the fixture helper:** `_categorise_fixture_rate_editable_rows` ->
  `_categorise_fixture_eligible_rows` (categorises the ELIGIBLE population); all ~23 call sites inherit the fix.
  The shared committed fixture's zero-qty Preamble (row 6) is now categorised, so save/carry tests built on it do
  not gate.
- **Scope 6 -- (g) inversions (OWNER-DIRECTED):** `TestCategoryGate.test_g_qtyless_preamble_blank_does_not_gate`
  -> `test_g_qtyless_preamble_blank_gates` (asserts REFUSED); the copy-forward carry gained
  `test_h_qtyless_preamble_gates_carry`; the cross-BoQ gained `test_i_qtyless_preamble_gates_carry`. Recorded in
  each docstring as an owner-directed reversal, NOT a weakening. `TestRateEditableBlankCount`'s MODE tests stay
  unchanged (the mode is retained); only its two get_priced_rows PAYLOAD tests updated (key + eligible value 4->5).

**Parity (owner-required, VERIFIED).** After the widening the gate count == `get_freeze_summary`'s count ==
the surfaced `eligible_blank_category_count` -- ONE number, superseding the earlier two-different-numbers
acceptance. `get_freeze_summary` was NOT changed (it already used the eligible population). Pinned by
`TestEligibleGateWidened.test_h_gate_count_equals_freeze_summary`.

**Residence re-baseline (Scope 0, its OWN commit, before any code edit).** `residence_check.py --init` cleared
the develop-merge frontend drift: F2 201->207, F5 114->116 (those increases originate from the develop merge,
NOT this arc). Backend rules B1(0)/B2(8)/B3(40) unchanged -- no backend drift absorbed. Post-edit re-check:
all rules at baseline (delta 0).

**Tests (bench-verified).** `test_pricing` 221 -> **228** (+7: new `TestEligibleGateWidened` (b/d/e/f/g/h) +
copy-forward `test_h`; the (g) inversion + payload-key updates change assertions in place). `test_cross_boq_carry`
40... 48 -> **49** (+1: `test_i`). `test_classify` **62** unchanged. Frontend vitest **907 -> 910** (retired 5
`isNeedsReviewCategory` cases in `ClassifySheetDialog.test.ts` 22->17; added 1 trim case + 7 `isMasterSetBlank`
cases in `PricingGrid.test.ts`). `tsc --noEmit`: ZERO errors in any touched file (the project baseline is
tsc-dirty on legacy `Retired Components`; the build uses vite/esbuild, not tsc).

**Browser live-cert RAN + PASSED** (owner session `admins@nirmaan.app`; mandatory de-stale done -- SW
unregistered, caches/storage cleared, tab closed+reopened, bare root then deep route; BUNDLE-MARKER confirmed:
a never-classified eligible row appears under the Check-Category filter, which the old bundle could not do).
Synthetic data (deleted + verified zero residual after):
- MAIN sheet `BOQ-26-00138` / `G2E CERT ` (rows: 10 LI categorised | 11 LI blank | 12 Preamble-qty blank |
  13 qty-LESS Preamble blank | 14 LI never-classified | 15 Other). C1: `eligible_blank_category_count` = 4 ==
  `get_freeze_summary` sum 4 (2 pre + 2 li); OLD key absent. C2: rate save on the categorised LI -> REFUSED
  (visible red banner). C3: categorise all EXCEPT the qty-less Preamble 13 -> STILL REFUSED (old gate would have
  succeeded). C4: categorise 13 -> save SUCCEEDS. C5: "Check Category" filter surfaces the never-classified row 14.
  C6: filter set {13,14} == amber set {13,14} (SAME set). C7: Other row 15 neither amber nor filtered nor counted.
- CARRY (C8): orig `BOQ-26-00139` + revision `BOQ-26-00140` / `G2E XB ` (dest LI 20,21 categorised + qty-less
  Preamble 22 BLANK). "Carry rates from original" apply -> REFUSED with the mapped friendly message naming the
  dest; nothing written.
- C9 REGRESSION: real fully-categorised `BOQ-26-00114` / `Electrical ` cv1 cell 313 (orig 45000): save 45123
  SUCCEEDED (gate did not block a categorised sheet), RESTORED to 45000, rowset identical.

**OWED / follow-ups:** **G3a** (the banner + live count consuming `eligible_blank_category_count`) is NEXT.
**G2d** (clear the override on re-classify, plus the copy-forward carry-atomicity test gap) is OWED. The
`rate_editable` mode has no consumer until the tendering-module rate helpers arrive. Minor: the SAVE-path throw
message still reads "rate-editable row" (owner-locked existing message, not changed this slice); and a couple of
comment references to `isNeedsReviewCategory` remain in the out-of-scope `boqTypes.ts` / `sheetCategoryResolve.ts`
(comments only, no code impact).

---


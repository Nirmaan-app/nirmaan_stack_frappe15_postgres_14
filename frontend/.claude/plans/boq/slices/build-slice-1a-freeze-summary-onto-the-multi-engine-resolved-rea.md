## Build slice 1a (freeze summary onto the multi-engine resolved read) COMPLETE

BACKEND-ONLY, NO migrate. Branch `feature/boq-pricing-helper`, base tip `6da6b207`.

**Why.** `get_freeze_summary` counted eligible rows lacking a category by calling the SINGLE-discipline
`get_sheet_categories`. On a sheet where two disciplines are both classified, a row categorised only
under the OTHER discipline was counted uncategorised. A forthcoming rate-edit gate needs the SAME
count, so it is built as one shared helper, not inline in the endpoint.

**The shared helper (`persist.blank_category_eligible_rows(boq, sheet_name, committed_version)`).**
Lives in the SERVICE layer (mirrors the `is_sheet_classification_frozen` frozen-reader precedent) so
both `classify.py` and a future `pricing.py` caller reach it without a service->api import. It returns
the eligible rows (node_type in {Line Item, Preamble}, is_current) whose RESOLVED effective category is
blank across EVERY discipline, as `[{excel_row, node_type}]`.
- **Fail-open guard (LOAD-BEARING, pinned by a test):** a row with NO `BoQ Row Category` record at all
  is counted BLANK. Never-classified rows are ABSENT from the resolved category read, so the helper
  keys on the eligible NODE set (the denominator) and applies the ladder to `votes.get(excel_row, {})`
  -- an absent row resolves to `""` (ladder branch 4) and IS counted blank. A count that scanned only
  returned category rows would fail OPEN (report 0 blanks) on a never-classified sheet.
- **Blank criterion = the ladder's effective category is empty** (index [0]), NOT `effective_source ==
  "blank"` -- this matches the old single-discipline `get_sheet_categories` emptiness test exactly, so a
  single-discipline sheet's counts are unchanged.

**One shared ladder.** `_resolve_row_ladder` + `_conf` + `_neg_key` were RELOCATED classify ->
`persist.resolve_row_ladder` (behaviour byte-identical). `get_sheet_categories_resolved` now calls
`persist.resolve_row_ladder`; the helper calls the same. `test_classify` imports the relocated ladder
under its former name (`persist.resolve_row_ladder as _resolve_row_ladder`) so the existing
`TestResolveRowLadder` cases exercise the SAME function. The former `classify._eligible_nodes` reader
was folded into the helper (its logic + the blank resolution now live together, cannot drift).

**Rewire.** `get_freeze_summary` computes its preamble/line-item blank split from
`persist.blank_category_eligible_rows`. Its `discipline` parameter is ACCEPTED (backward-compatible
signature) but NO LONGER USED -- the count resolves across all disciplines. Return keys/types unchanged.

**`get_sheet_categories` stayed BYTE-UNTOUCHED** (hard constraint): it still backs `freeze_classification`'s
stamping/banking. **`freeze_classification` stamping/banking is DELIBERATELY DEFERRED** to its own slice
(multi-discipline stamping is an owner decision, out of scope here).

**Before/after (live, `BOQ-26-00131 | ESTIMATE ` (trailing space), committed_version 2):**
old single-discipline `get_freeze_summary` blank totals = 104 asked `Electrical` (38 preamble + 66 line
item) / 69 asked `HVAC` (23 + 46); NEW resolved = **54** either way (18 preamble + 36 line item),
`discipline` param proven ignored. (The 66/46/36 line-item figures match the Slice-1a recon.)

**Tests (bench-verified):** `test_classify` 55 -> 62 (+7, new class `TestFreezeSummaryResolved`:
helper blank-set across disciplines; positive other-discipline-not-blank; discipline-param-ignored;
never-classified-is-blank (fail-open); blank-on-every-discipline; preamble/line-item split; single-
discipline compat pin). Regression `test_pricing` 189 -> 189 (unmoved). Files: `services/boq_category/
persist.py`, `api/boq/wizard/classify.py`, `api/boq/wizard/test_classify.py`.



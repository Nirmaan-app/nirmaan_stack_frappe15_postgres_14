### Slice B1.1b-fix-A -- flatten_resolved_row writes human_parent=-1 (backend fix)

**Status:** COMPLETE (feat pending; BACKEND ONLY; no frontend changes; tsc/build not required).

**Root cause confirmed (live DB probe, 2026-06-06):** BOQ-26-00145 Electrical sheet -- `parent_index` correct (roots=-1, children=real indices), but `human_parent=0` on all 253 rows. `resolve_effective` treats `human_parent >= 0` as a real override → `effective_parent_index=0` for every row → flat tree.

**The bug:** `flatten_resolved_row` applied the -1 sentinel only to `parent_index` (the structural field), but never set `human_parent`. Frappe coerces unset `Int` fields to `0` on insert. `0` is a valid row index, so `resolve_effective` misread it as "row 0 is this row's parent". The agreement #54 unify was half-applied: write boundary for `human_parent` was the missing half.

**The fix:** Added `"human_parent": -1` to the dict returned by `flatten_resolved_row` in `parse_run.py`. At parse time there is never a human edit, so `-1` (no-override sentinel) is always correct. The explicit write prevents Frappe's Int coercion fallback.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/parse_run.py` -- `flatten_resolved_row`: added `"human_parent": -1` with explanatory comment (agreement #54 rationale).
- `nirmaan_stack/api/boq/wizard/test_parse_run.py` -- 3 new tests: `test_human_parent_is_minus1_sentinel_for_root_row`, `test_human_parent_is_minus1_sentinel_for_child_row` (in `TestFlattenFaithfulness`), `test_human_parent_sentinel_root_resolves_effective_parent_none` (in `TestBoQReviewRowRoundTrip`). 60 → 63 tests; all pass.

**No data repair needed:** Nitesh will re-parse BOQ-26-00145 after this lands; the parse worker deletes and re-inserts all rows, so `human_parent=-1` is written fresh on every re-parse.


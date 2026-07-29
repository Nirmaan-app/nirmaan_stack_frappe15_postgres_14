### Phase 1.9m --- Mode A auto-detect 2-row headers ✅ COMPLETE

Single targeted fix per the 1.9j-1.9n locked plan. Parser source touched:
`_auto_guess.py` only. Test count 324 → 337. Phase 1.x Frappe tests 91 unchanged.

**Mode A (1.9i §22.4 finding) --- merged-cell 2-row headers misread at hrc=1:**

When a sheet uses a two-row merged header and is read at `header_row_count=1`, the
reader flattens merged cells — every continuation cell carries the same text as its
merge origin. This means adjacent columns share identical normalized text in the bottom
header row. The Phase 1 singleton guard in `auto_guess_sheet_config()` fires on the
second duplicate and drops its role assignment, leaving per-area columns without roles.

**Helper: `_should_auto_promote_hrc_to_2(bottom_row, above_row, below_row) → bool`**

Three-condition heuristic (all must hold):
1. bottom_row has ≥ 3 non-blank cells (degenerate sheets don't trigger).
2. At least one pair of ADJACENT columns (col-index difference == 1) in bottom_row
   has identical normalized text (the merged-cell signature).
3. For at least one such duplicate pair, either `above_row` or `below_row` has
   DISTINCT non-blank text at both those column positions (confirms a genuine 2-row
   header rather than a table with legitimately repeated values).

Conservative by design: false negatives are recoverable via
`SheetConfig.top_header_rows_override` (Phase 1.9d F5-b). False positives would
corrupt the parse.

**Signature change to `auto_guess_sheet_config()`:**

```python
# Before (Phase 1.9l):
def auto_guess_sheet_config(reader, sheet_name, header_row,
                             header_row_count: int,
                             reserved_keywords: list[str]) -> SheetConfig

# After (Phase 1.9m):
def auto_guess_sheet_config(reader, sheet_name, header_row,
                             header_row_count: int | None = None,
                             reserved_keywords: list[str] | None = None) -> SheetConfig
```

- `header_row_count=None` (new default) → Mode A auto-detect: reads above + below rows,
  calls `_should_auto_promote_hrc_to_2()`, resolves to `effective_hrc` ∈ {1, 2}.
- Explicit int (1 or 2) → bypasses auto-detect, same behaviour as before.
- `reserved_keywords=None` → resolves to `[]` (backward-compatible).

All existing callers pass explicit positional args `(reader, sheet, hr, hrc, kws)` —
unaffected by the default changes.

**Empirical targets (Phase 1.9i §22.4):**

- Paytm ELEC (header_row=5): adjacent RATE/RATE and AMOUNT/AMOUNT in row 5; below row 6
  has Supply/Installation → `_should_auto_promote_hrc_to_2` returns True → effective_hrc=2.
  BUT "SUPPLY" and "INSTALLATION" are in `multi_area_reserved_keywords`, so
  `detect_multi_area_pattern` returns None on the top row → no per-area roles assigned.
  effective_hrc=2 but area_dimensions=[] → no corruption, no improvement for Paytm.
  Full fix for Paytm deferred (needs non-reserved area names or Pattern 6 detection).
- Paytm HVAC: same shape; same result.
- TS-T2-WEX shape (e.g. "Office"/"Common Area" above "QTY"/"QTY"): adjacent QTY/QTY
  in bottom row; above row has distinct non-reserved names → promotes to hrc=2 → Pattern 1
  (top row fallback) fires → per-area qty roles assigned correctly.

**Implementation:**

- `_should_auto_promote_hrc_to_2()` added after `_normalize()` in `_auto_guess.py`.
- `auto_guess_sheet_config()` early block: if `header_row_count is None`, reads
  `header_row − 1` (if exists) and `header_row + 1`, calls helper, sets `effective_hrc`.
  `effective_hrc` then replaces `header_row_count` in Phase 1, Phase 2, and `SheetConfig(...)`.

**Test calibrations:** None required. All existing tests pass explicit `header_row_count`
values — they route through the `else: effective_hrc = header_row_count` branch, unaffected.

**New tests** in `test_auto_guess.py` (13 total):

`TestShouldAutoPromoteHrc2` (8 helper unit tests):
- adjacent dup + below distinct → True
- adjacent dup + above distinct → True
- no adjacent dups → False
- fewer than 3 cells → False
- adjacent dup + both above/below None → False
- adjacent dup + below matching at dup cols → False
- adjacent dup + below blank at dup cols → False
- non-adjacent dups (gap column) → False

`TestPhase1_9mModeAAutoPromote2RowHeader` (5 integration tests):
- TS-T2-WEX shape: auto-promotes to hrc=2
- all-distinct bottom row: stays hrc=1
- TS-T2-WEX: after promote, Pattern 1 (top) assigns per-area qty to Office + Common Area
- Paytm ELEC shape: promotes to hrc=2 but reserved kws block pattern → area_dimensions=[]
- explicit hrc=1 on promotable sheet: bypasses auto-detect → stays hrc=1, no per-area roles

**Audit-script regression check (agreement #25):**

`classifier_audit.py` does not call `auto_guess_sheet_config` — it uses
`reader.detect_header_row()` and scans headers at its own fixed hrc=1. Stats are expected
flat. Confirmed:
  Before (Phase 1.9l): classified=3970, unclassified=10709, unique_unclassified=2536.
  After (Phase 1.9m): classified=3970, unclassified=10709, unique_unclassified=2536. ✓

**§9 #54 ECHO check:** Synthetic xlsx fixtures perturbed during test run; cleared via
`git restore` before commit (done manually outside Claude Code due to tool hang).

**Status:** CLOSED. Feat commit `c08ebd13`. Docs commit see git log.


### Phase 1.9k --- Mode B + Mode F + F3c broadened ✅ COMPLETE

Three classifier defects fixed in one feat commit. Parser source touched:
`classifier.py`, `multi_area_detection.py`, `classifier_audit.py`. Test count
291 → 312. Phase 1.x Frappe tests 91 unchanged.

**Mode B (1.9i finding) — `_HEADER_KW` vocabulary additions:**
- `qnt`, `qnt.` → qty role (Paytm HVAC target 5, 170 line items with role_unassigned qty).
- `um` → unit role (Kohler HVAC target 11).
- 10 additional entries surfaced from `classifier_audit_output.json` top-200
  unclassified strings:
  - `sl no` → sl_no (unperioded variant; also enables Mode F "Sl No." fix as substring)
  - `sq.ft`, `sqm`, `rmt`, `rft`, `mtr`, `set`, `each` → unit (square feet/meters,
    running meter/feet, meter, set, each — all obvious unit abbreviations)
  - `no's` → qty (possessive/plural of nos, i.e. "numbers")
- `classifier_audit.py` `_CLASSIFIER_HEADER_KW` frozen replica synced
  (agreement #21 mechanical cascade). Sync comment updated to Phase 1.9k.

**Mode F (1.9i finding) — trailing-punctuation normalization:**
- Normalization at `classify_row()` header-repeat step (line 434 in `classifier.py`)
  extended: `_to_str(c.value).lower().rstrip(".:") `
- Affects: `Sl No.`, `SL NO.`, `Qty.`, `S No:`, and any trailing-period / trailing-colon
  variants across the corpus.
- Call-site scope: local to the header-repeat detection in `classifier.py`. Does NOT
  modify `multi_area_detection.py`'s `_is_reserved` (separate normalization path,
  reserved keywords from GlobalSettings do not typically have trailing periods).
- `classifier_audit.py` `_match_role()` normalization synced to same `rstrip(".:").
- **Audit magnitude**: Mode F contributed substantially more matches than Mode B alone.
  Classified count jumped from 3255 → 3970 (+715). The 715 delta vs ~12 vocabulary
  additions confirms Mode F's `rstrip` caught a large trailing-period long tail across
  the 25-workbook corpus.

**F3c broadened (Phase 1.9e finding) — `_RATE_CELL_PATTERN`:**
- Was: anchored regex `r"^\s*rates?\s*$"` (required cell to be exactly "rate"/"rates").
- Now: word-boundary regex `r"\b(rates?|costs?|prices?)\b"` (rate/cost/price family).
- Call-site changed from `.match()` to `.search()` (non-anchored regex requires search).
- Recognizes rate-family words anywhere in the cell text: `Per Unit Rate`,
  `Supply Rate`, `Rate (INR)`, `Unit Cost`, `Unit Price`, etc.
- Empirical basis: 62 cases (60 rate + 2 price) from Phase 1.9e stress test.
- False-positive risk bounded by Pattern 2-rate detection's call-site context
  (only consulted after a 3-col merge structure is already confirmed).
- Word-boundary semantics verified by `test_costing_does_NOT_match_word_boundary_check`
  — "Costing" does NOT match.
- F3c does NOT affect `classifier_audit_output.json` output (classifier_audit.py
  only uses classifier.py's `_match_role`, not multi_area_detection).

**Audit-script regression check (agreement #25):**
- `classifier_audit_output.json` regenerated.
- Before (v5.10 §17.11.F): classified=3255, unclassified=11424, unique_unclassified=2697.
- After (Phase 1.9k): classified=3970, unclassified=10709, unique_unclassified=2536.
- Net delta: classified +715; unclassified -715; unique_unclassified -161.
- Direction consistent with additive vocabulary + normalization broadening. No unexpected
  classification flips.

**Test calibration (§9 #73 path-shift pattern):** None required. All existing tests
continued to pass without modification. No test asserted that QNT/UM/Sl No. should
stay unclassified, and no Pattern 2-rate test asserted that non-bare-Rate headers should
fail detection.

**Test count:** 291 → 312. New tests:
- `TestPhase1_9kModeBAndF` in `test_classifier.py` (10 tests: QNT, QNT., UM, Sl No.,
  SL NO., Qty., No's, Sq.ft, Rmt, Each).
- `TestPhase1_9kF3cBroadenedRateCellPattern` in `test_multi_area_detection.py` (11 tests:
  Per Unit Rate, Supply Rate, Rate (INR), Unit Cost, Unit Price, bare Rate, bare Rates,
  Costing word-boundary guard, unrelated text guard, Per Unit Rate integration,
  Unit Cost integration).

**§9 #54 ECHO check:** xlsx fixtures perturbed by test runs; cleared via
`git restore nirmaan_stack/services/boq_parser/tests/fixtures/*.xlsx` before commit.

**Status:** CLOSED. Feat commit `3cc3819c`. Docs commit see git log.


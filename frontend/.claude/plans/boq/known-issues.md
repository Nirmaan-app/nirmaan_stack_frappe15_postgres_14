# BoQ — Known Parser Issues

## Contents
- 17.1 Pattern Y multi-dot ambiguity (level resolution)
- 17.2 Stray `Note` sl_no rows misclassified as PREAMBLE
- 17.3 Unnumbered section headers classified as NOTE; Phase 3 wizard handles promotion to PREAMBLE
- 17.4 Stale repo clone at `C:\Users\nites\Documents\nirmaan_stack_frappe15_postgres_14\`
- 17.5 Raheja-style Pattern 2 variant — 3-col-per-area with rate column
- 17.6 Fixtures folder contains only synthetic files; v5.3 "locked fixtures" claim was aspirational
- 17.7 docker cp temp-file cleanup requires `-u root` flag
- 17.8 Multi-area reserved keyword list — thorough survey deferred to Phase 2c
- 17.10 Phase 2c reserved keyword expansion did not reach detection target on first pass — targeted follow-on landed
- 17.11 Phase 2c caveats #2 + #4 cleanup — qty_by_area deprecation + 2-row Pattern 2 detection coverage
- 17.11.C Phase 2c §9 #45 priced-PREAMBLE-with-children review-flag implementation
- 17.11.D Phase 2c §9 #49 reader sheet_state exposure
- 17.11.E Phase 2c §9 #48 classifier-dictionary audit
- 17.11.F Phase 2c §9 #48 classifier-dictionary expansion + multi-area keyword expansion
- 17.11.G Phase 1.9c real-fixture integration tests (Raheja Electrical + HVAC + D-Tech CIVIL WORKS)
- 17.9 Preamble stack-depth cascade in hierarchy resolver — parked
- 17.10 Priced PREAMBLE with tree children — re-parenting deferred
- 17.12 Skip-then-ingest sheet type — parked
- 17.13 Wizard-load review pending — cumulative deferred-to-wizard inventory + UX-friction concern
- 17.14 #74 [DOCUMENTED v5.18] — Diagnostic-script forces header_row_count=1
- 17.15 #75 [DOCUMENTED v5.18] — Amount-family metric over-counts
- 17.16 #76 [MITIGATED v5.19] — PowerShell Select-Object -Last N pipe deadlock
- 17.17 #77 [MITIGATED v5.19] — Unicode section sign mangled by Windows/Docker heredoc
- 17.18 #78 [MITIGATED v5.19] — docker exec -w flag failure in some PowerShell quoting contexts
- 17.19 #79 [DOCUMENTED v5.19, RESOLVED v5.21] — v2 fixture shape only partially handled by Phase 1.9o
- 17.20 #80 [OPEN v5.20] — test_auto_guess.py entirely mock-based
- 17.21 #81 [OPEN v5.20, deferred] — Output filename drift from 1.9j checkpoint
- 17.22 #82 [DOCUMENTED v5.20] — Pre-1.9o synthetic fixtures embed two opposite conventions
- 17.23 #83 [OPEN v5.20, deferred to wizard] — Three coexisting header conventions in real BoQs
- 17.24 #84 [CLOSED v5.21 by feat 47090d7d] — Convenience field summation gap (Bug 6)
- 17.25 #85 [CLOSED v5.21 by feat 9a5b16cb] — Keyword vocabulary missing word-order variants (Bug 7)
- 17.26 #86 [CLOSED v5.22 by feat 798f4fd2] — Same-row =SUM() SUBTOTAL_MARKER misfire (Bug 10)
- 17.27 #87 [CLOSED v5.25 via A1+A2 land] -- Pattern-consistency mismatch in PREAMBLE vs LINE_ITEM (Bug 11)
- 17.28 #88 [OPEN v5.21, TARGET NEXT] — Section heads pinned at L1, intermediate hierarchy traversal lost (Bug 12)
- 17.29 #89 [CLOSED v5.23] — Excel error literals classified as content (Bug 13)
- 17.30 #90 [OPEN v5.21, LOW PRIORITY] — Letter-suffix peer items get nested levels (Bug 14, cosmetic)
- 17.31 #91 [PHASE 3 SPEC v5.21] — Wizard design: area name suffix normalization (Finding 15)
- 17.32 #92 [PHASE 3 SPEC v5.21] — Wizard design: single non-merged area column adjacent to merged group (Finding 16)
- 17.33 #93 [MITIGATED v5.21] — MSYS path conversion on Windows docker exec
- 17.34 #94 [MITIGATED v5.21] — Docker cp over heredoc corrupts ownership
- 17.35 #95 [LESSON v5.21] — Claude Code scope overreach during Sequence E
- 17.36 #96 [PATTERN v5.21] — Large output file, desktop-pull pattern
- 17.37 [DIAGNOSTIC v5.23] — §7.28 orphan-children audit (read-only diagnostic)
- 17.38 [DIAGNOSTIC v5.23] -- Bill Of Quantities Electrical & ELV rows 4-22 comparison audit
- 17.39 [DIAGNOSTIC v5.25] -- Approach A-reframed audit (sec 9 #99 gating, feat 16647958)
- 17.40 [LANDED v5.25] -- Approach A-reframed land (sec 9 #99 CLOSED, feat 8f960a2b)
- 17.41 [LANDED v5.25] -- SUB HEAD detection + universal subtotal-reset (sec 9 #100 + #101 CLOSED, feat 25a43617)
- 17.42 [PARKED v5.25] -- Bug 12 priced section-header detection (sec 9 #88, Phase 3+ AI layer)
- 17.43 [PARKED v5.25] -- Bug 15 priced-sub-section-header mis-classification (sec 9 #102, Phase 3+ AI layer)
- 17.44 [CYCLE 3 DEEP DIVE -- 9 DETERMINISTIC FIXES -- FIX QUEUE v5.26]
- 17.45 [CLOSED 2026-06-24, feat pending] -- PREAMBLE rows silently dropped their source quantities (no-attribute-loss / Option B)
- Row-detail panel read views (review screen, FRONTEND-only, 2026-06-25)
- Fuzzy description search (review screen, FRONTEND-only, 2026-06-25)

## 17. Known Parser Issues

Issues identified during real-BoQ verification. Each entry has a disposition: deferred or requires Phase 3 wizard action.

### 17.1 Pattern Y multi-dot ambiguity (level resolution)

**Issue:** In BoQs with numeric top-level coding (1., 2., ...) and letter sub-sections (A., B., ...), multi-dot sub-codes like `1.1` that appear under an `A.` parent are structurally ambiguous — they could be a sibling of `A.` at level 2, or a child of `A.` at level 3. The resolver cannot distinguish without user intent.

**Current behavior:** Resolver emits a warning with `category=ambiguous_level_pattern_y` and assigns default depth (1 + dot count). The tree structure is plausible but may not match the source document's intent.

**Disposition:** Defer to Phase 3 wizard. Phase 3 mapping UI will surface rows with this warning and let the user confirm or override the assigned level before saving. Working agreement #18 (TBD): all `ambiguous_level_pattern_y` warnings surface as explicit confirmation prompts in Phase 3 review step.

### 17.2 Stray `Note` sl_no rows misclassified as PREAMBLE

**Issue:** Some BoQ files include sl_no cells containing the literal text "Note" or "NOTE" followed by a description but no quantity. The classifier correctly routes these to PREAMBLE (sl_no + description, no qty) but they are not section headers — they are annotation notes.

**Current behavior:** These rows are inserted into the preamble stack, potentially becoming unwanted parent nodes for subsequent line items. One occurrence confirmed in JSW Elect B1.

**Disposition:** Visible but not catastrophic — the note becomes a leaf preamble with no line-item children in the one observed case. Defer: in Phase 3, add a reserved-keyword filter to the classifier that treats sl_no values matching `^note$` (case-insensitive) as NOTE classification regardless of description presence.

### 17.3 Unnumbered section headers classified as NOTE; Phase 3 wizard handles promotion to PREAMBLE

**Issue:** Some BoQ authors (observed in Inovalon HVAC) use unnumbered bold text-only rows as section headers. These have no sl_no value, so the classifier routes them to NOTE — not PREAMBLE. They are structurally preambles but visually indistinguishable from genuine annotation notes by pattern alone.

**Current behavior:** These rows are inserted as NOTE nodes in the resolved tree with no preamble-stack effect. Subsequent line items are parented to the last real PREAMBLE, not to the bold header. The hierarchy is therefore correct but misses an implicit grouping level.

**Scoring signals (implemented in `populate_preamble_candidate_scores()`):**
- Bold formatting on description cell: +2
- First note in a contiguous note-block (allowing spacers) terminated by a LINE_ITEM: +2
- Description shorter than 80 characters: +1

Score ≥ 2 is the Phase 3 promotion threshold. Score stored in `ClassifiedRow.preamble_candidate_score`; signal names in `ClassifiedRow.preamble_candidate_signals`.

**Phase 3 wizard responsibilities:**
1. Surface NOTE rows with score ≥ 2 as "could this be a section header?" prompts in the review step.
2. Provide a "Promote note → preamble" action that converts the NOTE to a PREAMBLE and re-runs hierarchy resolution for the affected subtree.
3. Provide a "Create new preamble from scratch" action for cases where no NOTE candidate exists (sets `ResolvedRow.is_synthetic = True`).

**Phase 2c (DB commit) responsibility:** Pass `preamble_candidate_score` and `preamble_candidate_signals` through to the BOQ Node record so Phase 3 can surface them without re-parsing.

**Deferred parser-side fix:** A future signal could use column-position heuristics (description starts in sl_no column rather than description column) to disambiguate at classify time. Not implemented — too many false-positive risks with current test corpus.

**Disposition:** Parser-side scoring implemented (Phase 2b.1b). Phase 3 wizard action deferred to Phase 3 planning.

### 17.4 Stale repo clone at `C:\Users\nites\Documents\nirmaan_stack_frappe15_postgres_14\`

**Issue:** There is a second nirmaan_stack repo clone on Nitesh's machine at `C:\Users\nites\Documents\nirmaan_stack_frappe15_postgres_14\`. That clone only has `feature/boq-phase-0` and `feature/boq-phase-1` branches — it does NOT have `feature/boq-phase-2` or any Phase 2 work.

**Critical pointer:** All BoQ Phase 2+ work MUST happen in the live working repo at `C:\Users\nites\Documents\frappe_docker\development\frappe-bench\apps\nirmaan_stack\`. At the start of every session, verify `pwd` output contains `.../frappe_docker/development/frappe-bench/apps/nirmaan_stack` before writing any code.

**Disposition:** Do NOT delete the stale clone — it may have independent history worth preserving. It is simply not the active development copy. If Claude Code ever opens in the stale clone by accident, stop immediately and switch to the live repo.

### 17.5 Raheja-style Pattern 2 variant — 3-col-per-area with rate column

**Issue:** Real BoQ files from Raheja Commerzone Chennai exhibit a Pattern 2 variant not handled by the current `detect_multi_area_pattern()` algorithm. The top row has area names in merged cells, but each merge spans **three** columns (not two), with the bottom row containing `[Qty][Rates][Amount]` under each merge (not `[QTY][AMOUNT]`). The current Pattern 2 algorithm (`_try_pattern_2` in `multi_area_detection.py`) is hardcoded to:
- Reject merges where `(max_col - min_col + 1) != 2` (2-col merges only)
- Require bottom-row pairs to match `_QTY_CELL_PATTERN` and `_AMOUNT_CELL_PATTERN` exactly (no rate cell in between)

Both checks fail on Raheja sheets. Detection priority falls through P2 → P3 (bottom: only reserved keywords) → P1 (bottom: only reserved keywords) → P1 (top, last-resort): finds the merge origins, returns `MultiAreaPattern(pattern=1, areas=[...], amount_columns=None)`. The result is technically "valid output" but factually wrong — areas have per-area amounts AND per-area rates that the Pattern 1 designation does not represent.

**Real-data evidence:** Verified 2026-05-13 across all sheets of `RAHEJA Commerzone Chennai BOQ.xlsx`. Every sheet uses the 3-col-per-area variant. The "Phase 1 / Phase 2" naming pattern and 3-col `Qty / Rates / Amount` shape are uniform.

**v5.3 documentation drift:** v5.3 §3 names Raheja as the "primary Pattern 2 validation target" — this assumption was wrong; Raheja does not match the textbook Pattern 2 spec at all.

**Disposition:** Defer to **Part D** (which already holds Pattern 4 + Pattern 6 candidate work) OR create a new dedicated sub-phase **Part D2 — Pattern 2-rate extension**. Likely scope: a new pattern designation (e.g., `pattern=4` if not already taken, or extending `MultiAreaPattern` with an optional `rate_columns` field), an extended detection algorithm accepting 3-col merges with `[QTY][RATE][AMOUNT]` pairing, ~3-5 new tests, and real-data re-verification on Raheja. Schema-side support already exists in Part A2 (`qty_by_area`, `amount_by_area`, and per-sheet `rate_combined` ColumnRoles are sufficient to represent the shape without new schema work).

**Status:** Open. Not blocking Part B or Phase 2c. Blocking only Raheja-specific parsing.

**Status updated 2026-05-16:** Re-opened. Absorbed into Phase 1.9 parser support scope. The 3-col-per-area shape detection lands as part of the per-area rate+amount schema extension work (see §7.32). No standalone follow-on sub-phase.

### 17.6 Fixtures folder contains only synthetic files; v5.3 "locked fixtures" claim was aspirational

**Issue:** v5.3 §3 and working agreement #12 (2026-05-10) state that real BoQ files (specifically JSW MEP Priced and Snitch) are "locked fixtures" committed to `nirmaan_stack/services/boq_parser/tests/fixtures/`. Inspection on 2026-05-13 shows that folder contains ONLY synthetic files:

- `generate_synthetic.py` (the generator script)
- `synthetic_blank_cols.xlsx`
- `synthetic_empty.xlsx`
- `synthetic_makelist_header.xlsx`
- `synthetic_merged_header.xlsx`
- `synthetic_simple.xlsx`
- `synthetic_sparse_header.xlsx`
- `synthetic_trailing_spaces.xlsx`

A `Get-ChildItem -Recurse -Filter "*JSW*"` across the entire `nirmaan_stack` repo on 2026-05-13 returned zero results.

**Root cause:** Working agreement #12 declared the intent to commit real fixtures, but the actual commit appears never to have happened. v5.3 was written as if the commit had landed.

**Impact:** Phase 2c (DB commit + version cascade + fixtures) cannot proceed against committed real fixtures because they don't exist in the repo. They currently live only on Nitesh's local disk at `C:\Users\nites\Downloads\`.

**Disposition:** **Phase 2c first action — commit the real fixtures.** Before adding any DB commit logic or version cascade tests, copy the real BoQ files into `tests/fixtures/` and commit them via a dedicated `chore(boq):` or `feat(boq):` commit. The handover doc's "locked fixtures" claim then becomes accurate. Per working agreement #12, no anonymization needed (this is an internal repo).

**Files to commit at Phase 2c kickoff:** at minimum `JSW MEP Priced` and `Snitch`. Additional fixtures (Raheja, TableSpace, DhashTech, Société Générale, etc.) can land in batches as Phase 2c progresses.

**Status (updated 2026-05-15):** CLOSED. 24 real BoQ fixtures committed at Phase 2c kickoff via feat commit `cfeaad1c`. Fixtures directory now contains: 8 synthetic files (7 originals + 1 synthetic_multi_area still untracked per B2a) + 1 Snitch (committed in B2c) + 24 real BoQ files = 33 total xlsx fixtures in tests/fixtures/. MappingConfig authoring for each new fixture deferred to per-fixture sub-phases later in Phase 2c. §9 #40 (handover doc) and §17.6 (plan doc) considered closed by this commit.

### 17.7 docker cp temp-file cleanup requires `-u root` flag

**Issue (operational):** When using `docker cp` to copy a temporary file into the Frappe container for manual verification (e.g., Session 4 real-data verification), the file lands inside the container as `root:root` owned. The default user when running `docker exec frappe_docker_devcontainer-frappe-1 ...` is the `frappe` user, who cannot delete root-owned files in `/tmp/`.

**Resolution:** Cleanup command needs `-u root`:

```
docker exec -u root frappe_docker_devcontainer-frappe-1 rm /tmp/<temp_file>.xlsx
```

**Standing rule for future docker-cp-based verifications:** include `-u root` in any `rm`/cleanup commands targeting files placed by `docker cp`. Verified and applied 2026-05-13 during Session 4 cleanup of `/tmp/jsw_test.xlsx`.

**Worst case if `-u root` is forgotten:** the temp file persists in `/tmp/` until container restart. Harmless (just untidy) since `/tmp/` is volatile.

### 17.8 Multi-area reserved keyword list — thorough survey deferred to Phase 2c

**Issue:** The `GlobalSettings.multi_area_reserved_keywords` list was initially set to 22 entries (Part A2) and expanded to 49 entries during Part B2b-keywords (triggered by the Snitch Light Fixtures false positive). The expansion was reactive — driven by one specific false positive, not a systematic survey of all header-word variants across the real-BoQ corpus.

**Known gaps:** No cross-file keyword analysis has been performed. Additional header words from JSW, Raheja, Paytm, Inovalon, HYBE, and other fixtures may still produce false positives in Pattern 1 detection when those files are parsed in Phase 2c.

**Disposition:** Defer systematic survey to Phase 2c. At Phase 2c kickoff, run `detect_multi_area_pattern()` against all committed real fixtures and inspect the output for false-positive areas. Any false-positive area name → add the offending header word to the reserved list. Working agreement: Phase 2c first-run verification step explicitly includes a keyword sweep before authoring any expected-output JSON.

**Status (updated 2026-05-15): CLOSED.** Audit half: `keyword_audit.py` (feat `da105976`) surfaced 125 candidate detections across 25 real fixtures. Expansion half (feat `824e3634`): 49→120 keywords (+71 in 6 buckets) + `_is_reserved` whitespace normalization + parenthetical strip. Post-expansion audit count: 112 (down from 125). The <50 target was not reached because the fixture set includes ~25+ genuine multi-area BoQs (RAHEJA PHASE-1/PHASE-2: 14 blocks, D-Tech floor-based: ~8, JSW MEP: 2) that are correctly detected and must not be suppressed. Remaining false positives (column headers: AREA/ACTIVITY/WORKITEM in D-Tech civil sheets; revision metadata: REV/RO in top-row fallbacks) are candidates for a follow-on keyword pass if needed. §9 #44 CLOSED on keyword-expansion landing; post-expansion sweep of remaining blocks is a non-blocking future caveat.

### 17.10 Phase 2c reserved keyword expansion did not reach detection target on first pass — targeted follow-on landed

**Issue:** Phase 2c keyword expansion sub-phase (feat `824e3634`, docs `db80d27e`) expanded `multi_area_reserved_keywords` from 49 to 120 entries with 71 new entries across 6 buckets (generic construction terminology: SQFT, NUMBER, BRAND, MARKET RATE, etc.). The post-expansion audit re-run dropped detection count from 125 to 112 — well above the spec'd <50 target. Root cause: the 71 entries committed did not match the specific false-positive triggers surfaced in the §9 #44 audit data (metadata top-row labels, per-row-attribution columns, space-and-typo Sl.No variants, etc.).

**Disposition:** Targeted follow-on sub-phase (feat `010666cc`, this docs commit): 71 specific entries added based on direct mapping from audit findings to false-positive triggers. List grows 120 → 191 entries. Post-targeted audit count: 50 detections (down from 112).

**Status (updated 2026-05-15): CLOSED.** §17.10 marked closed on targeted-additions landing. Of the 50 remaining detections, approximately 25 are genuine multi-area BoQ layouts (RAHEJA PHASE-1/PHASE-2 across 14 sheets, JSW MEP B1/B2/B3/B6, D-Tech per-floor floor-name areas, Bill of Quantities AV floor-names, DHL FK-5-1-12 critical-room areas, Voyager/Victor compound names on Société Générale) and must be preserved. Net real false positives remaining: roughly 25. These are candidates for structural heuristics (top-row title-repetition detection, sparse-metadata pattern detection) rather than keyword expansion — deferred as a future caveat if the residual false-positive count proves to be blocking during per-fixture MappingConfig authoring sub-phases.

### 17.11 Phase 2c caveats #2 + #4 cleanup — qty_by_area deprecation + 2-row Pattern 2 detection coverage

**Caveat #2 (§9 #42) — `qty_by_area` role removed from `ColumnRole.role` Literal:** The `qty_by_area` role was added in Part A2 as a parallel to `amount_by_area`, but the classifier never wired it — all per-area qty capture always used `role="qty"` with an `area=` field. The role was dead code in the Literal. Cleanup: removed `qty_by_area` from the `ColumnRole.role` Literal (it was already absent from `_AREA_COMPATIBLE_ROLES`). Validator `area_required_for_by_area_roles` renamed to `area_required_for_amount_by_area_role` and simplified to check only `amount_by_area`. Cascades: `test_qty_by_area_with_area_succeeds_in_full_sheetconfig` (test 17) updated to `role="qty"` (mechanical cascade per agreement #21); `test_pattern_4_full_mapping_validates_successfully` (test 21) updated similarly. New test 22 added: `test_qty_by_area_role_rejected_after_deprecation` — `ColumnRole(role="qty_by_area", area="Floor 1")` raises ValidationError even with area set. `test_config.py` count: 21 → 22.

**Caveat #4 (§9 #43) — premise correction + 2-row coverage gap:** Original framing in §9 #43 stated that `parse_boq()` on `synthetic_multi_area.xlsx` returned `multi_area_pattern=None` for the 1-row fixture and needed fixing. Step 0 verification revealed this premise was **wrong**: the fixture already returns `MultiAreaPattern(pattern=1, areas=['Floor 1', 'Floor 2'])` as of the current code. The "Total Qty" column (F1) appears AFTER "Floor 1" (D1) and "Floor 2" (E1), so Pattern 1 collects 2 areas before the `TOTAL_QTY_PATTERN` break. The `parse_boq()` result had always been non-None; the caveat's premise was stale. **Reframe (user-confirmed):** (a) Add Pattern 1 assertions to the existing 1-row integration test (`test_multi_area_post_pass_full_pipeline`) to lock in the now-verified passing behaviour; (b) Add a new 2-row Pattern 2 fixture (`synthetic_multi_area_2row.xlsx`) via `generate_multi_area_2row()` to cover the genuine 2-row header mode gap. The 2-row fixture has top header (row 1) with `Block A` / `Block B` merged cells and bottom header (row 2) with `Qty` / `Amount` pairs — `header_row=2, header_row_count=2`. New integration test class `TestMultiAreaDetectionIntegration` (1 test) verifies end-to-end `pattern=2`, `areas=["Block A", "Block B"]`, and per-area qty on resolved rows. `test_orchestrator.py` count: 27 → 28.

**Status (updated 2026-05-15): CLOSED.** Both caveats resolved in feat commit `c6910c71`. Test count: 205 → 207 (test_config 21→22 + test_orchestrator 27→28). `synthetic_multi_area_2row.xlsx` is generated at test runtime by `setUpClass`; the file is untracked alongside `synthetic_multi_area.xlsx`.

### 17.11.C Phase 2c §9 #45 priced-PREAMBLE-with-children review-flag implementation

**Implementation (§9 #45):** Two new fields added to `ResolvedRow` in `hierarchy.py`: `needs_classification_review: bool = False` and `review_reason: str = ""`. New post-pass `_apply_priced_preamble_with_children_review_flag_post_pass(resolved_rows)` added to `hierarchy.py`, wired in `orchestrator.py` between Step 4a (zero-children demotion) and Step 4b (multi-area post-pass) per §7.30. The post-pass flags any PREAMBLE that (a) has tree children (path in `paths_with_descendants`) AND (b) carries a price signal (alphanumeric unit string OR any rate field > 0). Flagged rows: `needs_classification_review=True`, `review_reason="priced_preamble_with_children"`. Re-parenting and demotion are NOT performed by the parser — the Phase 3 wizard reads `review_reason` to launch the re-classification flow.

**Audit (§9 #45 pre-step):** Audit script `nirmaan_stack/services/boq_parser/preamble_with_children_audit.py` (feat commit `1ad12a7b`) confirmed exactly one candidate across Snitch Electrical: resolved_idx=500, xlsx_row=502, sl_no='2.0', path='394/500', unit='LS', 5 direct children, `children_shape="siblings"`. No candidates in synthetic_simple. Re-running the audit on the current tip will now show row 500 with `needs_classification_review=True` on the parsed output (the audit script itself is unchanged — it reports the candidate, not the flag state).

**Test coverage:** 9 new tests in `TestPricedPreambleWithChildrenReviewFlag` (test_hierarchy.py) + 1 Snitch integration test `test_snitch_row_500_flagged_for_priced_preamble_with_children_review` (test_orchestrator.py). Test count: 207 → 217.

**Status (updated 2026-05-16): CLOSED.** feat commit `7ff4ce55`, docs commit this session. §17.10 (Priced PREAMBLE with tree children) updated to CLOSED. Next: Reader `sheet_state` exposure (§9 #49).

### 17.11.D Phase 2c §9 #49 reader sheet_state exposure

**Implementation (§9 #49):** New method `BoqReader.list_sheet_states() -> dict[str, str]` added to `reader.py` as a pure pass-through over openpyxl's `Worksheet.sheet_state`. Return value maps each sheet name (exact whitespace + casing, matching `list_sheets()`) to its visibility string — one of `'visible'`, `'hidden'`, or `'veryHidden'` — exactly as openpyxl yields them. No normalisation, no enum wrapper, no caching. Placement: immediately after `list_sheets()` in `reader.py`. No changes to any other source module.

**Design (§7.31):** See decisions log entry.

**Test coverage:** New `TestSheetStateExposure` class (4 tests) added to `test_reader.py`. Tests cover: all-visible default, one hidden sheet, one veryHidden sheet, and whitespace/order preservation. All use in-memory `openpyxl.Workbook` + `tempfile.TemporaryDirectory()` per-test (no committed fixture changes). Test count: 217 → 221.

**Non-breaking:** Additive only. No existing method changed. No existing test modified.

**Status (2026-05-16): CLOSED.** feat commit `3e9eafe0`. Next: §9 #48 classifier-dictionary audit half (see §17.11.E).

### 17.11.E Phase 2c §9 #48 classifier-dictionary audit

**What the script does:** Walks all 25 non-synthetic fixtures in `tests/fixtures/`, scans the first 15 rows of every sheet, and for each row with ≥ 3 non-empty cells tests every cell value against the classifier's `_HEADER_KW` dictionary. Records every string that no role's keyword set matches as "unclassified". Emits a JSON report with per-row detail, an unclassified-string frequency rollup, and summary counts.

**Script:** `nirmaan_stack/services/boq_parser/classifier_audit.py`

**Output JSON:** `nirmaan_stack/services/boq_parser/classifier_audit_output.json` (~5.4 MB)

**Run command (inside container):**
```bash
cd /workspace/development/frappe-bench/apps/nirmaan_stack
/workspace/development/frappe-bench/env/bin/python -m nirmaan_stack.services.boq_parser.classifier_audit
```

**Audit summary (from output JSON):**
- Fixtures attempted: 25 (24 scanned; 1 failed — `R0_CIVIL INTERIOR & MEP_TABLESPACE_PUNETH WORKING FILE_06.05.2026 (2).xlsx` contains invalid XML)
- Sheets scanned: 283
- Rows scanned (≥ 3 non-empty cells): 2,187
- Total cells scanned: 14,679
- Total classified: 1,770 | Total unclassified: 12,909
- Unique unclassified strings: 2,999

**Top 5 unclassified header strings by frequency (headers only — numerics dominate the raw rollup):**
1. `AMOUNT` (100 occurrences) — amount_total synonym family
2. `Sq.ft` (91) — unit/measurement column
3. `Amount` (71) — amount_total synonym (case variant)
4. `Rate` (67) — rate_combined synonym family
5. `Remarks` (64) — row_notes synonym family

**Note on rollup composition:** The raw top-frequency unclassified strings are dominated by numeric cell values (`0`: 2243, `1.0`: 295, etc.) because the first 15 rows of many fixtures include data rows that pass the ≥3 filter. These are expected junk that the expansion-half reviewer must filter. True column-header synonyms include: `Supply & Installation` (40), `SUPPLY & INSTALLATION` (20), `INSTALLATION` (29), `SUPPLY` (29), `Total Amount` (32), `Installation Rate` (25), `Supply Rate` (22), `SL. NO.` (17), `UOM` (11), `DSR` (12), `Make` (12).

**Status: CLOSED.** chore commit `f89e2478`. Next: §9 #48 classifier-dictionary expansion half (expansion-half sub-phase adds synonyms to `_HEADER_KW` in `classifier.py`).

### 17.11.F Phase 2c §9 #48 classifier-dictionary expansion + multi-area keyword expansion

**`_HEADER_KW` expansion (classifier.py):** Dict expanded from 5 to 14 role keys. The existing 5 keys (`sl_no`, `description`, `unit`, `qty`, `qty_total`) received audit-derived synonyms (e.g. `"sl. no"`, `"sr. no"`, `"si.no"`, `"particulars"`, `"item description"`, `"discription"`, `"uom"`, `"u.o.m"`, `"boq qty"`, `"total qty"`). Nine new role keys added: `rate_combined`, `rate_supply`, `rate_install`, `amount_total`, `amount_combined`, `amount_supply`, `amount_install`, `make_model`, `row_notes` — covering the rate/amount supply-install-combined split and make/notes label families prominent in real BoQ fixtures.

**`multi_area_reserved_keywords` expansion (config.py):** List expanded 191 → 224 (33 net new entries). New entries cover: SITC / S&I family (16 entries: SITC, S&I, S+I, SITC RATE, SITC AMOUNT, S&I RATE/AMOUNT, S+I RATE/AMOUNT, SUPPLY & INSTALLATION variants, SUPPLY AND INSTALLATION variants, SUPPLY, INSTALL & COMMISSIONING RATE), U.O.M, six "IN INR/RS" variants (RATE IN INR, RATE IN RS, RATE IN RS., AMOUNT IN INR, AMOUNT IN RS, AMOUNT IN RS.), NDSR (MR), COMBINED AMOUNT, six "AS PER BOQ" compounds (including a real-BoQ typo variant AS PER BNOQ TOTAL AMOUNT), SR., and AREA OF WORK. Seven entries from the original 41-entry spec were dropped as already-present duplicates (UOM, SPECS, SPECIFICATIONS, COMBINED RATE, FLOOR, LOCATION, NO.); original spec count was 40 not 41 (off by 1), giving 40 − 7 = 33 net new entries.

**classifier_audit.py sync (mechanical cascade, agreement #21):** The `_CLASSIFIER_HEADER_KW` frozen replica in `classifier_audit.py` was synced from 5 to 14 keys to match `_HEADER_KW`. Previously the replica was frozen at audit time; the sync makes future re-runs reflect the live dict. The "intentionally frozen" comment was updated to "synced as of Phase 2c §9 #48 expansion".

**Audit re-run delta (after sync):** classified 1,770 → 3,255 (+1,485 / +83.9%); unclassified 12,909 → 11,424 (−1,485); unique unclassified 2,999 → 2,697 (−302 / −10.1%). Total cells scanned unchanged (14,679) — same fixtures, same rows, only classification improved.

**Test count delta:** +10 in `TestHeaderKwExpansionPhase2c` (test_classifier.py — 8 required + 2 extra for `particulars` and `boq qty` synonyms), +6 in `TestReservedKeywordExpansionPhase2cSitcAndCombinedRoles` (test_multi_area_detection.py). Mechanical assertion bump in test_config.py (191 → 224, +5 spot-check entries: SITC RATE, SUPPLY & INSTALLATION, RATE IN INR, AS PER BOQ TOTAL AMOUNT, NDSR (MR)). Parser test count: 221 → 237.

**Non-breaking:** Pure data additions to both lists. No changes to `_is_reserved` matching logic, `classify_row` flow, or `detect_multi_area_pattern` algorithm. Existing parser behaviour fully preserved.

**Status: CLOSED.** feat commit `a0d2b4a5`. Next: DB commit + version cascade sub-phase.

### 17.11.G Phase 1.9c real-fixture integration tests (Raheja Electrical + HVAC + D-Tech CIVIL WORKS)

**Goal:** Add real-fixture integration tests to `test_orchestrator.py` covering three fixtures. No parser code changes. No Frappe code changes.

**Fixtures covered:**

1. **Raheja Commerzone Electrical sheet** ("Electrical ", trailing space) — Pattern 2-rate end-to-end with inline MappingConfig. Finding F3b confirmed: bottom header has "RATES" (plural); `_RATE_CELL_PATTERN` rejects it; pattern falls through to Pattern 1. `test_electrical_pattern_2_rate_detected` marked `@unittest.expectedFailure`.
2. **Raheja Commerzone HVAC sheet** ("HVAC ", trailing space) — Pattern 2-rate stress test. Finding F5 confirmed: area-name row is row 2 but `top_header_row` is hardcoded to `header_row − 1 = row 14` (blank intermediate row); no area names found. `test_hvac_pattern_2_rate_with_header_gap` marked `@unittest.expectedFailure`. F5 is distinct from F3b: HVAC bottom header has "RATE" (singular) — rejection is caused by wrong `top_header_row`, not RATES-plural mismatch.
3. **D-Tech CIVIL WORKS sheet** — `append_to_notes` end-to-end. Row 1 has a merged "PHASE-0" banner spanning all columns including G (Specs); `skip_top_rows_after_header=[1]` (absolute row number, confirmed from orchestrator `skip_rows.update()`) added to MappingConfig to discard it at parse time. Specs (G) always empty in fixture (0/54 data rows populated) — used as the always-absent column for Policy-X verification. Column E (Workitem) intentionally omitted from `column_headers` to exercise letter-fallback (`append_notes_raw["E"]`).

**Test classes added:**
- `TestPhase19cRealFixturesRaheja` — 4 tests (1 expectedFailure: F3b)
- `TestPhase19cRealFixturesRahejaHVAC` — 1 test (1 expectedFailure: F5)
- `TestPhase19cRealFixturesDTechCivilWorks` — 5 tests

**Test count:** 257 → 267. Expected failures = 2, counted as OK in suite verdict.

**Audit regression:** Zero flips in `classifier_audit.py` and `preamble_with_children_audit.py` — no parser code changed.

**Frappe boundary:** 88 PASS (28 boqs + 60 boq_nodes) — unchanged.

**Findings documented:**
- **F3b** — `_RATE_CELL_PATTERN = r"^\s*rate\s*$"` matches "RATE" singular only; "RATES" plural falls through to Pattern 1. Phase 1.9d candidate: widen to `r"^\s*rates?\s*$"`.
- **F5** — orchestrator `top_header_row` hardcoded to `header_row - 1`; cannot span multi-row gaps (e.g. 13 rows between area-name row 2 and bottom header row 15 in HVAC). Phase 1.9d candidate: `top_header_row_override` SheetConfig field.

**Status: CLOSED.** feat commit `f62a0ca5`. Phase 1.9d candidate scope: F3b + F5 bundled. Phase 2c next (unblocked).

### 17.9 Preamble stack-depth cascade in hierarchy resolver — parked

**Issue:** `_determine_preamble_level` in `hierarchy.py` uses a stack-walk heuristic: lowercase-letter sl_no tokens (`a.`, `b.`, … `z.`, `aa.`, `ab.`) each increment `stack_depth + 1`. In Snitch Electrical's cable-size section, every nested cable item has a lowercase-letter sl_no, causing the stack depth to climb from 3 to 21 over the section. These deeply-nested rows get `level=21` and are mistakenly classified as PREAMBLEs by the base classifier (sl_no + description, no qty → PREAMBLE). B2d-classifier's unit-based demotion post-pass addresses the symptom: those rows carry a unit value (e.g. `'Nos.'`) that matches real LINE_ITEM units on the sheet, so they are demoted to LINE_ITEM before the preamble candidate scorer runs.

**Residual concern:** The resolver's stack-depth rule is structurally wrong for real BoQs with deep lowercase cascades. A row that genuinely IS a section header with a unit value would also be demoted — the demotion criterion has no way to distinguish real section-header units from line-item units. This is unlikely in practice (real section headers have no unit), but it is a known structural weakness.

**Disposition:** Parked. B2d-classifier's unit-based demotion is sufficient for all known real fixtures (Snitch Electrical confirmed). Root-cause fix in `hierarchy.py` — e.g., capping lowercase-letter stack depth relative to the enclosing level — is deferred until a fixture is encountered where the symptom-level fix is insufficient.

**Status:** Open. Not blocking any current phase. Revisit if a real fixture shows demoted rows that are genuine section headers.

### 17.10 Priced PREAMBLE with tree children — re-parenting deferred

**Issue:** After B2d (unit-based demotion) and B2f (zero-children demotion), one PREAMBLE in Snitch Electrical remains that has both priced content (unit='LS') AND tree children: resolved_idx=500, sl_no='2.0', path='394/500', 5 children. It should arguably be demoted to LINE_ITEM (it carries a rate and a unit, implying it is itself a priced item), but doing so would orphan its 5 children — their `parent_index` would still point to the now-LINE_ITEM row. Re-parenting children to the demoted row's parent, or promoting them to top-level, requires a second pass over the resolved list to update `parent_index` and `path` values on all descendants. This is a non-trivial structural change.

**Disposition:** Explicitly OUT OF SCOPE for B2f. B2f's algorithm intentionally skips PREAMBLE rows that have descendants (`row.path in paths_with_descendants`). If row 500 is the only such case across the full real-fixture corpus and its children parse correctly, this is acceptable. If a future fixture shows the same pattern and the priced-but-with-children PREAMBLE causes downstream DB/UI problems, add a dedicated re-parenting pass as Part B2g (or Phase 2c extension).

**Status (updated 2026-05-16): CLOSED.** §9 #45 audit (commit `1ad12a7b`) confirmed row 500 as the sole candidate across the in-scope fixtures. §9 #45 implementation (feat `7ff4ce55`) resolves this by flagging the row via `needs_classification_review=True` / `review_reason="priced_preamble_with_children"` rather than auto-demoting. Re-parenting remains OUT OF SCOPE for the parser; deferred to Phase 3 wizard. See §17.11.C and §7.30.

### 17.12 Skip-then-ingest sheet type — parked

**Issue:** The current `SheetConfig.treat_as` Literal supports `"data"` and `"master_preamble"`. Real BoQs occasionally have a third sheet type: a summary or table-of-contents sheet that should be skipped for parsing but whose text should be ingested as unstructured metadata (e.g., room-area schedule, legend, cost summary). Setting `skip=True` discards the sheet entirely; there is no mechanism to capture its content without parsing it as a data sheet.

**Proposed addition:** A third `treat_as` value `"skip_then_ingest"` that causes the sheet to be skipped for row-by-row parsing but whose raw text content is captured and attached to the `ParsedBoq` as `ingest_only_sheets: dict[str, str]` (sheet_name → concatenated cell text). The wizard (Phase 3) can surface this text in a read-only panel for the user's reference.

**Disposition:** Parked. No real fixture currently requires this. The cost of skip=True is low — users can open the source Excel if they need the summary. Revisit if Phase 3 wizard user testing shows a clear need for ingested-but-not-parsed content. The `treat_as` Literal in `config.py` is the natural extension point; adding a third value is non-breaking.

**Status:** Open. Not blocking any current phase.

### 17.13 Wizard-load review pending — cumulative deferred-to-wizard inventory + UX-friction concern

**Status:** [RESOLVED v5.21] — Option 3b confirmed via execution-layer experiment Sequence C2+E2; 8/8 schema acceptance validates declarative wizard architecture. See handover §6 v5.21 decisions + §14 v5.21 EOS.

**Context (2026-05-17 chat-Claude / Nitesh discussion).** Multiple shape-handling decisions across Phases 1.8 – 1.9 have been deferred to Phase 3 wizard:
- Pattern 6 compound area names (§7.4 / §7.19, deferred since 2026-05-12)
- BMS schedule skip disposition (agreement #24)
- Vendor-compare disposition (agreement #24)
- Hidden-sheet default-skip (agreement #24, supported by §7.31 `BoqReader.list_sheet_states()`)
- Per-row attribution column-role choice (§7.34 `append_to_notes`; Phase 1.9b parser-side landed; commit-time merge owed in Phase 2c; wizard UX owed in Phase 3)
- Merged-title-banner default-skip (agreement #24 extension candidate; Phase 1.9d F7)
- Priced-PREAMBLE-with-children re-classification flow (§9 #45; parser-side review flag landed v5.9; wizard demote+re-parent owed in Phase 3)
- Multi-row top-header gap multi-row case (§7.39 candidate; Pattern 6 absorption)
- Declarative-first wizard direction (chat-Claude proposed 2026-05-16: parser-as-suggestion-engine, wizard-as-decision-engine; Nitesh locked direction: parser-fix-then-stress-test-then-wizard; not captured in v5.12 / v5.13 housekeeping — surfaced via conversation_search 2026-05-17)

**Standing concern (Nitesh, 2026-05-17).** Cumulative user-declaration load in Phase 3 wizard may be both UX-hostile (too many per-sheet decisions per upload) and error-prone (wrong user choices propagate to committed BoQ data). Worth a deliberate design conversation before Phase 2c body locks commit-time semantics.

**Re-evaluation trigger.** Post Phase 1.9e (real-fixture stress test observability chore). Phase 1.9e walks all 24 real fixtures with auto-guessed MappingConfigs and emits a characterization report. That report is the empirical basis for the decision — what fraction of sheets the parser gets right with zero user declaration, what fraction needs 1-2 overrides, what fraction needs 5+ overrides.

**Three threads to think through at re-evaluation time.**
1. Which deferred items get parser auto-detection (move work back to parser) vs stay with wizard.
2. Whether Phase 4 (LLM-assisted column-role suggestions, currently sequenced after Phase 3) should move up — AI auto-mapping is the direct mitigation for wizard friction. Nitesh flagged this as a parallel thread to explore 2026-05-17.
3. Per-template MappingConfig re-use as primary mitigation: if a user uploads the same vendor's BoQ template repeatedly (Raheja revision cycles, JSW project re-uploads), saved templates drop declaration cost to near-zero on subsequent uploads. Worth thinking about whether the wizard ships with this as a first-class concept (not bolted on later).

**Decision shape to make at re-evaluation.** Confirm or revise the locked sub-phase sequence (currently Phase 1.9d → 1.9e → 2c body → Phase 3 wizard → Phase 4 AI assist). Specifically: does Phase 4 stay after Phase 3, or interleave / move up?

**Status: OPEN. Re-evaluate post Phase 1.9e.**

Re-evaluation now unblocked — empirical data committed at 5cd4f580.

### 17.14 #74 [DOCUMENTED v5.18] — Diagnostic-script forces header_row_count=1

Intentional but means Mode A unmeasured. Mitigated by Diagnostic Chore #2 two-mode output. Full detail: handover §9 #74.

### 17.15 #75 [DOCUMENTED v5.18] — Amount-family metric over-counts

Amount-family metric over-counts based on role assignment. Mitigated by Diagnostic Chore #1 source_present_but_unparsed bucket. Full detail: handover §9 #75.

### 17.16 #76 [MITIGATED v5.19] — PowerShell Select-Object -Last N pipe deadlock

PowerShell Select-Object -Last N pipe deadlock with docker exec (15+ min hang). Mitigation: Option B file-redirect form for ALL test commands. Full detail: handover §9 #76.

### 17.17 #77 [MITIGATED v5.19] — Unicode section sign mangled by Windows/Docker heredoc

Unicode section sign mangled by Windows/Docker heredoc. Mitigation: ASCII labels only in commit messages and docs. Full detail: handover §9 #77.

### 17.18 #78 [MITIGATED v5.19] — docker exec -w flag failure in some PowerShell quoting contexts

docker exec -w flag failure in some PowerShell quoting contexts. Mitigation: bash -c 'cd /path && cmd' form. Full detail: handover §9 #78.

### 17.19 #79 [DOCUMENTED v5.19, RESOLVED v5.21] — v2 fixture shape only partially handled by Phase 1.9o

v2 fixture shape (area-name top merges + 4-col bottom) only PARTIALLY handled by Phase 1.9o. Reframed as Bug 9 in v5.21 8-bug taxonomy; addressed via Bug 7+9 combined remediation feat 9a5b16cb. Full detail: handover §9 #79.

### 17.20 #80 [OPEN v5.20] — test_auto_guess.py entirely mock-based

test_auto_guess.py is entirely mock-based; no real .xlsx loads. Mitigated forward by agreement #29 (real-fixture integration tests required). Closure deferred to focused sub-phase post-strategy decision. Full detail: handover §9 #80.

### 17.21 #81 [OPEN v5.20, deferred] — Output filename drift from 1.9j checkpoint

Output filename drift from 1.9j checkpoint. Low priority. Full detail: handover §9 #81.

### 17.22 #82 [DOCUMENTED v5.20] — Pre-1.9o synthetic fixtures embed two opposite conventions

Pre-1.9o synthetic fixtures embed two opposite conventions B and C. Documented; no action required. Full detail: handover §9 #82.

### 17.23 #83 [OPEN v5.20, deferred to wizard] — Three coexisting header conventions in real BoQs

Three coexisting header conventions in real BoQs (A/B/C). Path A explicitly defers parser-side fixes; wizard sidesteps via declarative config. Full detail: handover §9 #83.

### 17.24 #84 [CLOSED v5.21 by feat 47090d7d] — Convenience field summation gap (Bug 6)

cr.qty/rate/amount didn't sum per-area/per-component when Total/Combined blank. Closed by Bug 6 fix. Full detail: handover §9 #84.

### 17.25 #85 [CLOSED v5.21 by feat 9a5b16cb] — Keyword vocabulary missing word-order variants (Bug 7)

"Rate Supply" didn't match rate_supply. Closed by Bug 7+9 combined remediation. Full detail: handover §9 #85.

### 17.26 #86 [CLOSED v5.22 by feat 798f4fd2] — Same-row =SUM() SUBTOTAL_MARKER misfire (Bug 10)

classifier.py treats same-row supply+install aggregation formulas as cross-row subtotals. 131 cross-fixture misfires (57 VRF + 74 Societe Generale). Fix: _is_cross_row_sum() helper ~15 LOC + tests. Full detail: handover §9 #86.

**Closure record:** _is_cross_row_sum(formula, current_row) helper added in classifier.py Private helpers section. Gate added to FORMULA-path SUBTOTAL_MARKER check: formula must start with =SUM( AND _is_cross_row_sum returns True. Text-regex SUBTOTAL_MARKER path (Total Item No., Grand Total, etc.) NOT touched. 131 expected SUBTOTAL_MARKER -> LINE_ITEM reclassifications (VRF 57 + Societe Generale 74). Audit-script stats flat (classifier_audit.py measures header-keyword matching, not classification categories -- flat is expected for Bug 10). Fix verified by integration tests: TestBug10VrfSameRowSumIntegration row 1.1 and 1.2 assertions pass. Parser tests 409 -> 429 (20 new: 13 unit + 3 classify_row gating + 4 VRF real-fixture). No out-of-scope files touched. Agreements cited: #9 two-commit, #16 known-pattern citation, #20 25-item self-report, #25 audit-regression, #29 real-fixture integration.

**Coverage extension (feat 94706b5c):** TestBug10SocieteGeneraleHvacIntegration added in test_orchestrator.py. 73-row Societe Generale Bug 10 misfire surface now covered (VRF 57 rows covered by feat 798f4fd2 already). Areas: GF / 2F (Office) / 2F(Cafeteria). Per-row assertions: sl_no=1.03, 1.04, 1.05 (rows 23, 25, 27 with L=SUM(Jx:Kx)). Aggregate threshold >= 230 (post-fix empirical: 282; pre-fix ~209). Parser tests 429 -> 434. Suite verdict OK.

### 17.27 #87 [CLOSED v5.25 via A1+A2 land] -- Pattern-consistency mismatch in PREAMBLE vs LINE_ITEM (Bug 11)

**MISFRAMED — PARKED.** Original framing: classifier ignores sl_no pattern_depth; 240+ rows affected in BoQ Elec alone; fix was orchestrator post-pass with asymmetric depth rule. Implemented in feat fb89bf44 / docs f9bd1e70, then reverted (feat f1839b1e, docs debd5186) after diagnostic revealed root cause is hierarchy RESOLVER (parenting), not classifier.

**Root cause (post-diagnostic 2026-05-22).** Two sub-manifestations:
- **11a — Numeric peer sibling gap:** 1.0 PREAMBLE + 2.0 LINE_ITEM should sibling; resolver parents 2.0 under 1.0.
- **11b — Letter-sequence cascade (§17.9):** a/b/c letter-suffix rows chained stack_depth+1 each instead of equi-depth siblings under numbered ancestor.

**Why parked.** Snitch diagnostic confirmed 124/124 depth-1 lowercase-letter ('l' sig) rows in '6. Electrical' are genuine enumerated sub-items (cable variants, socket types, conduit sizes under numbered PREAMBLEs). Depth-≤1 auto-promote nets −95 LINE_ITEMs — a regression. Fix belongs in hierarchy resolver layer; deferred to Phase 3+ AI review per agreement #33. Parser tests stable at 434. Full detail: handover §9 #87.

**Update 2026-05-23 (post-hoc recognition):** Bug 11a + Bug 11b were structurally resolved by Rule A1 + Rule A2-reframed landing (feat 8f960a2b, sec 9 #99, §17.40). The connection was not recognized in the A1+A2 land docs commit (ea60a03f) and was identified during v5.25 housekeeping preparation review.

**Bug 11a -> Rule A2-reframed.** A2 fires at LINE_ITEM attachment when LINE_ITEM sl_no has same pattern_signature as stack-top PREAMBLE AND a different first_numeric_token (both non-None). Attaches to stack-top's parent (sibling, not child). This is exactly the Bug 11a canonical case: "1.0 PREAMBLE + 2.0 LINE_ITEM with qty -- resolver parents 2.0 under 1.0; should be SIBLING of 1.0 (same pattern signature D.D, same depth)". Empirical evidence: A2 audit (sec 9 #99, feat 16647958) captured 27 A2 firings in Snitch + 31 A2 firings in BoQ ELV -- every firing is the Bug 11a case. All landed correctly post-A1+A2 (parser tests 440 -> 464 confirm).

**Bug 11b -> Rule A1.** A1 fires in _determine_preamble_level when sl_no (after rstrip) is all-lowercase, scans stack reversed for first non-lowercase ancestor, returns anchor.level + 1. This is exactly the Bug 11b cascade case: "a/b/c letter-suffix children should sibling under numbered ancestor; resolver chains them via stack_depth + 1". Empirical evidence: A1 audit captured 3 A1 firings in Snitch (xlsx rows 458/475/491, sl_no b/c/d). Before A1: level 5/6/7 (cascade). After A1: all at level 4 (siblings under numbered parent). The §17.9 lowercase-letter cascade (root cause of Bug 11b) is structurally resolved.

**Snitch LINE_ITEM caveat.** Snitch diagnostic (2026-05-22 on tip f9bd1e70) showed 124/129 depth-1 lowercase-letter rows are GENUINE LINE_ITEMs (cable variants, socket types, conduit sizes). LINE_ITEMs do not go through _determine_preamble_level so A1 does not affect them. Those 124 rows attach to stack-top numbered PREAMBLE naturally without cascade. A1 handles the remaining 5 PREAMBLE anomalies that exhibited the cascade.

**Status:** **CLOSED v5.25.** Both manifestations structurally resolved. The 47 tests added in the reverted v5.22 attempt (feat fb89bf44 + docs f9bd1e70, reverted via debd5186 + f1839b1e) are NOT restored -- they tested classifier-layer auto-promotion logic that A1+A2 supersedes (resolver-layer fix). Original v5.22 commits preserved in git history for archaeology.

### 17.28 #88 [OPEN v5.21, TARGET NEXT] — Section heads pinned at L1, intermediate hierarchy traversal lost (Bug 12)

Non-dotted PREAMBLEs unconditionally L1; dotted-decimals trace to most recent section head. Foundational for §7.34 commit-time notes-merge. ~30 LOC hierarchy.py. Full detail: handover §9 #88.

### 17.29 #89 [CLOSED v5.23] — Excel error literals classified as content (Bug 13)

Excel error literals (#REF!, #VALUE! etc.) classified as content. Fix: EXCEL_ERROR_LITERALS frozenset + _is_excel_error() helper in reader.py; all seven error strings normalized to None at iter_rows() cell-read time; 6 new tests (4 unit + 2 integration). Parser tests 434 -> 440. feat 5ff93064. Full detail: handover §9 #89.

### 17.30 #90 [OPEN v5.21, LOW PRIORITY] — Letter-suffix peer items get nested levels (Bug 14, cosmetic)

Rows like a./b./c. should be peer children of most recent numbered ancestor; currently nested under each other. ~20 LOC hierarchy.py. No data damage. Full detail: handover §9 #90.

### 17.31 #91 [PHASE 3 SPEC v5.21] — Wizard design: area name suffix normalization (Finding 15)

Wizard must strip trailing ` Qty`/` Quantity` from area names auto-detected from column headers. Full detail: handover §9 #91.

### 17.32 #92 [PHASE 3 SPEC v5.21] — Wizard design: single non-merged area column adjacent to merged group (Finding 16)

Wizard needs hybrid layout support. Full detail: handover §9 #92.

### 17.33 #93 [MITIGATED v5.21] — MSYS path conversion on Windows docker exec

/tmp/ translates to C:/Users/.../Temp/. Mitigation: prefix MSYS_NO_PATHCONV=1 on ALL docker exec/cp commands. Captured in CLAUDE.md this commit. Full detail: handover §9 #93.

### 17.34 #94 [MITIGATED v5.21] — Docker cp over heredoc corrupts ownership

Files become root-owned. Mitigation: Write-tool -> host temp file -> docker cp INTO container. NEVER heredoc through bash -c. Full detail: handover §9 #94.

### 17.35 #95 [LESSON v5.21] — Claude Code scope overreach during Sequence E

Auto-drafted E2 configs unilaterally instead of returning to chat after inspection. Mitigation: future prompts include explicit "STOP after this phase" reminders. Full detail: handover §9 #95.

### 17.36 #96 [PATTERN v5.21] — Large output file, desktop-pull pattern

For >50KB diagnostic dumps, docker cp output off container to Desktop + upload to chat; avoid inline cat through Claude Code. Full detail: handover §9 #96.

### 17.37 [DIAGNOSTIC v5.23] — §7.28 orphan-children audit (read-only diagnostic)

Script `unit_demotion_orphan_audit.py` (feat 8a126846) answers: of the ~82 PREAMBLE rows
§7.28 demotes on Snitch '6. Electrical', how many have descendants outside the §7.28 target set
(i.e. descendants that would be orphaned)? Pipeline: classify_row → (§7.28 skipped) →
resolve_hierarchy → (§7.29/§7.30/multi-area skipped). Target set confirmed 82. Result: 47/82
(57.3%) of target rows have ≥1 real-orphan descendant; 196 total real-orphan descendants;
max 9 on a single row. Informs pending decision on "no auto-demote/promote of parented PREAMBLE"
blanket rule. Invokable as `python -m nirmaan_stack.services.boq_parser.unit_demotion_orphan_audit`.

### 17.38 [DIAGNOSTIC v5.23] -- Bill Of Quantities Electrical & ELV rows 4-22 comparison audit

Script `boq_electrical_elv_rows_4_22_audit.py` (feat 3b0790f0) compares production
hierarchy resolution (with §7.28 unit-based demotion) vs proposed Approach A
(Rule A1 lowercase-letter cascade fix + Rule A2 numeric peer signature match,
§7.28 skipped) on xlsx rows 4-22 of ELECTRICAL & ELV BOQ in Bill of Quantities.xlsx.

Per-row output: classification, level, qty, parent_sl_no, path, description.
Headline findings: 0/19 rows differ between current and Approach A in this range.
1 Bug 12 candidate (row 4, sl_no "SUB HEAD A", level 1, text-only section heading
co-existing with numeric level-1 PREAMBLEs 1.0 and 4.0). Rule A1 and Rule A2 each
fire 0 times -- no lowercase-letter cascade or numeric-peer PREAMBLE rows in range.
Rows 9 (2.0) and 11 (3.0) are classified as LINE_ITEM (have qty values), so Bug 11a's
PREAMBLE-vs-LINE_ITEM sibling gap is visible via parent_sl_no="1.0" on both -- Rule A2
cannot fix LINE_ITEM parenting (documented in Approach A limitation footer).
Invokable as `python -m nirmaan_stack.services.boq_parser.boq_electrical_elv_rows_4_22_audit`.

### 17.39 [DIAGNOSTIC v5.25] -- Approach A-reframed audit (sec 9 #99 gating, feat 16647958)

Script `approach_a_reframed_audit.py` (feat 16647958) compares production resolve_hierarchy
(with sec 7.28) vs Approach A-reframed custom resolver (Rule A1 + Rule A2-reframed,
sec 7.28 applied in BOTH) on two full fixtures:

  - Snitch '6. Electrical' (521 rows) -- Rule A1 cascade case
  - Bill of Quantities 'ELECTRICAL & ELV BOQ' (1186 rows) -- Rule A2-reframed case

Rule A1 fires in PREAMBLE level determination when pattern_signature(sl_no) starts with 'l'.
Scans stack top-down for first entry whose sig does not start with 'l'; level = anchor.level+1.

Rule A2-reframed fires at LINE_ITEM attachment step (NOT in _determine_preamble_level).
Stack top only (proximity=1). Trigger: signature(LINE_ITEM.sl_no) == signature(top.sl_no)
AND first_numeric_token differs AND both non-None. Action: attach LINE_ITEM to top.parent
(one level up; root if top has no parent). LINE_ITEM never pushes onto stack.

Snitch '6. Electrical':         A1=3   A2=27  combined=0  indirect=0  total=30
Bill of Quantities ELEC&ELV:    A1=0   A2=31  combined=0  indirect=0  total=31

No auto-bucket misfire classification. User reviews first-20 sample in diagnostic_snapshots/.
Decision criterion: low misfire rate => land A1+A2 next sub-phase (sec 9 #99 closed);
appreciable misfires => park + codify "no more parser fuzzy rules" as working agreement #40.
Gating exit criterion E3 (closing Phase 2c bug-fix cycle).
Invokable as `python approach_a_reframed_audit.py` from the boq_parser directory.

---

### 17.40 [LANDED v5.25] -- Approach A-reframed land (sec 9 #99 CLOSED, feat 8f960a2b)

Rule A1 + Rule A2-reframed landed in hierarchy.py as production code (feat 8f960a2b).
approach_a_enabled: bool = True kwarg on resolve_hierarchy() and
_determine_preamble_level() provides on/off toggle for regression testing.
Helpers pattern_signature() and first_numeric_token() added to hierarchy.py.

F5 tightening applied: A1 trigger changed from sig.startswith('l') to
all(c == 'l' for c in sig_stripped) where sig_stripped = pattern_signature(
sl_no.rstrip('.,):;]')). Prevents mixed codes (a1, custom-code-xyz) from
wrongly absorbing into A1 (failure mode discovered during Step 5 test run).

Sec 7.29 interaction: A2 reparents all 5 children of PREAMBLE "2.0" (xlsx ~502,
Snitch 6. Electrical) to section header G. Zero-children demotion post-pass then
makes "2.0" a LINE_ITEM with parent G, structurally resolving the priced-preamble
ambiguity flagged in sec 9 #45. test_snitch_row_500_demoted_to_line_item_post_a2
captures this end-state.

snitch_electrical_expected.json regenerated: LINE_ITEM 176->177, PREAMBLE 43->42,
preamble_level_transitions 7->4 entries (levels 1-4 only; b/c/d collapse to
level 4 via A1, reducing the former 5/6/7 cascade).

test_approach_a_rules.py: 24 new tests (5 helpers, 7 A1 unit, 7 A2 unit,
3 Snitch integration, 2 BoQ ELV integration). Parser tests: 440 -> 464.

Working agreement #40 deferred pending Bug 12 diagnostic on 2 fixtures
(see §17.28 -- Bug 12 candidate "SUB HEAD A" row 4 in BoQ ELV must be
evaluated on 2 fixtures before deciding whether any further fuzzy rules
are warranted or should be permanently prohibited).

**Update 2026-05-23:** Working agreement #40 now codified in §14 -- see §17.41.

**Update 2026-05-23 (post-hoc recognition):** A1+A2 land also structurally resolved Bug 11a + Bug 11b -- see §17.27 status update.

---

### 17.41 [LANDED v5.25] -- SUB HEAD detection + universal subtotal-reset (sec 9 #100 + #101 CLOSED, feat 25a43617)

Both fixes landed in hierarchy.py. _SUB_HEAD_RE + _is_sub_head_marker() helpers added;
SUB HEAD branch in _determine_preamble_level forces level=1 unconditionally; _MID_SHEET_RESET_RE
preserved (deprecated, audit-script-only) with deprecation comment at definition site --
see in-line comment at definition site. SUBTOTAL_MARKER now unconditionally clears stack.
test_sub_head_and_subtotal_reset.py: 20 tests (6 helper unit, 4 Fix 1 unit, 5 Fix 2 unit,
5 BoQ ELV integration). Parser tests 464 -> 484. PHASE 2c BUG-FIX CYCLE CLOSED.

Empirical basis: 6-fixture cross-corpus audit (BoQ ELV, Snitch '6. Electrical', Inovalon HVAC,
SG HVAC, Raheja Electrical, D-Tech Civil) confirmed zero mid-section subtotals across 46 markers
and "SUB HEAD X" pattern unique to BoQ ELV but harmless to other fixtures. All 21 SUB HEAD
PREAMBLE rows in BoQ ELV now correctly at level=1 with parent_index=None.

Note on Group 4 test scope: test_boq_elv_numeric_preamble_after_sub_head_b_is_clean_root
asserts numeric PREAMBLE 1.0 lands at level=1 with parent_index=None
(clean root, no stale section-A descendant chain). The 1.0 does NOT
parent under SUB HEAD B at level 2 -- both end up as level-1 peers
because dotted-decimal sl_no matches level_1_style="numeric" detection.
This is a known structural limitation in BoQ ELV's mixed-convention
hierarchy (SUB HEAD section markers co-existing with numeric PREAMBLEs
at the same level). Parenting numeric PREAMBLEs under SUB HEAD section
markers requires stateful section-aware level overrides -- fuzzy logic,
violates working agreement #40. Goes to Phase 3+ AI layer along with
Bug 12 + Bug 15.

---

### 17.42 [PARKED v5.25] -- Bug 12 priced section-header detection (sec 9 #88, Phase 3+ AI layer)

Inovalon HVAC sheet: section markers ("VRV SYSTEM FOR CRITICAL AREAS", "VAV BOXES WORKS",
"HYDROGEN EXHAUST") AND sub-section preambles ("OUTDOOR UNITS", "INDOOR UNITS",
"REMOTE CONTROLS", "DRAIN PUMP") are NOTE-classified text rows with no sl_no and no
quantitative data. Parser cannot promote NOTE -> PREAMBLE without natural-language pattern
recognition (short text + uppercase + position before numeric is fuzzy).

Cross-fixture audit identified 14 candidate section-marker NOTEs in Inovalon BOQ alone.
Working agreement #40 governs -- park to Phase 3+ AI review layer.

---

### 17.43 [PARKED v5.25] -- Bug 15 priced-sub-section-header mis-classification (sec 9 #102, Phase 3+ AI layer)

SG HVAC 'BOQ_HVAC Lowside works' sheet: 7 user-identified section headers (xlsx rows
5/123/130/157/165/194/260). 1/7 correctly classified PREAMBLE (row 5 "AIR DISTRIBUTION");
6/7 classified LINE_ITEM and buried under sl_no=1.0.

Root cause: sl_no values REPEAT across sections (sl="A" appears in rows 5, 165, 194, 260
for different sections). Quantitative-data routing dominates classifier today and sends these
to LINE_ITEM bucket. Natural-language section-title recognition is required to distinguish
"A -- CHILLED WATER WORKS" (header) from "A -- Chilled water FCU 1200 CFM" (line item).

Working agreement #40 governs -- park to Phase 3+ AI review layer.

---

### 17.44 [CYCLE 3 DEEP DIVE -- 9 DETERMINISTIC FIXES -- FIX QUEUE v5.26]

Cycle 3 deep dive walked 7 fixtures (sg_hvac, safron, inovalon,
bill_of_quantities, alorica 2row+1row A/B, snitch, raheja_commerzone_hvac;
multi_area_merged_header_v1 dropped per Section 1A decisions log entry). 9 deterministic
parser fixes identified, all meeting working agreement #40 deterministic-unambiguous
bar. Implementation queued per agreement #43 (one cycle + validation).

For each bug below: SYMPTOM (current behavior), CANONICAL FIXTURE EXAMPLES
(rows from cycle 3 walk), ROOT CAUSE (parser layer + mechanism), FIX SPEC
(what changes, in which module), EXPECTED POST-FIX BEHAVIOR (same rows
after fix), CROSS-FIXTURE SAFETY.

----------------------------------------------------------------------
Bug 16 -- classifier unit invariant (in-classifier flow)
LANDED v5.27 (this session). Commit: 68cfc57d.
----------------------------------------------------------------------

ROOT CAUSE: classifier's classification decision step routes to
LINE_ITEM whenever qty/rate/amount is present. Policy X (sec 7.25)
preserves explicit zero, so =SUM(blanks)=0.0 counts as "qty present."
sg_hvac and Snitch authors use ghost formulas (=SUM(blanks),
=N(...)*N(...)) on visually-blank rows, producing rows with
qty=0.0 but no semantic content. The classifier had no check on
unit presence.

FIX: in-classifier two-clause block in classify_row(), inserted
AFTER the existing four-way classification decision and BEFORE
the existing emptiness guard. Single toggle BUG_16_UNIT_INVARIANT_
ENABLED (default True) gates both clauses.

Clause 1 (SPACER broadening): if sl_no AND description AND unit
are all blank-or-junk, classify as SPACER. Overrides whatever the
four-way decision produced.

Clause 2 (LINE_ITEM unit gate): if the four-way decision produced
LINE_ITEM but unit is blank-or-junk, re-evaluate via PREAMBLE /
NOTE rules (same logic as the four-way decision but without the
LINE_ITEM option).

Three field-specific blank-or-junk helpers:
- _is_unit_blank_or_junk: trimmed empty OR contains no alphabetic
  characters. Rejects "", "-", "0", "123". Accepts "Nos.", "m**2", "LS".
- _is_sl_no_blank_or_junk: trimmed empty OR contains no alphanumeric
  characters. Accepts "1.0", "A.", "IV". Rejects "*", arrows.
- _is_description_blank_or_junk: delegates to _is_sl_no_blank_or_junk.

INVARIANT: together with sec 7.28 (unit-based PREAMBLE demotion)
and sec 7.29 (zero-children PREAMBLE demotion), Bug 16 closes the
biconditional: a row is LINE_ITEM if and only if it has a real
unit (modulo SPACER / HEADER_REPEAT / SUBTOTAL_MARKER caught at
earlier classifier steps).

CROSS-FIXTURE IMPACT (Phase 0 diagnostic this session):
- sg_hvac BOQ_HVAC Lowside works: 132 LINE_ITEM reclassifications
  (74 via Clause 1 to SPACER, 58 via Clause 2 to PREAMBLE/NOTE).
- Snitch 6. Electrical: 190 NOTE -> SPACER via Clause 1.
- VRF System: 1 Clause 1 + 1 Clause 2 hit.
- Inovalon HVAC: unchanged.
- Bill of Quantities ELV: unchanged.

CALIBRATION UPDATES TO EXISTING TESTS:
- test_classifier.py: 8 synthetic rows gained explicit unit="Nos"
  (were missing units; under old behavior LINE_ITEM, under Bug 16
  PREAMBLE).
- test_orchestrator.py: Snitch NOTE expectation 287 -> 97;
  Societe HVAC LINE_ITEM threshold relaxed; 2 Pattern 2 column-role
  maps shifted right by one to accommodate new unit column.
- generate_synthetic.py: Pattern 2 fixtures (synthetic_multi_area_
  2row.xlsx, synthetic_pattern_2_rate.xlsx) regenerated with a unit
  column (C) and unit="Nos" on data rows.

TODO/CLEANUP: Clause 2's fall-through duplicates the PREAMBLE/NOTE
logic from the four-way decision above (lines 766-789). If that
logic changes in a future fix, this block must be updated in
lockstep. Flagged for a future cleanup session: extract the
PREAMBLE/NOTE decision into a private helper called by both the
main path and Clause 2's fall-through.

ARCHITECTURAL ASYMMETRY: Bug 16 sits in classify_row() body
(in-classifier). Sec 7.28 and sec 7.29 sit as post-passes. The
biconditional invariant is therefore enforced in two places: the
classifier blocks LINE_ITEM at classify time when unit is missing
(Bug 16), and the post-passes catch PREAMBLEs with units at
post-classify time (sec 7.28/7.29). Acknowledged; not addressed
this session. Future cleanup may consolidate into one location.

PARKED BUG 16 ALTERNATIVE (FROM v5.26): the original v5.26 spec
proposed _apply_unit_blank_demotion_post_pass running after
sec 7.28. This session reframed to in-classifier flow. Rationale:
cleaner architecture (no intermediate "LINE_ITEM-that-is-not-
really-LINE_ITEM" state); enforces the invariant from the start.
The original post-pass framing is not implemented and will not be.

----------------------------------------------------------------------
Bug 17 -- Reader-layer auto-trim for text-role columns   [LANDED 30b6045b]
Layer: reader.py
----------------------------------------------------------------------

IMPLEMENTATION-DESIGN NOTE: Approach (a) sub-variant chosen -- reader takes
text_role_columns: set[str] | None at iter_rows() call time (column letters,
not construction). Orchestrator derives the set from SheetConfig.column_role_map
filtering by TEXT_ROLE_ROLES constant before calling iter_rows(). Single
commit; Bug 18 plumbing is independent shape (is_merged_origin propagation).
Pre-flight confirmed via raw xlsx XML inspection (openpyxl not available on
host): alorica A31/A33 numFmtId=0 ("General"), A45/A52 numFmtId=2 ("0.00"),
sg_hvac A39 numFmtId=166 (complex accounting format, no-op acceptable per spec).
+21 tests (502->523). Closes cluster 1 session 3.

SYMPTOM: sl_no (and other text-role columns like append_to_notes) read as
Python str() of float, losing user-intended display formatting. Two
failure modes:
(i) Trailing zero trim: BoQ author types "1.10" in numeric-formatted cell,
    Excel stores as float 1.1, str(1.1) returns "1.1". Author's "1.10" intent
    lost.
(ii) Float precision noise: BoQ author writes a formula like =A30+0.1,
     Excel evaluates to 2.3000000000000003 (IEEE 754), openpyxl returns
     the float, str(2.3000000000000003) returns the full precision string.

CANONICAL FIXTURE EXAMPLES:
- alorica r31: sl_no="2.3000000000000003" (formula result, intended "2.3"
  or "2.30")
- alorica r33: sl_no="2.4000000000000004" (intended "2.4")
- alorica r45: sl_no="3.0199999999999996" (intended "3.02")
- alorica r52: sl_no="3.0299999999999994" (intended "3.03")
- sg_hvac r39: sl_no="1.1" (sequence is 1.07, 1.08, 1.09, 1.1, 1.11, 1.12 --
  likely author typed "1.10" but Excel stored as 1.1 because default numeric
  formatting trims trailing zeros)

ROOT CAUSE: reader.py iter_rows() uses openpyxl data_only=True mode and
passes cell.value through. str() coercion happens downstream (classifier.py
reads cell value for sl_no). For floats, str() loses both trailing zeros
(from Excel's display format) and exposes IEEE 754 precision artifacts
(from formula evaluation).

FIX SPEC: Add helper to reader.py:
`_format_numeric_as_displayed(value, number_format) -> str`. Logic:
  - If value is int or value is None: return str(value) or "" respectively.
  - If value is float AND number_format matches a known precision pattern
    (e.g., "0.0", "0.00", "0.000"): use Python format-spec, e.g.,
    format(2.3000000000000003, ".2f") -> "2.30".
  - If value is float AND number_format is "General": apply
    conservative rounding (e.g., round(value, 10) then strip trailing zeros
    with care to preserve at least 1 decimal if format hints).
  - If value is str: pass through unchanged.
Apply to text-role columns only (sl_no, append_to_notes, description, unit,
make_model) -- NOT to numeric-role columns (qty/rate/amount which need raw
float for math).

EXPECTED POST-FIX BEHAVIOR:
- alorica r31: sl_no="2.30" (or "2.3" depending on cell number_format)
- alorica r45: sl_no="3.02"
- sg_hvac r39: sl_no="1.10" if number_format is "0.00", or "1.1" if
  "General" -- depending on what's actually in source cell format.

CROSS-FIXTURE SAFETY: Bug 17 fixes can only IMPROVE output, never regress --
the worst case is a no-op (number_format is "General" and value already
cleanly formatted). Cross-checked across 6 walked fixtures: snitch, raheja,
boq, safron, inovalon all use clean sl_nos with no precision noise; sg_hvac
and alorica are the catches.

Inovalon r26 (rate_supply_resolved=7560.000000000001) is a
cosmetic float passthrough in a numeric-role column (rate_supply),
NOT a Bug 17 target. Bug 17 applies to text-role columns only
(sl_no, append_to_notes, description, unit, make_model). Numeric-
role columns keep raw float for downstream math; downstream
ResolvedRow formatters handle display rounding for numeric
columns separately.

----------------------------------------------------------------------
Bug 18 -- Merged-cell banner rows produce false LINE_ITEMs
Layer: reader.py
----------------------------------------------------------------------

LANDED v5.28 -- cluster 1 session 4 (feat 41a86cd9)

IMPLEMENTATION NOTES:
- Architecture path (a) chosen: fix inside iter_rows() reusing Bug 17
  text_role_columns wiring. No classifier.py changes. No orchestrator
  changes. CellInfo.is_merged_origin and covered_lookup already present
  in reader.py; covered is not None correctly identifies propagated cells.
- New constant BUG_18_MERGE_PROPAGATION_BLANK_ENABLED (default True) in
  reader.py, placed immediately after Bug 17 helper section.
- Suppression logic: after Bug 17 formatting block, if toggle AND
  text_role_columns AND col_letter in text_role_columns AND covered is
  not None -> computed_value = None. Non-text-role covered cells
  (qty, rate, amount) are NOT suppressed -- area-header merge
  propagation continues to work.
- Fix selection (path a vs b vs c): path (a) chosen per chat-Claude
  2026-05-26 architectural discussion; rationale: Bug 17 consistency +
  zero new parameters or orchestrator changes. See agreement #39.
- Excel verification of safron r41: A41:G41 merge confirmed, cell text
  "PART- 2 INSULATION" (space after dash), no stray numeric data.
- +7 tests (523->530): 5 synthetic unit (TestBug18SyntheticMergeBanner)
  + 2 safron real-fixture integration (TestBug18SafronIntegration --
  r41 reader-level covered cell blank + classify_row NOTE assertion).
  0 existing-test calibrations. Cluster 1 complete (3 of 3:
  Bug 16 + Bug 17 + Bug 18 landed).
- Feat hash: 41a86cd9. Docs hash: see §14 decisions log.

ORIGINAL SYMPTOM: When BoQ author uses a banner-style section header that
spans multiple columns via merged cells, the per-cell merge propagation
logic (Phase 2b.2 Part A1, v5.10) copies the banner text into every
covered cell. Classifier then sees the same string in A (sl_no),
B (description), C (unit), etc. and routes to LINE_ITEM.

CANONICAL FIXTURE EXAMPLE:
- safron r41: PART-2 INSULATION banner. Merge A41:G41. After fix:
  A41 retains "PART- 2 INSULATION"; B41/C41 (text-role) -> None.
  D41-G41 (numeric-role) still carry propagated text -> treated as
  non-numeric qty=0.0 rate-only. Bug 16 Clause 2 then fires (unit=None
  is junk + desc=None is blank) -> NOTE.

CROSS-FIXTURE SAFETY: Banner-style section headers seen only in safron r41
among walked fixtures. Non-text-role covered cells unaffected.
Cross-fixture check during cycle 3 re-run will confirm no misfires.

----------------------------------------------------------------------
Bug 19 -- Priced-PREAMBLE detection via sl_no signature (LINE_ITEM step)
Bug 19-ext -- Same logic extended to PREAMBLE attachment step
Layer: classifier.py + hierarchy.py
LANDED cluster 2 session 4 (feat fbc1d845)
----------------------------------------------------------------------

IMPLEMENTATION DELTA vs ORIGINAL SPEC (cluster 2 session 4 partial-abort #20):

Original spec framed Bug 19 as an A2-reframed extension at the hierarchy
resolver's LINE_ITEM attachment step. Actual implementation pivoted to a
pre-resolve post-pass in classifier.py (_apply_priced_preamble_promotion),
running at Step 3c in parse_boq() pipeline (after Bug 20, before
resolve_hierarchy). Pivot rationale: once Bug 20 anchor-promoted PREAMBLEs
are visible, we can detect the priced-section-header pattern purely from
the classified list without needing hierarchy state.

ALGORITHM (as landed): backward-only window scan (size=20). For each LINE_ITEM
with numeric sl_no, collect first_numeric_token values of PREAMBLEs in the
backward window sharing the same pattern_signature. Promote iff:
  (a) len(preamble_fnts) >= 2
  (b) sorted preamble_fnts forms a gap-free consecutive sequence
  (c) target fnt == max(preamble_fnts) + 1

Backward-only: prevents a PREAMBLE from a DIFFERENT section (appearing in the
forward portion of the symmetric window) from corrupting the anchor set.
Rows processed in document order so promoted rows immediately become anchors
for subsequent candidates (8.00 promoted → 9.00 sees {3..8} in its window).

promoted_from_line_item: bool = False field added to ClassifiedRow; set on
promotion. Guard added in _apply_zero_children_preamble_demotion_post_pass
Step B to skip promoted rows (priced section headers legitimately have
unit/qty as leaf PREAMBLEs).

DISCRIMINATOR SHAPE (false-positive case, deferred):
Snitch electrical has 2 residual false promotions (30.0 row=109 backward
window {28,29}; 6.0 row=341 backward window {3,4,5}) where a clean contiguous
PREAMBLE sequence immediately precedes a genuine LINE_ITEM of the same pattern.
These promotions are semantically harmless (LINE_ITEM treated as PREAMBLE leaf
with no children). Discriminator refinement deferred to cycle 3 validation
re-run review. snitch_electrical_expected.json calibrated (LINE_ITEM 177→175,
PREAMBLE 42→44).

Bug 19-ext (sec 9 #107) as landed: BUG_19_EXT_PREAMBLE_REPARENT_ENABLED
toggle in hierarchy.py. In the PREAMBLE branch of resolve_hierarchy, after
the stack assigns a natural parent, scan resolved rows backwards for a PREAMBLE
with matching pattern_signature AND matching first_numeric_token at level-1.
If found and different from the natural parent, override parent_index.
Canonical: Inovalon r22 (sl=1.3) correctly parents under r6 (sl=1.0) because
r6 is found in the backward scan with sig='D.D' and fnt=1 matching r22's fnt.

Guarded by approach_a_enabled toggle (same toggle that gates A1/A2).

13 new tests in test_priced_preamble_promotion.py (552 → 565 total).
Sec 9 #106 and #107 CLOSED.

----------------------------------------------------------------------

SYMPTOM: LINE_ITEMs with sl_no signature matching nearby PREAMBLE family
but having quantitative data (so classifier correctly tags LINE_ITEM)
attach to wrong parent because hierarchy resolver attaches LINE_ITEMs to
top-of-stack only.

CANONICAL FIXTURE EXAMPLES:
- sg_hvac r25: sl_no="1.04" LINE_ITEM (real qty data, "plenum with Double
  skin AHU"). Parents under r6 (sl=1.0 PREAMBLE) which is a section-content
  parent. Should be sibling-of-r6, parented under r5 SUB HEAD A
  AIR DISTRIBUTION.
- safron r34 (sl=8.0), r35 (sl=9), r37 (sl=10.0): all LINE_ITEMs with real
  data. Parent under r30 (sl=7.0 PREAMBLE) instead of being level-1
  sibling sections.
- inovalon r22: sl_no="1.3" PREAMBLE parented under r19 (sl=2.0)
  PREAMBLE instead of r6 (sl=1.0) EQUIPMENTS -- same-family sibling gap at
  the PREAMBLE attachment step. This is Bug 19-ext.

ROOT CAUSE: v5.25 Rule A2-reframed fires at LINE_ITEM attachment with
`pattern_signature(LINE_ITEM.sl_no) == pattern_signature(top.sl_no)` AND
`first_numeric_token(LINE_ITEM.sl_no) != first_numeric_token(top.sl_no)`.
Two extensions needed:
(a) Bug 19: A2-reframed currently only re-parents to top's parent (one
    level up). It should also flag the LINE_ITEM as `needs_classification_
    review = True` with `review_reason = "priced_preamble_with_children"`
    analogue, so wizard can surface for user review (similar to §7.30).
(b) Bug 19-ext: A2-style logic at LINE_ITEM step doesn't apply to
    PREAMBLEs. The PREAMBLE-PREAMBLE case (inovalon r22 sl=1.3 should
    parent under r6 sl=1.0 instead of r19 sl=2.0) is unaddressed.

FIX SPEC:
(a) Bug 19: extend A2-reframed action to also set
    `needs_classification_review=True` + `review_reason=
    "priced_preamble_via_signature"` on the re-parented LINE_ITEM. Wizard
    reads this in review pass.
(b) Bug 19-ext: in `_determine_preamble_level`, after Rule A1 fires (or if
    A1 doesn't apply), check stack for entries with same pattern_signature
    AND different first_numeric_token. If found, set level to that entry's
    level and parent to that entry's parent (sibling-under-grandparent
    pattern, mirroring A2-reframed).

Search window and safety threshold (applies to both Bug 19 and
Bug 19-ext):
- Window: +/- 20 rows symmetric around the candidate row (the
  LINE_ITEM at Bug 19 attachment, or the PREAMBLE at Bug 19-ext
  attachment). Scan reaches forward into not-yet-classified rows
  only if those rows are already on the stack at the time of
  attachment; otherwise scan is backward-only within the 20-row
  radius.
- Minimum-count safety threshold: if fewer than 3 PREAMBLEs are
  present in the window, the rule does NOT fire. This prevents
  misfires on sparse sections where signature-matching peers are
  too few to establish reliable sibling-family structure.
- Asymmetric tunable held in reserve: window radius is configurable
  via module-level constants (forward_radius, backward_radius,
  min_window_preambles). Default symmetric +/- 20 / +/- 20 / >= 3.
  If post-land misfires surface on specific fixtures, tune
  asymmetrically (e.g. backward 30, forward 10) without changing
  the rule's deterministic-binary character. Tunable values land
  in agreement #16 (known-pattern citation) framing -- any
  asymmetric tune must cite specific empirical misfire evidence.

EXPECTED POST-FIX BEHAVIOR:
- sg_hvac r25 sl=1.04: A2-reframed already fires here (re-parents to None
  if r6's parent is None; with Bug 20-ext, r6 parents under r5 so r25
  becomes sibling of r6 under r5). Bug 19 adds review flag.
- safron r34/35/37: A2-reframed fires, re-parents to None (rootless). Bug 19
  adds review flag.
- inovalon r22: Bug 19-ext fires in _determine_preamble_level. Scans stack
  for signature match with different first_token. Finds r6 (sl=1.0,
  signature "D.D", first_token 1). r22 (sl=1.3, signature "D.D",
  first_token 1) -- wait, same first_token. Doesn't fire on this rule;
  actually correctly parents under r6 (already L1 PREAMBLE) at level 2.
  The Inovalon r22 issue is different: it should parent under r6 (sl=1.0)
  not r19 (sl=2.0); but the current resolver pops r6 when r19 enters
  (same level). After r19 pops r6, r22 sees only r19 on stack.
  THE FIX: Bug 19-ext applies when r22 enters -- it should scan FULL stack
  history (not just top), find r6 in the path (lookback), and re-parent
  to r6. This requires a stack-history scan, more complex than A2's
  top-only check. Implementation detail to be worked out in fix-prompt
  drafting.

CROSS-FIXTURE SAFETY: A2-reframed firing pattern already validated in
v5.25 (61 firings across Snitch + BoQ ELV, all correct). Extension to add
review flag is strictly additive -- no behavior change for the parenting
itself. Bug 19-ext extension to PREAMBLE step requires careful audit
before locking spec.

----------------------------------------------------------------------
Bug 20 anchor 1 + 2 + 3 -- Section-header NOTE -> PREAMBLE
Layer: classifier.py + hierarchy.py
LANDED anchors 1+2 v5.28 -- cluster 2 session 2 (feat 4f85ec3e)
Coverage correction (test only, no source change): initial test SheetConfig
used header_row=5 (copied from Bug 17/18 pattern). Safron's actual header is
r3. Corrected in follow-up commit; safron r5 PART-1 banner now exercises
anchor 1 as a real-fixture canonical case (was previously invisible to the
test). Caveat JJ logged for Bug 17 + Bug 18 config consistency.
----------------------------------------------------------------------

SYMPTOM: BoQ section-header rows that have only description text (no
sl_no, no numeric data) classify as NOTE per classifier rules
(description-only with no sl_no -> NOTE). They should be PREAMBLEs at
the section-root level, with subsequent numeric PREAMBLEs / LINE_ITEMs
parenting under them.

CANONICAL FIXTURE EXAMPLES:
- safron r5: "PART-1 AIR DISTRIBUTION SYSTEM" NOTE (no sl_no, no
  numeric). First non-spacer non-header row after header. Should be
  section-header PREAMBLE. Subsequent rows r7-r39 (sl=1.0 through 8.0
  and SUBTOTAL r39) all rootless level-1; should be children of r5.
- safron r41: "PART-2 INSULATION" (currently false LINE_ITEM per
  Bug 18 due to merged-cell banner; after Bug 18 fix becomes NOTE).
  First non-spacer after SUBTOTAL r39. Should be section-header
  PREAMBLE. Subsequent r44 (sl=1.0), r46 (sl=2.0) and r48 SUBTOTAL
  should be children.
- safron r43: "ACCOUSTIC INSULATION" NOTE. First non-spacer after
  promoted PREAMBLE r41 (anchor 3 -- post-promoted-section-header).
  Should be sub-section-header PREAMBLE under r41. Subsequent r44/r46
  parent under r43, which parents under r41.
- bill_of_quantities r4: "SUB HEAD A WIRING IN STEEL & PVC CONDUIT"
  already classifies as PREAMBLE per v5.25 §17.41 SUB HEAD detection.
  Bug 20 anchors don't change this -- SUB HEAD rule fires first. Bug
  20-ext level-0 applies (see next bug).

ROOT CAUSE: Classifier rule "description-only with no sl_no -> NOTE" is
correct for inline notes but mislabels banner-style section headers.
Hierarchy resolver then treats NOTE as content (attaches to topmost
PREAMBLE), not as structural element.

FIX SPEC: Add new hierarchy.py post-pass
`_apply_section_header_note_promotion_post_pass(classified_rows)`. Three
anchor patterns:
(1) Anchor 1 -- header: First non-spacer non-header row after the header
    row, where row is NOTE-classified with no sl_no, no numeric data.
    Promote to PREAMBLE at level 0.
(2) Anchor 2 -- subtotal: First non-spacer row after a SUBTOTAL_MARKER,
    same NOTE criteria. Promote to PREAMBLE at level 0.
(3) Anchor 3 -- post-promoted-section-header: First non-spacer row after
    a PREAMBLE that was just promoted via anchor 1 or 2 (one-step
    recursive), same NOTE criteria. Promote to PREAMBLE at level 1
    under the just-promoted ancestor.

Reading B locked: single-step recursive only -- anchor 3 does NOT
chain (promoted-via-anchor-3 PREAMBLE does NOT itself become a
new anchor for a further anchor 3 firing). Anchor 3 is correctness-
preferred but NOT data-loss-critical: even if anchor 3 mis-classifies
a row that should have been promoted, §22.11 NOTE-attachment
captures the row's content as an attached note under the most
recent in-stack PREAMBLE (e.g. safron r43 ACCOUSTIC INSULATION
content surfaces under r41 PART-2 INSULATION via the NOTE-attachment
pathway even if r43 itself stays classified as NOTE). This makes
anchor 3 a structurally-nice-to-have rather than a data-recovery
necessity -- implementation may defer anchor 3 if its empirical
yield proves too low to justify the misfire-audit cost.

Run BEFORE existing v5.25 SUB HEAD detection (so SUB HEAD takes priority
if applicable).

EXPECTED POST-FIX BEHAVIOR:
- safron r5: anchor 1 fires -> PREAMBLE level 0. r7/r13/r17/.../r37
  (level-1 sections 1.0 through 8.0) parent under r5.
- safron r41: Bug 18 demotes from LINE_ITEM to NOTE first; then anchor 2
  fires (preceded by SUBTOTAL r39) -> PREAMBLE level 0. r44/r46 (sl=1.0
  and 2.0) parent under r41.
- safron r43: anchor 3 fires (post-promoted r41) -> PREAMBLE level 1
  under r41. r44/r46 parent under r43.

CROSS-FIXTURE SAFETY:
- sg_hvac: r5 SUB HEAD-style is already PREAMBLE via sl_no=A -> existing
  rule covers, Bug 20 doesn't fire (no NOTE preceding).
- inovalon: r36-r40 cluster ("Central Air Cleaner for AHUs", etc.) NOT
  caught by any of the 3 anchors -- no header/subtotal/promoted-PREAMBLE
  immediately precedes. STAYS PARKED to Phase 3+ AI per agreement #43.
- snitch: pre-section INDEX (rows 3-10 PREAMBLEs + r11 SUBTOTAL) already
  works under universal subtotal-reset; Bug 20 anchors don't fire (no
  NOTE-classified section headers).
- raheja: section markers are PREAMBLEs (sl=1/2/3/4), not NOTEs. Bug 20
  doesn't fire.

----------------------------------------------------------------------
Bug 20-ext -- Section-header PREAMBLEs at LEVEL 0 (closes v5.25 §17.41
             PARKED limitation)
Layer: hierarchy.py
LANDED v5.28 -- cluster 2 session 2 (feat 4f85ec3e)
----------------------------------------------------------------------

SYMPTOM: Section-header PREAMBLEs (detected via SUB HEAD pattern v5.25,
or via Bug 20 anchors 1-3 newly above) are assigned level=1. Subsequent
numeric PREAMBLEs (sl_no like "1.0", "2.0") also resolve to level=1.
Stack-walk rule "pop while top.level >= candidate.level" pops the
section-header PREAMBLE when a level-1 numeric PREAMBLE enters. Section
headers become functionally useless as parents -- numeric PREAMBLEs become
rootless.

CANONICAL FIXTURE EXAMPLE:
- bill_of_quantities r4: SUB HEAD A WIRING IN STEEL & PVC CONDUIT,
  currently level=1, rootless.
- bill_of_quantities r6 sl=1.0, r9 sl=2.0, r11 sl=3.0, r13 sl=4.0,
  r25 sl=7.0, r30 sl=8.0, r38 sl=10.0, r43 sl=11.0, r52 sl=14.0:
  all level=1, all rootless. None parent under r4 SUB HEAD A.

ROOT CAUSE: v5.25 §17.41 explicitly set SUB HEAD to level=1 with the
reasoning that level=0 would break existing tests asserting level=1 +
parent=None for the 21 SUB HEAD rows. The PARKED rationale was
"Parenting numeric PREAMBLEs under SUB HEAD section markers requires
stateful section-aware level overrides -- fuzzy logic, violates working
agreement #40." But the fix is NOT fuzzy -- it's a single level-assignment
change.

FIX SPEC: Modify hierarchy.py SUB HEAD detection branch and Bug 20
anchors 1-3 promotion logic: section-header PREAMBLEs (whether detected
via SUB HEAD regex or via Bug 20 anchors 1-3) get `level=0` instead of
`level=1`. Numeric/letter PREAMBLEs continue to resolve to level=1+ via
existing 10-priority logic; stack-walk pop rule unchanged. Result:
level=0 section headers do not get popped by level=1 numeric PREAMBLEs;
numeric PREAMBLEs correctly parent under the level=0 section header.

Test calibration: 21 SUB HEAD rows in BoQ ELV currently asserted at
level=1 + parent=None. After fix: level=0 + parent=None (still rootless
at section-root level). Test JSONs need regeneration. NOT a regression
-- it's an explicit calibration update for the corrected behavior.

EXPECTED POST-FIX BEHAVIOR:
- bill_of_quantities r4 SUB HEAD A: level=0, parent=None.
- bill_of_quantities r6 sl=1.0: level=1, parent=r4. (Currently
  level=1, parent=None.)
- bill_of_quantities r9 sl=2.0: level=1, parent=r4 (A2-reframed
  re-parents from r6's parent which is now r4).
- All sl=1.0 through 14.0 PREAMBLEs/LINE_ITEMs in section A parent
  under r4 SUB HEAD A. Section structure correctly modeled.

CROSS-FIXTURE SAFETY:
- bill_of_quantities is the high-impact case. Closes v5.25 §17.41
  PARKED limitation.

Keystone observation (cluster-2 sequencing rationale): Bug 19 +
Bug 19-ext alone do NOT unlock BoQ-style structures, because
text-shaped pattern_signature (e.g. "SUB HEAD A" -> "UUU UUUU U")
never matches numeric-shaped pattern_signature (e.g. "1.0" -> "D.D")
under any tokenization. The one-line level=0 assignment change in
Bug 20-ext is what actually unlocks numeric PREAMBLEs parenting
under SUB HEAD section roots in Bill of Quantities. This makes
Bug 20-ext the highest-yield fix in cluster 2 for BoQ-style
structures -- Bug 19/19-ext are complementary but not substitutive.
Cluster 2 sequencing places Bug 20-ext last so its 21-assertion
test calibration lands after all prior cluster-2 fixes have
stabilized.

- safron r5/r41 (post Bug 20 anchor 1+2): also become level=0, get
  correct children.
- sg_hvac r5 (already PREAMBLE level=1 via sl_no=A): unaffected -- only
  promoted-via-anchor section headers get level=0. Existing PREAMBLEs
  with explicit sl_no keep their level.
- inovalon, snitch, raheja: no SUB HEAD pattern, no Bug 20 anchor
  promotions -> unaffected.

----------------------------------------------------------------------
Bug 22 -- Token-based pattern_signature (collapses consecutive digits)
Layer: hierarchy.py
----------------------------------------------------------------------

SYMPTOM: v5.25 `pattern_signature(sl_no)` is per-character: digits->D,
uppercase->U, lowercase->l, other chars literal. This means "9.0" produces
"D.D" but "10.0" produces "DD.D". Rule A2-reframed requires signature
equality between LINE_ITEM and stack-top PREAMBLE. When section
numbering crosses single-digit->multi-digit boundary, A2 stops firing.

CANONICAL FIXTURE EXAMPLE:
- snitch r48 sl_no="10.0" LINE_ITEM: stack at processing has
  [r14(A., L1), r31(3.0, L2)]. pattern_signature("10.0")="DD.D",
  pattern_signature("3.0")="D.D" -- DIFFERENT. A2-reframed does not fire.
  r48 attaches to top of stack = r31. Should be sibling of r6 sl=1.0,
  r9 sl=2.0, etc. (all parent under r14).
- snitch r50 sl_no="11.0": same issue, also parents under r31.

ROOT CAUSE: pattern_signature implementation maps each character
independently. Multi-digit integers produce N consecutive D's, breaking
equivalence with single-digit-prefix counterparts.

FIX SPEC: Modify `pattern_signature` to collapse consecutive same-class
characters into a single token. Two equivalent implementations:
(a) Regex-based: `re.sub(r"D+", "D", signature)` after current per-char
    mapping. "DD.D" -> "D.D", "DDD.DD" -> "D.D".
(b) Token-iteration: split by separator characters ("."), classify each
    token as "numeric"/"alpha"/"mixed" using the token's character classes.
    "10.0" -> ["numeric","numeric"], "3.0" -> ["numeric","numeric"]. Match.

Implementation choice: option (a) is the smaller change -- one line of
regex post-processing on existing function output. Tests need updating:
pattern_signature unit tests asserting "DD.D" for "10.0" should assert
"D.D" instead.

EXPECTED POST-FIX BEHAVIOR:
- snitch r48 sl_no="10.0": pattern_signature now "D.D" matches r31's
  "D.D". A2-reframed fires: same signature, first_token differs
  (10 != 3). Re-parent to r31's parent. r31's parent is r14 (sl=A.).
  r48 attaches to r14. Correct.
- snitch r50 sl_no="11.0": same, parents under r14.
- Same fix benefits any BoQ section with >=10 numbered items where the
  10+ items are LINE_ITEMs.

CROSS-FIXTURE SAFETY: STRICTLY ADDITIVE. The change only enables
additional A2-reframed firings (previously blocked by signature
mismatch). Existing firings (where signatures already matched, e.g.,
Snitch sl=2.0 through 9.0, BoQ ELV sl=2.0/3.0 vs 1.0) continue to fire
identically -- "D.D" still equals "D.D" under the new signature. No
existing-correct case becomes wrong. Test count: pattern_signature
unit tests need recalibration (~5-8 assertions), no integration test
regression expected.

LANDED v5.26a -- cluster 2 session 1 (feat 4e5561d3)

IMPLEMENTATION NOTES:
- Exact change: `return re.sub(r"D+", "D", "".join(result))` replaces
  bare `return "".join(result)` in pattern_signature. One line added.
  import re was already present (SUB HEAD detection v5.25).
- Unit-test recalibrations: 1 assertion in test_approach_a_rules.py
  (line 192, "10.3" expected "DD.D" -> "D.D").
- New tests: 3 methods in class TestPatternSignatureBug22 in
  test_hierarchy.py (test_multi_digit_collapses_to_single_token,
  test_single_digit_signature_unchanged,
  test_mixed_class_runs_each_class_collapses_independently).
- Parser test count: 484 -> 487 OK.
- Integration-level impact (snitch r48/r50 re-parenting) deferred to
  cycle 3 validation re-run (session 7). No integration test
  regressions observed during session 1 test run.
- Canonical 7-module command in prompt was stale: test_config +
  test_reader live at boq_parser root (not tests/ subdir), and
  test_approach_a_rules + test_sub_head_and_subtotal_reset were
  missing. Correct 9-module command documented in session findings.
  Sec 9 #110 CLOSED.
- Toggle added v5.26a session 1.5 (feat a2ce8a0d): module-level constant
  BUG_22_COLLAPSE_ENABLED (default True). Set False for regression
  isolation if cycle 3 validation re-run (session 7) surfaces a
  Bug 22-induced misfire. Mirrors v5.25 approach_a_enabled precedent
  in intent; module-level constant rather than function kwarg because
  pattern_signature is called from inside Rule A2-reframed. 3 additional
  tests in TestPatternSignatureBug22 covering toggle ON default +
  toggle OFF restoration of pre-Bug-22 per-char signature +
  same-first-numeric-token edge case (1.10 / 1.01 / 1.1 invariant lock
  -- same signature post-fix, same first_numeric_token, A2-reframed will
  not fire). Parser tests 487 -> 490 OK. Stale canonical command confirmed
  absent from plan-doc and CLAUDE.md (it existed only in session prompts,
  not in repo files -- no replacement needed in docs).

----------------------------------------------------------------------
Cross-bug interactions and implementation ordering
----------------------------------------------------------------------

Implementation will be batched per agreement #43 time-box (5-7 sessions
for all 9 fixes + cycle 3 validation re-run). Recommended cluster split:

CLUSTER 1 -- classifier.py + reader.py (~3 sessions):
- Bug 16 (classifier post-pass -- unit-blank demotion)
- Bug 17 (reader format helper + classifier integration)
- Bug 18 (merged-cell banner detection -- depends on Bug 17 architecture
  decision for cross-layer plumbing)

CLUSTER 2 -- hierarchy.py (~3 sessions):
- Bug 22 (pattern_signature token-collapse -- smallest, lands first) ✅ LANDED session 1
- Bug 19 (review flag on A2-reframed firings)
- Bug 19-ext (PREAMBLE-step signature siblings)
- Bug 20 anchors 1 + 2 (+ anchor 3 deferred to session 6) ✅ LANDED session 2
- Bug 20-ext (level-0 framing) ✅ LANDED session 2

VALIDATION -- cycle 3 re-run (~1 session):
- Re-run cycle 3 against 8 fixtures (multi_v1 dropped)
- Manual review of resolved-row outputs vs current baseline
- Confirm no regressions on 547 parser tests (or accept calibrated
  test JSON updates for Bug 19)

Cross-bug interactions to watch:
- Bug 16 + Bug 18: both re-route rows out of LINE_ITEM. Bug 18 fires
  earlier (in classify_row body); Bug 16 fires later (post-pass). No
  conflict.
- Bug 16 + Bug 20: Bug 16 may demote a LINE_ITEM to PREAMBLE
  (description+sl_no, no unit). Bug 20 anchors then fire on NOTE rows
  (Bug 16 doesn't produce NOTE from LINE_ITEM unless sl_no blank).
  No conflict.
- Bug 20 + Bug 20-ext: must fire in order -- anchors 1/2/3 promote NOTE
  to PREAMBLE first, then level-0 framing applies to those PREAMBLEs.
- Bug 22 + Rule A2-reframed: Bug 22 only changes signature output;
  A2-reframed's match logic unchanged. Bug 22 strictly adds firings.
- Bug 19 + §7.30: similar review flag namespace. Reason strings differ
  (priced_preamble_via_signature vs priced_preamble_with_children).
  One-writer-per-review_reason invariant (§22.11 invariant 5) preserved.

Out-of-scope shape observed during cycle 3 walk (Inovalon
subtotal-reset-and-continue):

Inovalon r28 SUBTOTAL is followed by rootless level-2 PREAMBLEs
at r30, r33, r44 -- the universal subtotal-reset rule (v5.25
§17.41) correctly resets the stack at r28, but the rows that
follow are not section-header-shaped (no SUB HEAD pattern, no
anchor-1/anchor-2 trigger context) and arrive at level 2 with
no level-1 or level-0 ancestor on the stack. This is a BoQ-author
data-quality issue (subtotal placed mid-section rather than at
section end) rather than a parser bug -- the BoQ author's intent
cannot be deterministically recovered from the spreadsheet text
alone. Disposition: out of scope for cycle 3 fix queue per
agreement #43. The wizard review pathway (Phase 2c body) surfaces
rootless level-2 PREAMBLEs for user-disambiguation via existing
rootless-row review flags; no parser-layer fix attempted.

### 17.45 [CLOSED 2026-06-24, feat pending] -- PREAMBLE rows silently dropped their source quantities (no-attribute-loss / Option B)

**Issue:** Any row that ended up classified `preamble` lost its source quantity (+ amount / per-area) in the parsed output — `qty_total` was written as 0/None even when the Excel qty cell held a real number. Confirmed on the last real upload (BOQ-26-00021, sheet `HVAC_-19TH FLOOR`): 16 line-items with genuine quantities (350 Rmt, 40 Rmt, 8 No., 1 Lot, 300 Kgs, …) were turned into preambles with qty=0.

**Root cause (two compounding parts):** (1) `_apply_priced_preamble_promotion` ("Bug 19", `classifier.py`) over-promotes real LINE_ITEMs into PREAMBLEs on sheets that use ONE flat integer `sl_no` series for BOTH section headers (no unit/qty → preamble) AND leaf line-items — its contiguous-sequence + cascade heuristic ("earlier promotions inform later ones") swallows the numbered leaf items. (2) STRUCTURAL: `resolve_hierarchy` built the PREAMBLE `ResolvedRow` WITHOUT the qty/amount carry-forward kwargs the LINE_ITEM branch has (`hierarchy.py`), so `flatten_resolved_row` read `qty_total=None`. The zero-children demotion that would rescue a leaf preamble explicitly SKIPS `promoted_from_line_item` rows → the qty was gone for good.

**Fix (Option B — "no source attribute lost during parsing; classification is a label, not a data filter", owner-locked principle):**
- `hierarchy.py`: the PREAMBLE `ResolvedRow` now carries `qty_by_area_raw`/`amount_by_area_raw`/`qty_total`(=`qty_total_raw`)/`amount_total`, symmetric with LINE_ITEM. No-op for genuine (qty-less) section headers.
- `orchestrator.py`: `_apply_multi_area_post_pass` gate widened LINE_ITEM-only → `{LINE_ITEM, PREAMBLE}` (SPACER/NOTE/subtotal/header_repeat stay skipped — they never become priceable nodes and the committed grid tier already preserves their raw cells).
- `review_screen.py`: the existing `priced_preamble_no_children` advisory flag now ALSO triggers on a carried `qty_total>0` (so qty-bearing preambles are surfaced for human reclassify, instead of a NEW parser `needs_classification_review` flag that would DUPLICATE the existing server-side flag); reason text → "…price or quantity…"; corrected the stale "DORMANT on freshly-parsed rows" docstring (false — Bug-19 promotions skip demotion, so 11 already fired on this sheet).

**Verification:** ~833 parser+review+commit tests green (Bug-19/Bug-20 promotion regressions + commit reconcile all intact). New tests: resolve_hierarchy preamble carry-forward (`test_hierarchy`), post-pass processes preamble + SPACER still skipped (`test_orchestrator` ×2), qty-only flag (`test_review_screen`); repurposed `test_non_line_item_rows_not_modified` → `test_spacer_rows_skipped`. Live non-destructive re-parse of BOQ-26-00021 / `HVAC_-19TH FLOOR`: **16/16 quantities restored, 15/16 surfaced for review**. To apply to a live BoQ: re-parse after the bench workers pick up the new code (re-parse discards human review edits on that sheet).

**Known follow-up (not a regression):** Option A (narrowing Bug 19 so a self-priced leaf is never promoted → labels also correct) is deferred. The 1/16 un-flagged row is a qty-bearing preamble WITH children whose pre-existing with-children flag (`_apply_priced_preamble_with_children_review_flag_post_pass` / `_is_priced_for_review`) didn't fire.

---

### Row-detail panel read views (review screen, FRONTEND-only, 2026-06-25)

**What:** added two NEW read views -- an ancestor breadcrumb (parent chain) + a direct-children list -- to the review-screen inline Row-detail panel (`ReviewTree.tsx`, the `expandedDetailRow === row.row_index` block), which previously showed only a row's IMMEDIATE parent and no children. **The original single-column panel design is UNCHANGED** (indigo brand-tinted card, vertical classification/parent stack, 3 separate edit grids, AI/Gemini/revert blocks, remarks, flags, edit history -- all exactly as before). The two views are mounted ADDITIVELY in a `mb-2 space-y-2` block placed right after the Classification/Parent display grid and before the AI-suggestion block.

**Scope note (recorded):** a fuller two-column "CONTEXT (read) | ACTIONS (write)" revamp of this panel (neutral surface, FINDING B indigo reversal, AI consolidation, read/write bifurcation) was prototyped via `/grill-with-docs` + `/frontend-design` and then **REVERTED by owner request** -- only the two read views below were kept. `ReviewTree.tsx`'s panel body + `GeminiAcceptBlock.tsx` were git-restored to their pre-revamp state; the indigo-tint FINDING B decision STANDS (not reversed).

**Build (the only surviving changes):**
- NEW `frontend/src/pages/boq-wizard/ParentChain.tsx` -- PURE; walks `effective_parent_index -> byIdx` (same shape as `revealAndScrollToRow`, `HOP_CAP=60` + self/cycle guard) to a vertical indented ancestors→(this row) tree; ancestor crumbs clickable via `onNavigate`. ROOT indicated correctly: NO synthetic "Root" node -- the actual root-most ancestor is tagged "top level" (only when its own parent is null/-1), and a top-level current row renders "This row is at the top level — no parent." Text scale matches the panel (`text-[10px]` label / `text-xs` rows).
- NEW `frontend/src/pages/boq-wizard/ChildrenList.tsx` -- PURE; reads the new `childrenByParent` map; DIRECT children only, each with a `▸N` grandchild-count (`childrenByParent.get(child)?.length`), descriptions HARD-capped at 35 chars (`capDesc`, JS slice + ellipsis), `max-h-48` scroll, empty → "No children." Text scale matches the panel (`text-[10px]` / `text-xs`). Both reuse `ClassificationPill` from `reviewRender`.
- `ReviewTree.tsx` (4 minimal additions, panel body otherwise untouched): (a) imports the two components; (b) the `[rows]` memo now also builds `childrenByParent: Map<number, ReviewRow[]>` (O(n) inverse of `effective_parent_index`, render-order preserved); (c) new `navigateToRow(idx)` = `setExpandedDetailRow(idx)` + `revealAndScrollToRow(idx)` (open-target-panel + reveal/scroll/flash on a crumb/child click); (d) the `<ParentChain/>` + `<ChildrenList/>` mount block after the classification/parent grid. Both render in editable AND readOnly sheets (read context).

**Known limit:** a ParentChain/ChildrenList navigate target hidden by an active classification/status FILTER (not just collapse) is a no-op scroll -- same as the existing scroll-to-parent.

**Verification:** project `tsc` delta-0 (3181 before == after; 0 errors in any touched file); in-container Vite build exit 0 (`✓ 7938 modules transformed`). No Frappe tests (frontend-only). Manual live-cert pending: LC1 parent chain renders + crumbs drill-navigate; LC2 children list + `▸N` + drill; LC3 both views show in a readOnly (finalized) sheet too; LC4 regression -- the rest of the original panel (reclassify, change-parent, 3 edit grids, remarks, Looks OK, Claude+Gemini, revert, edit history) unchanged.

---

### Fuzzy description search (review screen, FRONTEND-only, 2026-06-25)

**What:** the two description search boxes in the BoQ post-parse review workflow -- `ReviewTree.tsx` (the #159 main
find-&-filter) and `SheetSearchView.tsx` (the source-row finder, also embedded as the parent-picker inside
`RestructureModal.tsx`) -- previously matched with case-insensitive SUBSTRING (`description.toLowerCase().includes(q)`).
They now use the SAME token-scoring algorithm the app-wide pickers use (`utils/tokenSearch`, the extracted
`FuzzySearchSelect` core), so a query like `cable 16` finds *"Supply & laying of XLPE cable 4C x 16 sqmm"* even though the
words aren't contiguous. `RestructureModal` owns no search of its own -- it inherits the upgrade via SheetSearchView (no
RestructureModal change). A codebase sweep confirmed these are the ONLY description/text searches in `boq-wizard/` (the
other "filters" -- classification/status/AI/priceability -- are toggles, not text search, and are untouched).

**Locked decisions (from `/grill`-style fork resolution):**
- **A -- ordering.** Fuzzy decides MEMBERSHIP only (which rows match). Each surface then re-emits its hit list in
  DOCUMENT order (its source `rows`/`allRows` order), so the prev/next stepper still walks top-to-bottom. tokenSearch's
  relevance ranking is DELIBERATELY discarded -- a find-stepper should not jump around by score.
- **B -- strictness.** AND semantics: every >=2-char query token must match (`minTokenMatches = tokenCount`, computed at
  the call site). `partialMatch: true` (`cable` matches `cabling`). Min length 2 -- a <2-char query, OR a query whose
  tokens are all 1-char, yields NO hits (1-char fuzzy-partial floods).
- **C -- scope.** Only the two surfaces above; RestructureModal inherits; non-text filters untouched.

**Build:**
- NEW `frontend/src/pages/boq-wizard/boqDescriptionSearch.ts` -- ONE shared pure export `fuzzyDescriptionMatchSet<T>(items,
  query, getText)` -> `Set<T>` of MATCHING ORIGINAL references. Guards short/empty queries to an EMPTY set (NOT
  tokenSearch's "empty returns everything" default -- the find-semantics trap). The token-count it passes as
  `minTokenMatches` uses the SAME `length >= 2` filter as the config's `minTokenLength` (they MUST agree or nothing
  matches). One definition so the two surfaces never drift.
- `ReviewTree.tsx` `searchHits` memo -- candidates gated by the UNCHANGED filter axis (`classificationVisible &&
  passesFilter`, NOT the collapse axis `isVisible`); `fuzzyDescriptionMatchSet(candidates, q, r => r.description ?? "")`;
  re-emit `candidates.filter(has).map(row_index)` (document order). Steppers / ring+flash tiers / counter /
  `revealAndScrollToRow` / dep array all unchanged. The "hit predicate's filter axis == render gate's filter axis"
  invariant is preserved (only the text test changed).
- `SheetSearchView.tsx` `hits` memo -- keeps `searchEnabled`/`descriptionLetter`/degraded-mode guards;
  `fuzzyDescriptionMatchSet(allRows, q, r => String(r.cells[descriptionLetter] ?? ""))`; re-emit
  `allRows.filter(has).map(row_number)` (document order). Scroll/center/flash, `onCurrentHitChange`, counter unchanged.

**Accepted edge cases:** 1-char query -> no hits (was substring); query of only 1-char tokens -> no hits;
`description == null` -> never matches (mirrors the old `if (d && ...)` guard). Perf O(rows x tokens) per keystroke,
trivial at BoQ scale; no debounce added.

**Verification:** project `tsc` delta-0 (3181 before == after; 0 errors in any touched file -- the standalone-LSP `@/`-alias
"cannot find module" + downstream implicit-any are pre-existing noise, not tsc errors). In-container Vite build exit 0
(`✓ built in 1m 24s`). No Frappe tests (frontend-only). Manual live-cert pending: LC1 ReviewTree `cable 16` finds a
non-contiguous match + Next walks top->bottom; LC2 same inside the RestructureModal parent-picker; LC3 1-char query => no
hits; LC4 active classification/status filters still gate hits; LC5 highlight/flash/counter intact.

---


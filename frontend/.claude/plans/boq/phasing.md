# BoQ — Phasing

## Contents
- Phase 0 — Project context *(complete)*
- Phase 1 — Data model + manual entry *(2–3 days)*
- Phase 1.8 — Per-area rate + amount schema extension ✅ COMPLETE
- Phase 1.8.1 — F1 + F2 cleanup ✅ COMPLETE
- Phase 1.9a — Parser support for per-area rate ✅ COMPLETE
- Phase 1.9b — Parser support for append_to_notes ✅ COMPLETE
- Phase 1.9d — F3b + F5 + F7 Raheja-fidelity bundle ✅ COMPLETE
- Phase 1.9e — Real-fixture stress test (observability chore) ✅ COMPLETE
- Phase 2a — Reader + Mapping Config schema ✅ COMPLETE & MANUALLY VERIFIED
- Phase 2b.1a — Row classifier ✅ COMPLETE
- Phase 2b.1b — Hierarchy resolver ✅ COMPLETE
- Phase 2b.2 — Multi-area + first end-to-end fixture ✅ COMPLETE (Parts A1–A3c, B1, B2a, B2b-keywords, B2c, B2d, B2e, B2f all complete)
- Phase 2c — DB commit + version cascade + 4 more fixtures ⏳ FUTURE
- Phase 3 Module 1a — Wizard backend and schema ✅ COMPLETE
- Phase 3 Module 2a -- Hub backend: schema + sheet-draft endpoints ✅ COMPLETE
- Phase 3 Module 2b-i -- Hub static shell + read-only sheet-card list ✅ COMPLETE
- Phase 3 Module 2b-ii -- Wire hub interactions + fix status pill colors ✅ COMPLETE
- Phase 3 Module 2b-iii -- Hub visual polish ✅ COMPLETE
- Phase 3 Module 3 Slice 3a -- Backend schema + endpoints (per-sheet sheet_config + work_package multi-link) COMPLETE
- Phase 3 Module 3 Slice 3b-i -- Backend sheet-data preview endpoint (values-only, S3-safe) COMPLETE
- Endpoint follow-up: `get_sheet_preview_full(boq_name, sheet_name)` -- single-pass full-sheet read (feat 196ed765, 2026-06-10) COMPLETE
- Phase 3 Module 3 Slice 3b-ii -- Frontend spoke shell + SheetDataGrid + load-more paginator COMPLETE
- Phase 3 Module 3 Slice 3b-iii -- SheetDataGrid polish (sticky header + gridlines + decode fix) COMPLETE
- Phase 2 — Excel parsing engine (backend only) *(4–5 days)*
- Phase 3 — Upload + mapping UI (manual flow) *(5–7 days)*
- Phase 4 — AI assist *(3–4 days)*
- Phase 5 — Edit + audit UI *(2–3 days)*
- Phase 6 — Read views, search, export *(3–5 days)*
- Phase 7 — Linkage layer *(2–4 weeks, sub-phased)*

## 13. Phasing

Each phase = one feature branch (`feature/boq-phase-<N>`) → review → merge before next phase.

### Phase 0 — Project context *(complete)*
- `CLAUDE.md` enriched.
- This plan committed at `frontend/.claude/plans/boq-upload-plan.md`.
- Decisions log at end of this file.

### Phase 1 — Data model + manual entry *(2–3 days)*
- Doctypes: `BOQs`, `BOQ Nodes`. JSON schemas as in §6.
- Controllers in `integrations/controllers/`. Validation, path computation, amount auto-computation.
- Audit: confirm Nirmaan Versions schema; add `reason` field if missing; wire BOQ Node changes to write Nirmaan Versions entries.
- `hooks.py` `doc_events` updates.
- Real tests covering: path computation, amount computation, validation rules per node_type, parent-child consistency, audit log creation. Use `FrappeTestCase`. Aim for genuine coverage, not stubs.
- Permissions: match Procurement Requests / Procurement Orders conventions.
- **Exit:** can manually create a BoQ tree via Frappe Desk; tests pass.

### Phase 1.8 — Per-area rate + amount schema extension ✅ COMPLETE

**Completed 2026-05-16. Feat commit: `7d5fbc4e`. 88 Phase 1.x Frappe tests passing (60 boq_nodes + 28 boqs). 237 parser tests unchanged.**

Extends `BOQ Node Qty By Area` from 2 fields to 9 fields: adds `supply_rate`, `install_rate`, `combined_rate`, `supply_amount`, `install_amount`, `total_amount`, `amount_override`. Adds controller logic with: (a) universal-rate fallback semantics — when source file doesn't provide per-area rate, populate from parent line-item rate; (b) auto-computed per-area amounts as `area_qty × area_rate` unless source file provides them; (c) `amount_override` Check field parallel to parent — when set, suppress auto-compute; (d) weighted-average precedence on parent — when per-area rates set, parent universal rate auto-recomputes as `Σ(area_qty × area_rate) ÷ Σ(area_qty)` in `before_save`; (e) consistency validation on child rows — `combined_rate == supply_rate + install_rate` when all three set (mirrors parent-row rule). Migration patch back-populates existing child-table rows with parent's universal rate. **Scope note (2026-05-16): `make_model` field was already present on `BOQ Nodes` (position 25) — Phase 1.8 added `"make_model"` to the `_write_audit` tracked-fields list (1-line cascade fix per §7.33 + §9 #55). Controller logic lives in `integrations/controllers/boq_node_qty_by_area.py` (helper module called from parent controller — no hooks.py change needed).**

### Phase 1.8.1 — F1 + F2 cleanup ✅ COMPLETE

**Completed 2026-05-17. Feat commit: `4c6b81e6`. 91 Phase 1.x Frappe tests passing (63 boq_nodes + 28 boqs). 267 parser tests unchanged.**

F1 (per-child consistency guard, §9 #58): `_validate_combined_rate` in `boq_node_qty_by_area.py` already had the correct all-three-set guard (`if sr is not None and ir is not None and cr is not None:`). The Phase 1.8 Desk-verification finding was that TESTS were missing for the partial-rate cases, not the code. Added 2 tests (Group G): `test_child_supply_only_no_consistency_error` (supply_rate set, install_rate/combined_rate None → no error) and `test_child_install_only_no_consistency_error` (install_rate set, supply_rate/combined_rate None → no error). Regression case already covered by existing Phase 1.8 test — not duplicated.

F2 (Desk-save audit trigger, §9 #59): `on_update` had `if old_doc is None or not doc.edit_reason: return`, blocking audit on Desk saves where `edit_reason` is not filled in. Fix: (1) removed `not doc.edit_reason` from the guard — audit fires for all saves with tracked-field changes; (2) `_write_audit` defaults `nv.reason` to `"Desk edit"` when `edit_reason` is not explicitly provided; (3) added `if not changed: return` guard to suppress no-op saves; (4) added `_NULLABLE_NUMERIC_FIELDS` normalization in `_write_audit`'s comparison loop — Frappe stores Currency/Int `None` as `0` in PostgreSQL, causing false `old=0 vs new=None` diffs on repeat saves for unset rate/amount/level fields; normalizing via `or 0` for 8 fields eliminates this noise. Existing test `test_audit_entry_not_written_without_reason` renamed to `test_audit_entry_without_reason_defaults_to_desk_edit` and updated (expects reason `"Desk edit"`, adds finally cleanup). New tests: `test_audit_entry_not_written_when_no_fields_change` (+1).

### Phase 1.9a — Parser support for per-area rate ✅ COMPLETE
Extends `ClassifiedRow` with `rate_by_area_raw: dict[str, dict[str, float | None]]` (parallel to existing `qty_by_area_raw` / `amount_by_area_raw` — completes the §7.22 parallel-field pattern). Adds three new ColumnRoles: `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`. Extends `multi_area_detection.py` to recognize the 3-col-per-area Raheja "Pattern 2-rate" shape (`[Area merge][Qty][Rate][Amount]` vs textbook 2-col `[Area merge][Qty][Amount]`) — closes §17.5 / handover §9 #39 (partial). Routing priority: Pattern 2-rate → Pattern 2 → Pattern 3 → Pattern 1 (Pattern 2-rate tried first because it is a strict superset of Pattern 2 shape). Extends `_apply_multi_area_post_pass` to populate `rate_by_area` on `ResolvedRow`, auto-compute per-area amounts from rate×qty when amount not directly present, and emit soft `combined_rate != supply_rate + install_rate` validation warning. Synthetic `synthetic_pattern_2_rate.xlsx` fixture added. 12 new parser tests (237→249). Feat: `b2a2f747`. **All per-area rates in Pattern 2-rate default to `combined_rate` kind — split supply/install sub-label detection deferred to a future iteration.**

### Phase 1.9b — Parser support for append_to_notes ✅ COMPLETE
Adds `append_to_notes` to ColumnRole Literal in `config.py` (NOT singleton, NOT area-compatible). Adds `append_notes_raw: dict[str, str]` field to `ClassifiedRow` in `classifier.py` — keys are source column header strings (resolved via `SheetConfig.column_headers`, falling back to column letter), values are cell text coerced via `str()`. Pattern mirrors `qty_by_area_raw`. Empty/blank cells produce no dict entry (Policy-X-style empty-cell-skip). NOTE: `ResolvedRow` does NOT need its own field — accessed via `resolved_row.classified_row.append_notes_raw`. `column_headers: dict[str, str] = {}` field added to `SheetConfig` (Case B → Option B resolution, chat-Claude 2026-05-16). Phase 2c commit step merges captured values into the `notes` field on `BOQ Nodes` with structured `[Source: ...] [Column: ...]` prefixes (§7.34). 8 new tests (249→257): +3 test_config.py (append_to_notes accepted, multiple columns, column_headers round-trip), +5 test_classifier.py (TestAppendNotesRaw class). Feat: `78b3d233`.

### Phase 1.9d — F3b + F5 + F7 Raheja-fidelity bundle ✅ COMPLETE

Design-locked 2026-05-17. Three findings bundled. Implementation prompt to follow as a separate sub-phase.

**F3b (§9 #62) — `_RATE_CELL_PATTERN` widening.** Pattern 2-rate detection regex in `multi_area_detection.py` currently `r"^\s*rate\s*$"` rejects "RATES" plural. Raheja Commerzone Electrical uses "RATES"; falls through to Pattern 1; areas + qty still capture correctly via fallback but per-area rate fidelity lost. Locked fix: widen regex to `r"^\s*rates?\s*$"`. 1-line change. Implementation prompt to include: regex widening + new synthetic fixture variant with RATES-plural shape + audit-script regression check per agreement #25 + remove `@unittest.expectedFailure` decorator on `test_electrical_pattern_2_rate_detected`.

**F5 (§9 #63) — `SheetConfig.top_header_rows_override: list[int] | None` field.** Orchestrator currently hardcodes `top_header_row = header_row - 1` in `_apply_multi_area_post_pass`. Cannot bridge multi-row gaps (Raheja HVAC: 13-row gap between merged area-name top row at row 2 and bottom header row at row 15). Locked fix: add new optional field `top_header_rows_override: list[int] | None = None` to `SheetConfig`. **Field is plural and list-typed** for forward-compatibility with Pattern 6 (Société Générale compound area names per §7.4 / §7.12 / §7.19). When set, orchestrator uses the override list to identify top-header row(s). When unset, falls back to existing `header_row - 1` behaviour. Single-element list `[2]` is the Raheja HVAC case. Multi-element lists (Pattern 6 case) deferred — parser support for multi-row concatenation not in 1.9d scope. Validation: each entry must be a valid row number less than `header_row`; entries must be unique. Implementation prompt to include: schema change + validation + orchestrator branch + 2-3 new tests + remove `@unittest.expectedFailure` decorator on `test_hvac_pattern_2_rate_with_header_gap`. Migration path noted: when Pattern 6 lands, the same field absorbs multi-row concatenation logic — no schema migration needed.

**F7 (§9 #64) — Merged title banner standing pattern (no code change).** Real-BoQ row 1 frequently carries a merged title banner spanning all populated columns (Raheja Electrical "BOQ - ELECTRICAL"; D-Tech "PHASE-0"). Without user mitigation, parser classifies as junk LINE_ITEM with banner text propagated into sl_no/description/unit (zero qty via Policy X — benign but noisy). Existing `MappingConfig.skip_top_rows_after_header` field handles via row-index list (e.g. `[1]` for row 1, `[1, 2, 3, 4]` for multiple noise rows). **No code change in Phase 1.9d.** Standing pattern documented here. Phase 3 wizard default-skip behaviour when a merged cell spans all populated header columns is agreement #24 extension candidate — codify when Phase 3 wizard design lands.

**Pattern 6 (Société Générale compound area names) — design-locked but parser-deferred.** §7.19 captured the 2-level concatenation rule on 2026-05-12: top-row value + bottom-row value, with parenthetical-suffix stripping (case-insensitive trailing `(Qty)` / `(Quantity)` / `(Amount)` / etc.), joined by underscore separator. Worked example: top `Voyager (Qty)` → strip → `Voyager`; bottom `Ground +MF`; compound `Voyager_Ground +MF`. **3+ level concatenation is a known boundary** — build when a real fixture surfaces (currently zero such fixtures across the 24 real BoQs committed in v5.8). Pattern 6 parser implementation likely absorbed by Phase 3 wizard rather than shipping as detection code. The F5-b `top_header_rows_override: list[int]` field is the future Pattern 6 entry point — same field, multi-element list with concatenation logic added when needed. Re-evaluation triggers: (a) Phase 1.9e surfaces a 2nd Pattern 6 fixture, OR (b) a real user needs Société Générale upload before Phase 3 ships.

**Scope estimate:** ~250-300 line implementation prompt covering all three findings. Comfortably under 700-line cap per agreement #15.

**Status:** ✅ COMPLETE. Feat commit `eacc8b38`. F3b CLOSED (§9 #62). F5-b CLOSED (§9 #63). F7 documentation-only (§9 #64). Parser test count 267 → 274. 0 expected failures (was 2). Raheja Electrical + HVAC integration tests now pass without expectedFailure decorators. Audit-script regression check per agreement #25: classifier_audit_output.json ZERO CHANGES; preamble_with_children_audit_output.json ZERO CHANGES; keyword_audit stdout shows Raheja RATES-plural sheets flip to pattern_2_rate (expected F3b outcome, disclosed). Pattern 6 concatenation still deferred; field shape forward-compatible.

### Phase 1.9e — Real-fixture stress test (observability chore) ✅ COMPLETE

Walks all 25 fixtures (24 real BoQ workbooks + Snitch) with zero user declaration (auto-guessed `MappingConfig`). Selects up to 4 real BoQ sheets per workbook (skip excluded sheets by name, rank by data-row count). Calls `parse_boq()` once per workbook and records per-sheet parse results. Detects rate/cost/price synonym variations in header rows not matched by `_RATE_CELL_PATTERN`. Emits `real_fixture_stress_test_output.json` as a characterization artifact — no test assertions, no parser code changes, no Frappe code touched. Empirical basis for §17.13 wizard-load re-evaluation.

**Results:** 68 sheets parsed across 25 workbooks (1 load failure: openpyxl XML parse error on one file). 62 rate-synonym variations surfaced. Pattern 1 = 9 sheets auto-detected (13%); Pattern 2/3 = 0 by construction (auto-guess uses `header_row_count=1` only). 274 parser tests unchanged.

**Status:** ✅ COMPLETE. Chore commit: 5cd4f580. Output JSON: `real_fixture_stress_test_output.json`.

### Phase 2a — Reader + Mapping Config schema ✅ COMPLETE & MANUALLY VERIFIED

**What it built:**
- Pydantic-based MappingConfig schema (`config.py`): MappingConfig, SheetConfig, ColumnRole, GlobalSettings, MasterBoqMetadata. Full validation: column letters `^[A-Z]+$`, role uniqueness, area-must-match-area_dimensions, header_row required for data sheets, master_preamble vs data sheet types.
- BoqReader class (`reader.py`) wrapping openpyxl: list_sheets() preserving exact names including whitespace; get_sheet_dimensions() (content-based); iter_rows() with lazy iteration and content-based dimension detection on empty sheets; detect_header_row() weighted-keyword heuristic with row-shape guards; detect_blank_columns(); get_master_preamble_text().
- RawRow + CellInfo dataclasses capturing: computed values, formulas, merged ranges, bold formatting, fill RGB, indent.
- Synthetic fixture generator producing 7 .xlsx test fixtures (committed to repo): synthetic_simple, synthetic_merged_header, synthetic_trailing_spaces, synthetic_blank_cols, synthetic_empty, synthetic_sparse_header, synthetic_makelist_header.
- 35 new tests (14 config + 21 reader), all passing. Phase 1.x: 77/77 still passing.

**Two bugs fixed:**
1. `detect_blank_columns` couldn't see column Z because openpyxl's `max_column` only reflects written columns. Fixed by writing `ws["Z1"] = ""` in the test fixture to extend `max_column` to 26.
2. Empty sheets returning phantom blank row because openpyxl's `max_row` defaults to 1 after save/reload. Fixed by content-based dimension detection in `iter_rows()` when `end_row` not specified.

**Heuristic loosening (follow-up commit `c34b1440`):** Manual verification on real JSW BoQ revealed `detect_header_row` returned `None` for HVAC and ELEC Make List sheets (sparse multi-area headers and domain-specific vocabulary). Heuristic was loosened with weighted scoring (strong keywords +2pts: sl.no, s.no, sno, sr.no, description, item description; medium keywords +1pt: item, material, materials, details of materials, make/model, approved make, approved makes) and row-shape guards (≥3 non-empty cells, ≤1 cell with text >60 chars, not the last content row). 3 new tests + 2 new synthetic fixtures added. After loosening, all 3 real-file sheets returned correctly: Elect B1 → 2, HVAC → 5, ELEC Make List → 3.

**Manual verification done on real JSW Unpriced BoQ via Frappe console** — sheet listing exact, dimensions detected including stray content in column G that initial inspection missed (reader correctly returned (438, 7) — column G has values at rows 181 and 185), bold detection works, formulas captured, blank rows detected, header detection works on all 3 spot-checked sheets.

Branch: `feature/boq-phase-2`.

### Phase 2b.1a — Row classifier ✅ COMPLETE

**What it built:**
- `classifier.py`: RowClassification enum (PREAMBLE, LINE_ITEM, NOTE, SUBTOTAL_MARKER, SPACER, HEADER_REPEAT), ClassifiedRow dataclass, classify_row() pure function.
- Evaluation order: spacer → header-repeat (3+ keyword matches in mapped columns) → subtotal (text regex patterns OR =SUM( formula in any amount column) → qty extraction with RO-marker detection and blank-qty+rate rule → PREAMBLE / LINE_ITEM / NOTE decision.
- Handles RO/ro/R/O/RATE ONLY markers (qty=0, is_rate_only=True), blank qty cells (qty=0 when rates present), unit whitespace stripping, make_model passthrough, row_notes passthrough, numeric sl_no preservation as string, per-area raw qty capture (splitting deferred to 2b.2).
- Pure per-row logic — no tree-walking, no parent inference, no multi-area splitting.
- 17 new tests (asked for 12 minimum, +5 bonus for edge cases). All passing. Phase 1.x + Phase 2a tests: 129/129 still passing (28 BOQs + 49 BOQ Nodes + 14 config + 21 reader + 17 classifier).

Branch: `feature/boq-phase-2`. Commit: `9d8afac5`.

**Follow-up fix (ghost-note suppression):** Manual verification on real JSW Elect B1 revealed ~70 visually-empty rows being classified as NOTE because they contained leftover template formulas (e.g. `=N($D17)*N(E17)` evaluating to 0 with blank qty/rate). Added a post-extraction emptiness check after the classification decision: if classification = NOTE AND every extracted field (sl_no_value, desc_text, unit, qty, all rates, make_model, row_notes) is None/empty, override to SPACER and clear warnings. 1 new test (18 total classifier tests, 130 total). Commit: `ab99fb6c`.

### Phase 2b.1b — Hierarchy resolver ✅ COMPLETE

**What it built:**
- `hierarchy.py`: `ResolvedRow` dataclass (parent_index, level, path, attached_to_index, attached_notes), `ResolvedSheet` dataclass (rows, master_preamble_notes, warnings), `resolve_hierarchy()` pure function, `_determine_preamble_level()` private helper.
- Stack-walk algorithm with in-memory `path_cache: dict[int, str]` — avoids DB round-trips during bulk insert. `stack[i]` holds the resolved-row index of the most recent preamble at level i+1.
- **Note attachment:** notes attach to the topmost non-None preamble on the stack. Notes before the first preamble go to `ResolvedSheet.master_preamble_notes`.
- **Mid-sheet numbering reset:** SUBTOTAL_MARKER rows matching `^\s*total\s+item\s+no\.?\s+\d+` (case-insensitive) clear the stack entirely; subsequent preambles restart at level 1. Plain subtotals (e.g. "TOTAL CARRIED OVER") do not reset.
- **Level determination heuristic** (in order): pure integer → level 1; dotted-decimal (trailing `.0` stripped; ambiguous `1.0.0` → level 1) → len(parts) depth; single letter (A., B.) → level 1; PART-X → level 1; Roman numeral → level 1; digit+letter (1a) → level 2; digit.digit+letter (1.1a) → level 3; fallback to `sl_no` cell indent (indent+1); final fallback to stack_depth+1. Soft warning emitted for level > 5.
- 19 new tests across 4 families (tree shape, note attachment, special markers, level heuristics). All 72 parser tests passing (14 config + 21 reader + 18 classifier + 19 hierarchy). 77 Phase 1.x tests still passing.

Branch: `feature/boq-phase-2`. Commit: `fdb6eb64`.

**Follow-up fix (level_1_style detection — context-aware level determination):** Manual verification on real JSW Elect B1 revealed all 32 preambles classifying at level 1 (flat list, no tree) due to context-blind heuristic. Root cause: trailing-zero stripping rule for `1.0` produced level 1 even when `1.0` was a sub-section under a letter-coded parent. Fix: pre-scan sheet to detect first-preamble code style as `level_1_style` (one of letter/roman/numeric/part); subsequent preambles matching that style → level 1, different recognized style → level 2, multi-dot decimal → 1 + dots, lowercase letter → stack_depth + 1, unknown → fallback chain (cell indent → stack_depth + 1). Re-detects after mid-sheet "TOTAL ITEM NO. X" reset. Added `level_1_style_override` field to `SheetConfig` for Phase 3/4 manual override. Pattern Y multi-dot ambiguity emits warning category `ambiguous_level_pattern_y` and uses default depth — Phase 3 wizard resolves. Test count increased from 19 → 31 hierarchy tests; total parser tests 84 (14 config + 21 reader + 18 classifier + 31 hierarchy). Commit: `7f63e39a`.

**Second follow-up fix (lookahead-based level_1_style detection):** Manual re-verification on JSW Elect B1 (after the level_1_style fix) revealed sections C and D being mis-categorized because single chars C, D, L, M, I, V, X are valid Roman characters and match `_RE_ROMAN` before `_RE_UPPER`. A simple regex-order swap was attempted and reverted — it broke Paytm's legitimate Roman pattern starting at `I.` (where I, II, III sequences need single-char I to be Roman, not letter). Correct fix: lookahead-based detection in `_detect_level_1_style` that examines the first TWO level-1-eligible preambles. Unambiguous chars (A, B, E, F, G — not in [IVXLCDM]) return "letter" immediately. Ambiguous single chars (I, V, X, L, C, D, M) check the second preamble: multi-char Roman second (II, III...) → roman (Paytm I./II./III. pattern); single char alphabetically near (abs(ord) ≤ 3, e.g. C→D) → letter; both in Roman set and far apart → roman; else → letter. Plus a small special case in `_determine_preamble_level` so single-char Roman codes (C, D etc.) are accepted at level 1 on letter-style sheets (the categorizer still returns "roman" for them since `_RE_ROMAN` is unchanged). Handles both JSW alphabetic (A-G with C/D) and Paytm Roman (I-IV) correctly without regression. Test count increased from 31 → 36 hierarchy tests; total parser tests 89 (14 config + 21 reader + 18 classifier + 36 hierarchy). Commit: `90b0f0db`.

**Third follow-up addition (preamble candidate scoring + `is_synthetic` field for Phase 3 wizard):** Manual verification on real Inovalon HVAC BoQ revealed BoQ authors sometimes use unnumbered text-only rows as section headers (example: row 36 "Central Air Cleaner for AHUs" introduces line items 41-42 but has no sl_no). The classifier correctly labels these as NOTE since they have no sl_no, but Phase 3 wizard needs metadata to surface promotion candidates. Added `preamble_candidate_score: int` (0-5) and `preamble_candidate_signals: list[str]` to `ClassifiedRow` (both default to 0/[] — rows classified individually are unaffected). Score breakdown: bold +2, first-note-in-block-ending-at-line-item +2, short description (<80 chars) +1. Computed by new function `populate_preamble_candidate_scores(classified_rows, sheet_config)` called as a separate post-pass after individual row classification (Phase 2b.2's `parse_boq()` orchestrator will call it). Also added `is_synthetic: bool = False` field to `ResolvedRow` (parser never sets True) reserved for Phase 3 wizard's "create new preamble from scratch" action. Classifier classification and tree logic unchanged — this is data preparation only. Test count: classifier 18 → 26, hierarchy 36 → 37; total parser tests 98 (14 config + 21 reader + 26 classifier + 37 hierarchy). Commit: `481035ba`.

### Phase 2b.2 — Multi-area + first end-to-end fixture ✅ COMPLETE (Parts A1–A3c, B1, B2a, B2b-keywords, B2c, B2d, B2e, B2f all complete)

- Multi-area qty processing — populates qty_by_area per row from the qty_by_area_raw dict the classifier already captures
- First end-to-end test fixture using real Snitch BoQ (small, 4-sheet file, simple structure)
- Hand-written expected-output JSON for the Snitch fixture (~1 hour of careful work)
- parse_boq(file_path, config) entry point wiring reader + classifier + hierarchy resolver
- ~13 unit tests + 1 integration test using the Snitch fixture

**Part A1 complete (2026-05-10):** `iter_rows()` extended so that cells covered by a merged range (not the origin) now propagate the origin's `value`, `formula`, `formula_text`, and `merged_range` string into their `CellInfo`. `is_merged_origin` stays `False` for covered cells. Formatting fields (`font_bold`, `fill_color_rgb`, `indent`) are always the covered cell's own data — not inherited from the origin. Implementation: a per-invocation `covered_lookup: dict[(row, col), (range_str, value, formula_text, is_formula)]` built at the start of `iter_rows()` by walking `ws.merged_cells.ranges`; origin cells fall through to existing logic unchanged. 6 new tests in `TestMergedCellPropagation` class (origin unchanged, covered inherits range, covered inherits value, covered is not origin, formatting not inherited, two-row Pattern-2-shaped layout). Test count: reader 21 → 27; total 175 → 181. Commit: `ed860248`.

**Part A2 complete (2026-05-10):** `ColumnRole` Literal extended with 3 new roles: `amount_combined`, `qty_by_area`, `amount_by_area`. (`rate_combined` was already present; `total_qty` dropped — existing `qty_total` serves this role.) `_AREA_COMPATIBLE_ROLES` extended from 4 to 6 entries to include the two new per-area roles. New `area_required_for_by_area_roles` model validator enforces that `qty_by_area` and `amount_by_area` must have a non-empty `area` value; existing optional-area behaviour for `qty`, `amount_supply`, `amount_install`, `amount_total` is unchanged. Existing `area → area_dimensions` cross-check on `SheetConfig` applies automatically to the new roles (role-agnostic code). `GlobalSettings` gains `multi_area_reserved_keywords: list[str]` (22-entry locked default; `Field(default_factory=...)` pattern). 6 new tests (20 config total). Test count: config 14 → 20; total 181 → 187. Commit: `c70e186b`.

**Pre-implementation discrepancies surfaced and resolved:** (1) `rate_combined` already existed in Literal — dropped from addition list. (2) `total_qty` = same concept as existing `qty_total` — dropped; Part A3 populates `qty_total`. (3) `area_name` vs existing `area` field — resolved Option B: reuse existing `area` field, extend `_AREA_COMPATIBLE_ROLES`, add require-validator for new roles only. (4) Proposed Test 5 (area→area_dimensions cross-check for `qty_by_area`) was redundant with existing `test_area_referencing_undeclared_dimension_rejected` — replaced with combined `test_amount_combined_role_does_not_accept_area` (positive + negative assertions for `amount_combined`).

**Follow-up fix (2026-05-10, commit `c7f8912b`):** `amount_combined` was omitted from `_SINGLETON_ROLES` in the original A2 commit. Added adjacent to `amount_total` to match the amount-fields cluster. Parallel to `rate_combined` (already a singleton). The existing generic duplicate-rejection validator covers it automatically — no new test required. Test count unchanged at 187.

**Ops note (2026-05-10, commit `017b2a1a`):** `CLAUDE.md` Active Features row updated at the A2→A3 boundary — branch changed from `feature/boq-phase-0` to `feature/boq-phase-2`, spec path changed from `docs/boq-feature/spec.md` to `frontend/.claude/plans/boq-upload-plan.md`, `BOQ Node Audit Logs` corrected to `BOQ Node Qty By Area` (audit is via `Nirmaan Versions`), Phase 2 sub-phase split noted. Working agreement #13 (doc maintenance at sub-phase boundaries) should be extended to also require `CLAUDE.md` updates at each full phase boundary (i.e., when the Active Features table row would change).

**Session 1 complete (2026-05-13):** Added Pattern-4 integration test (`test_pattern_4_full_mapping_validates_successfully`) to `test_config.py`. Proves the Part A2 schema accepts a single-sheet config combining per-area qty + per-area amount + split supply/install rate + split supply/install total amount, all together. Pure in-memory construction — no reader/classifier/hierarchy involvement. Test count: config 20 → 21; parser total 110 → 111. Commits: feat `e150d1f0`, docs `see git log`. **Note:** test file lives at `nirmaan_stack/services/boq_parser/test_config.py` (NOT in `tests/` subdirectory — that directory holds only fixtures). Test runner command is `python -m unittest test_config test_reader test_classifier test_hierarchy -v` from the `boq_parser/` directory (pytest not installed in the bench env). **Note:** total 188 = 77 Phase 1.x (28 BOQs + 49 BOQ Nodes, run via `bench run-tests`) + 111 parser (run via unittest). The 111 pure-Python parser tests are the ones Claude Code can verify directly.

**Part A3a complete (2026-05-13):** `multi_area_detection.py` created with `MultiAreaPattern` dataclass + `detect_multi_area_pattern()` function + 3 private helpers (`_try_pattern_1`, `_try_pattern_2`, `_try_pattern_3`). Function accepts `(bottom_header_row: RawRow, reserved_keywords: list[str], top_header_row: RawRow | None = None)` — pure Python, no reader dependency, fully testable with in-memory `RawRow` objects. TOTAL_QTY_PATTERN + QTY/AMOUNT cell regexes locked per v5.3 §3. Priority routing: 1-row mode → P3 → P1; 2-row mode → P2 → P3 → P1(bottom) → P1(top fallback). 3 smoke tests added in `test_multi_area_detection.py` (one per pattern, happy-path only). Test count: parser 111 → 114. Feat commit: `043ff057`. **Signature deviation from prompt**: prompt suggested `(reader, sheet_name, header_row, header_row_count, reserved_keywords)`; implemented as `(bottom_header_row, reserved_keywords, top_header_row=None)` for testability — the caller extracts rows before calling. Noted for Part B orchestrator integration.

**Part A3b complete (2026-05-13):** 11 comprehensive tests added in new class `TestMultiAreaDetectionComprehensive` covering: Pattern 1 liberal (no terminator, 3 areas), Pattern 1 single-area rejection, Pattern 2 three-merge happy path, Pattern 2 QTY+QTY rejection (pairing required), Pattern 3 canonical two-pair shape, priority P2>P3 (2-row mode), priority P3>P1 (1-row mode), P1 top-row last-resort fallback (TS_T2_WEX shape), reserved-keyword top-row merges rejected for P2 (Morgan Stanley shape), all-reserved-keywords → None, case-insensitive keyword matching. Test count: parser 114 → 125. `multi_area_detection.py` unchanged. Feat commit: `4c2fd166`. ~~**Latent bug noted (not fixed):** `_try_pattern_1` does not skip covered cells — covered-cell duplication bug; fix deferred to Part B.~~ **Fixed in Part A3c (commit `3bc745a9`) — see A3c record below.**

**Part A3c complete (2026-05-13):** Fixed covered-cell duplication bug in `_try_pattern_1`: added one `continue` condition — `if cell.merged_range is not None and not cell.is_merged_origin: continue` — before the TOTAL_QTY_PATTERN check. Covered cells (reader-propagated values from Part A1) are now skipped; only merge origins and non-merged cells contribute area names. Test 4 (`test_pattern_2_qty_amount_pairing_required`) updated: covered-cell fixture tightened to realistic propagated values (`value="Office"` / `value="Common Area"` instead of `value=None`), assertion changed from `assertIsNone` to `Pattern 1 with ["Office", "Common Area"]` — the test now covers both P2 pairing rejection AND the P1 top-row fallback that correctly fires after the fix. Two regression tests added: `test_pattern_1_skips_merge_covered_cells_on_top_row` (realistic TS_T2_WEX-style fixture with propagated covered cells) and `test_pattern_1_treats_origin_cells_normally` (origin + regular cells both collected). Test count: parser 125 → 127. Fix commit: `3bc745a9`.

**Session 4 verification complete (2026-05-13):** Manual real-data verification of `detect_multi_area_pattern()` against two real BoQ files from local disk (no commits, no fixtures added). **JSW HVAC Pattern 3: PASS** — opened `R0 WORKING-JSW -MEP Priced BOQ- 29.04.2026.xlsx` via `BoqReader` from a temporary `/tmp/jsw_test.xlsx` (docker cp + cleanup), called `detect_multi_area_pattern` on row 5 of the HVAC sheet, returned `MultiAreaPattern(pattern=3, areas=['B1', 'B3', 'B6'], qty_columns=[4, 6, 8], amount_columns=[5, 7, 9], detected_on_row=5)` — exact match to predicted output. Pattern 3 detection, area capture, reserved-keyword handling, and TOTAL QTY terminator behavior all verified end-to-end on real data. Trailing whitespace on `'AMOUNT '` (column L) correctly handled by case-insensitive `.upper().strip()` comparison. **Raheja Commerzone Chennai Pattern 2: NOT VERIFIED** — discovered a variant shape (3-col-per-area `[Area merge][Qty][Rates][Amount]` instead of textbook 2-col `[Area merge][Qty][Amount]`) not currently handled by `detect_multi_area_pattern`. Spot-checked across all Raheja sheets — every sheet uses the 3-col variant. See §17.5 for full description and disposition. Half-coverage on real data; Pattern 3 alone confirmed working.

**Part B1 complete (2026-05-14):** `ClassifiedRow.amount_by_area_raw: dict[str, float]` field added (parallel to `qty_by_area_raw`; `field(default_factory=dict)`). `classify_row()` captures `amount_by_area_raw` from columns with `role == "amount_by_area"` — mirrors `qty_by_area_raw` capture logic exactly (same dict shape, same area-name keying, same early-return gating for SPACER/HEADER_REPEAT/SUBTOTAL_MARKER). `ResolvedRow.validation_warnings: list[str] = []` field added — parser never sets a non-empty value in B1; B2's sum-validation post-pass will. `ParsedBoq` + `ParsedSheet` Pydantic models created in new `nirmaan_stack/services/boq_parser/orchestrator.py` module (not `config.py` — keeps input config separate from output result models). `parse_boq(file_path, config) -> ParsedBoq` orchestrator wires reader → `classify_row()` → `populate_preamble_candidate_scores` → `resolve_hierarchy` → `detect_multi_area_pattern` per non-skipped data sheet; `master_preamble` extracted from `treat_as="master_preamble"` sheets. NO multi-area splitting; NO sum validation; NO fixtures committed — all B2 scope. 12 new unit tests (5 classifier for `amount_by_area_raw`, 2 for `ResolvedRow.validation_warnings`, 5 orchestrator). Test count: parser 127 → 139. Feat commit: `9c2275ae`.

**Part B2b-keywords complete (2026-05-14):** Prerequisite sub-phase to fix a multi-area detection false positive discovered during the B2b (Snitch) session. Root cause: `'S No.'` and `'ITEM'` in the Snitch `'7. Light Fixtures'` header row were not in `multi_area_reserved_keywords`, so `_try_pattern_1` collected them as area names. Fix: expanded `GlobalSettings.multi_area_reserved_keywords` in `config.py` from 22 to 49 entries — adding "INSTALLATION RATE", "TOTAL RATE" (rate variants), 11 Sl.No./S No. variants ("SL.NO", "SL.NO.", "SL NO", "SL NO.", "SLNO", "S NO", "S NO.", "S.NO", "S.NO.", "SNO", "S/N"), 4 Sr No. variants ("SR NO", "SR NO.", "SR.NO", "SR.NO."), 3 Serial No. variants ("SERIAL NO", "SERIAL NO.", "SERIAL NUMBER"), 5 Item variants ("ITEM", "ITEMS", "ITEM DESCRIPTION", "ITEM NO", "ITEM NO."), 2 Desc shorthand variants ("DESC", "DESC."). Code-trace verification confirmed fix eliminates false positive: col A='S No.' → reserved skip; col B='ITEM' → reserved skip; col C='UNIT' → reserved skip; col D='Qty' → TOTAL_QTY_PATTERN match → break; zero areas collected → None. 5 new regression tests in new class `TestReservedKeywordExpansion` in `test_multi_area_detection.py` (Snitch LF header no-false-positive, Sl.No. variant, Sr No. variant, Item Description variant, case-insensitive). Also updated `test_config.py` count assertion 22→49 (outside stated in-scope list — minimal fix to prevent failing test, noted as deviation). Test count: 156 → 161. `snitch_electrical.xlsx` stays untracked in `tests/fixtures/` (B2c will commit it). Feat commit: `d02b212f`.

**Part B2d complete (2026-05-14):** Added `_apply_unit_based_demotion_post_pass(classified_rows: list[ClassifiedRow]) -> None` to `classifier.py` (see §7.28). Wired in `orchestrator.py` as Step 2b — after the per-row `classify_row()` loop and BEFORE `populate_preamble_candidate_scores()` (preamble scoring must not apply to rows that were just demoted to LINE_ITEM). Logic: collect unit strings from all LINE_ITEM rows on the sheet; demote any PREAMBLE row whose `qty is None` and `unit` matches a collected unit (case-sensitive, exact) → `classification = LINE_ITEM, qty = 0.0, is_rate_only = True`. 9 new tests added to `test_classifier.py` in new `TestUnitBasedDemotion` class (8 unit tests + 1 smoke on `synthetic_simple.xlsx`). TestSnitchIntegration: 3 tests now fail intentionally (`test_snitch_electrical_total_resolved_row_count`, `test_snitch_electrical_first_5_line_items`, `test_snitch_electrical_preamble_level_transitions`) — Snitch Electrical LINE_ITEM count changed 93→175, PREAMBLE 126→44 (82 rows demoted). B2e-snitch-refresh will regenerate `snitch_electrical_expected.json` to match. Test count: 173 → 182 total (179 passing, 3 failing). Known issue §17.9 (preamble stack-depth cascade in `hierarchy.py`) parked — B2d addresses the symptom at the classifier stage but the resolver-level root cause is not fixed. Feat commit: see git log.

**Part B2e-snitch-refresh complete (2026-05-14):** Regenerated `snitch_electrical_expected.json` against the new classifier behaviour from B2d-classifier (§7.28). Snitch Electrical: total resolved rows 521 (unchanged), LINE_ITEM 175, PREAMBLE 44, NOTE 287, SPACER 6, SUBTOTAL_MARKER 9. Max preamble level dropped from 21 to 7 (the depth-21 cable cascade resolved as the affected rows were demoted to LINE_ITEM). `first_5_line_items` re-populated by new resolved-order: indices 24/25/27/31/32 (resolved_idx=25 is a newly-demoted row with qty=0.0, is_rate_only=True). `preamble_level_transitions` uses Option α working definition (first preamble at each distinct level; 7 entries for levels 1–7; documented in JSON `_notes`; level-2 entry uses `description_contains_substring` for soft-hyphen safety). Subtotal marker indices unchanged (same 9 positions). Light Fixtures fully unchanged (PIR PREAMBLE preserved by case-sensitive unit comparison 'NOS' ≠ 'Nos.'). No `test_orchestrator.py` source changes needed — JSON regeneration alone restored all 3 failing tests. All 182 tests now pass. `_notes` key added to JSON with working definition and regeneration provenance. §17.9 known issue (KG/LS-unit PREAMBLEs not demoted, unique units) visible in audit but benign — not blocking. Feat commit: `1fa1d99f`.

**Part B2f-zero-children-demotion complete (2026-05-14):** Added `_apply_zero_children_preamble_demotion_post_pass(resolved_rows: list[ResolvedRow]) -> None` to `hierarchy.py` (see §7.29). Wired in `orchestrator.py` as Step 4a — after `resolve_hierarchy()` (needs tree path data) and BEFORE `_apply_multi_area_post_pass()`. Algorithm: (A) build `paths_with_descendants` set by extracting ancestor-path prefixes from every row's `path`; (B) for each PREAMBLE row whose path is NOT in that set (i.e. leaf node): if it has a non-empty unit or a positive rate → demote to `LINE_ITEM(qty=0.0, is_rate_only=True, level=None)`. Row 341 in Snitch Electrical (sl_no='7.0', unit='KG', no children, path='305/341') was the target: now LINE_ITEM. Row 500 (sl_no='2.0', unit='LS', path='394/500', has 5 children) correctly NOT demoted (§17.10 deferred). Additionally, PIR sensor row in Snitch Light Fixtures (resolved_idx=14, unit='NOS', leaf node) also demoted by the same logic — this is correct behaviour (the classifier's blank-qty-no-rate rule had set it PREAMBLE, but it is a genuine rate-only item with a unit). Snitch expected JSON updated: Electrical LINE_ITEM 175→176, PREAMBLE 44→43; Light Fixtures LINE_ITEM 13→14, PREAMBLE 1→0; `row_16_preamble_anomaly` updated to reflect B2f-demoted LINE_ITEM classification. `test_snitch_light_fixtures_row_16_preamble_anomaly` test body updated (LINE_ITEM check). 8 new tests in `TestZeroChildrenPreambleDemotion` class in `test_hierarchy.py`. All 190 tests green. §17.10 known issue (priced PREAMBLE with children at row 500) explicitly parked. Feat commit: see git log.

**Part B2c complete (2026-05-14):** Committed `snitch_electrical.xlsx` (138,066 bytes, 5 sheets: OVERALL SUMMARY, SUMMARY MEP, 6. Electrical, 7. Light Fixtures, MAKE LIST). Wrote `snitch_electrical_expected.json` with narrow expected-output spec covering: workbook-level assertions (sheet count=2, master_preamble=None, no validation warnings), skip-sheet assertions, first 5 LINE_ITEMs per sheet, all 9 SUBTOTAL_MARKERs in Electrical + 1 in Light Fixtures, preamble level transitions (levels 1/2/3 for Electrical), Light Fixtures PIR PREAMBLE anomaly, per-classification counts. Added `TestSnitchIntegration` class (12 test methods) in `test_orchestrator.py` — setUpClass calls `parse_boq()` once and caches result. §7.25 decision log wording corrected from "by mistake" framing to deliberate policy-reversal framing. Snitch fixture partially closes §9 #40 (JSW MEP Priced still on local disk only). Known issue §17.8 (reserved keyword gap survey) deferred to Phase 2c. Test count: 161 → 173. Feat commit: see git log. Docs commit: see git log.

### Phase 2c — DB commit + version cascade + 4 more fixtures ⏳ FUTURE

**Blocked on Phase 1.8 + 1.9.** Per-area rate+amount schema extension must land BEFORE Phase 2c DB-commit work begins. Rationale: no real BoQ data is committed to the DB yet (only test fixtures); this is the cheapest possible moment to extend the schema. Once Phase 2c starts writing real parsed BoQ data, every subsequent schema extension carries a migration, writer-rewrite, and data-correctness audit. Phase 1.8 (schema + controller + migration) and Phase 1.9 (parser support including 3-col-per-area Pattern 2-rate detection) sequence first.

- commit_parsed_boq(parsed_output) writes master + sub-BoQs + nodes + qty_by_area to DB
- Version cascade (deferred from Phase 1.7) — re-upload triggers cascade: old master + old children → Superseded; new master + new children at v+1; missing-sheet handling per Q-Cascade-Missing decision (drop, not carry-forward)
- 4 more end-to-end fixtures (JSW Unpriced, Paytm, Inovalon HVAC, HYBE) using golden-with-review approach (run parser, eyeball output, save as expected)
- ~20 tests
- Manual back-office demo at end

**Scope expansion (2026-05-16, §7.34):** `commit_parsed_boq()` must implement the commit-time merge logic for the `notes` field — read `row_notes` from each row's classified_row, walk ancestor chain via `resolved_row.path` to assemble inherited `append_notes_raw` content, emit structured-prefix lines per the §7.34 format, write final string to `BOQ Nodes.notes` field.

### Phase 3 Module 1a — Wizard backend and schema ✅ COMPLETE

Branched as `feature/boq-phase-3` from `feature/boq-phase-2` tip 2e338b36 (2026-05-29). First commit of Phase 3 (wizard). Pre-v5.30 framing called this "Phase 2c body"; user decision at Phase 3 kickoff re-frames wizard work as a distinct phase branched fresh per "one branch per phase" working agreement.

Schema: `BOQs.wizard_state` Select (`In progress / Configured / Parsed`) + `BOQs.sheet_drafts` Table; new `BoQ Sheet Draft` child doctype with 4 fields (`sheet_name`, `sheet_order`, `wizard_status`, `work_package`). Migration verified: `has_column("BOQs", "wizard_state")` True; `BoQ Sheet Draft` DocType exists with 4 fields.

API: `api/boq/wizard/` package with two whitelisted endpoints:
- `upload_file` (async via `frappe.enqueue`): validates extension + size, saves to Frappe File storage, enqueues worker; worker opens BoqReader, creates BOQs row with `wizard_state="In progress"` and sheet_drafts child rows, auto-detects `work_package` via case-insensitive substring match on Work Headers, attaches via Nirmaan Attachments, publishes `boq:wizard_parse_done` over realtime.
- `update_boq_draft`: partial-update endpoint for `boq_name`, `version`, `tax_treatment`, `notes`.

`create_tendering_project` dropped from scope: wizard never creates Projects rows; picker's "Create new project" path (Module 1b) defers to existing Nirmaan new-project workflow.

`BOQs.before_insert` owns version computation (M1.25: `COALESCE(MAX(version), 0) + 1` scoped to project+boq_name); duplicate computation removed from worker.

16 new wizard tests (corrected from 17; bench run-tests reported 16; 16 + 25 from 2a = 41 total confirmed). Frappe tests: 679 -> 696. Parser tests: 588 unchanged. Feat: 06f38e8d.

### Phase 3 Module 2a -- Hub backend: schema + sheet-draft endpoints ✅ COMPLETE

**Schema (2 doctypes, sanctioned JSON edits + bench migrate).**
- `BoQ Sheet Draft.wizard_status` options extended from 3 to 6: blank/Pending/Hidden/Reviewed/Skip/General specs/Parse failed. "Parse failed" included at enum-definition time (no writer until Module 5) so no future option-migration needed.
- `BoQ Sheet Draft.sheet_label` Data field added (optional, after work_package in field_order). Human-reference label for Skip sheets. No parser coupling.
- `BOQs.general_specs_sheet` Data field added (optional, in parser_metadata_section after area_dimensions). Stores the sheet name string of the designated general-specifications/master-preamble sheet. At most one per workbook (single scalar on parent). NOT a Link -- sheet drafts have no standalone linkable name; parser master_preamble already keys off sheet name.
- `BOQs.master_preamble` Long Text field added (optional, read_only, in parser_metadata_section after general_specs_sheet; feat 8db5a8d8). Machine-written by the parse worker when `parsed.master_preamble` is non-empty. Kept separate from the user's free-form `notes` field (clean separation; Phase 2 review screen displays it). Search is within a single BoQ (UI/find-in-text concern) -- no full-text index, no splitting into points. C7-logged add: field has a live producer now (Slice 2 worker) and a named Phase-2 consumer (review screen).

NOT added: any parse-status/auto-parse-failed field on either doctype. No per-sheet parse producer exists in current architecture (Module 1 worker only lists sheets; per-sheet pass/fail is produced by the deliberate parse in Module 5). Dead schema with no writer is out of scope.

NOT changed: work_package on either doctype. Single->multi-link conversion is a Module 3 concern.

**API: `api/boq/wizard/update_sheet_draft.py`** -- 3 new POST endpoints (`@frappe.whitelist(methods=["POST"])`):
- `set_sheet_status(boq_name, sheet_name, status)`: sets wizard_status on matching child draft row. Explicitly REJECTS "General specs" (redirect message: use set_general_specs_sheet). Allowed: Pending/Hidden/Reviewed/Skip/Parse failed.
- `set_sheet_label(boq_name, sheet_name, label)`: sets/clears optional sheet_label. label=None or "" both clear.
- `set_general_specs_sheet(boq_name, sheet_name_or_none)`: sets/clears BOQs.general_specs_sheet pointer. Backend stores pointer ONLY -- does NOT touch wizard_status on any draft row. Frontend derives "General specs" display badge from pointer and handles warn-and-confirm (M2.23) before calling. When cleared, frontend reverts released sheet card to Pending.

URL paths: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.<function_name>`

Child-row idiom: `frappe.db.get_value("BoQ Sheet Draft", {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name}, "name")` to find child_name, then `frappe.db.set_value("BoQ Sheet Draft", child_name, field, value)`. Mirrors existing wizard endpoint style.

**Read path:** NO custom read endpoint added. `useFrappeGetDoc("BOQs", boqName)` (already used in BoqUploadScreen) returns full doc including all sheet_drafts child rows with all fields.

**Tests: `api/boq/wizard/test_update_sheet_draft.py`** -- 25 new FrappeTestCase tests:
- TestSetSheetStatusPositive (6): set_reviewed, set_skip, set_hidden, set_pending_after_reviewed, set_parse_failed, second_sheet_unaffected
- TestSetSheetStatusNegative (5): rejects_general_specs_direct, rejects_invalid_status, rejects_unknown_sheet, rejects_unknown_boq, rejects_missing_status
- TestSetSheetLabel (6): set_label, clear_with_empty_string, clear_with_none, second_sheet_unaffected, rejects_unknown_sheet, rejects_unknown_boq
- TestSetGeneralSpecsSheet (8): set_pointer, change_pointer, clear_with_none, clear_with_empty_string, wizard_status_not_touched_on_set, wizard_status_not_touched_on_clear, rejects_unknown_sheet, rejects_unknown_boq

Wizard test total: 41 (was 16 actual / 17 as recorded in Module 1a entry; 16 + 25 = 41). Parser tests: 588 unchanged.

**Migration:** `bench --site localhost migrate` in container. Processed frappe + nirmaan_stack + frappe_s3_attachment; no patches; no unrelated app touched.

**In-scope:** 2 doctype JSON edits, update_sheet_draft.py (3 endpoints), test_update_sheet_draft.py (25 tests), boq-upload-plan.md + root CLAUDE.md. **Out-of-scope:** all frontend (2a is backend-only); upload_file.py/update_boq_draft.py (unchanged); parser (unchanged at 588). Frontend CLAUDE.md intentionally NOT updated.

Feat: 5cdbbd16.

### Phase 3 Module 2b-i -- Hub static shell + read-only sheet-card list ✅ COMPLETE

**Route and read path.**
New route `{ path: "upload-boq/hub/:boqId", lazy: () => import("@/pages/boq-wizard/BoqHubPage") }` added as a sibling of `upload-boq` in routesConfig. `boqId` read from `useParams()` -- survives browser refresh and is linkable. `useFrappeGetDoc<BOQsDoc>("BOQs", boqId, boqId ? undefined : null)` fetches the doc (third-arg gotcha honored). No endpoint calls in this slice (2b-ii).

**Shared types (`boqTypes.ts`).**
`BOQsDoc` promoted from a private `BoqUploadScreen` interface to a shared module. Adds `sheet_drafts: BoQSheetDraft[]` and `general_specs_sheet?: string`. `BoQSheetDraft` interface includes `name`, `sheet_name` (EXACT), `sheet_order`, `wizard_status` (6-value union), `work_package?`, `sheet_label?`. Both `BoqUploadScreen` and `BoqHubPage` import from here.

**Continue stub repointed.**
`BoqUploadScreen.tsx`: removed `handedOff` state + `CheckCircle2` placeholder branch. Continue button now calls `navigate(\`/upload-boq/hub/${boqDocName}\`)`. Dead code fully cleaned (`useState` import removed, `CheckCircle2` import removed).

**Hub components (all in `src/pages/boq-wizard/`).**
- `BoqHubPage.tsx`: four regions rendered from the fetched BOQsDoc:
  1. Header strip: `boq_name` + V{version} subtitle + static "Saved" indicator + DropdownMenu with disabled "Discard BoQ" item (TODO(2b-ii)).
  2. General-specs selector: shadcn Select with current `general_specs_sheet` value; SelectTrigger `disabled` (2b-ii removes disabled and wires `onValueChange` to `set_general_specs_sheet`). EXACT: `SelectItem value` = `sheet_name` verbatim.
  3. Sheet-card list: non-hidden sheets sorted by keyword-hint weight then `sheet_order`. Hidden sheets collapsed under "Show hidden sheets (N)" toggle (local `useState`).
  4. Parse-gate footer: progress text "{N} of {M} sheets reviewed" + "Parse workbook" Button (disabled when `!canParse`, onClick no-op stub -- Module 5).
- `SheetCard.tsx`: status pill (6 statuses + fallback) + sheet name (display-trimmed only) + at most one muted summary line (sheet_label > work_package > keyword hint). Action buttons deferred to 2b-ii (TODO comment).

**General-specs derivation (M2.16) -- critical.** Effective status "General specs" is derived: if `draft.sheet_name === boq.general_specs_sheet` (EXACT match), effective status overrides `wizard_status`. The comparison is verbatim -- no trimming. This is the only correct derivation; writing "General specs" to `wizard_status` from the frontend is forbidden.

**Keyword sort + hint (presentation-only).** Keywords: `summary`, `make list`, `cover`, `index`, `abstract`, `boq summary`. Matching sheets get weight 1 (sink to bottom) and show "Likely non-data sheet -- consider skipping" in italic if no `sheet_label` or `work_package` is present. No data is changed.

**Parse-gate computation.** Data sheets = non-hidden, non-skip, non-general-specs (the parse candidates). `blockingCount` = Pending or Parse failed among data sheets. `reviewedCount` = Reviewed among data sheets. `canParse = blockingCount === 0 && reviewedCount >= 1`. Gate reflected in button's `disabled` state + tooltip. "Parse workbook" is a no-op stub.

**EXACT sheet_name constraint (verified 2026-05-31).** Backend matches `sheet_name` verbatim. React keys and SelectItem values use `draft.sheet_name` as-is; display labels are trimmed. Each site in hub code has a comment noting the exact-match requirement.

**Static/read-only boundary.**
- IN SCOPE (2b-i): route, all four hub regions rendered, General-specs derivation, keyword sort, parse-gate computation, Continue repointed.
- OUT OF SCOPE (2b-ii): `onValueChange` on Select (wire `set_general_specs_sheet`), action buttons on SheetCard (wire `set_sheet_status`/`set_sheet_label`), Discard BoQ (wire `delete_boq`), autosave indicator (real autosave), "Parse workbook" action (Module 5).

**Verification.** TypeScript: zero errors in wizard files (`node_modules/typescript/bin/tsc --noEmit`, filtered to wizard paths). Pre-existing baseline errors in other files are unchanged. Vite build: `bench build --app nirmaan_stack` via container, built in 3m 36s, clean.

**Frontend CLAUDE.md updated.** Root CLAUDE.md intentionally NOT updated (frontend-only slice).

Feat: 81568df9.

### Phase 3 Module 2b-ii -- Wire hub interactions + fix status pill colors ✅ COMPLETE

**Part A: Status pill color fix.**
`STATUS_PILL` in `SheetCard.tsx` refactored from raw palette classes to a clean centralized map:
- Semantic tokens (no dark: needed): `Parse failed` = `bg-destructive/10 text-destructive`; `Hidden` = `bg-muted text-muted-foreground`.
- Intentional traffic-light colors with dark: variants: Pending (slate), Reviewed (emerald), Skip (amber), General specs (sky).
One definition, no raw palette classes elsewhere. App has dark theme (ThemeProvider + mode-toggle).

**Part B: Interactions wired.**
- Mutation pattern: `useFrappePostCall` (frappe-react-sdk) for all three endpoints. First wizard use of `useFrappePostCall`; raw `fetch` kept only for file upload (multipart). Re-fetch via SWR `mutate()` after each successful write -- server is authoritative; no local-state optimistic updates.
- Per-card saving: `isSaving = statusLoading || labelLoading` per SheetCard. Spinner + all buttons on that card disabled; other cards stay interactive. Inline `text-destructive` error on failure (wizard convention -- no toasts).
- Button set per effective status (wired vs stubbed):
  - Pending: [Review(stub-M3)] [Skip -> set_sheet_status("Skip")] [Mark reviewed -> set_sheet_status("Reviewed")]
  - Reviewed: [Edit(stub-M3)] [Set pending -> set_sheet_status("Pending")]
  - Skip: [Edit label -> set_sheet_label] [Include -> set_sheet_status("Pending")]
  - Hidden: [Include -> set_sheet_status("Pending")]
  - Parse failed: [Review(stub-M3)] [Mark reviewed -> set_sheet_status("Reviewed")] [Skip -> set_sheet_status("Skip")]
  - General specs: hint text, no status buttons (selector governs it)
  - Stub buttons (Review, Edit): onClick no-op, Tooltip "Per-sheet configuration opens in Module 3 (coming next)"
  - "Mark reviewed" and "Set pending": interim affordances so the parse gate is testable without the Module 3 spoke. In the real flow, Reviewed is reached via the spoke (M2.6).
- Edit label (Skip cards): inline input expand on "Edit label" button; Save/Cancel inline; calls `set_sheet_label`. Empty value clears the field.
- General-specs selector (M2.23 AMENDED): `disabled` removed; `onValueChange` wired to `handleSpecsChange`. Behavior:
  - Selecting "None selected" (NONE_SENTINEL): calls `set_general_specs_sheet("")` directly (no confirm).
  - Selecting any other sheet whose effective status is NOT "Reviewed": calls `set_general_specs_sheet(sheet_name)` directly.
  - Selecting a sheet whose effective status IS "Reviewed": opens AlertDialog warn-and-confirm ("Set as general specifications sheet? ... Continue?"); Cancel reverts (selector is controlled by server state -- no endpoint called); Confirm calls `set_general_specs_sheet(sheet_name)`.
  - SINGLE call only: NO `set_sheet_status` as part of designation. Backend stores pointer only.
  - AMENDED from original M2.23: releasing a designated sheet returns it to its TRUE prior `wizard_status` (not forced Pending). Rationale: less destructive, simpler, no fragile two-call sequence.
- Parse workbook: stays no-op stub (Module 5). Gate computation from 2b-i unchanged.
- Discard BoQ: stays disabled/stubbed (destructive; separate slice). NOT wired.

**Verification.** tsc (filtered to wizard files): zero errors. Vite build via `bench build --app nirmaan_stack`: built in 3m 35s, clean.

**Root CLAUDE.md:** intentionally NOT updated (frontend-only slice).

Feat: 459f85ae.

### Phase 3 Module 2b-iii -- Hub visual polish ✅ COMPLETE

Visual/wording-only slice. No endpoint changes, no gate-logic changes, no store changes.

**Item 1: Two-column responsive card grid.** Main sheet-card list container changed from `space-y-2` (single vertical stack) to `grid grid-cols-1 sm:grid-cols-2 gap-3`. Hidden-sheets reveal section uses the same grid. Cards look proportionate in a 4xl container at 640px+ wide.

**Item 2: Solid-saturated status pills with dark: variants.** `STATUS_PILL` in `SheetCard.tsx` replaced faint tint backgrounds (e.g. `bg-emerald-100`) with solid saturated colors + white text for maximum contrast. Text bumped from `text-xs` to `text-sm`; horizontal padding widened to `px-2.5`. Dark: variants present for all six statuses. Pending is now vivid blue (`bg-blue-500`) -- no longer nearly invisible slate-gray.

**Item 3: Amber AlertTriangle keyword hint.** Sheets whose name matches a likely-skip keyword (no `sheet_label`, no `work_package`) now show an amber `AlertTriangle` icon + amber-colored text instead of soft italic muted text. `isKeywordHint` bool tracks the case; precedence (label > work_package > keyword) unchanged.

**Item 4: Detailed footer breakdown.** Footer text changed from `N of M sheets reviewed` to `N of M data sheets reviewed [· K general specs] [· S skipped] [· H hidden]` -- only non-zero categories shown. generalSpecsCount / skippedCount / hiddenCount derived from `getEffectiveStatus`. Gate math (canParse / blockingCount / reviewedCount) NOT touched.

**Verification.** tsc (filtered to wizard files): zero errors. Vite build via `bench build --app nirmaan_stack`: ✓ built in 3m 44s, clean.

**Root CLAUDE.md:** intentionally NOT updated (frontend-only slice).

Feat: 57152c52.

### Phase 3 Module 3 Slice 3a -- Backend schema + endpoints (per-sheet sheet_config + work_package multi-link) COMPLETE

**Backend-only slice. No frontend changes. No parse-trigger wiring (Module 5).**

**Schema changes (boq_sheet_draft.json, feat b14e9015):**
- `work_package` single-Link (options: "Work Headers") REPLACED by `work_packages` Table (options: "BoQ Sheet Work Package"). Plural fieldname signals multi-value. Named `work_packages` not `work_package` to distinguish from the legacy column.
- `sheet_config` JSON field added (optional, reqd=0). Single JSON blob home for per-sheet parser config (header_row, header_row_count, column_role_map, area_dimensions, etc.). Single blob by design per M3.18/§6.3 -- wizard-internal, not queried cross-sheet.
- Updated field_order: `[sheet_name, sheet_order, wizard_status, work_packages, sheet_label, sheet_config]`.

**New child doctype BoQ Sheet Work Package (feat b14e9015):**
- `nirmaan_stack/nirmaan_stack/doctype/boq_sheet_work_package/` (3 files: .json, .py, __init__.py)
- `istable=1`, one field: `work_header` Link -> "Work Headers" (reqd=1). NAMING NOTE: target doctype is "Work Headers" (NOT "Work Packages" -- legacy naming confusion).
- Python class: `BoQSheetWorkPackage(Document): pass` (minimal, same as Project Work Headers pattern).

**Migration (feat b14e9015):**
- `patches/v3_0/migrate_boq_sheet_draft_work_package_to_multi.py` appended to patches.txt (post_model_sync section).
- Reads existing single `work_package` column via raw SQL (ORM no longer tracks it post-schema-change). Creates one BoQ Sheet Work Package child row per non-empty work_package value. Idempotent (existence check). Orphan-guarded (skips rows where Work Headers no longer exists). Ran clean on localhost: migrated=8, skipped_already_exists=0, skipped_orphan=0.

**New endpoints in update_sheet_draft.py (2 additions, feat b14e9015):**
- `set_sheet_config(boq_name=None, sheet_name=None, sheet_config=None)` -- writes JSON blob. Accepts dict or JSON string. Validates JSON string on input. URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_config`
- `set_sheet_work_packages(boq_name=None, sheet_name=None, work_headers=None)` -- replace-all semantics. Accepts list or JSON-string list. Validates ALL docnames exist before any write (no partial write on rejection). URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_work_packages`
- Both mirror existing style exactly: `@frappe.whitelist(methods=["POST"])`, all-params-default-None signatures, `frappe.db.exists("BOQs", boq_name)` guard, `frappe.db.commit()` before `return {"status": "saved"}`.

**Tests (test_update_sheet_draft.py, feat b14e9015):** 25 (original in file) -> 41 tests. 16 new:
- TestSetSheetConfig (6): dict input write+read, JSON string input, second-sheet isolation, nonexistent boq/sheet/missing-config negatives.
- TestSetSheetWorkPackages (8): 2 headers -> 2 rows; replace-all reduces to 1; empty list clears; second-sheet isolation; nonexistent boq/sheet/work-header negatives; one-invalid-among-two rejects all.
- TestMigrateWorkPackageToMulti (2): creates child row from legacy column; idempotent.
All 41 tests in file pass. Wizard total: 41 (file) + 9 (upload) + 7 (boq_draft) = 57 total.

**bench migrate:** clean. Patch ran post-model-sync, tabBoQ Sheet Work Package table created by schema phase, then patch populated it.

**Frontend shape-change flag (EXPECTED -- handled in later slice):** `BoQSheetDraft.work_package` (string) on the frontend interface in `boqTypes.ts` does NOT match the new backend shape (`work_packages` as a Table child list). The frontend currently renders `work_package` as a string (SheetCard summary line). A later frontend slice must update `boqTypes.ts` to use `work_packages: BoQSheetWorkPackage[]` (where `BoQSheetWorkPackage = { name: string; work_header: string }`). Do NOT touch frontend files in this slice.

Feat: b14e9015.

### Phase 3 Module 3 Slice 3b-i -- Backend sheet-data preview endpoint (values-only, S3-safe) COMPLETE

**Backend-only slice. No frontend changes (Slice 3b-ii builds the spoke UI). No parser changes.**

**Performance rationale (measured, 7.65 MB workbook):**
`BoqReader(path)` takes ~27 s: opens workbook TWICE (data_only + formula pass) + pre-scans merged ranges for all sheets. Unusable for a synchronous preview. `openpyxl.load_workbook(path, data_only=True, read_only=True)` takes ~0.56 s on the same file. The endpoint uses `read_only=True` (streaming mode) and never uses `BoqReader`.

**S3 safety:** `BOQs.source_file_url` is a frappe_s3_attachment redirect URL after upload. `frappe.get_doc("File", ...).get_content()` reads local disk only and breaks under S3 (plugin moves the file). Bytes are fetched via `S3Operations.read_file_from_s3(key)` and written to a `NamedTemporaryFile`; the tempfile is always `os.unlink`-ed in a `finally` block.

**New module: `nirmaan_stack/api/boq/wizard/sheet_preview.py` (feat 7aaa0525):**

- `_derive_s3_key(source_file_url)` -- extracts the S3 object key. Primary: parse the `key=` query param from the private-file URL (format confirmed from controller.py line 142). Fallback: `frappe.db.get_value("File", {"file_url": url}, "content_hash")` (plugin stores key there per line 148). URL-param parsing is primary -- zero DB hit, format verified.
- `_fetch_boq_file_to_tempfile(source_file_url)` -- derives key, calls `S3Operations().read_file_from_s3(key)`, reads `response["Body"].read()` bytes, writes to a `NamedTemporaryFile(suffix=".xlsx", delete=False)`, returns path. Tempfile is only created AFTER bytes are successfully downloaded; a failed S3 fetch throws before any file is created (no orphan).
- `_to_json_serializable(value)` -- coerces non-JSON-primitives: `datetime.datetime` → `.isoformat()`, `datetime.date` → `.isoformat()`, `datetime.timedelta` → `str()`, any other non-primitive → `str()`.

**Endpoint: `get_sheet_preview(boq_name, sheet_name, start_row=1, end_row=40)`**
- `@frappe.whitelist()` bare (no `methods=["POST"]` -- it is a read; callable via GET / useFrappeGetCall).
- Coerces start_row / end_row to int (Frappe passes query params as strings). Guards: start_row >= 1, end_row >= start_row. Window cap: if window > 200 rows, end_row is CLAMPED silently (not rejected) to `start_row + 199`.
- Guards: `frappe.db.exists("BOQs", boq_name)`, source_file_url non-empty.
- VERBATIM sheet_name matching: uses `sheet_name not in wb.sheetnames` -- no strip, no case-fold. Same discipline as the rest of the wizard.
- Reads rows with `ws.iter_rows(min_row=start_row, max_row=end_row)`. Filters `EmptyCell` objects (openpyxl read_only mode pads rows to sheet `max_column` with `EmptyCell`; `EmptyCell` has no `.column`/`.row` attribute). Guard: `hasattr(cell, "column")`.
- Cell dict: `{col_letter: value}` where `col_letter` is uppercase Excel column letter (A, B, ...) and `value` is JSON-serializable (None for empty).
- `has_more` derived from `ws.max_row` (the sheet's dimension metadata, reliable for well-formed xlsx in read_only mode). Fallback when `max_row is None`: proxy from `returned_count == (end_row - start_row + 1)`.
- Tempfile always unlinked in a `finally` block. Workbook `wb.close()` called in the same `finally` block before unlink.
- Return shape: `{"sheet_name": str, "start_row": int, "end_row_requested": int, "rows": [{row_number, cells}], "returned_count": int, "has_more": bool}`.
- URL: `/api/method/nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview`

---

### Endpoint follow-up: `get_sheet_preview_full(boq_name, sheet_name)` -- single-pass full-sheet read (feat 196ed765, 2026-06-10) COMPLETE

**What & why.** The Slice 1a live-cert logged that SheetSearchView's full-sheet load is ~30s on the
1001-row Fire Fitting sheet because the frontend loops `get_sheet_preview` in 200-row windows and the
endpoint re-fetches S3 + re-opens the workbook PER WINDOW. This backend slice pays down that OWED item
with ONE additive endpoint that fetches + opens the workbook ONCE and reads EVERY row in a single pass.

**Recon decision (option a chosen, option b rejected).** A NEW additive function -- NOT a refactor of
`get_sheet_preview`. `get_sheet_preview` is left byte-for-byte untouched (it still serves SheetSpokePage's
genuine on-demand 40-row pagination); refactoring it to share a core was rejected (it risked the certified
windowed contract for no benefit). Verified additive: `git diff` shows +237 insertions, 0 deletions.

**As built.**
- `@frappe.whitelist()` bare (read). Args `boq_name`, `sheet_name` only -- no window params, no cap.
- REUSES the existing helpers verbatim: `_fetch_boq_file_to_tempfile`, `_to_json_serializable`,
  `get_column_letter` (no fork/duplication).
- Same guards as `get_sheet_preview`: missing `boq_name` / missing `sheet_name` / `BOQs` not-found /
  empty `source_file_url` / sheet-not-in-workbook all throw identically. `sheet_name` matched VERBATIM
  (#152) -- a trailing-space mismatch throws (mirrors `test_whitespace_mismatch_throws`).
- Fetch once -> `openpyxl.load_workbook(..., data_only=True, read_only=True)` once -> iterate
  `min_row=1 .. max_row=ws.max_row`. NOTE: `ws.max_row` is `None` for read_only sheets with no
  `<dimension>` tag (snitch_electrical is such a sheet); `iter_rows(max_row=None)` still iterates to the
  end (verified -- 1011 rows returned), so this is None-safe.
- IDENTICAL per-row build to `get_sheet_preview`: skip all-EmptyCell padding rows
  (`next((c.row...), None) -> skip if None`); within a kept row skip EmptyCells (`hasattr(cell,"column")`);
  keys via `get_column_letter`; values via `_to_json_serializable`. Row shape
  `{"row_number": <absolute Excel row>, "cells": {col_letter: value}}` -- byte-identical to the windowed path.
- Tempfile unlinked + workbook closed in a `finally` (mirrors `get_sheet_preview`).
- **Return shape:** `{sheet_name, rows, returned_count, has_more: False}`. `has_more` kept (always
  False -- a full read has nothing beyond) so the response stays TYPE-COMPATIBLE with
  `get_sheet_preview` for the v2 frontend (reuses `SheetPreviewResponse` without a fork); `start_row` /
  `end_row_requested` omitted (windowing artifacts, meaningless for a full read). Owner decision 2026-06-10.

**Tests (new `TestGetSheetPreviewFull`, 9, all PASS in-container):**
- T1 `test_all_rows_returned_no_200_cap` -- snitch fixture: `returned_count == len(rows)` and `> 200`
  (proves no 200-row cap; the sheet has 1011 content rows).
- T2 `test_byte_identity_to_windowed_path` (CORRECTNESS KEYSTONE) -- windows `get_sheet_preview` over the
  same sheet (`_gather_windowed_rows`, 200-row windows until `has_more` False), concatenates, asserts it
  EQUALS `get_sheet_preview_full`'s rows exactly (order, row_numbers, cells). Locks the new path to the
  preserved contract.
- T3 `test_blank_rows_skipped_noncontiguous` -- synthetic_simple has data on rows 1,2,3,5 (row 4 blank);
  asserts row_numbers `[1,2,3,5]`, blank row 4 absent, `max(rn) > count` (a row genuinely skipped), and
  the skip pattern matches the windowed path.
- T4 `test_whitespace_mismatch_throws` -- leading-space sheet_name throws (#152 verbatim).
- T5 negatives (5) -- missing boq_name / missing sheet_name / nonexistent boq / nonexistent sheet /
  empty source_file_url all throw, mirroring the existing endpoint.

**The tests ARE the cert for this slice** (no live UI consumer yet). The byte-identity test (T2)
genuinely executed and passed in-container -- it is the proof the new single-pass path equals the
concatenated windowed path. Live PERF proof lands when SheetSearchView v2 wires this endpoint up.

**No frontend consumer yet -- deferred to "SheetSearchView v2".** The SheetSearchView switch from the
windowed loop to this endpoint is bundled (per the slice-composition framework) with the other two
SheetSearchView-touching changes (column-widths/wrap from Layout Part A's OWED item + click-to-select),
so the 1a-certified component is re-certified ONCE rather than three times.

**Verification:** in-container `bench --site localhost run-tests --module
nirmaan_stack.api.boq.wizard.test_sheet_preview` -> 32 tests OK (23 pre-existing + 9 new). The 23
existing `get_sheet_preview` tests pass unchanged (proves the existing endpoint is untouched). No
tsc/build (no frontend touched). Two commits: feat (sheet_preview.py + test_sheet_preview.py) then docs.

---

**Tests: `nirmaan_stack/api/boq/wizard/test_sheet_preview.py` (23 tests as of feat bf1a2e64; +9 `TestGetSheetPreviewFull` added feat 196ed765 -> 32 total, all PASS):**
- `TestDeriveS3Key` (3): parse key from private URL; fallback via File doc content_hash (mock); throws when no key derivable.
- `TestToJsonSerializable` (5): primitives pass through; datetime.datetime → isoformat; datetime.date → isoformat; timedelta → str; unknown type → str.
- `TestGetSheetPreviewShape` (4): response keys present; row_numbers sequential + in range; cells use uppercase Excel column letters; A1 value matches `synthetic_simple.xlsx` fixture ("Sl.No.").
- `TestGetSheetPreviewPagination` (2): second window row_numbers start at 41; window cap clamped silently (end_row=500 → end_row_requested=200).
- `TestGetSheetPreviewHasMore` (3): has_more=True for first window on large fixture (snitch_electrical.xlsx "6. Electrical"); has_more=False when requesting past end of small fixture (synthetic_simple.xlsx); end-of-sheet returns fewer rows + has_more=False.
- `TestGetSheetPreviewNegative` (6): missing boq_name; missing sheet_name; nonexistent boq; nonexistent sheet_name; empty source_file_url; whitespace-mismatch sheet_name (verbatim EXACT match required).
- S3 fetch mocked via `unittest.mock.patch("...sheet_preview._fetch_boq_file_to_tempfile", side_effect=...)`. The side_effect copies the local fixture file into a fresh `NamedTemporaryFile` so the endpoint's `finally` block can safely `os.unlink` it without touching the original.
- Real BOQs rows created in `setUpClass` via `_make_project()` + `_make_boq_with_url()` pattern (mirrors `test_update_sheet_draft.py`). `source_file_url` set to fake S3-format URL so `frappe.db.exists` + `frappe.db.get_value` use the real DB; only the S3 fetch is mocked.

**Backwards-compat:** Purely additive. New module + new endpoint; no existing endpoint or schema touched. Existing wizard tests stable at 41 (test_update_sheet_draft.py). Total wizard Frappe tests: 41 + 23 = 64.

Feat: bf1a2e64.

### Phase 3 Module 3 Slice 3b-ii -- Frontend spoke shell + SheetDataGrid + load-more paginator COMPLETE

**Frontend-only slice. No backend changes. No config sections (Slice 3c).**

**Spoke route (routesConfig.tsx):** `/upload-boq/hub/:boqId/sheet/:sheetName` added as sibling of the hub route. Lazy-loaded; module exports `{ SheetSpokePage as Component }` per React Router v6 lazy convention.

**SheetSpokePage.tsx (shell -- minimal scope):** Reads `boqId` + `sheetName` from `useParams()`. Fetches `BOQsDoc` via `useFrappeGetDoc` (same third-arg gotcha as hub: pass null to disable). Back button → hub (`/upload-boq/hub/${boqId}`). Header shows display-trimmed sheet name + BoQ name/version + optional `sheet_label`. No config sections, no work-package picker, no mark-reviewed control -- those are Slice 3c+.

**encode/decode:** Hub navigates with `encodeURIComponent(draft.sheet_name)`. React Router v6 `useParams()` returns the RAW URL-encoded string (does NOT call `decodeURIComponent` automatically). NOTE: decode bug present at 3b-ii land -- fixed in Slice 3b-iii (q.v.).

**SheetDataGrid.tsx (new component):**
- `useFrappePostCall` for ALL fetches (initial + load-more). This is the sanctioned read-over-POST case: accumulating/paginating reads use POST + local `useState` because SWR replace-on-fetch semantics fight row accumulation. See convention note in frontend CLAUDE.md.
- Initial 40 rows fetched in `useEffect([boqName, sheetName])` with cancellation flag.
- Column header: union of all `col_letter` keys across loaded rows, sorted in Excel order (shorter first, then alphabetical: A,...,Z,AA,...). Recomputed after each load-more.
- Left gutter: absolute Excel `row_number` (never re-indexed; row 41 shows "41"). `sticky left-0 z-10`.
- Cells: null → blank, booleans → "TRUE"/"FALSE", others → String(). `max-w-[180px] truncate`, full value on hover via `title` attr. shadcn `<Table>` (NOT TanStack).
- Load-more: button shown when `has_more === true`. `disabled={isLoadingMore}` is the single-flight guard. `setRows(prev => [...prev, ...preview.rows])` appends. Re-evaluates `has_more` from new response.
- No sticky header / no gridlines at this slice (fixed in Slice 3b-iii).

**Preview types in boqTypes.ts:** `SheetPreviewRow { row_number, cells: Record<string, string|number|boolean|null> }` + `SheetPreviewResponse { sheet_name, start_row, end_row_requested, rows, returned_count, has_more }`.

**Review/Edit wiring (SheetCard.tsx + BoqHubPage.tsx):**
- `MODULE3_TOOLTIP` constant + unused `Tooltip`/`TooltipContent`/`TooltipTrigger` imports removed from SheetCard.
- Review (Pending, Parse-failed) and Edit (Reviewed) now call `onOpenSpoke?.(draft.sheet_name)` via a new optional prop `onOpenSpoke?: (sheetName: string) => void`.
- `BoqHubPage` passes `onOpenSpoke={handleOpenSpoke}` where `handleOpenSpoke` calls `navigate(\`/upload-boq/hub/${boqId}/sheet/${encodeURIComponent(sheetName)}\`)`. Hub owns navigate; SheetCard stays router-free.
- All other card buttons (Skip, Include, Mark reviewed, Set pending, Edit label) unchanged.

**Verification:** tsc zero new errors in wizard files. Vite build exit 0.

Feat: 7be670d4.

### Phase 3 Module 3 Slice 3b-iii -- SheetDataGrid polish (sticky header + gridlines + decode fix) COMPLETE

**Frontend-only slice. Pure polish pass on Slice 3b-ii. No backend, no config sections.**

Three live-testing fixes:

**(1) Sticky column-letter header row (SheetDataGrid.tsx).**
Root cause: the `overflow-x-auto` wrapper had no height constraint. CSS spec forces `overflow-y` to computed `auto` when `overflow-x` is non-visible, but without a max-height the container grew to fit content -- no vertical clip, no scroll window, so `sticky top-0` never fired.
Fix: changed container to `overflow-auto max-h-[calc(100vh-14rem)]`. This bounds the container in both axes, creates a proper vertical scroll window, and makes `sticky top-0` fire relative to the container (not the page).
z-index hierarchy: corner cell (z-30, both axes) > column-letter headers (z-20, top-only) > row-number gutter cells (z-10, left-only). Corner `#` cell changed from `sticky left-0 z-10` to `sticky top-0 left-0 z-30`. Column-letter headers gained `sticky top-0 z-20`. All sticky header cells use solid `bg-muted` (not semi-transparent `bg-muted/50`) so scrolled body rows don't show through.

**(2) Visible cell gridlines (SheetDataGrid.tsx).**
`border-r border-border` added to column-letter `<TableHead>` cells and data `<TableCell>` cells. Row-number gutter `<TableHead>` (corner) and `<TableCell>` already had `border-r` from Slice 3b-ii. Existing `border-b` on `<TableRow>` provides horizontal lines. Result: spreadsheet-style grid.

**(3) Spoke header decode fix (SheetSpokePage.tsx).**
Root cause: `useParams()` in React Router v6 returns the raw URL-encoded path segment without calling `decodeURIComponent`. So a sheet named "C&I" navigated via `encodeURIComponent` appeared as "C%26I" in the page header AND was sent to the endpoint as "C%26I" (breaking VERBATIM matching against the DB-stored "C&I").
Fix: `const decodedSheetName = sheetName ? decodeURIComponent(sheetName) : ""` applied once. `displaySheetName`, draft lookup, and `SheetDataGrid sheetName` prop all use `decodedSheetName`. The raw `sheetName` from `useParams()` is kept only for the `!sheetName` guard. `decodeURIComponent` is idempotent if the browser or RR already decoded -- safe in either direction.
No change to what `BoqHubPage.handleOpenSpoke` sends to `navigate()` -- the hub still uses `encodeURIComponent(draft.sheet_name)`.

**Backwards-compat:** Purely cosmetic + one decode fix. Fetch behavior (POST, accumulation, load-more, row numbers, cell values) unchanged. No behavior change to data loading or pagination.

**Verification:** tsc zero new errors in wizard files. Vite build exit 0.

Feat: 2ac4789a.

### Phase 2 — Excel parsing engine (backend only) *(4–5 days)*
- `services/boq_excel_parser.py`: reader, mapping config schema (dataclass / Pydantic), classifier (code-driven + rule-driven), hierarchy resolver (stack walk), validator.
- Sample BoQ corpus: 3–5 anonymized real `.xlsx` files under `tests/fixtures/boq_samples/`. Each has an expected JSON.
- Parser unit tests covering all sample BoQs and every edge case in §12.
- No frontend, no AI, no whitelisted endpoints yet.
- **Exit:** from Frappe console, `parse_boq(file_url, config)` returns correct structured output for all samples.

### Phase 3 — Upload + mapping UI (manual flow) *(5–7 days)*
- Whitelisted APIs: `upload.py`, `parse.py`, `save.py` under `nirmaan_stack/api/boq/`.
- Frontend: BoQ upload wizard mirroring project-form structure (see §10). Steps: Upload, Mapping, ParsedPreview, Confirm.
- Excel preview with TanStack Table preserving formatting cues.
- Column role assignment (click header → dropdown). Row classification (click row → type dropdown). Drag-select for bulk. "Auto-classify similar rows" examples-based fill.
- Validation warnings panel.
- Multi-stage progress dialog mirroring `project-creation-dialog.tsx`.
- **Exit:** real user uploads a real BoQ Excel, manually maps, saves; saved data matches Excel.

**append_to_notes wizard responsibility (2026-05-16, §7.34):** Surface `append_to_notes` as a column-role choice during per-sheet mapping. Allow user to assign it to any number of columns (multi-select, not singleton). Show a preview of the resulting notes field on a sample row before commit so user can verify. Future optional enhancements: user-override displayed column name; user-customize prefix format. Initial v1 ships with default format and raw column headers.

### Phase 4 — AI assist *(3–4 days)*
- `services/boq_ai_assist.py` mirroring `services/document_ai.py`. Anthropic API integration. Prompt iteration against fixture corpus.
- `api/boq/ai_assist.py` whitelisted endpoint, background job dispatch.
- Frontend: spinner on Mapping step, suggestions overlay applied, confidence display, low-confidence rows highlighted.
- Cost guards: row cap, caching, token logging.
- **Exit:** typical BoQ requires <30s of correction after AI pre-fill.

### Phase 5 — Edit + audit UI *(2–3 days)*
- Inline editing of saved BoQ Nodes with reason capture (modal).
- Audit log viewer per node (reads from Nirmaan Versions).
- Re-upload as new version: creates v2 BoQ, marks v1 as Superseded. Carry-over of links is stubbed.
- **Exit:** users can fix typos with full audit trail.

### Phase 6 — Read views, search, export *(3–5 days)*
- BoQ list per project.
- Tree view with collapse/expand per preamble.
- Search across line items by description.
- Filter by preamble.
- Export back to Excel.
- Roll-up summaries: total supply value, total install value, value per L1.
- Basic version diff view.
- **Exit:** PMs can browse a BoQ end-to-end without opening the original Excel.

### Phase 7 — Linkage layer *(2–4 weeks, sub-phased)*

Each sub-phase gets its own design doc. All linkages are standalone doctypes following the Critical PO Tasks pattern. CEO Hold check required before any procurement-creating action.

- **7a — Work Header / Milestone linkage.** New doctype `BOQ Node Milestone Link`. UI to map BoQ Nodes to existing Work Headers / Work Milestones (no replacement of existing entities).
- **7b — Critical PO Category linkage.** New doctype `BOQ Node Critical PO Link`. Map BoQ Nodes to Critical PO Tasks. Coordinate with active plans `frontend/.claude/plans/critical-po-setup-plan.md` and `critical-po-tracker-project-view.md`.
- **7c — PR / PO line item linkage.** New doctypes `BOQ Node PR Item Link`, `BOQ Node PO Item Link`. When creating a PR/PO, optionally pick from BoQ line items. Pre-fills item details.
- **7d — Delivery linkage.** New doctype `BOQ Node Delivery Link`. Track delivered qty per line item. Show "delivered vs BoQ qty" progress in the tree view.
- **7e — Version migration.** When v2 of a BoQ is uploaded, surface a UI to map v1 nodes → v2 nodes so existing linkages carry over.


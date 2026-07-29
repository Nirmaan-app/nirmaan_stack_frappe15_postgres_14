### UNIFY-ON-(-1) + Phase-2 Slice A -- review-screen backend

**Status:** COMPLETE (feat fff26abd; BACKEND ONLY -- no frontend files touched; +34 wizard tests; 202 total).

**The -1 sentinel decision (WHY):**

Frappe coerces `Int None -> 0` on insert. `parent_index = 0` is a VALID row index (parent is row 0). This means `None` (root row, no parent) and `0` (parent is row 0) were indistinguishable in the DB after insert. Verified: 618 real rows all stored `0` with zero NULLs, making root detection impossible from the stored value alone.

The retired workaround was `has_human_parent` (a separate Check field): since `human_parent=0` could be either "row 0 as parent" or "Frappe-coerced None", a dedicated sentinel was needed. This doubled the write surface and caused the Slice-1 root-cause bug.

FIX: `-1` is the canonical "no parent / no override" sentinel. -1 can never be a valid row index, so it is unambiguous. Architecture:
- `-1 lives ONLY at the DB persistence boundary.` The parser (hierarchy.py, classifier.py, orchestrator.py) keeps using `None` internally -- UNTOUCHED.
- WRITE boundary: `flatten_resolved_row` writes `-1` when `resolved_row.parent_index is None`. `save_review_edit` writes `-1` when human_parent is cleared (`value is None`).
- READ boundary: `resolve_effective` translates `in (None, -1) -> None` for both `parent_index` and `human_parent` before computing effective values.
- All downstream (`_chain_has_cycle`, `check_structural_integrity`, orphan/cycle/lineitem-as-parent checks) only see the translated `None` for root rows. Logic unchanged.
- `human_parent == 0` is unambiguously a real override (parent is row 0) because 0 is NOT in `(None, -1)`. `has_human_parent` is RETIRED entirely.

**Schema delta:**
- `has_human_parent` Check field REMOVED from `BoQ Review Row` (boq_review_row.json: field + field_order entry deleted; migration ran clean). `parent_index` and `human_parent` remain Int. NO new default values added (explicit writes at the DB boundary are the convention; Frappe defaults for Int are unreliable for sentinels).

**Files changed:**
- `nirmaan_stack/api/boq/wizard/parse_run.py` -- `flatten_resolved_row`: parent_index write now `None->-1`.
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- NEW FILE (Slice A backend). `resolve_effective`, `check_structural_integrity`, `append_edit_log_entry` helpers + `get_review_rows`, `save_review_edit`, `mark_sheet_parsed_check_done` endpoints.
- `nirmaan_stack/nirmaan_stack/doctype/boq_review_row/boq_review_row.json` -- `has_human_parent` removed.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- NEW FILE. 34 tests (6 groups).
- `nirmaan_stack/api/boq/wizard/test_parse_run.py` -- coherence assertion updated: `not in (None, -1)` instead of `is not None`.
- `nirmaan_stack/nirmaan_stack/doctype/boq_sheet_draft/boq_sheet_draft.json` -- already-landed Parsed Check Done enum (Slice A context).

**Test counts (all green):**
- `test_review_screen`: 34 new tests. Groups: TestResolveEffective (7), TestCheckStructuralIntegrity (8), TestAppendEditLogEntry (4), TestGetReviewRows (4 DB), TestSaveReviewEdit (7 DB), TestMarkSheetParsedCheckDone (3 DB).
- `test_parse_run`: 60 unchanged (regression).
- Total wizard: 202 (60 + 34 + 66 + 7 + 23 + 12).

**Frozen review-screen design (governing principles, carried into Slice B/C/D):**

Structural accuracy > edit speed (principle): the review screen is the correctness gate before rows become canonical BOQ Nodes. A false-negative (missing a structure break) is worse than friction. Warn-and-confirm, never silent auto-fix.

Human-edit layer architecture:
- Three confirm-gated edits: `human_classification`, `human_parent`, value fields (qty/rate/amount). Parser fields are NEVER overwritten.
- Effective = human override (if set) else parser value. `has_human_parent` retired; `-1` sentinel covers the "unset" case.
- `edit_log` JSON list: every write to any field appends `{field, from, to, by, at}`. `from` is the EFFECTIVE value before the edit (not the raw stored value) so the log shows what the user saw, not what the DB held.

Advisory-flag rule: `needs_classification_review` + `review_reason` are advisory only. They do not block the "Parsed Check Done" transition (warn-and-confirm gate via `check_structural_integrity` is a SEPARATE concern). A parser-flagged row that the user acknowledges and leaves as-is is acceptable.

Review-screen export design: per-sheet CSV. Clean fieldnames + Excel-row-number parent columns + appended edit columns. show-original (parser vs effective side-by-side) deferred to edit-log-only v1; show-original in the export is Slice D+.

Priced-preamble no-machinery: a PREAMBLE with `needs_classification_review=True` (priced_preamble_with_children) is surfaced via the advisory flag + `review_reason`. No auto-reclassification, no wizard UI machinery. Human decides via `human_classification` override if needed. 1186 rows / parser-flagged-nothing finding: on the real BoQ corpus (pre-Slice A), 0 rows had `needs_classification_review=True`. Advisory-flag saturation is low; UI emphasis should be on structural breaks (orphan/cycle/line-item-as-parent) which are more common.

Indent = live parent_index chain walk: display indentation is computed by walking `effective_parent_index` up the chain, NOT from the stored `level` field (which is the parser's computed depth, may diverge after human_parent edits). Frontend must re-walk the chain on every render using the effective values.

Level = preamble cross-check: `level` from the parser is retained as a stored field for cross-checking (e.g. a PREAMBLE at level 3 whose effective parent is a PREAMBLE at level 1 may indicate a skipped level). Level is NEVER updated after a human_parent change -- it is permanently the parser's value.

**Slices B/C/D:** Slice B is split into B1 (spine -- COMPLETE, feat 0683f7b9) + B2 (B2a advisory flags -- COMPLETE; B2b row-detail panel -- remaining). Slice C = editing UX (save_review_edit wiring). Slice D = integrity gate (mark_sheet_parsed_check_done).

---


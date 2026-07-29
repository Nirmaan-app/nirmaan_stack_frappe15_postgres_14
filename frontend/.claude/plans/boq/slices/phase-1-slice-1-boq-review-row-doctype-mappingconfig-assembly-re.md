### Phase-1 Slice 1 -- BoQ Review Row doctype + MappingConfig assembly + ResolvedRow flattener

**Status:** COMPLETE (feat 7aaa0525; 31 new tests / 89 wizard / 588 parser). Backend-only -- no frontend changes this slice. Frontend CLAUDE.md NOT touched (no frontend change this slice).

Files added/modified:
- `nirmaan_stack/api/boq/wizard/parse_run.py` -- 3 pure functions (no `@frappe.whitelist` endpoint; Slice 2 adds that)
- `nirmaan_stack/api/boq/wizard/test_parse_run.py` -- 31 tests in 3 groups
- `nirmaan_stack/nirmaan_stack/doctype/boq_review_row/` -- new top-level doctype (JSON + controller + __init__ + test stub)
- `nirmaan_stack/nirmaan_stack/doctype/boq_sheet_draft/boq_sheet_draft.json` -- "Parsed" added to wizard_status Select options

**What is Phase-1 Slice 1?**

First backend slice of the "Phase 1 parse run". Prepares the infrastructure that the parse-pass endpoint (Slice 2) will call: the transient output doctype, the config-assembly function, and the output-flattening function. All pure Python -- no whitelisted endpoint, no DB writes.

**New doctype: BoQ Review Row**

Autoname `BOQRR-.YY.-.#####`. Top-level (not istable). `track_changes=1`. Role-based access: System Manager + 4 project roles (Procurement Executive, Project Lead, Project Manager, Estimates Executive) full CRUD; Design Lead full CRUD; Design Executive + Accountant + HR Executive + PMO Executive read-only.

Role: transient per-row store for one parse-run's output -- one row per resolved parser row per parse pass. NOT the committed output (that goes to BOQ Nodes once Phase 4+ lands). The doctype holds the full parser result so a human reviewer can inspect, annotate, and approve rows before they become canonical BOQ Nodes.

Field groups (from the .json field_order):
- **Links:** `boq` Link->BOQs (reqd, indexed), `sheet_name` Data (reqd)
- **Position:** `source_row_number` Int, `row_index` Int (0-based within sheet), `classification` Data, `level` Int, `parent_index` Int, `path` Data (read-only, indexed), `attached_to_index` Int, `attached_notes` JSON (list of str)
- **Classifier metadata:** `promoted_from_line_item` Check, `preamble_level_override` Int, `preamble_candidate_score` Int, `preamble_candidate_signals` JSON (list of str), `needs_classification_review` Check, `review_reason` Data
- **Content:** `sl_no_value` Data, `description` Text (global search), `unit` Data, `make_model` Data, `is_rate_only` Check
- **Quantities/Rates/Amounts:** `qty_total` Float, `qty_by_area` JSON (dict), `rate_supply/rate_install/rate_combined` Float, `rate_by_area` JSON (dict of dicts), `amount_total/amount_supply/amount_install` Float, `amount_by_area` JSON (dict)
- **Notes:** `row_notes` Text, `append_notes_raw` JSON (dict)
- **Warnings:** `validation_warnings` JSON (list -- sum-mismatch warnings on ResolvedRow), `classifier_warnings` JSON (list -- classifier-level warnings on ClassifiedRow; distinct from validation_warnings)
- **Flags:** `is_synthetic` Check

**Frappe list-JSON serialization caveat:** Frappe's `get_valid_dict()` auto-serializes Python dicts for JSON fieldtype but REJECTS Python lists with "cannot be a list". The four list-type JSON fields (`attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`) must be pre-serialized via `json.dumps()` before `doc.insert()`. Dict-type fields can be passed as Python dicts directly. See `_LIST_JSON_FIELDS` module-level constant in `parse_run.py` for the authoritative set (module-level since Slice 2; `TestBoQReviewRowRoundTrip._insert_rows` references the same constant).

**"Parsed" wizard_status addition**

`BoQ Sheet Draft.wizard_status` Select gains `Parsed` as the 7th value. Lifecycle meaning: a sheet whose parse run completed successfully. `assemble_mapping_config` treats `Parsed` identically to `Reviewed` -- both include the sheet as a data parse target with its saved `sheet_config` blob (a re-run re-parses configured sheets).

**`assemble_mapping_config(boq_name) -> (MappingConfig, not_eligible: list[str])`**

Pure function (no DB writes). Reads the BOQs doc + all BoQ Sheet Draft child rows, builds a `MappingConfig` Pydantic model for the parser orchestrator. Routing rules applied in order (feat e997028b -- pointer outranks Skip/Hidden):
1. `sheet_name == BOQs.general_specs_sheet` -> `treat_as="master_preamble"` -- checked FIRST; pointer is source of truth per M2.16 and wins over any stored wizard_status
2. `wizard_status` in {Hidden, Skip} -> `SheetConfig(skip=True)` -- only for sheets NOT matching the pointer
3. `wizard_status` in {Reviewed, Parsed} + valid `sheet_config` blob -> deserialize + include as data
4. Anything else (Pending, Parse failed, blank, Reviewed-without-blob) -> appended to `not_eligible`

**Rule-order fix (feat e997028b, 2026-06-03).** Original order had Skip/Hidden (old Rule 1) before the pointer check (old Rule 2). Bug: a sheet designated as general-specs while its stored wizard_status was still "Skip" (the common real-data case -- hub pointer designation per M2.16 does NOT write "General specs" to wizard_status) was routed as skip=True and master_preamble text was never extracted. Verified live on BOQ-26-00145 sheet "SOW" (wizard_status="Skip", pointer="SOW"). Fix: pointer check promoted to Rule 1.

**DEFERRED REQUIREMENT -- Multiple general-specs sheets per Master BoQ (raised 2026-06-03, real-BoQ-driven).** Real BoQs found with more than one general-specifications sheet. Current model (single BOQs.general_specs_sheet Data pointer + single BOQs.master_preamble Long Text, one-per-workbook per M2.16) is too narrow. Needs (to design, not yet specced): drop the one-per-workbook constraint (reverses M2.16); store multiple designations -- likely a child table on BOQs, one row per general-specs sheet, each capturing (source sheet name + extracted master-preamble text); frontend hub designation UI single-select -> multi-select/add-list (wizard-scope; pairs with Slice 2b); worker changes from one-pointer-one-preamble to all-designated-sheets -> N preambles each with source sheet name; migration of existing single-general_specs_sheet BoQs into the new structure; open design question -- are the multiple sheets distinct kinds (SOW/General Conditions/Preamble) or same kind split (shapes separate-labeled vs concatenated). Sequencing: its own design-close + build, likely with Slice 2b. The rule-order precedence fix is a stepping stone -- the multi-version checks "sheet is in the set of general-specs sheets" instead of "== the one pointer", same precedence principle.

Raises `frappe.ValidationError` if the BOQ doesn't exist or no eligible sheets exist. `GlobalSettings` always uses defaults (no per-BoQ override exists or is wanted).

**`flatten_resolved_row(resolved_row, sheet_name, row_index) -> dict`**

Pure function. Maps a `ResolvedRow` (and its nested `ClassifiedRow`) to a flat dict of BoQ Review Row field values. All 30+ fields mapped. JSON list fields returned as Python lists; JSON dict fields returned as Python dicts (callers pre-serialize lists before insert). The `boq` field is NOT included -- `flatten_parsed_boq` injects it.

Object-per-flag note: `needs_classification_review` and `review_reason` are on `ResolvedRow` (post-hierarchy review flags); `preamble_candidate_score`, `preamble_candidate_signals`, `preamble_level_override`, and `classifier_warnings` are on `ClassifiedRow` (classifier-time signals). Mixing these up breaks the review-flag logic.

**`flatten_parsed_boq(parsed_boq, boq_name) -> list[dict]`**

Pure function. Iterates `ParsedBoq.sheets`, calls `flatten_resolved_row` per resolved row, injects `boq=boq_name`. `master_preamble` sheets produce no rows (their content lives on `ParsedBoq.master_preamble`). `row_index` is 0-based within each sheet's `resolved_rows` list.

**Test groups (31 new tests in `test_parse_run.py`):**
- `TestAssembleMappingConfig` (9 tests, FrappeTestCase): routing rules for all 5 wizard_status cases, not_eligible collection, general-specs pointer -> master_preamble, Parsed parity with Reviewed, Reviewed-without-blob soft-exclusion, unknown-boq ValidationError
- `TestFlattenFaithfulness` (17 tests, pure Python, no DB): row count matches resolved_rows, classification values, sequential row_index, sheet_name + boq injection, parent_index + path coherence, scalar rate_supply preserved, multi-area qty_by_area + amount_by_area dicts, validation_warnings survive flatten, clean rows have empty warnings, programmatic needs_classification_review flag survives flatten, is_synthetic False by default, JSON fields are Python objects not strings
- `TestBoQReviewRowRoundTrip` (5 tests, FrappeTestCase): insert simple rows + read-back classification, multi-area line item JSON round-trip, validation_warnings DB round-trip, needs_classification_review + review_reason DB round-trip

**Slice 2 next:** `trigger_parse_run` whitelisted endpoint + background worker + Parsed lifecycle (BOQs.wizard_state="Parsed") + old BoQ Review Rows cleanup on re-parse.

---


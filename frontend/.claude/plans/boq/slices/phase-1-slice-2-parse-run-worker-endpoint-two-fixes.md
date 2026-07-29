### Phase-1 Slice 2 -- parse_run worker + endpoint + two fixes

**Status:** COMPLETE (feat 842b2b1a; +13 tests; 44 test_parse_run / 102 wizard / 588 parser; all 831 app Frappe tests green). Backend-only -- no frontend changes this slice.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/parse_run.py` -- FIX 1 + FIX 2 + `_LIST_JSON_FIELDS` module constant + `run_parse` endpoint + `_run_parse_worker` + `_fetch_boq_file_to_tempfile` + `_set_draft_status` + `_publish_parse_event`
- `nirmaan_stack/api/boq/wizard/test_parse_run.py` -- imports updated; `_LIST_JSON_FIELDS` moved to module-level; `test_fix1_production_blob_without_sheet_name_is_eligible` added to `TestAssembleMappingConfig`; `TestRunParseWorker` class added (13 new tests)

**FIX 1 -- sheet_name injection (BLOCKING)**

Production wizard blobs saved by `set_sheet_config` have exactly 6 keys: `area_dimensions`, `column_role_map`, `header_row`, `header_row_count`, `skip_top_rows_after_header`, `top_header_rows_override`. They NEVER contain `sheet_name` (verified live on BOQ-26-00150 and BOQ-26-00145). `SheetConfig.sheet_name` has no default; without the injection `model_validate` raises `ValidationError` and the sheet falls into `not_eligible` silently, making every Reviewed sheet ineligible.

Fix: `raw["sheet_name"] = sheet_name` injected in `assemble_mapping_config` Rule 3 before `SheetConfig.model_validate(raw)`. One line.

**FIX 2 -- list-JSON pre-serialization**

The four list-type JSON fields (`attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`) must be pre-serialized via `json.dumps()` before `doc.insert()`. Frappe's `get_valid_dict()` rejects Python lists for JSON fieldtype. The `_run_parse_worker` applies this per-field. The canonical set is `_LIST_JSON_FIELDS` (module-level `frozenset` in `parse_run.py`).

**`run_parse` endpoint**

`@frappe.whitelist(methods=["POST"])`. Enqueues `_run_parse_worker` on `queue="long"`, `timeout=600`, mirroring `upload_file.py`. Returns `{"status": "queued", "job_id": ...}`.

`sheet_names=None` parses all eligible Reviewed/Parsed sheets. `sheet_names=[...]` narrows to the named subset (per-sheet re-parse; skip/master_preamble sheets always pass through).

URL: `/api/method/nirmaan_stack.api.boq.wizard.parse_run.run_parse`

**`_run_parse_worker` design**

1. Fetch workbook via `_fetch_boq_file_to_tempfile` -- S3 or local (dev/test). Real file extension derived from `file_name` query param in the S3 URL (unlike `sheet_preview._fetch_boq_file_to_tempfile` which hardcodes `.xlsx`). Local paths/`/private/` URLs copy to a tempfile via `shutil.copy2`.
2. `assemble_mapping_config(boq_name)` -- FIX 1 fires here; returns `(config, not_eligible)`.
3. If `sheet_names` subset given, narrow `config.sheets` (skip/master_preamble always included).
4. `parse_boq(tempfile_path, config)` -- orchestrator handles skip + master_preamble internally.
5. Per parsed sheet: delete existing BoQ Review Rows (`boq`+`sheet_name` filter) then insert new rows (FIX 2 applies). On per-sheet insert failure: compensating delete + set `Parse failed` status + continue.
6. On `parse_boq` global failure: all eligible data sheets set to `Parse failed`, commit, publish error event, return.
7. `master_preamble` text: when `parsed.master_preamble` is non-empty, written to `BOQs.master_preamble` via `frappe.db.set_value`. Falsy result skips the write -- a re-parse that finds no general-specs sheet does NOT blank a previously stored value. Logged at INFO level in both cases. Field added in feat 8db5a8d8; bench migrate run; `has_column` verified True.
8. `BOQs.parsed_at` stamped with `frappe.utils.now()` if at least one sheet succeeded.
9. `frappe.db.commit()` THEN `frappe.publish_realtime("boq:parse_run_done", ...)` (commit-before-publish per CLAUDE.md).
10. Event targeted to enqueueing user via `user=user` param.

**Status lifecycle (per `BoQ Sheet Draft.wizard_status`)**
- Reviewed + successful parse -> `Parsed`
- Re-parse of `Parsed` sheet -> rows replaced; status stays `Parsed`
- `parse_boq` global failure -> all eligible sheets -> `Parse failed`
- Per-sheet insert failure -> that sheet -> `Parse failed`; other sheets continue
- General-specs sheet (master_preamble): status NOT changed by worker (it is not a data sheet)
- Pending/Hidden/Skip/Parse-failed/Reviewed-without-blob: not parsed; status unchanged

**Event: `boq:parse_run_done`**
- Success: `{status:"success", boq_name, parsed_sheets:[], not_parsed_sheets:[], failed_sheets:[]}`
- Error: `{status:"error", boq_name, error_code: "missing_file"|"fetch_failed"|"no_eligible_sheets"|"parse_failed"|"internal"}`
- Targeted to enqueueing user (vs. `boq:wizard_parse_done` which is broadcast to all clients).

**`BOQs.wizard_state` NOT touched** -- the worker never sets this field. User-declared finalize is a later phase.

**New test class `TestRunParseWorker` (15 tests; +1 from rule-order fix)**
- Uses a tiny 3-sheet openpyxl workbook (SheetA + SheetB + SOW) built in `setUpClass`; `source_file_url` set to the local tempfile path (triggers local-fetch branch in `_fetch_boq_file_to_tempfile`; no S3 dependency)
- All blobs use 6-key production shape (no `sheet_name`) to exercise FIX 1 naturally
- Tests: Reviewed->Parsed on success; rows inserted; `parsed_at` stamped; `parse_boq` failure->Parse failed (via `unittest.mock.patch`); re-parse no duplicate rows; subset parse leaves other sheets' rows untouched; Pending sheet not parsed + stays Pending; general-specs sheet no rows; master_preamble written + contains SOW text + SOW still no rows; master_preamble written when general-specs sheet has wizard_status="Skip" (rule-order fix, real-data regression); `general_specs_sheet=""` safe; `general_specs_sheet=None` safe; Skip/Hidden no rows; FIX 2 list-JSON round-trip
- `test_fix1_production_blob_without_sheet_name_is_eligible` + `test_skip_sheet_designated_as_general_specs_routes_to_master_preamble` (rule-order fix unit test) added to `TestAssembleMappingConfig` (+1)

**`_LIST_JSON_FIELDS` promotion**
Moved from `TestBoQReviewRowRoundTrip._LIST_JSON_FIELDS` (class attribute) to module-level `frozenset` in `parse_run.py`. `test_parse_run.py` imports it from `parse_run`; no re-hardcoding.

**Live proof (to be run by Nitesh)**
1. Designate "SOW" on BOQ-26-00145 as general-specs via wizard hub (`set_general_specs_sheet`)
2. Call `run_parse` on BOQ-26-00145 and BOQ-26-00150 (or trigger via a temporary curl/bench console call until the Parse button is wired in Slice 2b)
3. Assert: Reviewed sheets -> Parsed; 21/3 Skip sheets -> no rows; SOW -> master_preamble text logged, no rows; per-sheet re-parse replaces only that sheet's rows; `parsed_at` set on BOQs

**Slice 2b next:** Wire "Parse workbook" button in hub frontend to call `run_parse`; handle `boq:parse_run_done` event in the hub; show parse progress/result. OR: Slice 3c (SheetConfigPanel wizard spoke) first if that is prioritized.

---


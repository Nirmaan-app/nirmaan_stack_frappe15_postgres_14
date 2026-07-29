### Phase-1 Slice 2b-backend-2 -- parse-history fields (has_prior_parse + last_parsed_at)

**Status:** COMPLETE (feat 896f3a3c; 5 new TestParseHistoryFields in test_parse_run + 4 new TestParseHistoryNotTouched in test_update_sheet_draft; 55 test_parse_run + 60 test_update_sheet_draft; 588 parser tests unchanged). Backend + type-only frontend.

**Files changed:**
- `nirmaan_stack/nirmaan_stack/doctype/boq_sheet_draft/boq_sheet_draft.json` -- two new fields
- `nirmaan_stack/api/boq/wizard/parse_run.py` -- `_set_draft_status` extended + Parsed write site stamped
- `nirmaan_stack/api/boq/wizard/test_parse_run.py` -- `TestParseHistoryFields` class (5 tests) + imports
- `nirmaan_stack/api/boq/wizard/test_update_sheet_draft.py` -- `TestParseHistoryNotTouched` class (4 tests)
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- type addition only

**What this slice does**

Adds two fields to BoQ Sheet Draft:
- `has_prior_parse` (Check, default 0): set to 1 by the worker when it marks a sheet "Parsed". Never cleared.
- `last_parsed_at` (Datetime, read_only): stamped to `frappe.utils.now()` by the worker alongside the Parsed status write. Never cleared.

Both fields are stamped in a single `frappe.db.set_value` call (via the extended `_set_draft_status` helper's `extra_fields` dict param) to keep the write atomic.

**Design principle (LOCKED by product owner):** `wizard_status` = current intent/state; `has_prior_parse` + `last_parsed_at` = history of what actually occurred. Write-once by the worker; nothing in current scope clears them.

**Dirty-detection contract:** `wizard_status == "Reviewed"` AND `has_prior_parse == 1` means the sheet was previously parsed but its config was subsequently changed (parse is stale). This is the "dirty signal" for exit-criterion-B Checks 5/6 and for the hub Parse-button slice that follows.

**General-specs guard:** `has_prior_parse` / `last_parsed_at` are stamped ONLY inside the `if sheet_name not in general_specs_sheet_names_worker` guard -- exactly the same guard that gates the "Parsed" status write. General-specs sheets are never stamped.

**`_set_draft_status` extension:** `extra_fields: dict | None = None` param added. When provided, fields are merged via `{"wizard_status": status, **extra_fields}` and written in one `frappe.db.set_value` call. All existing callers (error paths writing "Parse failed") are unchanged (no extra_fields).

**Frontend type (boqTypes.ts):** `has_prior_parse?: 0 | 1` (Frappe Check fields return as 0/1) and `last_parsed_at?: string | null` added to `BoQSheetDraft`. TYPE ADDITION ONLY -- no frontend logic in this slice.

**New tests in `test_parse_run.py` -- `TestParseHistoryFields` (5 tests):**
- Data sheet parsed -> `has_prior_parse == 1` and `last_parsed_at` non-null
- General-specs sheet never stamped -> `has_prior_parse == 0` / `last_parsed_at` null
- Parse history survives config-change dirty-drop (key Check-5 support test: dirty signal = Reviewed + has_prior_parse=1)
- Parse history survives set_sheet_status("Pending") (history is history)
- Re-parse restamps `last_parsed_at` to newer time (sentinel-past-time technique avoids sleep)

**New tests in `test_update_sheet_draft.py` -- `TestParseHistoryNotTouched` (4 tests):**
- `set_sheet_config` dirty-drop does not clear parse history
- `set_sheet_config` no-op save does not clear parse history
- `set_sheet_status("Pending")` does not clear parse history
- `set_sheet_status("Reviewed")` does not clear parse history

**Frappe Datetime type note (test implementation):** `frappe.db.get_value` returns Datetime fields as `datetime.datetime` objects, not strings. Tests that compare `last_parsed_at` against a string sentinel use `str(val)[:19]` normalization (`str(datetime.datetime(2026, 1, 1, 0, 0))` = `"2026-01-01 00:00:00"`).

**Module 2b next.**


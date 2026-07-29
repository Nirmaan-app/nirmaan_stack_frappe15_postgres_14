### Slice B1.1a -- extend get_review_rows with column_descriptors (backend)

**Status:** COMPLETE (feat 58d2ed44; backend only; +13 wizard-review-screen tests; 50 total review-screen tests, 218 total wizard tests).

**What landed:**

*Backend (`review_screen.py`):*
- Imports `_RATE_ROLE_TO_KIND` from `classifier.py` (authoritative rate-role -> subkey table; no parallel copy).
- New module-level constants: `_NON_DISPLAY_ROLES` (append_to_notes, ignore, reference_images), `_SINGLETON_ROLE_TO_FIELD` (12 singleton roles -> review-row field names).
- New helper `_build_column_descriptors(sheet_config)` -- compiles a declarative list from `sheet_config.column_role_map`. Per entry: `{col, role, area, value_field, value_key, rate_subkey}`. Sorted by Excel order (len, lexical). Non-display and unknown roles skipped silently. Returns `[]` for absent/empty config.
- `get_review_rows` extended to load `sheet_config` from `BoQ Sheet Draft` child row (one `frappe.db.get_value` call) and append `column_descriptors` to its return dict. Existing `rows` + `work_packages` contract unchanged (additive only).
- `get_review_rows` return shape: `{"rows": [...], "work_packages": [...], "column_descriptors": [...]}`.

*Role -> descriptor mapping table:*
- Singleton: role in `_SINGLETON_ROLE_TO_FIELD` -> `value_field=<field>`, `value_key=null`, `rate_subkey=null`.
- `qty` -> `value_field="qty_by_area"`, `value_key=<area>`, `rate_subkey=null`.
- `amount_by_area` -> `value_field="amount_by_area"`, `value_key=<area>`, `rate_subkey=null`.
- `rate_*_by_area` (key in `_RATE_ROLE_TO_KIND`) -> `value_field="rate_by_area"`, `value_key=<area>`, `rate_subkey=_RATE_ROLE_TO_KIND[role]`.

*Tests (`test_review_screen.py`):*
- `_build_column_descriptors` imported for pure-Python tests.
- `TestBuildColumnDescriptors` (9 pure-Python tests): empty config, non-display exclusion, count + Excel order, singleton shape, rate_by_area shape, qty_by_area shape, amount_by_area shape, multi-letter column sort (Z < AA < AB), unknown role skipped.
- `TestGetReviewRowsColumnDescriptors` (4 DB tests): ordered descriptors with correct value_field/key/rate_subkey, non-display roles excluded from endpoint, no sheet_config returns `[]`, rows + work_packages unchanged.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- import extended; 2 new constants; `_build_column_descriptors` helper; `get_review_rows` extended (additive only); docstring updated.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- `_build_column_descriptors` import added; `TestBuildColumnDescriptors` (9) + `TestGetReviewRowsColumnDescriptors` (4) appended.

**Test counts:**
- `test_review_screen`: 50 tests (was 37, +13: 9 pure-Python + 4 DB).
- Total wizard: 218 (60 + 50 + 66 + 7 + 23 + 12).

**No frontend changes (B1.1b consumes this).** tsc/build not required this slice.

---


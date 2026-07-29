### Phase-1 Slice 2b-backend -- dirty-marker drop (Parsed -> Reviewed on config change)

**Status:** COMPLETE (feat 7795582f; 7 new tests; 56 wizard tests total; 588 parser tests unchanged). Backend-only -- no frontend changes this slice.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/update_sheet_draft.py` -- `set_sheet_config` dirty-marker logic
- `nirmaan_stack/api/boq/wizard/test_update_sheet_draft.py` -- `TestSetSheetConfigDirtyMarker` class (7 tests)

**What this slice does**

`set_sheet_config` is the sole config writer (verified: no other endpoint touches `sheet_config`). Before writing the new blob it now:

1. Reads the child row's current `wizard_status` + `sheet_config` via `frappe.db.get_value(child_name, [...], as_dict=True)`.
2. Computes `changed` via a **sound semantic compare**: normalizes both the incoming config (Python object from dict input or `json.loads` of string input) and the stored config (stored blob re-parsed; handles Frappe auto-deserialization of JSON fields -- see note below) to `json.dumps(..., sort_keys=True)` and compares those canonical strings.
3. If `current_status == "Parsed"` and `changed`: sets `wizard_status = "Reviewed"` (separate `db.set_value` call before the blob write).
4. Writes the config blob unconditionally (identical blob write is harmless; simpler than skipping).

**Compare-soundness note (load-bearing)**

The stored and incoming forms are both non-canonical: dict input uses Python insertion-order via `json.dumps(dict)` (no `sort_keys`); string input is stored verbatim. Key reordering alone would cause a raw `==` compare to report "changed" on a semantically identical no-op save, producing a false dirty flag.

The `sort_keys=True` normalization makes semantically-equal configs compare equal regardless of key order or original string formatting.

**Additional finding during implementation:** Frappe's `db.get_value` with `as_dict=True` on a JSON fieldtype auto-deserializes the field to a Python dict (not a raw string). The comparison code handles both string and already-deserialized-object forms when reading the stored blob. Without this, `json.loads(dict)` raises `TypeError`, the except clause catches it, `stored_canonical` becomes `None`, and every save reports "changed" -- verified by two initial test failures.

**Status-machine contract (LOCKED per plan §4)**

| Prior status | changed | Result |
|---|---|---|
| Parsed | True | drops to Reviewed |
| Parsed | False | stays Parsed (no-op save) |
| Reviewed / Pending / Skip / Hidden / Parse failed | any | status untouched |

`set_sheet_config` is the only endpoint that implements this drop; it is called by SheetConfigPanel's read-modify-write save. No schema changes (no dirty boolean, no hash field, no timestamp -- the status drop IS the dirty marker, per plan §4).

**New test class `TestSetSheetConfigDirtyMarker` (7 tests)**
- Parsed + changed config -> drops to Reviewed
- Parsed + identical config (no-op save) -> stays Parsed
- Parsed + reordered-keys (same semantic) -> stays Parsed (compare-soundness regression guard; included because stored form IS non-canonical)
- Reviewed + changed config -> stays Reviewed (not touched)
- Pending + changed config -> stays Pending (not touched)
- Skip + changed config -> stays Skip (only-Parsed invariant)
- Config blob correctly written in the Parsed->Reviewed drop path

**No schema change.** No frontend change. No parser change. No CLAUDE.md convention-level change (dirty-marker behavior is fully documented here; set_sheet_config docstring updated inline).

---


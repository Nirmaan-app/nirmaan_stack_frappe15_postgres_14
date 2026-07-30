<!-- Carved from .claude/context/domain/boq-backend.md on 2026-07-30 (structural carve).
     boq-backend.md is a router; this file holds the detail.
     Load when: Upload worker prefill, template priced export, the single-editor lock, or template deselect behaviour -->

## BoQ Upload Worker -- auto-guess prefill (Step 10.5)

After `boq_doc.insert()` (Step 10, which assigns child-row names), the worker runs a prefill step for every **Pending** sheet draft:

1. `reader.detect_header_row(sheet_name)` — heuristic keyword-scoring scan of the first 15 rows; returns `int | None`.
2. If a row is found: `auto_guess_sheet_config(reader, sheet_name, header_row)` from `nirmaan_stack.services.boq_parser._auto_guess`. Returns a `SheetConfig` Pydantic model.
3. `frappe.db.set_value("BoQ Sheet Draft", draft.name, "sheet_config", json.dumps(detected.model_dump()))` — writes the full SheetConfig (including `column_role_map`) as JSON.

**Failure-isolation rule (enforced by try/except):** an exception in step 1, 2, or 3 calls `frappe.log_error()` and leaves `sheet_config = None` for that sheet. The upload never fails because of a bad auto-guess. This is intentional: the wizard spoke's sparkle UX handles wrong guesses; a failed guess falls back to the empty-panel behavior.

**Pending-only scope:** Hidden and Skip sheets (marked by the worker itself based on sheet visibility) are skipped entirely — `detect_header_row` is never called for them.

**Read path:** `useFrappeGetDoc("BOQs", boqName)` returns the full doc including the prefilled `sheet_config` on each child row. The frontend's `SheetConfigPanel` reads `draft.sheet_config` and shows sparkle on all pre-filled fields.

---

## Template priced-export blank-row compaction (2026-07-23, `export_template_workbook.py`)

**The defect.** A template BoQ's committed grid keeps every row at its ORIGINAL template Excel row
(`_invert_rows_to_grid`: `row_number = source_row_number`) while the commit filters to the INCLUDED
subset (`_template_grid_rows` -> `filters={"is_excluded": 0}`). Deselecting rows therefore removes them
from the grid but NOT from the numbering, so a pruned sheet exported with a physical blank row at every
deselected row, on top of the master template's own spacer rows. Live case: `BOQ-26-00213` / `Sprinkler`
= 31 grid rows spanning 54 physical rows -> 23 holes.

**The rule (owner-locked).** ONE uniform rule, no head/tail special case: **any maximal run of
consecutive blank source rows becomes exactly ONE blank output row.** A lone authored spacer therefore
survives (it is a section break the template author put there); the deselection holes collapse. The
header-to-data gap collapses under the same rule (`out_first = header_row + 1`).

**Blankness is judged on what is WRITTEN, not on whether a grid row exists** (`row_has_content`):
a non-currency mapped cell with a non-blank value, OR a stamped rate, OR a remark. The currency columns
are excluded because step (a) deliberately skips them (an unpriced row's placeholder 0s must not keep a
visually-blank row alive). A COLOUR tag alone is NOT content (an empty tinted cell is still a blank row).

**LOAD-BEARING — the map is built ONCE and EVERY absolute-row writer consumes it.** Never
`openpyxl.delete_rows`: this sheet is built out of row-relative formulas (amount cells, the multi-area
`=SUM`, the grand total, the Summary's cross-sheet refs) and `delete_rows` does NOT rewrite formulas.
Equally, a writer that addressed a SOURCE row directly would land a rate on the wrong row — silent,
client-facing corruption. The seven writers: grid cells, `_stamp_rates`, amount formulas, the multi-area
total `=SUM`, the grand total, colours/priced-highlight/remarks, `_style_data_sheet` borders.
`_stamp_rates` / `_apply_colors` / `_write_remark_column` are SHARED with the upload path, so the remap
is applied to the FETCHED RECORD LISTS inside `export_template_workbook.py` (`_remap_excel_rows`) —
those helpers stay untouched and the upload branch is byte-identical.

Pure + unit-tested: `build_compact_row_map` / `row_has_content` / `_remap_excel_rows`.

**Tests:** `test_export_writeback` 28 -> **42** (13 pure + a `TestTemplateExportBlankRowCompaction`
end-to-end class seeding holes, a 3-run, a lone spacer, a currency-placeholder-only row and a
remark-only row; the corruption guard asserts the src-10 rate lands on output row 6, never row 10).
`test_review_screen` 260 · `test_pricing` 185 · `test_revision_schema` 17 — all OK.

**Live E2E (2026-07-23):** `BOQ-26-00213` / `Sprinkler` exported 55 -> **36 rows**, blank runs `[1,1,1]`,
2/2 rates on the correct rows, 0 amount-formula row drift; UI "Download priced tender" produced a valid
8.4 KB xlsx.

**⚠️ Consequence:** a compacted priced export no longer has row-number parity with the internal committed
tier. Re-uploading it as a revised BoQ still works (sheet pairing is by NAME, row carry runs through the
parser matcher — neither anchors on Excel row), but do not build a future feature that anchors on
exported row numbers.

---

## ⚠️ Single-editor lock — the race loser REJECTS; it can never re-read the winner (2026-07-23)

**`pricing_lock.acquire_or_refresh` had an unreachable recovery branch.** On losing the PK race it
rolled back to its savepoint, re-read the winner, and re-raised when the re-read returned None —
commented as "the colliding row vanished … genuinely unexpected".

**It is the opposite of unexpected: it happened 100% of the time.** Frappe runs PostgreSQL at
**REPEATABLE READ** (`SHOW transaction_isolation` → `repeatable read`; psycopg2 `isolation_level` 2 —
NOT the PG default of read committed, which is what the original design assumed). The loser's snapshot
is fixed at its first statement, necessarily BEFORE the winner commits (it read the identity as FREE).
Its INSERT then blocks on the winner's uncommitted row and fails only once the winner commits.
`ROLLBACK TO SAVEPOINT` makes the transaction usable again but **does not advance the snapshot**, so the
winning row stays invisible for the rest of that transaction.

Measured with two concurrent connections on the real bench: **12/12 losers raised a raw
`DuplicateEntryError`**, never routing to reject/takeover — i.e. the module's headline
"exactly-one-winner, the loser is routed" guarantee never held. It surfaced as an HTTP **409** that
failed the caller's write with an error the frontend could not interpret. An in-transaction retry loop
would fail identically (the snapshot cannot advance) — do not add one.

**Fix:** the loser THROWS the standard marker-prefixed lock rejection (`marker` param, so the draft tier
still reports `BOQ_DRAFT_LOCKED`) after rolling back to the savepoint to keep the caller's transaction
usable. This is CORRECT routing, not a degraded fallback: losing the insert race is itself proof the
lock is held AND fresh (the winner just stamped `last_edit_at = now`) — precisely branch 3. Only the
holder's NAME is unobtainable, so the message names the *session* rather than guessing a person. Re-run
of the same harness: **12/12 → one `acquired`, one marker-prefixed reject.**

**Test note:** `test_atomicity_concurrent_first_edit_exactly_one_winner` used to stub `_read_lock` to
return None on the first call and the REAL row on the second — a fake that made the unreachable branch
look healthy, which is how the leak survived. It now stubs None on EVERY call (what a real loser
observes) and asserts the rejection is not a `DuplicateEntryError`. Plus 4 new cases in
`TestSingleEditorLock` (marker, writes-nothing, caller's marker, transaction-still-usable).
`test_pricing` 185 → **189**.

**Call-site corollary:** a client-side lock acquire fired at the same instant as a write that acquires
server-side races on this same check-then-insert. The two BoQ callers that acquire server-side
(`save_review_edit`, `save_cell_price`) must NOT have a client acquire fired from inside the save — the
template review screen acquires on FOCUS instead (see `boq-frontend-*`), and the T10 selection checkbox
relies on the server acquire alone.

---

## Template selection — a DESELECT clears the row's quantities (2026-07-23, `template_select.py`)

`set_row_excluded` now zeroes `qty_total` + `qty_by_area` on every row it flips to excluded, for the
whole DESELECT cascade. A deselected row is never committed, so a quantity left on it is dead data that
silently returns if the row is re-selected — the reviewer would see a number they did not type for a
scope they had removed. Cascade-wide is the case that matters: deselecting one group can strand dozens
of typed quantities.

- **`zeroed_qty_by_area(current)`** (pure, unit-tested) is the clearing SHAPE: the same area KEYS, all
  values 0. The key set is preserved rather than nulled because a clone seeds every eligible row with
  `{area: 0.0}` per configured area and the review grid reads that key set to decide the row is
  qty-bearing — nulling it renders the Total blank instead of 0. Returns None for a single-area row that
  never had the dict, so the caller skips the column entirely.
- Written through `frappe.db.set_value(..., update_modified=False)` + `json.dumps` for the JSON column,
  and stamps **NO provenance** — matching the `is_excluded` write beside it. The user performed a
  SELECTION, not a per-row edit; flipping a cascade of rows to "Edited" would misattribute work they
  never did.
- Only rows the endpoint actually flips are cleared, so ride-along (non-eligible) rows stay untouched
  exactly as D5 requires, and the SELECT direction never clears anything.
- **ONE-WAY by design (owner):** re-selecting restores the row, never the numbers.

`test_template_select` 22 → **29** (3 pure `zeroed_qty_by_area` + 6 endpoint: single row, cascade,
per-area keys preserved, re-select does not restore, SELECT never clears, no provenance stamp).

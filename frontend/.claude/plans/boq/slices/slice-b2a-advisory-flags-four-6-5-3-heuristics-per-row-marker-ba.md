### Slice B2a -- advisory flags: four §6.5.3 heuristics + per-row marker (backend + frontend)

**Status:** COMPLETE (feat pending; backend helpers + endpoint extension + frontend marker + tests; 76 total review-screen tests, 247 total wizard tests).

**What landed:**

**Governing constraints:**
- Flags are ADVISORY-ONLY: never auto-change any field, never block any wizard transition.
- READ-ONLY at the data layer: no new BoQ Review Row fields, no writes.
- Serving decision: backend extends `get_structural_breaks` endpoint to return `flags` alongside `breaks` (GET-capable; no new endpoint). Frontend computes flags client-side from the `rows` prop (all required fields already present in `ReviewRow` from `get_review_rows`), avoiding any change to `SheetReviewPage.tsx` (out of scope).
- Files in scope exclusive: `review_screen.py`, `test_review_screen.py`, `ReviewTree.tsx`, docs files.

**Four flag sources (§6.5.3 heuristics):**

| Type | Fires when | Canonical reason |
|---|---|---|
| `priced_preamble_no_children` | effective_cls=preamble AND no row has this row_index as effective_parent AND any scalar price field > 0 | "Preamble carrying a price with no sub-items — check if it's a line item." |
| `zero_amount_line_item` | effective_cls=line_item AND (amount_total is None or 0 OR qty_total is None or 0) | "Amount is zero — check the value or whether it's intentional." |
| `orphan` | reused from structural_breaks (type="orphan") -- NOT recomputed | "Line item with no parent group — check its parenting." |
| `parser` | needs_classification_review is set AND review_reason is non-empty | review_reason verbatim (no canonical override) |

**Flag (i) expected-dormant status:** `_apply_zero_children_preamble_demotion_post_pass` in `hierarchy.py` demotes childless priced preambles to line_items at parse time. Flag (i) only fires after a human reclassification (Slice C) reverts a demoted row back to preamble. On freshly parsed sheets, flag (i) is expected to produce zero results -- this is correct behavior, not a gap.

**`_PRICE_SIGNAL_FIELDS`:** scalar fields only -- `amount_total`, `amount_supply`, `amount_install`, `rate_supply`, `rate_install`, `rate_combined`. `rate_by_area` is a JSON dict (not scalar Float) and is intentionally excluded.

*Backend (`review_screen.py`):*
- New module-level constants: `_FLAG_REASONS` (3 canonical strings, verbatim-pinned), `_PRICE_SIGNAL_FIELDS` (6 scalar Float fields), `_ADVISORY_EXTRA_FIELDS` (9 extra fields fetched by `get_structural_breaks` for flag computation).
- New helper `_has_price_signal(row)`: returns True if any `_PRICE_SIGNAL_FIELDS` entry is non-None and > 0.
- New helper `_compute_advisory_flags(rows, structural_breaks)`: builds `children_of` set from effective parent values, reuses orphan row_indexes from structural_breaks input (never recomputes), iterates rows and emits flag dicts for all 4 sources. Each flag dict: `{type, row_index, source_row_number, reason}`.
- `get_structural_breaks` extended: fetches `_ADVISORY_EXTRA_FIELDS` alongside existing minimal fields; passes rows and breaks to `_compute_advisory_flags`; returns `{"breaks": [...], "flags": [...]}`. Existing `"breaks"` contract is fully preserved (additive only).

*Frontend (`ReviewTree.tsx`):*
- New import: `Fragment` (explicit -- `<>` shorthand doesn't support `key` prop), `Info` from `lucide-react`.
- New local type `AdvisoryFlag { type: string; reason: string }`.
- New pure function `computeAdvisoryFlags(rows)`: mirrors backend logic client-side using the same effective-parent chain, children-of set, and four-flag logic. Operates on the already-fetched `ReviewRow[]` prop -- no extra network call.
- New state: `expandedFlagRows: Set<number>` + `toggleFlagRow(rowIdx)` functional updater.
- `flagsByRowIdx: Map<number, AdvisoryFlag[]>` via `useMemo([rows])`.
- Row rendering: `rows.map(row => ...)` changed from returning `<tr key={...}>` to `<Fragment key={row.row_index}><tr>...</tr>{optional flag-reasons tr}</Fragment>`.
- Per-row flag marker: amber `<Info className="h-3 w-3">` button in the Classification `<td>`, after ClassificationPill. `e.stopPropagation()` prevents accidental collapse toggle. `aria-label` + `title` set. Only rendered when `flagsByRowIdx.has(row.row_index)`.
- Optional flag-reasons `<tr>`: `bg-amber-50/60 dark:bg-amber-950/20`, `colSpan={totalCols}`, bullet list of `{f.reason}` per flag. Only rendered when `hasFlags && flagsExpanded`.

*Tests (`test_review_screen.py`):*
- `TestAdvisoryFlagHelpers` (20 pure-Python tests): `_has_price_signal` (4 cases), flag (i) (4 cases incl. human-override path), flag (ii) (5 cases), flag (iii) orphan composition, flag (iv) parser verbatim, clean sheet, canonical reasons verbatim pin.
- `TestGetStructuralBreaksB2a` (6 DB tests): `flags` key present, `breaks` key unchanged, flag (i) in response (FlagSheet: preamble row 0, amount=500, no children), flag (iii) orphan in response, flag (iv) parser verbatim, clean sheet returns empty flags.
- **Test fix applied:** test fixture bug -- row 2 originally had `parent=0` making row 0 have a child, so flag (i) correctly didn't fire. Fixed to `parent=None` so row 0 is truly childless. The comment "no children" in the fixture now matches the actual setup.
- **Implementation fix applied:** `_FLAG_REASONS` constant had curly apostrophes (U+2019) from IDE/editor auto-correction; tests used straight apostrophes (U+0027). Fixed in `review_screen.py` via binary replace to use straight apostrophes throughout.

**Test counts:**
- `test_review_screen`: 76 tests (was 50, +26: 20 pure-Python `TestAdvisoryFlagHelpers` + 6 DB `TestGetStructuralBreaksB2a`).
- Total wizard: 247 (63 + 76 + 66 + 7 + 23 + 12).

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Remaining in Slice B2:** B2b = row-detail panel (click a row to expand a side panel or inline detail showing all field values; not started).

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- `_FLAG_REASONS` + `_PRICE_SIGNAL_FIELDS` + `_ADVISORY_EXTRA_FIELDS` constants; `_has_price_signal` + `_compute_advisory_flags` helpers; `get_structural_breaks` extended.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- `_compute_advisory_flags` + `_has_price_signal` imports; `TestAdvisoryFlagHelpers` (20 tests) + `TestGetStructuralBreaksB2a` (6 tests) appended.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- `Fragment` + `Info` imports; `AdvisoryFlag` type; `computeAdvisoryFlags` function; state + useMemo; Fragment-wrapped rows; Info marker button; flag-reasons `<tr>`.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record + overview line updated.
- `frontend/CLAUDE.md` -- status line bumped.

---


## MC-1 -- multi-column Description: join at parse + faithful parts map (parser core) COMPLETE

Branch `feature/boq-multicolumn-description` (off develop `dd60cc36`). Parser-core ONLY -- downstream
tiers (reader, hierarchy, orchestrator, wizard endpoints, commit pipeline, doctypes, frontend)
UNTOUCHED this slice. One feat commit + this docs commit. Baseline parser suite 594 -> 603, all green.

**Design (owner-locked):** the `description` role may now be mapped on MULTIPLE columns. The parser
JOINS all mapped description columns, in EXCEL COLUMN ORDER (A, B, ... AA -- sort key `(len, letter)`,
NOT dict insertion order), with the separator `" | "` (space-pipe-space, ASCII), skipping columns whose
cell text is blank/whitespace for that row, into the SINGLE canonical `description` string the whole
pipeline already consumes. It ALSO records each original column's text in a NEW per-row parts map
`description_parts_raw` (originally `{header label -> raw cell text}`; **SUPERSEDED by MC-1b below ->
an ordered LIST of `(col_letter, header_label, cell_text)` triples**, Excel order, blank cells absent),
mirroring `append_notes_raw`, for later faithful display. **Single-description sheets are BYTE-IDENTICAL to
pre-MC-1** (single stripped value, no separator; empty when the cell is blank/absent) -- a regression
pin test + the entire existing suite prove it.

**What landed:**
- **`config.py`** -- removed `"description"` from `_SINGLETON_ROLES`, so a sheet_config mapping the
  description role on 2+ columns now VALIDATES (was rejected). All other singleton roles + per-area
  uniqueness + area-declared checks UNCHANGED. Comment updated to state the multi-column intent.
- **`classifier.py`** -- ONE shared source of truth: `_description_columns(sheet_config)` (description-role
  columns in Excel order) + `_description_parts(raw_row, sheet_config)` (`(header_label, cell_text)` per
  non-blank column, Excel order; header via `column_headers.get(col, col)` identical to `append_notes_raw`;
  `_to_str` coercion == today's single-column `desc_raw`). The `classify_row` description read builds
  `desc_raw = " | ".join(parts)` + `description_parts_raw = dict(parts)` ONCE; every downstream consumer of
  `desc_raw` (subtotal regex, subtotal-marker row, `desc_text`, the final `description`, classification)
  inherits the joined value. New dataclass field `ClassifiedRow.description_parts_raw` populated uniformly
  on every row (subtotal-marker + main constructors). NOTE rows inherit the joined string for free (their
  text IS `ClassifiedRow.description`). The candidate scorer's bold signal reads the LEFTMOST (Excel-first)
  description column via the shared helper (Option A -- byte-identical single-column; bold is a per-cell
  property so it cannot consume the joined string); its string-length signal already sees the joined value
  via the passed-in `row_k.description`.
- **Tests:** `test_config.py` swapped `test_two_description_columns_rejected` -> `_accepted` (the sibling
  `test_two_qty_total_columns_rejected` keeps the singleton-negative proof). `test_classifier.py` new
  `TestMultiColumnDescription` (9 cases): two/three-column join order, blank-middle skip (no double sep),
  mapping-order-vs-Excel-order (Excel wins), multi-letter Z-before-AA order, single-column byte-identical
  pin, parts-map labels/order/values, single-column parts map, all-description-blank equivalence to a
  single blank column.

**Downstream (NOT this slice, for later):** the reader/hierarchy/orchestrator carry the joined string
transparently; `description_parts_raw` needs threading through `ResolvedRow` -> `flatten_resolved_row` ->
`BoQ Review Row` -> commit -> `BOQ Nodes` and the review/pricing render surfaces before faithful
per-column display exists end-to-end.

### MC-1b -- parts shape fix: collision-proof triples COMPLETE

Follow-on to MC-1 (tip `f5d61372`), BEFORE anything downstream consumes the field. `classifier.py` +
`test_classifier.py` only. Baseline parser suite 603 -> 604, all green.

**Problem:** MC-1's `{header label -> raw cell text}` dict silently DROPPED a column when two description
columns shared an identical header (last-write-wins). **Fix (owner call 2026-07-09):** the STORED SHAPE
of `ClassifiedRow.description_parts_raw` becomes an ORDERED LIST of `(col_letter, header_label, cell_text)`
triples, Excel column order, blank cells still skipped. `col_letter` is UNIQUE -> collision-proof;
`header_label` stays the ORIGINAL header text (NO de-duplication in storage). `_description_parts` returns
the triples; the join site takes each triple's `cell_text`.

**The canonical joined `description` string is UNTOUCHED** (byte-identical to MC-1 in every case) -- all
join-string tests pass unmodified. The scorer bold signal is unchanged.

**DISPLAY CONVENTION (recorded, NOT built here -- lands MC-4/MC-5):** at render time, duplicate header
labels get ` 2`, ` 3` suffixes in column order (e.g. two "Description" columns render as "Description" +
"Description 2"). Storage keeps the raw original labels; the suffixing is a pure render-time decoration.

**Tests:** `TestMultiColumnDescription` parts assertions restated to the triple shape; NEW
`test_duplicate_header_labels_both_survive` (identical headers -> BOTH parts kept, distinguished by
`col_letter`, join string unaffected). `test_classifier` 133 -> 134.


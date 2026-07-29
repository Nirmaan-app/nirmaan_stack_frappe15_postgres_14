## MC-3b -- capture column header labels at parse time COMPLETE

`SheetConfig.column_headers` had NO production writer -> always `{}`, so every header-label lookup
(`description_parts_raw` triple labels, `append_notes_raw` keys) fell back to the bare column LETTER for
EVERY sheet. Owner Option B (2026-07-10): capture the real header text at PARSE time. Backend-only; two
commits (feat + this docs). No schema. Parser suite 604 -> 610; test_parse_run 102 unchanged.

**Seam = orchestrator.py (NOT parse_run.py).** `assemble_mapping_config` (parse_run) builds the
parser-input `SheetConfig` from stored blobs with NO workbook open; the workbook is opened inside
`parse_boq`, whose per-sheet loop has both the reader and the authoritative `header_row` AND runs before
`classify_row` (the consumer of `column_headers`). New helper `orchestrator._enrich_column_headers(reader,
sheet_config)` reads the `header_row` cells via `reader.iter_rows(start_row=end_row=header_row)` (no reader
change) and fills `column_headers`. It lights up BOTH the description triples and the append-notes keys
(classify_row reads `column_headers.get(col, col)` for each).

**D1-D5 as built:**
- **STORED WINS (D1):** a non-empty existing `column_headers[col]` is never overwritten.
- **BOTTOM ROW (D2):** `header_row` is the single declared header row = the bottom sub-header row (the
  second tier sits ABOVE it, excluded from data by the `row >= header_row` guard) -> its cells are the real
  per-column labels; a banner row above is NOT read.
- **BLANK -> ABSENT (D3):** a blank/whitespace header cell leaves the column absent from `column_headers`
  (the letter fallback stays); never stores `""`.
- **NO WRITE-BACK (D4):** enrichment is IN-MEMORY on the parser-input `SheetConfig`; the stored
  `BoQ Sheet Draft.sheet_config` blob is never mutated, and the committed `BoQ Sheet.column_headers`
  snapshot still snapshots the stored `{}`. **Labels reach MC-4/5 ONLY via the persisted
  `description_parts_raw` triples' `header_label`.**
- **SEAM (D5):** orchestrator.py only; reader.py + parse_run.py untouched.

**LOCKED for MC-4/5 -- the label source (union-across-rows):** since `column_headers` is not written back
and `column_descriptors` carry no per-column label, MC-4/5 read each description column's header label from
`description_parts_raw[].header_label`, taking it from any row where that column's cell is non-blank (the
label is constant per column). This covers every column with content in >=1 row; a description column blank
in EVERY row (degenerate) shows the Excel letter -- accepted (owner, no write-back).

**Backwards-compat:** enrichment only FILLS empty entries; pre-filled configs behave identically; existing
sheets gain labels on their NEXT parse only (forward-only). The parts-map SHAPE is unchanged -- only label
VALUES improve.

**Tests (+6 in test_orchestrator, via a bespoke tempfile workbook -- never a committed binary):** single-row
multi-description real labels, two-row header reads the sub-header row (not the banner), stored-entry-wins,
blank-header letter fallback, append_notes real-label bonus, prefilled regression. **Also updated in-place:
the pre-existing dtech letter-fallback test** -- its column E ("Workitem") has a real header, which MC-3b
now captures, so its `append_notes_raw` key is the real label, NOT the letter "E" (the letter fallback now
only survives a genuinely blank header; that coverage moved to the new blank-header test).


## MC-2 -- thread description_parts_raw to draft rows + BOQ Nodes COMPLETE

Threads the MC-1/1b parts list from parser output to BOTH DB tiers (draft `BoQ Review Row` + committed
`BOQ Nodes`) so MC-4/5 can render the original columns on the review screen and the pricing editor. Two
commits (feat + this docs). Backend-only; `pricing.py` + frontend untouched. Migrated. Suites:
parser 604 (unchanged), test_parse_run 99->102, test_commit_pipeline 51->54, test_review_screen 247->249,
test_pricing 176 (inheritance regression-checked, unchanged).

**LOAD-BEARING SERIALIZATION CONVENTION (list-JSON, NOT the dict append_notes_raw path):**
`description_parts_raw` is a LIST (of `(col_letter, header_label, cell_text)` triples). Frappe's
`get_valid_dict()` rejects raw Python lists on a JSON field, so at EVERY boundary it follows the list-JSON
siblings (`attached_notes` / `classifier_warnings` / `edit_log`) -- explicit `json.dumps` on write,
membership in the LIST parse-set on read -- NEVER the dict-valued `append_notes_raw` (which Frappe
auto-serializes). It round-trips as a **list-of-lists** `[[col, header, text], ...]` on read (tuples not
preserved).

**Hop list as built** (EXPLICIT-COPY at every code hop; `ClassifiedRow`/`ResolvedRow` are BLOB-PASS -- no
change to classifier.py/hierarchy.py):
- **Doctypes (additive JSON field, `bench migrate`d; A5 has_column gate passed both):**
  `description_parts_raw` on `boq_review_row.json` + `boq_nodes.json`. Migrate did NOT churn the JSONs
  (clean 7-insertion additive diff each; no timestamp/reorder noise -> no reduction needed).
- **`parse_run.py` (draft write):** `flatten_resolved_row` copies `cr.description_parts_raw`;
  `_LIST_JSON_FIELDS` gains it so `_run_parse_worker` `json.dumps` it before `doc.insert()`; two docstrings
  updated.
- **`commit_pipeline.py` (draft -> BOQ Nodes):** fetched in `_REVIEW_ROW_FIELDS`, parsed in
  `_JSON_FIELDS_TO_PARSE`, written in the **deferred list-JSON PASS 3** (`set_value(json.dumps)`, NOT
  `_build_node_pass1` -- a list would trip the wall; empty list skipped like append_notes_raw), reconciled
  via `_jsn`.
- **`review_screen.py` (read feeds):** `get_review_rows` ships it (`all_fields` + `_JSON_LIST_FIELDS`, the
  LIST set); the committed mapper `_committed_node_to_row` parses + emits it, **normalizing absent/NULL to
  `[]`** (covers pre-MC-2 nodes AND empty-parts nodes the commit skips writing). `pricing.py`
  `get_priced_rows`/`get_version_priced_rows` INHERIT it via the committed feed -- no pricing edit.

**Display-only invariant:** no classification/pricing logic reads `description_parts_raw`; it is render data
for MC-4/5, which apply the ` 2`/` 3` duplicate-header display suffixes.

**Tests (+8):** test_parse_run round-trip (multi/single/empty -> list-of-lists via the draft insert);
test_commit_pipeline (carried-verbatim onto BOQ Nodes, duplicate-header survival end-to-end, empty-parts
no-crash + committed feed `[]`); test_review_screen (draft feed parsed list, committed feed parsed +
absent->`[]`).


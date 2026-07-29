## Phase 5 Slice 1 — committed general-specs faithful-grid doctype (BACKEND, feat 5fe61bff, 2026-06-16)

**What this slice is (and is NOT).** Builds the EMPTY committed home for faithful general-specs rows — a new
top-level doctype that stores a general-specs sheet's cell grid faithfully (arbitrary length AND width) carrying
the per-sheet commit-version dimension. SCHEMA + bare-stub controllers + tests ONLY. It is NOT the commit
pipeline: NO commit logic, NO `get_sheet_preview_full` call, NO real-data fetch/persist, and the parser, wizard
API, BOQ Nodes, BOQs and BoQ Sheet Draft are ALL untouched (those are later slices). Resolves C2 (general-specs
stored today as a LOSSY flattened `preamble_text` blob — see "PHASE 5 -- LOCKED INPUTS") by giving the faithful
rows a committed home; the actual routing of reachable grid data into it is Slice 3.

**Slice-0 recon facts verified before build (all confirmed):** V1 — the existing `BoQ General Specs Sheet` has
exactly two fields (`source_sheet_name` Data, `preamble_text` Long Text, `istable=1`); it is the lossy blob
doctype and is UNTOUCHED — the new doctype is fully separate. V2 — `get_sheet_preview_full`'s per-row output
shape is `{"row_number": int, "cells": {col_letter: value}}` (`sheet_preview.py` ~:297-302); the new child
mirrors it so Slice 3 can persist that output directly. V3 — §9 #136 grandchild-serialization convention holds:
a first-level child serializes on its parent via `get_doc`, a grandchild Table does not, so the design uses ONE
level of child (`rows` on the parent) + JSON `cells` (a field, not a Table) to stay first-level.

**NEW doctype — `BoQ Committed General Specs`** (module Nirmaan Stack; `istable=0` standalone top-level, NOT a
child of BOQs, because it carries versioning and is queried independently per sheet). `autoname BCGS-.YY.-.#####`
(deliberately distinct from BQSH-/BOQ-/BOQN-/BOQRR-, collision-checked), `track_changes=1`, `engine InnoDB`,
`allow_rename=1`, `index_web_pages_for_search=1`, and the 10-role permission block mirroring `BoQ Sheet`
verbatim. **Fields:** `boq` (Link->BOQs, reqd, `search_index`, `in_standard_filter`, `in_list_view`);
`source_sheet_name` (Data, reqd, `in_list_view`, stored VERBATIM #152 — never stripped/trimmed); the per-sheet
VERSION dimension `commit_version` (Int, reqd, default 1, `in_list_view`) + `is_current` (Check, default 1,
`in_standard_filter`, `in_list_view`); `committed_at` (Datetime, read_only — pipeline-set); and the child table
`rows` (Table -> "BoQ Committed General Specs Row").

**NEW child doctype — `BoQ Committed General Specs Row`** (`istable=1`, module Nirmaan Stack, `permissions: []`).
**Fields:** `row_number` (Int, reqd, `in_list_view` — the source Excel row number, faithful 1-based position);
`row_order` (Int, `in_list_view` — emission-order sort key, preserves order when row_number is sparse); `cells`
(JSON — the arbitrary-width `{col_letter: value}` map mirroring `get_sheet_preview_full`'s per-row "cells" shape;
JSON not exploded columns is what gives arbitrary width without a grandchild table).

**One-current invariant DEFERRED.** Exactly one `is_current=1` row per (boq, source_sheet_name) is the durable
goal, but Slice 1 DEFINES the fields only — the pipeline (Slice 3) enforces the one-current invariant on write.
Slice 1 builds NO enforcement; both controllers are intentionally bare stubs (`class …(Document): pass`, no
compute, no cross-doc writes) per the project convention. The parent stub carries a docstring noting the deferred
invariant. No `integrations/controllers/` file is added (no hooks, no logic this slice).

**Design rationale (locked):** one-level child (`rows` on the parent) + JSON `cells` keeps the grid first-level so
it serializes on `get_doc` per §9 #136; versioning lives on the parent (the same model the node tier will carry);
the lossy `BoQ General Specs Sheet` blob doctype stays UNTOUCHED and separate.

**Verification (in-session, real bench run).** `bench --site localhost migrate` CLEAN (both doctypes install).
`test_boq_committed_general_specs` **4/4 green** in-container: T1 arbitrary-width round-trip (rows of 3 / 2 / 5
columns persist + read back, cells match exactly, widths preserved); T2 row_number + row_order persist and
ordering is recoverable from sparse/out-of-sequence row_numbers; T3 version fields default correctly
(commit_version=1, is_current=1) and are settable (commit_version=2, is_current=0) — schema-level only, NO
enforcement; T4 (#152) `source_sheet_name` with a trailing space persists VERBATIM (not stripped). Parser suite
**597 UNCHANGED** (this slice does not touch the parser). The test self-seeds a BOQs row in `setUpClass`
(`boq.project=_TEST_PROJECT` + `ignore_links=True`, mirroring `test_boq_sheet`); committed-general-specs inserts
are uncommitted so FrappeTestCase tearDown rolls them back.

**Files (feat 5fe61bff):** two NEW doctype folders only — `nirmaan_stack/nirmaan_stack/doctype/
boq_committed_general_specs/` (`__init__.py` + `.json` + bare-stub `.py` + `test_*.py`) and
`…/boq_committed_general_specs_row/` (`__init__.py` + `.json` + bare-stub `.py`). 7 files, +423 lines, 0
deletions. NO parser / wizard-API / BOQ Nodes / BOQs / BoQ Sheet Draft / hooks.py / frontend change. Docs commit
separate (this plan doc + root CLAUDE.md substantive; frontend/CLAUDE.md minimal-touch per the DOCS-UPDATE RULE).
**NEXT:** the per-sheet commit-version model on the node tier + the commit pipeline (Slice 3) that routes
`get_sheet_preview_full` output into these rows and enforces one-current.


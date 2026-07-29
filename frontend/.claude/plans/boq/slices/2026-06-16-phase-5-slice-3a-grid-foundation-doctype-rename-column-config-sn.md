## Phase 5 Slice 3a — grid foundation + doctype rename + column-config snapshot + single-open commit shell (BACKEND, feat pending, 2026-06-16)

The FIRST slice of the commit pipeline and the FIRST to write REAL parsed BoQ data into the committed schema
(the #47 first-real-data crossing). Builds the GRID layer + the combined commit shell; the FINALIZED node-tree
branch is a PURE STUB (dispatched + no-op — that is Slice 3b).

**Two-layer model (the shell you are building).** Every committable sheet commits its COMPLETE original as a
FAITHFUL GRID (all 6 row classifications, in original position) into the renamed faithful-grid doctype. Finalized
sheets will ALSO commit a node tree (Slice 3b); general-specs sheets are grid-only. 3a writes the grid for BOTH
dispositions and dispatches to the node stub for finalized.

**(1) Doctype rename (free — zero rows existed).** `BoQ Committed General Specs` → **`BoQ Committed Sheet Grid`**
and its row child → **`BoQ Committed Sheet Grid Row`**: folders, `.json` `name`, controller files + classes
(`BoQCommittedSheetGrid` / `BoQCommittedSheetGridRow`), the `rows` table `options`, descriptions, and the test
file/class all renamed. Autoname **`BCGS-.YY.-.#####` → `BCSG-.YY.-.#####`** (decision: keep the prefix honest to
the new name; free with zero rows). The doctype is no longer general-specs-specific — it holds the faithful grid
for ANY committable sheet. **Frappe migrate AUTO-DELETED the orphaned old DocTypes** (built-in orphan cleanup:
"Orphaned DocType(s) found: BoQ Committed General Specs Row, BoQ Committed General Specs … Deleting orphaned
DocTypes") — this was NOT a `delete_doc` I added (the plan had said to leave the orphan inert; migrate cleaned it
itself). Harmless: zero rows, no runtime callers.

**(2) Discriminator field `sheet_disposition`** (Select `grid_only` / `grid_and_nodes`) added to the grid doctype.
RATIONALE: a Select over a `has_node_tree` Check — a self-documenting closed set that parallels the Slice-2 gate's
disposition vocabulary (`finalized` | `general_specs`) and leaves room for a future third disposition without an
awkward second boolean. VALUE MAPPING (ties to the gate, not re-derived): gate `general_specs` → `grid_only`;
gate `finalized` → `grid_and_nodes`. (`commit_version` / `is_current` / `committed_at` already existed from
Slice 1 — S4 satisfied, no new versioning fields.)

**(3) Commit shell + dispatch — NEW `nirmaan_stack/api/boq/wizard/commit_pipeline.py`.** `commit_boq(boq_name,
sheet_subset)` (whitelisted POST): calls the Slice-2 gate (`compute_committable_sheets`) for the eligible set +
each sheet's disposition; SERVER-SIDE GATE RE-CHECK rejects (throws) any subset sheet not in the eligible set,
BEFORE any file fetch or write — the caller's subset is never trusted; opens a PER-SHEET transaction boundary
(one trailing `frappe.db.commit()` per sheet, NO savepoints — the existing app-wide pattern); routes each sheet by
disposition to the grid write-body (both dispositions) + a node-write STUB (`_commit_node_tree_stub`, TODO(3b)
no-op) for finalized.

**(4) Single-open file path (shared, built here, used by 3a + 3b).** `sheet_preview.py`'s row-extraction loop was
WELDED + duplicated inside `get_sheet_preview` and `get_sheet_preview_full` (the fetch helper
`_fetch_boq_file_to_tempfile` was reusable, but there was no `ws`→rows helper). DECISION (owner): extract the
SHARED helper **`_extract_grid_rows(ws, min_row=1, max_row=None)`** and route BOTH endpoints through it
(behavior-preserving — the byte-identity test stays green), so the previewed grid and the committed grid read a
sheet through ONE implementation and cannot silently diverge. `commit_boq` fetches the workbook ONCE +
`load_workbook` ONCE, then LOOPS the committable sheets calling `_extract_grid_rows(ws)` inside the single open
workbook — no per-sheet re-open, no per-sheet whitelisted-endpoint loop; the S3-safe fetch helper is reused
verbatim.

**(5) Grid write-body (per sheet, BOTH dispositions).** Builds the faithful grid `{row_number, cells:{col_letter:
value}}` for every row (NO row dropped — note/spacer/subtotal_marker/header_repeat all kept), persists to
`BoQ Committed Sheet Grid` + its child `rows` (`row_order` = emission index). **Verbatim sheet identity (#152):**
`source_sheet_name` is matched byte-for-byte on BOTH the write and the freeze lookup — never trimmed (six sheets on
BOQ-26-00145 carry a trailing space; PostgreSQL `=` on varchar is byte-exact, so trailing spaces are significant
and the prior-version lookup finds the right row). **Versioning** per (boq, sheet verbatim): `commit_version =
max(prior)+1` (first = 1), `is_current=1`, `committed_at` set; the prior current grid's `is_current` flips → 0 —
exactly one current grid per (boq, sheet). `sheet_disposition` set per the gate mapping. All within the per-sheet
transaction.

**(6) Committed `BoQ Sheet` per sheet (both dispositions — incl. grid-only general-specs, which the node path
never created).** Creates the committed BoQ Sheet row (the P4-1 tier nodes attach to in 3b). REPLACE semantics: the
BoQ Sheet has no version dimension of its own (versioning lives on the grid; per-node versioning is 3b), so a
re-commit deletes the prior (boq, sheet verbatim) BoQ Sheet + its child work_packages and creates a fresh one —
keeping exactly one committed BoQ Sheet per (boq, sheet). **COLUMN-CONFIG SNAPSHOT (the linchpin):**
`column_role_map` + `column_headers` + `area_dimensions` (+ `header_row` / `header_row_count` / `treat_as`) are
pinned VERBATIM from the matching draft's `sheet_config` at commit; `sheet_order` / `sheet_label` / `work_packages`
carried from the draft; `treat_as` = master_preamble (general_specs) / data (finalized). This snapshot is what
later serves append-notes rendering, semantic column rendering, and Excel write-back addressing.

**GOTCHA (pinned).** `BoQ Sheet.area_dimensions` is a list-valued JSON field. It INSERTS fine via `json.dumps()`
(a string passes `get_valid_dict`), but Frappe parses it back to a Python list on load, so any later `doc.save()`
OR `delete_doc` (whose as_json archive calls `get_valid_dict`) THROWS "cannot be a list". The replace path
therefore uses raw `frappe.db.delete` (bypasses the lifecycle/archive) + explicit child-row cleanup (the BoQ Sheet
controller is a bare stub — no on_trash guard, so a raw delete is safe). Reads tolerate the parsed form
(`frappe.parse_json(v) if isinstance(v, str) else v`).

**Tests.** Renamed doctype suite `test_boq_committed_sheet_grid.py` 4/4 (baseline was 4; the BCGS→BCSG autoname
assertion updated). NEW `test_commit_pipeline.py` 11/11: grid round-trip (all rows kept, in order, cells by
col_letter — note/spacer/subtotal/header_repeat retained); column-config snapshot on a finalized sheet AND on a
grid-only general-specs sheet; discriminator mapping (finalized→grid_and_nodes, general_specs→grid_only);
versioning + freeze (v1→v2, exactly one current); committed_at set; gate re-check negative (ineligible / unknown /
empty subset throw, nothing written); verbatim trailing-space identity (a trimmed lookup would leave TWO current
grids — asserted it does not); one committed BoQ Sheet per sheet after re-commit. `test_sheet_preview` 32/32
UNCHANGED (byte-identity guard green → the `_extract_grid_rows` refactor is behavior-preserving). Parser suite
**597 UNCHANGED**. Test-fixture note: a `BOQs` row needs a non-empty `project` (the `before_insert` controller) —
a dummy `project` string + `ignore_links=True` satisfies it (the Slice-1 pattern).

**Migration.** `bench migrate` CLEAN (no Role-Profile lock this run; the orphan auto-clean is noted above — not a
failure). Schema verified at runtime: new doctypes present, old gone, `sheet_disposition` Select with options
`grid_only\ngrid_and_nodes`, autoname `BCSG-.YY.-.#####`, all version columns present.

**Live test (scripted commit-and-inspect on BOQ-26-00145 — the first-real-data crossing) PASS.** Gate →
SOW=general_specs, FAS=finalized. `commit_boq(["SOW","FAS"])` → SOW grid_only 39 rows (committed BoQ Sheet
treat_as=master_preamble, empty role-map — SOW has no parser config), FAS grid_and_nodes 1001 rows (committed BoQ
Sheet treat_as=data, header_row=2, header_row_count=2, role-map A–H, area_dimensions ['Phase 1','Phase 2']); the
node stub no-op'd (zero BOQ Nodes written — correct for 3a). Re-commit of the same subset → v1 froze (is_current
0), v2 current; exactly ONE current grid per sheet; the committed BoQ Sheet replaced (count = 1 each). The live
data persists on BOQ-26-00145 (legitimate committed data — the point of the crossing).

**Files.** 7 renamed (doctype folders/files) + 2 new (commit_pipeline.py + test_commit_pipeline.py) + the
sheet_preview.py refactor + docs. Pure-backend slice → docs scoped to root CLAUDE.md + this plan; frontend/CLAUDE.md
deliberately NOT touched (no frontend change this slice — the build prompt scoped it root-only; the DOCS-UPDATE
RULE's frontend minimal-touch is intentionally skipped, see the prompt's A15).

**NEXT = Slice 3b** (the node-tree write path for finalized sheets: resolve_effective() → BOQ Nodes + BOQ Node Qty
By Area per the P4-3 field-mapping lock, carrying is_rate_only + amounts/rates verbatim; per-node versioning; the
combined_rate throw→warning relaxation) **+ Slice 4** (hub commit UI / version picker / "Committed" status flip +
the hub last_committed_at mirror).


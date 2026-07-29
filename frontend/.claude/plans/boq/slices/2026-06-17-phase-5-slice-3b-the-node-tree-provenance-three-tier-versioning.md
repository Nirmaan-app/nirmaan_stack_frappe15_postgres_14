## Phase 5 Slice 3b — the node tree + provenance + three-tier versioning + combined_rate relaxation (BACKEND, feat pending, 2026-06-17)

FILLS the node-write stub Slice 3a left in `commit_pipeline.py`. The second real-data-write slice; completes the
commit pipeline's node layer. A FINALIZED sheet now commits a faithful grid (3a) AND a node tree (3b);
general-specs sheets stay grid-only.

**Recon first (read-only, prior turn).** Confirmed: `resolve_effective` lives only in `review_screen.py:252`,
returns a per-row dict with `effective_classification` + `effective_parent_index` (a review ROW_INDEX or None);
the P4-3 word-order reversal is real (rate_supply→supply_rate, etc.); BOQ Nodes had NO provenance/versioning
fields (P4-4 added only edit_log/edited_by/edited_at/remarks/attached_notes); BoQ Sheet had NO versioning fields;
the grid-freeze precedent uses `frappe.db.set_value`. THREE recon/build STOP-CHECKs fired and were resolved with
the owner: (4a-i) BOQ Nodes has list-valued JSON fields `attached_notes`+`edit_log` → `doc.save()` pass-2 unsafe;
(S3) BOQ Nodes lacked `append_notes_raw`; (4c-i) **the real per-area data is FLAT `{area:float}`, not the recon's
nested `{area:{kind}}`** — the current parser emits nested (BOQ-26-00166 VRF System confirmed nested L1/L2
supply/install/combined), so both shapes must be handled.

**Six locked decisions** (carried into the build): (1) per-area explosion = dual-shape, NEVER downgrade
granularity; (2) live-test the nested path on BOQ-26-00166 VRF System (real nested data); (3) rate path is
live-certified via 00166 (00145 had no per-area rates); (4) carry `edit_log` (P4-4: node is the durable home for
the review row's edit history); (5) parent wire = doc.save with deferred list-JSON fields; (6) add
`append_notes_raw`.

**Step 1 — schema (migrate clean).** BOQ Nodes: `review_row_name` (Data — source BOQRR- name; human-readable tie,
MAY DANGLE on re-parse), `commit_provenance_id` (Data — frappe.generate_hash, the DURABLE key), `is_synthetic`
(Check — FUTURE-INSURANCE: 0 across the whole current corpus, carried verbatim so the plumbing is ready),
`append_notes_raw` (JSON, dict-valued), and the per-node versioning triple
`commit_version`/`is_current`/`committed_at`. BoQ Sheet: the SAME versioning triple (it had none — only the grid
did). All columns verified present at runtime.

**Step 2 — combined_rate throw → WARNING (capture-only).** Parent (`boq_nodes.py`) + child
(`boq_node_qty_by_area.py`) `frappe.throw` → `frappe.msgprint(alert=True, indicator="orange")`; the node saves,
values persist verbatim, tendering reconciles. This is a prerequisite for the node body (pass-2 `doc.save()`
re-fires the checks). 3 throw-tests retargeted to assert-saves; the 5 success tests untouched.

**Steps 3–4 — the node body (`_commit_node_tree` replaces the stub).** Reads review rows ({boq, sheet_name
VERBATIM #152}, row_index asc), runs `resolve_effective` (imported, not reimplemented), maps
`effective_classification` → node_type: **preamble → Preamble (+level), line_item → Line Item (no level);
note/spacer/subtotal_marker/header_repeat → GRID-ONLY, NOT nodes** (the Select has exactly Preamble + Line Item).
**TWO-PASS + DEFERRED LIST FIELDS** (the load-bearing mechanic, resolving 4a-i): BOQ Nodes' list-valued JSON
`attached_notes`/`edit_log` would trip `doc.save()`'s get_valid_dict ("cannot be a list"). PASS 1 inserts each
node parent-less with those two fields NULL (dict-valued `append_notes_raw` IS set in pass 1 — only LISTs trip the
wall); PASS 2 sets `parent_node` + `doc.save()` in ANCESTOR-DEPTH order (paths cascade correctly + the
parent-chain validation re-runs as a free integrity check) — list-safe because the two list fields are still null;
PASS 3 writes `attached_notes`+`edit_log` via `frappe.db.set_value(json.dumps(...))` (targeted column write,
bypasses full-doc serialization). MONEY = P4-3 word-order reversal, Float→Currency (Frappe coerces, no manual
round); `qty_total→qty` (Float stays Float); `sl_no_value→code`, `row_index→sort_order`. is_rate_only/is_synthetic
carried verbatim. HUMAN LAYER (human_classification/human_parent[-1 sentinel]/human_is_root) carried as PROVENANCE
ONLY — never branched on (the LIVE wiring is parent_node+node_type+level from resolve_effective). edit_log carried
(decision 4); notes←row_notes; attached_notes carried verbatim (Option A — no aggregation/up-roll). Provenance:
review_row_name = the row name, commit_provenance_id = frappe.generate_hash().

**Step 4c — per-area child explosion (`_explode_area_children`) — DUAL-SHAPE, NEVER DOWNGRADE (owner-locked).**
qty_by_area always flat `{area:float}` → child.qty (defaults 0.0 for an area absent from qty but present in
rate/amount — child.qty is reqd=1); rate_by_area NESTED `{supply_rate,install_rate,combined_rate}` → each on its
own child column, FLAT scalar → combined_rate ONLY (deliberate; supply/install left empty, not invented);
amount_by_area NESTED `{supply,install,total}` → supply_amount/install_amount/total_amount each, FLAT scalar →
total_amount ONLY. area_name = dict key verbatim (#152).

**Step 5 — three-tier shared versioning + the BoQ Sheet fold.** ONE shared `commit_version` per (boq, sheet)
(`_next_commit_version` = grid max+1) covers grid + sheet + nodes. On re-commit each tier FREEZES its prior
current via `frappe.db.set_value(is_current=0)` — NEVER `doc.save()` (BoQ Sheet's list-valued `area_dimensions`
would re-serialize and hit get_valid_dict). **3a's raw-DELETE of the prior BoQ Sheet is RETIRED →
freeze-and-supersede**: the prior sheet + its nodes survive as a coherent frozen vN snapshot; v1 nodes stay
attached to frozen sheet v1. Node re-commit freezes the prior commit's current nodes (attached to the frozen prior
sheet), never touching their parent_node. **Centralized is-current accessor `_current_names(doctype, boq,
name_field, value)`** (recon Q5 — none existed): one helper, three callers (grid:source_sheet_name,
sheet:sheet_name, nodes:sheet). Step 6: the 3a gate re-check is intact (verified).

**Tests.** test_commit_pipeline 11→19 (node tree built preamble+line-items-only / note+spacer skipped;
provenance+flags carried; human-layer+notes+edit_log+append_notes_raw carried; per-area nested-granularity-survives
+ flat→total/combined; combined_rate warns-not-throws; three-tier re-commit freeze [grid+sheet+nodes one shared
version, v1 nodes attached to frozen sheet v1, one current per tier]; is-current accessor; T7 retargeted to
versioned-NOT-deleted). test_boq_nodes 71 (3 retargeted to capture-only warns). test_review_screen 158 UNCHANGED
(resolve_effective import safe). Parser **597 UNCHANGED**. A child-`qty`-reqd surprise (the flat explosion's
amount-only area) was fixed by defaulting child qty to 0.0; a Currency-defaults-to-0.0 (not None) test expectation
was corrected.

**Live test (scripted, second real-data crossing) — BOTH PASS.** FLAT BOQ-26-00145 FAS → 21 nodes (5 Preamble + 16
Line Item; note/spacer skipped from 1001 grid rows), parent tree wired 0-dangling, money verbatim vs the review
rows, provenance set; re-commit froze grid+sheet+nodes to one shared version (v3→v4 — 3a had left grid v1/v2 for
FAS, so max+1 is consistent), prior BoQ Sheet NOT deleted (3 FAS sheets, versions [1,3,4], 1 current), v1 nodes all
is_current=0 attached to the frozen sheet, exactly one current per tier. NESTED BOQ-26-00166 VRF System (set
Finalized as documented test setup) → 69 nodes; per-area L1/L2 each carry distinct supply_rate=160 / install_rate=40
/ combined_rate=200 on separate committed child columns — granularity SURVIVES (decision #1 proven on real data).
The live test left legitimate committed data on both BoQs and set BOQ-26-00166 VRF System → Finalized.

**Files.** boq_nodes.json + boq_sheet.json (schema), boq_nodes.py + boq_node_qty_by_area.py (relaxation),
commit_pipeline.py (node body + versioning fold + accessor), test_boq_nodes.py (3 retargeted),
test_commit_pipeline.py (+8 / T7 retarget) + docs. Pure-backend slice → root CLAUDE.md + this plan;
frontend/CLAUDE.md NOT touched (no frontend change). NEXT = Slice 4 (hub commit UI / version picker / "Committed"
status flip + the hub last_committed_at mirror).


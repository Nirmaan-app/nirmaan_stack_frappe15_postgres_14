## Slice 2 -- commit round-trip reconciliation (output-fidelity) -- BACKEND (feat 01c7dbaf, 2026-06-18)

**What this slice is.** An AUTOMATIC, headless, EVERY-COMMIT verification that the committed tiers (node tree +
per-area children + faithful grid) equal what the commit PRODUCED. Runs at the tail of each per-sheet write path,
BEFORE the per-sheet `frappe.db.commit()`; a divergence `frappe.throw`s and the EXISTING Slice-5 per-sheet isolation
converts the sheet into a clean `{failed}` entry (rollback + reason). Recovers the dropped Slice-6 dogfood as an
always-on check. BACKEND ONLY.

**Locked scope = OUTPUT-FIDELITY, not logic-correctness.** Verifies ONLY that the value each transform PRODUCED was
COPIED to the DB accurately. It does NOT judge whether a produced value is *correct* (valid parent, no cycles, sane
rates, declared area, level-monotonicity = VALIDITY = tendering's job = OUT OF SCOPE). No coherence/relational
checks built. The "must be able to fail" rule governs: a derived-value check never re-runs the producer (that would
be self-confirming) -- it compares against the CAPTURED producer output.

**Build-recon resolved (verified against live code).** The two derived values are observable in-memory in
`_commit_node_tree`'s scope at the tail: `eff_parent_by_idx` (resolve_effective's captured output), `name_by_idx`
(pass-1 insertion record), `docs_by_idx` (the in-memory node docs, carrying produced `.level`), and `node_rows`
(the review-row snapshot). Currency precision: no per-field precision -> system default (money 2dp via empty
`currency_precision`; qty 3dp via `float_precision=3`). Day-N census: 625 current nodes / 18 sheets, **0
money/qty copy-divergences** across 584 resolvable nodes at 2dp (the check won't fire on day one; the money
suppress-set is complete). Slot confirmed: `_commit_one_sheet` does grid -> sheet -> node tree -> commit, so a
raise before commit routes to commit_boq's per-sheet `try/except` (Slice-5).

**The check (one type, two anchors).**
- COPIED fields -> `stored == transform(review-row source)` reusing the in-hand `node_rows` (no re-query drift):
  code, sort_order, source_row_number, description (cascade desc->sl_no->"(untitled)"), unit, make_model,
  node_type, row_class, qty (Line-Item None->0), the six money fields (word-order reversal), is_rate_only /
  is_synthetic / human_is_root (bool-coerce), human_classification, human_parent (-1 sentinel), notes (row_notes
  rename), append_notes_raw / attached_notes / edit_log (JSON, empty-normalized), and the per-area children
  (deterministic explosion; flat-stays-flat encoded for free).
- DERIVED (exactly two) -> `stored == CAPTURED producer output`, NEVER re-running the producer: `parent_node =
  name_by_idx.get(eff_parent_by_idx.get(idx))` (the exact lookup pass-2 used -- re-running resolve_effective would
  be the self-confirming trap); `level = docs_by_idx[idx].level` (the in-memory value the producer built -- a THIN
  tripwire: nothing mutates level today, kept for near-zero-cost regression value).
- Plus a node-COUNT check (produced node rows vs current stored nodes -> catches a finalized sheet that should
  have nodes but persisted none) and a grid row_number/cells compare.

**Precision + anti-false-flag.** Numerics compared rounded to the field's own `frappe.get_precision` (money 2dp,
qty 3dp) via `frappe.utils.flt(v, p)` -- never raw float equality -- so Float->Currency coercion never false-flags.
Stored read fresh in-transaction (Frappe sees the uncommitted writes).

**Suppress-set encoded exactly** (the only differences NOT flagged -- they are our own rules): blank-qty=0,
placeholder description, flat-stays-flat (absent rate/amount kind normalizes to 0 == stored 0), gen-specs 0 nodes
(node reconcile not called), minted `commit_provenance_id` + versioning triple + `path` + `boq` EXCLUDED from the
field list, spacer grid-only (skipped from node_rows), note/subtotal_marker/header_repeat -> Other money-null,
human_parent -1 sentinel (N-2), bool coercion (N-3), qty None->0 Line-Item-only (N-4), and N-1: node->source paired
via the in-hand `node_rows`/`name_by_idx`, NOT a `review_row_name` re-lookup -- so historical dangling provenance is
irrelevant (the check only runs on freshly-committed nodes).

**Implementation.** Two helpers in `commit_pipeline.py`: `_reconcile_node_tree(sheet_name, boq_sheet_name,
commit_version, node_rows, eff_parent_by_idx, name_by_idx, docs_by_idx)` called inline before
`_commit_node_tree`'s return; `_reconcile_grid(sheet_name, grid_name, grid_rows)` called in `_commit_one_sheet`
before the commit. Support helpers `_text_eq` (None/'' equal), `_json_eq` (empty {}/[]/None normalized),
`_node_type_for`, and the `_NODE_MONEY_SOURCE` word-reversal map. No signature change to the existing functions; no
new plumbing; isolation boundary unchanged.

**Tests (`test_commit_pipeline`, 33 -> 44, +11, all green in-container; no schema, no migration).** MUST-FIRE (6):
corrupted money, dropped per-area child, zero-node finalized sheet, wrong parent_node, mutated level, corrupted grid
-- each tampers the STORED side AFTER the write via a wrapper around the reconcile helper (`_corrupt_then`), so the
real reconcile reads the corrupted rows; no production code altered. MUST-NOT-FIRE (5): flat-stays-flat,
blank-qty/placeholder-desc, gen-specs 0 nodes, note-Other-money-null + dropped-spacer-parent-root, re-commit
versioning-excluded. The existing 33 faithful-commit tests stay green (the reconcile does not break a normal
commit). The raise->failed[] routing is the existing Slice-5 mechanism (a reconcile raise is just another per-sheet
exception), already proven by TestCommitBoqPartialFailure -- not duplicated here.

**Docs.** Pure backend -> this plan + root CLAUDE.md substantive. frontend/CLAUDE.md NOT touched (no frontend
change this slice).


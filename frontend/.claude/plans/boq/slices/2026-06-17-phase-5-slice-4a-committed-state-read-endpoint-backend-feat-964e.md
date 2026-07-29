## Phase 5 Slice 4a — committed-state read endpoint (BACKEND, feat 964e14d0, 2026-06-17)

**Goal.** Give the (coming) Slice-4b hub commit UI a per-sheet CURRENT committed-state read, so it can render a
"Committed" badge + timestamp on a committed sheet card, a "Committed: N" footer count, and last-committed
date/time inside the commit modal's already-committed warning. READ-ONLY: one new whitelisted endpoint + its
tests; no writes, no doctype JSON change, no migration.

**Why a NEW read (recon-confirmed).** The two existing commit endpoints do NOT surface committed-state: the gate
`get_committable_sheets` returns ELIGIBILITY only ({sheet_name, disposition}); `commit_boq` returns post-commit
metadata but does not echo `committed_at`. The modal therefore needs BOTH calls (gate for eligibility + this new
read for committed-state). The authoritative committed_at source is the **`BoQ Committed Sheet Grid`** tier — it is
written for BOTH dispositions (grid_only general-specs AND grid_and_nodes finalized), anchors the shared
`commit_version`, and the Slice-3 pipeline's freeze-and-supersede invariant keeps exactly one `is_current=1` row
per (boq, source_sheet_name); its JSON `committed_at` description already names it the Slice-4 source of truth.

**Implementation (`commit_gate.py`, beside the gate it complements).**
- New `@frappe.whitelist() def get_committed_state(boq_name) -> dict`. Same missing/unknown-BoQ guard as
  `get_committable_sheets` (`frappe.throw` "boq_name is required." / "BOQs '...' not found." → `ValidationError`).
- `frappe.get_all("BoQ Committed Sheet Grid", filters={"boq": boq_name, "is_current": 1}, fields=["source_sheet_name",
  "committed_at", "commit_version"])`, mapped to `{"sheet_name": <source_sheet_name VERBATIM #152>, "committed_at":
  <Datetime|None>, "commit_version": int}`. Returns `{"committed_state": [...]}`; empty list when nothing committed.
- PURE read — no set_value/insert/save/commit. NO dedup logic: the one-current invariant is pipeline-enforced; were
  it ever violated a sheet would simply appear twice rather than being silently collapsed (noted in the docstring).
- `get_committable_sheets` / `compute_committable_sheets` / `commit_pipeline.py` / all doctype JSON UNTOUCHED.

**Tests.** `test_commit_gate` 13 → 18 (+5, new `TestGetCommittedState` seeding `BoQ Committed Sheet Grid` rows
directly — no pipeline run): current state returns committed_at + commit_version; a prior frozen v1 (is_current=0)
+ current v2 → only v2 surfaces (commit_version 2); a trailing-space sheet name round-trips VERBATIM (`"Elec "`
present, `"Elec"` absent); a BoQ with no committed grid → `{"committed_state": []}`; unknown BoQ throws. The 13
existing gate tests still pass (same module). RUN in-container `bench --site localhost run-tests --app
nirmaan_stack --module nirmaan_stack.api.boq.wizard.test_commit_gate` → 18/18 OK.

**Scope.** BACKEND-ONLY (Slice 4b = the hub UI, separate). Pure-backend → root CLAUDE.md + this plan;
frontend/CLAUDE.md minimal-touch per the DOCS-UPDATE RULE.


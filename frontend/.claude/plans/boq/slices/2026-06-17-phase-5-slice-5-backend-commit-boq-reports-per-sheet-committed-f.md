## Phase 5 Slice 5 (backend) — commit_boq reports per-sheet committed + failed (BACKEND, feat 09714041, 2026-06-17)

**Goal.** A commit-results modal (a SEPARATE later frontend prompt) must enumerate per-sheet SUCCESS and per-sheet
FAILURE. The partial-failure recon established `commit_boq` already commits per sheet (each `_commit_one_sheet`
ends with `frappe.db.commit()`, so earlier sheets are durable) but on a mid-batch failure it RAISED and aborted the
rest — the caller never learned which sheets succeeded vs failed. This slice changes propagate-and-abort into
catch-rollback-continue-and-report. BACKEND-ONLY (`commit_pipeline.py` + its test); the frontend modal is next.

**The change (`commit_pipeline.py`).** The per-sheet loop wraps each sheet's work in `try/except`. On `except`:
1. **`frappe.db.rollback()` — MANDATORY (the load-bearing safety point).** Catching the exception SUPPRESSES
   Frappe's request-level rollback (which today, in the raise path, discards the failed sheet's uncommitted work).
   Without an explicit rollback here, the failed sheet's freeze-before-write (its prior version's `is_current` set
   to 0) + partial new writes stay pending, and the NEXT sheet's `frappe.db.commit()` FLUSHES them — ORPHANING the
   sheet (prior frozen to `is_current=0`, new write incomplete → NO `is_current=1` version). The rollback runs
   FIRST, before recording/continuing. Already-committed earlier sheets are durable (commit made them permanent;
   rollback only affects the current uncommitted txn).
2. record `{sheet_name, reason}` in a new `failed[]` (`reason` via new `_commit_failure_reason(e)` — prefers the
   exception's message, lightly HTML-stripped, with a safe fallback "Commit failed for this sheet -- see server
   logs."; NEVER empty), `frappe.log_error` the traceback, `continue`.
Return envelope is now `{boq_name, committed, failed}` — `failed` is `[]` on full success (key always present).
**MIXED STATE is a valid resting outcome** (3 succeed + 2 fail → 3 durable, 2 rolled back); NO all-or-nothing
wrapper. The commit-per-sheet boundary + `_commit_one_sheet` + the three tier-writers are UNCHANGED. The
sheet-not-in-workbook check moved INSIDE the per-sheet try (a genuinely-absent eligible sheet → `failed[]`, loop
continues); the UPFRONT gate re-check STAYS a whole-call throw (eligibility is a precondition, not a runtime
failure).

**Tests (`test_commit_pipeline` 27 → 33, +6 in a new `TestCommitBoqPartialFailure`).** These drive `commit_boq`
(the public loop) with its file path PATCHED — `_fetch_boq_file_to_tempfile` + `openpyxl.load_workbook` (→ a
`_FakeWB`) + `_extract_grid_rows` (→ synthetic rows) — so no S3 / real workbook is needed; a per-sheet failure is
induced by monkeypatching `_commit_one_sheet` (or `_commit_node_tree` for the post-freeze orphan case) to raise for
ONE sheet_name. T1 partial-success durability (3 sheets, #2 fails → #1/#3 persisted, #2 wrote nothing); **T2
ORPHAN-PREVENTION (load-bearing)** — a re-commit whose new write fails AFTER the real tier-1/tier-2 freezes; asserts
the prior version stays `is_current=1`; **PROVEN to FAIL (`AssertionError: 0 != 1`) when the `frappe.db.rollback()`
line is neutered** (verified by temporarily neutering, running, restoring); T3 all-success `failed=[]`; T4 envelope
shape `{boq_name, committed, failed}` + each failed entry `{sheet_name, reason}`; T5 reason fallback on a
message-less exception; T6 sheet-absent-from-workbook lands in `failed[]`. Full suite `Ran 33 tests OK`.

**Scope.** BACKEND-ONLY — root CLAUDE.md + this plan; `frontend/CLAUDE.md` intentionally NOT touched (no frontend
change this slice; the commit-results modal that consumes `failed[]` is a separate frontend prompt). No doctype
JSON, no migration.


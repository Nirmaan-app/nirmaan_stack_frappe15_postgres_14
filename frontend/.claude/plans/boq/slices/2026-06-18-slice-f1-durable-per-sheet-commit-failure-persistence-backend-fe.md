## Slice F1 -- durable per-sheet commit-failure persistence (BACKEND, feat 5c095b34, 2026-06-18)

**What & why.** The backend half of the "needs attention" F-arc (F2 = a hub-card consolidated indicator,
F3/F4 = the parse/commit completion modals highlighting failures -- all FRONTEND, NOT this slice). Before F1,
`commit_boq`'s per-sheet failure handler built an in-memory `failed[]`, `frappe.log_error`d the traceback, and
returned the `{committed, failed}` envelope -- but PERSISTED NOTHING per-sheet. Once the HTTP response was gone a
hub card had nothing durable to read, so it could not show a commit-failure notice across sessions. F1 PERSISTS the
per-sheet commit failure (reason + timestamp) on the `BoQ Sheet Draft`, CLEARED on a successful re-commit -- the
durable analog of Slice 1a's `parse_failure_*`. BACKEND ONLY.

**Shape = a PAIR, NO category Select (recon-decided, owner-confirmed).** Parse had a clean 3-way taxonomy
(Config stale / Parser error / Insert error) because its failures came from three structurally-distinct phases.
Commit failures are heterogeneous/freeform -- a reconciliation divergence, a controller validation throw, a
sheet-not-in-workbook throw, a list-JSON `get_valid_dict` wall, a generic DB error -- and are already flattened to
one string by `_commit_failure_reason` (best-effort HTML-stripped message + safe fallback, never empty). A Select
would be mostly "Other", so it was deliberately omitted.

**(1) Schema (`boq_sheet_draft.json`).** Two additive NULLABLE fields at the tail of `field_order`, after
`parse_failure_at`, mirroring the `parse_failure_*` conventions:
- `commit_failure_reason` -- Small Text (no `read_only`, matching `parse_failure_reason`).
- `commit_failure_at` -- Datetime, `read_only: 1` (matching `parse_failure_at`).
Each carries a `description` documenting "Cleared on a subsequent successful commit". No `reqd`, no default, NO
data backfill (existing rows get NULL = "no commit failure" = the correct default). `bench migrate` CLEAN; runtime
columns verified via `frappe.db.has_column("BoQ Sheet Draft", ...)` + `get_meta` (Small Text / Datetime read_only).

**(2) Write hook -- the rollback-then-write-then-commit ORDER is load-bearing.** In `commit_boq`'s per-sheet
`except`, immediately AFTER the MANDATORY Slice-5 `frappe.db.rollback()` (UNCHANGED -- the orphan-prevention):
```
except Exception as e:
    frappe.db.rollback()                              # (1) FIRST -- unchanged Slice-5 orphan-prevention
    reason = _commit_failure_reason(e)
    _record_commit_failure(boq_name, sheet_name, reason)   # (2) set_value the draft, no commit
    frappe.db.commit()                                # (3) flush ONLY the stamp
    failed.append({"sheet_name": sheet_name, "reason": reason})   # reuses the captured reason
    frappe.log_error(...)                             # unchanged
    continue
```
`_record_commit_failure(boq, sheet, reason)` mirrors `_record_parse_failure`: verbatim-#152 child lookup
(`{"parent", "parenttype": "BOQs", "sheet_name"}` -> name; missing -> silent skip), then ONE
`frappe.db.set_value("BoQ Sheet Draft", child_name, {commit_failure_reason, commit_failure_at: now()},
update_modified=False)`, NO commit (the caller owns it). WHY THIS ORDER:
- The write is AFTER the rollback so the rollback does not sweep it away.
- The explicit `frappe.db.commit()` is REQUIRED -- this is the one real difference from the parse pattern (which
  relies on the worker's trailing commit). `commit_boq` has NO trailing commit after the loop; if the failed sheet
  is the LAST in the subset, no later `_commit_one_sheet` commit would ever flush the stamp -> it would be lost.
- The draft is a DIFFERENT doctype from the rolled-back grid/sheet/node tiers, and the commit pipeline never writes
  the draft during a sheet commit, so after the rollback this `set_value` is the ONLY pending write -- it cannot
  re-flush a rolled-back tier write, so T2 orphan-prevention is preserved.

**(3) Clear hook.** A new `_clear_commit_failure(boq, sheet)` (both fields -> None, same verbatim lookup, no
commit) folded into `_commit_one_sheet`'s trailing per-sheet `frappe.db.commit()` -- after the grid reconcile,
before the commit -- so a re-commit that now succeeds drops the stale stamp ATOMICALLY with the successful
grid/sheet/node write (mirrors 1a's clear-on-success). It runs only on the fully-successful path (a reconcile raise
earlier propagates to the except, which instead WRITES the stamp).

**Payload contract FROZEN.** The `{committed, failed}` envelope is byte-for-byte unchanged; the persisted fields are
an additive SUPERSET of what `failed[]` already returns. No return-shape change.

**Tests.** `test_commit_pipeline` **44 -> 49** (+5, all green), added to `TestCommitBoqPartialFailure` (the class
that drives the public `commit_boq` loop with the file path patched). Its `tearDown` now also clears the two
commit-failure fields on all sheets -- the stamps are committed (that is the point), so they survive
FrappeTestCase's per-test rollback and would otherwise leak into the next test (the draft rows are shared, created
once in setUpClass). The five:
- `test_f1_commit_failure_persisted_on_last_sheet_failure` -- PERSIST-ON-FAILURE; the failing sheet is LAST in the
  subset, so no later commit could flush the stamp -> it persists ONLY via the except's own commit (non-vacuous re
  the explicit commit). reason == the returned `failed[]` reason; `commit_failure_at` set.
- `test_f1_stamp_survives_rollback_and_no_orphan` -- KEYSTONE. A POST-FREEZE re-commit failure on the LAST sheet
  (`_commit_node_tree` patched to raise for S1 after the real `_write_grid` + `_write_committed_boq_sheet` froze
  S1's prior rows; S1 pre-committed once; subset `[S2, S1]` so S1 is last). Asserts BOTH: the prior S1 grid is
  STILL `is_current=1` at version 1 (the except's rollback discarded the freeze -> orphan-prevention holds, the new
  failure-commit did NOT re-flush it) AND the S1 stamp is persisted (it SURVIVED the very rollback that discarded
  the freeze).
- `test_f1_cleared_on_successful_recommit` -- pre-stamp via `_record_commit_failure` + commit, then a successful
  `commit_boq([S1])` -> both fields None.
- `test_f1_clean_first_commit_leaves_fields_null` -- a clean first commit leaves both fields None.
- `test_f1_mixed_outcome_only_failed_sheet_stamped` -- S2 fails of `[S1, S2, S3]` -> S2 stamped; S1 + S3 (clean
  successes) carry NO stamp; envelope correct.
The existing load-bearing T2 orphan-prevention test
(`test_orphan_prevention_rollback_restores_prior_on_failed_recommit`) is UNTOUCHED + green.

**Scope.** NO change to `parse_run.py` (the parse-failure fields are done -- only READ to mirror), `review_screen.py`,
the reconciliation internals, or any frontend. Pure-backend -> this plan + root CLAUDE.md substantive;
frontend/CLAUDE.md deliberately NOT touched (build-prompt scope; no frontend change this slice). NEXT = F2 (the hub
"needs attention" indicator reading `parse_failure_*` + `commit_failure_*` off the BOQs payload + a separate
`get_stale_sheets` call).


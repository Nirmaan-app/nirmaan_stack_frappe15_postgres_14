---
name: cashbook-one-expense
description: Formal check that the Cashbook (petty-cash wallet) import never books one wallet Txn Id as two expenses, across job crashes and re-runs, two job runs on one batch, a person's Create/Link on a line the job still holds, and two overlapping statements confirmed at once. A FizzBee model of every interleaving plus a real two-connection race test. Use before changing or reviewing api/outflow_import/cashbook.py, the Cashbook paths of expenses.create_expense / settle_row, their locking, or spec #1585 Phase 1 work.
---

# Cashbook: at most one expense per wallet Txn Id

**Property.** Each wallet Txn Id gets at most one expense (Project or Non-Project), counted by `payment_ref`.

**Harm.** A second expense is money booked twice in a project's ledger, already Paid, that nobody approved
(the Cashbook import is the one path that creates records with no approver).

Two checks, and you need both:

| Check | What it proves | Where |
|---|---|---|
| Model (FizzBee) | the DESIGN: no order of steps books a Txn Id twice | `scripts/formal/cashbook_one_expense/` |
| Race test | the CODE takes the lock the design needs | `nirmaan_stack/api/outflow_import/test_cashbook_one_expense_race.py` |

## Does your change touch it?

Rerun both checks when a change touches any of these (the coverage record):

| File | What the check covers |
|---|---|
| `nirmaan_stack/api/outflow_import/cashbook.py` | `confirm_cashbook_import`, `resume_cashbook_import`, `_enqueue_worker`, `_cashbook_worker`, `_lock_pending_line`, `_write_one`, `_write_failed`, `_mark_if_still_pending`, `_build_plan`, `_already_imported`, `_already_booked`, `_booked_index`, `_stage` |
| `nirmaan_stack/api/outflow_import/expenses.py` | `create_expense`, `_refuse_as_already_imported`, `already_imported_sentence`, `_settle_and_commit` (settle_row), `_load_settleable_row`, `guard_not_an_own_import_line`, `_guard_money_not_recorded` |
| `nirmaan_stack/services/outflow_import/skip_origin.py` | `own_import_refusal` -- phase 1 gate B: a Cashbook line is refused by hand while `Pending match run` |
| `nirmaan_stack/services/outflow_import/sources.py` | `CASHBOOK_SOURCE`, `CREATE_GATED_SOURCES`, `line_waits_for_its_own_create` |
| `nirmaan_stack/services/outflow_import/settle.py` | `create_expense_from_row` (writes `payment_ref`), the 1:1 Link `payment_ref` write |
| `nirmaan_stack/services/outflow_import/candidates.py` | `prior_import_sightings` (which stored lines count as already imported) |
| `nirmaan_stack/api/outflow_import/card_create.py` | `_create_one` -- the locking prior art the spec copies |
| `nirmaan_stack/nirmaan_stack/doctype/outflow_row_match/outflow_row_match.py` | `ensure_one_import_created_expense_per_transfer` (rule 3's index); `ensure_settled_target_unique` never fires for Cashbook |
| `nirmaan_stack/services/outflow_import/import_created_expense.py` | `IMPORT_CREATED_EXPENSE_INDEX`, `is_import_created_expense_refusal`, `import_created_expense_holding` (moved from the controller after the sync commit; the code is unchanged) |
| `nirmaan_stack/api/outflow_import/cashbook_lines.py` | `lock_line_if`, the row lock `_lock_pending_line` takes (moved out of `cashbook.py` after the sync commit; the same `SELECT ... FOR UPDATE` and status check) |
| any new unique index or advisory lock on expenses, `payment_ref` or Cashbook lines | changes rule 2 or 3 of the model |

**Sync commit: `f36a74ce`** (spec #1585 Phase 1 merged: #1586-#1589). At this commit the model's `phase1`
configs were confirmed against the code above, step by step. The `today*` configs describe the code before
Phase 1 (sync commit `cd1ce4e74`) and are kept on record. See whether the covered code moved since:

```bash
git log --oneline f36a74ce..HEAD -- nirmaan_stack/api/outflow_import/cashbook.py nirmaan_stack/api/outflow_import/expenses.py nirmaan_stack/services/outflow_import/skip_origin.py nirmaan_stack/services/outflow_import/sources.py nirmaan_stack/services/outflow_import/settle.py nirmaan_stack/services/outflow_import/candidates.py nirmaan_stack/api/outflow_import/card_create.py nirmaan_stack/nirmaan_stack/doctype/outflow_row_match/outflow_row_match.py nirmaan_stack/services/outflow_import/import_created_expense.py nirmaan_stack/api/outflow_import/cashbook_lines.py
```

Any commit listed means the model may no longer describe the code. Re-read the changed functions against
the step table below before trusting a result. Move the sync commit forward (edit it here) only after you
have confirmed that every step in the table still matches the code at the new commit.

## Run it

```bash
scripts/formal/cashbook_one_expense/run.sh            # the model: every config, about 45 s, exit 0 = all as expected
DEVENV up                                              # once per checkout; the race test needs a DB
DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_one_expense_race   # about 10 s
```

`DEVENV` is the dev-env script named in the local `CLAUDE.md`. `run.sh` downloads FizzBee v0.5.4 once
(checked by SHA-256) into `~/.cache/fizzbee/`, needs `curl` and `python3`, and writes nothing in the repo.
`run.sh phase1 today` runs only the named configs.

## Read the result

Each `.cfg` states its expected outcome on its first line. `run.sh` prints one row per config and exits 1 if
any row says `UNEXPECTED`. Expected at the sync commit:

```
 config                     expected  why
 today                      FAIL      the code before Phase 1, every scenario at once
 today_two_jobs             FAIL      gap A: two job runs on one batch
 today_person               FAIL      gap B: a person's Create/Link on a Pending line
 today_overlap              FAIL      gap C: two overlapping confirms at once
 today_crash_rerun          PASS      a crash, then a re-run after it, was safe before Phase 1
 phase1                     PASS      spec #1585 Phase 1 as built (A, B, C's index), every scenario at once; person Creates
 phase1_two_batches         PASS      two staged batches with one Txn Id, both jobs at once: C's index refuses the second
 phase1_link                FAIL      FINDING: C's index does not see a person's Link (see Findings 4)
```

`phase1` takes about 15 minutes (874 s at the sync commit, on contabo); the others take seconds.

The race test FAILED on the code before Phase 1 (both tests) and must PASS from the sync commit on: a red
race test is a regression. Its failure message lists the Txn Ids that got two expenses.

A FAIL prints the shortest bad sequence of steps, e.g. `today_person`:

```
Confirm#0.Plan, Confirm#0.StageAndEnqueue   statement staged: line 0 (T1), line 1 (T2), both Pending
Job#0.ListPendingLines                      the job lists lines 0 and 1 as Pending
Job#0.ReadLine, Job#0.WriteOne              line 0 -> expense for T1, commit
Person#0.OpenLine (l=1), CreateOrLink       a person creates line 1 by hand -> expense for T2
Job#0.ReadLine, Job#0.WriteOne              the job reads line 1 with no lock and no status check
                                            and creates T2 again: two expenses for T2
```

To tell it in the code's words, map each step through the table below. The full trace, with every
variable after each step, is in the log path `run.sh` prints.

### Real bug or modeling error?

An unexpected result is a real bug only if every step of the trace is something the code can do. Check:

1. Each step in the trace exists in the code at the line the step table names, with the same guard.
2. What the model treats as one step is one SQL statement or one transaction in the code. If the code now
   commits in the middle of what the model calls one step (or stopped committing), the model is wrong.
3. The database rules (below) still hold: Frappe still opens Postgres at REPEATABLE READ
   (`frappe/database/postgres/database.py`), `ofm_match_import_created_expense_unique` still exists with
   the same predicate, and no unique index covers `payment_ref`.
4. If the race test agrees with the model (red where the model fails), it is a real bug.

If a step does not match the code, fix the model and say so; never weaken `AtMostOneExpensePerTxnId` or
delete a scenario to make a config pass.

## How the model maps to the code

The database rules everything rests on (REPEATABLE READ):

1. A transaction reads a snapshot taken at its first statement, and never sees a commit made after it,
   **even one made while it waited for a lock**. Measured: `DEVENV script scripts/formal/cashbook_one_expense/probe_advisory_snapshot.py`
   prints `waiter sees 0` for both shapes.
2. An UPDATE or `SELECT ... FOR UPDATE` of a row another transaction changed after our snapshot raises a
   serialization failure (SQLSTATE 40001). Nothing else conflicts: inserting a second expense never does.
3. Phase 1 C (#1588): the partial unique index `ofm_match_import_created_expense_unique` refuses a second
   Settled, import-created Expense match row for one `transfer_id`. The match row goes in with its Expense,
   in one transaction, so the second create rolls back whole. A Link (`created_by_import` 0) is not covered.

⚠️ Only a connection's FIRST transaction runs at REPEATABLE READ. After a `frappe.db.commit()`, Frappe's
`START TRANSACTION` runs at the server default, READ COMMITTED (measured; `cashbook._lock_pending_line`'s
docstring), so the job's lines after the first run at READ COMMITTED. The model treats every transaction as
REPEATABLE READ. For the phase 1 job this changes no outcome: at READ COMMITTED the `FOR UPDATE` waits and
returns the line as the other writer left it, and the status check refuses it where the model's rule 2
does; `_mark_if_still_pending`'s `WHERE` likewise matches nothing; and rule 3 is a unique index, which
holds at any isolation level.

| Model step | Code | Indivisible because |
|---|---|---|
| `Job.ListPendingLines` | `cashbook.py:300` pending-lines query in `_cashbook_worker` | one statement; the job's first snapshot, shared with its first line |
| `Job.ReadLine` | `cashbook.py:415` start of the `FOR UPDATE` in `_lock_pending_line`, now taken by `cashbook_lines.lock_line_if` (before Phase 1: a plain `get_value`) | one statement; snapshot of each later line's transaction |
| `Job.LockLine` | phase 1 A, `cashbook.py:400` `_lock_pending_line`: 40001 or not `Pending match run` -> `None`, `_write_one` returns `False`, rollback | the `FOR UPDATE` returning (after any wait) |
| `Job.WriteOne` | `cashbook.py:429` `_write_one` + the commit at `:318` in `_cashbook_worker`; phase 1 C: the match insert refused by `ofm_match_import_created_expense_unique` | one transaction |
| `Job.MarkError` | phase 1: `cashbook.py:327` `_write_failed` -> `:368` `_mark_if_still_pending` (index refusal -> "Already imported" skip, else Error; the log commits first, on its own) | one statement + commit |
| `Job.Crash` | worker killed; Postgres rolls back | -- |
| `Confirm.Plan` | `cashbook.py:156` `_build_plan` (`:545`) -> `_already_imported` `:565`, `_already_booked` `:588` | reads one snapshot |
| `Confirm.StageAndEnqueue` | `cashbook.py:170-185`, `_stage` `:731`, `_enqueue_worker` `:270` | one transaction after `save_file`'s commit |
| `Person.OpenLine` | `expenses.py:1131` `_load_settleable_row` (gate B: `guard_not_an_own_import_line` `:1171` -> `skip_origin.own_import_refusal`) + `:1231` `_guard_money_not_recorded` | reads one snapshot |
| `Person.CreateOrLink` | `create_expense` `expenses.py:1017` (match row `created_by_import` 1: the index applies; refused -> `_refuse_as_already_imported` `:1084` -> `AlreadyImportedError`) / `settle_row` `:262` (writes `payment_ref`; match row `created_by_import` 0: the index does not apply) | one transaction |

`save_file` commits in production (`frappe_gcp_attachment` `file_upload_to_gcs` calls `frappe.db.commit()`),
so `_stage` runs in a new transaction. A dev env with the upload off does not commit there; the race test
patches `save_file` to commit, as production does.

## Bounds and what is NOT covered

Checked exhaustively within: 2 Txn Ids; up to 2 statements (one overlapping the other by one Txn Id);
2 job runs on batch 0 and 1 on batch 1; one person action; crashes and write errors at every step.
A pass covers this model at these bounds, not the system. Assumed or left out:

- A second job run may overlap the first (stronger than Frappe's dedupe, which is check-then-act).
- Line identity is the Txn Id alone; `_already_imported` also compares amount and date, so a repeat whose
  amount or date disagrees is staged again. That path is out of the model.
- Expenses keyed in by hand with the Txn Id, Partially Allocated lines, Allocate / Split, Unreconcile,
  Skip / Unskip, refunds and card spends are not modeled.
- Liveness (gap F: a crashed job's lines stay Pending until someone re-runs) is not checked, only safety.
- The race test forces one interleaving per scenario with a held snapshot; the model covers the rest.

## Findings at the sync commit

Measured at `f36a74ce` with `run.sh`: every config came out as expected (exit 0) -- `phase1` and
`phase1_two_batches` PASS, `phase1_link` FAILs as kept on record, the `today*` rows as in the table above.

1. **The code before Phase 1 booked a Txn Id twice** in gaps A, B and C (traces above; race test red). A
   crash plus a later re-run was safe; overlap is what broke it. The first line of a second job run is saved only by rule
   2, because the list and the first write share a transaction; every later line is written again.
2. **Spec #1585 Phase 1 as built passes every scenario it was asked to close** (`phase1`, at `f36a74ce`):
   A (`_lock_pending_line`, #1586), B (`own_import_refusal`, #1587) and C's index (#1588). #1589's Resume
   re-queues the same job under the same job id, which the model's two overlapping job runs on one batch
   already cover.
3. **Phase 1's job-side Txn Id lock (Implementation Decision C) does not do what it says at REPEATABLE READ.**
   The lock is taken inside the line's transaction, whose snapshot is older than the lock, so the re-check
   cannot see the expense the other holder committed while it waited (`phase1_two_batches`; probe). It is
   harmless only while the confirm lock keeps a Txn Id to one staged line. The fix must make the re-check
   read after the lock: a session-level lock, then a commit, then the line's transaction
   (a `phase1_two_batches_fixed` config, since removed), or a database-enforced key on the Txn Id. **Resolved (#1588):** the spec
   took the database key (C's partial unique index) and dropped the Txn Id lock and the confirm lock; the
   model's `phase1` now models the index, and `phase1_two_batches` passes. Breaking the index in the model
   (`index_refuses` -> `False`) turns `phase1_two_batches` red again (measured).
4. **C's index does not see a Link** (`phase1_link`, #1588). Confirms are no longer serialised, so two
   overlapping confirms can stage one Txn Id twice. If one of those lines becomes workable by hand (Error,
   or reopened) and a person Links it to an existing expense, the other line's job still creates the Txn Id:
   the Link's match row has `created_by_import` 0. The same happens with no race (a Link first, the job
   later). It is the spec's out-of-scope "hand-keyed Expense" case reached through a Link; `phase1` checks
   the person's Create only, and `phase1_link` keeps the Link scenario on record as a FAIL.

## When the code changes on purpose

- **Phase 1 landed (`f36a74ce`):** the `phase1*` configs describe the code, the step table was confirmed
  against it and the sync commit moved. Still to do: rename `today*.cfg` to `before_1585_*.cfg` (or delete
  them), and refresh the line numbers in `CashbookOneExpense.fizz`'s comments, which still name the code
  before Phase 1 (the step table above is current).
- **Another change:** edit the matching step in `CashbookOneExpense.fizz` (keep one step = one statement or
  one transaction), update the step table, run `run.sh`, and update the expected outcomes only when the
  change is meant to alter them. Before trusting a new PASS, break the guard it relies on and watch the
  config fail. Measured: `index_refuses` -> `False` fails `phase1_two_batches`. In the real code, removing
  the status re-check from a `FOR UPDATE`'d `_write_one` turns `TestTwoJobsOnOneBatch` red, and without
  the index `TestTwoOverlappingConfirms` is red.

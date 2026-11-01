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
| `nirmaan_stack/api/outflow_import/cashbook.py` | `confirm_cashbook_import`, `_cashbook_worker`, `_write_one`, `_build_plan`, `_already_imported`, `_already_booked`, `_booked_index`, `_stage` |
| `nirmaan_stack/api/outflow_import/expenses.py` | `create_expense`, `_settle_and_commit` (settle_row), `_load_settleable_row`, `guard_not_an_own_import_line`, `_guard_money_not_recorded` |
| `nirmaan_stack/services/outflow_import/sources.py` | `CREATE_GATED_SOURCES`, `line_waits_for_its_own_create` (phase 1 gate B lands here) |
| `nirmaan_stack/services/outflow_import/settle.py` | `create_expense_from_row` (writes `payment_ref`), the 1:1 Link `payment_ref` write |
| `nirmaan_stack/services/outflow_import/candidates.py` | `prior_import_sightings` (which stored lines count as already imported) |
| `nirmaan_stack/api/outflow_import/card_create.py` | `_create_one` -- the locking prior art the spec copies |
| `nirmaan_stack/doctype/outflow_row_match/outflow_row_match.py` | `ensure_settled_target_unique` -- it never fires for Cashbook, which is why this check exists |
| any new unique index or advisory lock on expenses, `payment_ref` or Cashbook lines | changes rule 2 of the model |

**Sync commit: `cd1ce4e74`.** At this commit the model's `today` configs were confirmed against the code above,
line by line. See whether the covered code moved since:

```bash
git log --oneline cd1ce4e74..HEAD -- nirmaan_stack/api/outflow_import/cashbook.py nirmaan_stack/api/outflow_import/expenses.py nirmaan_stack/services/outflow_import/sources.py nirmaan_stack/services/outflow_import/settle.py nirmaan_stack/services/outflow_import/candidates.py nirmaan_stack/api/outflow_import/card_create.py nirmaan_stack/doctype/outflow_row_match/outflow_row_match.py
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
 today                      FAIL      today's code, every scenario at once
 today_two_jobs             FAIL      gap A: two job runs on one batch
 today_person               FAIL      gap B: a person's Create/Link on a Pending line
 today_overlap              FAIL      gap C: two overlapping confirms at once
 today_crash_rerun          PASS      a crash, then a re-run after it, is safe today
 phase1                     PASS      spec #1585 Phase 1 as written, every scenario at once
 phase1_two_batches         FAIL      FINDING: Phase 1's Txn Id lock does not work at REPEATABLE READ
 phase1_two_batches_fixed   PASS      the same, with the re-check reading after the lock
```

The race test FAILS on today's code (both tests) and must PASS once Phase 1 lands. Its failure message
lists the Txn Ids that got two expenses.

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
3. The two database rules (below) still hold: Frappe still opens Postgres at REPEATABLE READ
   (`frappe/database/postgres/database.py`), and no unique index covers `payment_ref`.
4. If the race test agrees with the model (red where the model fails), it is a real bug.

If a step does not match the code, fix the model and say so; never weaken `AtMostOneExpensePerTxnId` or
delete a scenario to make a config pass.

## How the model maps to the code

The two database rules everything rests on (REPEATABLE READ):

1. A transaction reads a snapshot taken at its first statement, and never sees a commit made after it,
   **even one made while it waited for a lock**. Measured: `DEVENV script scripts/formal/cashbook_one_expense/probe_advisory_snapshot.py`
   prints `waiter sees 0` for both shapes.
2. An UPDATE or `SELECT ... FOR UPDATE` of a row another transaction changed after our snapshot raises a
   serialization failure (SQLSTATE 40001). Nothing else conflicts: inserting a second expense never does.

| Model step | Code | Indivisible because |
|---|---|---|
| `Job.ListPendingLines` | `cashbook.py:237` pending-lines query | one statement; the job's first snapshot, shared with its first line |
| `Job.ReadLine` | `cashbook.py:271` `get_value` (today); start of the `FOR UPDATE` (phase 1) | one statement; snapshot of each later line's transaction |
| `Job.LockLine` | phase 1 A, like `card_create.py:143` | the `FOR UPDATE` returning (after any wait) |
| `Job.LockTxnId` | phase 1 C, `pg_advisory_xact_lock(Txn Id)` | one statement; does not refresh the snapshot |
| `Job.RecheckBooked` | phase 1 C, "no expense with that payment reference" | one SELECT, from the snapshot |
| `Job.WriteOne` | `cashbook.py:284-336` + commit at `:250` | one transaction |
| `Job.MarkError` | `cashbook.py:252-263` (blind today; "where still Pending" in phase 1) | one statement + commit |
| `Job.Crash` | worker killed; Postgres rolls back | -- |
| `Confirm.TakeConfirmLock` | phase 1 C session advisory lock + commit | one statement + commit |
| `Confirm.Plan` | `cashbook.py:146` `_build_plan` -> `_already_imported` `:401`, `_already_booked` `:424` | reads one snapshot |
| `Confirm.StageAndEnqueue` | `cashbook.py:160-183`, `_stage` `:567`, enqueue | one transaction after `save_file`'s commit |
| `Person.OpenLine` | `expenses.py:1091` `_load_settleable_row` + `:1187` `_guard_money_not_recorded` | reads one snapshot |
| `Person.CreateOrLink` | `create_expense` `:994` / `settle_row` (writes `payment_ref`, `settle.py:643`) | one transaction |

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

1. **Today's code books a Txn Id twice** in gaps A, B and C (traces above; race test red). A crash plus a
   later re-run is safe; overlap is what breaks it. The first line of a second job run is saved only by rule
   2, because the list and the first write share a transaction; every later line is written again.
2. **Spec #1585 Phase 1 passes every scenario it was asked to close** (`phase1`). A scratch Phase 1 in the
   real code (`FOR UPDATE` + status re-check in `_write_one`, a 40001 skipped as "another run took it",
   the confirm lock + commit) turned both race tests green; it was dropped afterwards.
3. **Phase 1's job-side Txn Id lock (Implementation Decision C) does not do what it says at REPEATABLE READ.**
   The lock is taken inside the line's transaction, whose snapshot is older than the lock, so the re-check
   cannot see the expense the other holder committed while it waited (`phase1_two_batches`; probe). It is
   harmless only while the confirm lock keeps a Txn Id to one staged line. The fix must make the re-check
   read after the lock: a session-level lock, then a commit, then the line's transaction
   (`phase1_two_batches_fixed`), or a database-enforced key on the Txn Id.

## When the code changes on purpose

- **Phase 1 lands:** the `phase1*` configs now describe the code. Confirm each phase 1 step in the table
  against the new code, rename `today*.cfg` to `before_1585_*.cfg` (or delete them), make the race test a
  required pass, and move the sync commit.
- **Another change:** edit the matching step in `CashbookOneExpense.fizz` (keep one step = one statement or
  one transaction), update the step table, run `run.sh`, and update the expected outcomes only when the
  change is meant to alter them. Before trusting a new PASS, break the guard it relies on and watch the
  config fail. Phase 1's guards overlap: dropping only `LockLine`'s status check still passes, because
  `RecheckBooked` catches the same case. Breaks that do fail `phase1` (measured): `TakeConfirmLock` no
  longer waits (`require confirm_lock == ""` -> `pass`); or both the status check and `RecheckBooked`
  removed. In the real code, removing the status re-check from a `FOR UPDATE`'d `_write_one` turns
  `TestTwoJobsOnOneBatch` red.

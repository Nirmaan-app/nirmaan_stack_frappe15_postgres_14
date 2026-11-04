---
name: cashbook-one-expense
description: Formal check that the Cashbook (petty-cash wallet) import never books one wallet Txn Id as two expenses, across job crashes and re-runs, two job runs on one batch, a person's Create/Link on a line the job still holds, two overlapping statements confirmed at once, open Collect payment lines and re-opened own-balances skips. A FizzBee model of every interleaving plus a real two-connection race test. Use before changing or reviewing api/outflow_import/cashbook.py, cashbook_reopen.py, the Cashbook paths of expenses.create_expense / settle_row / link_lines.link_rows_to_expense, the one-Expense-per-Txn-Id index, their locking, or spec #1585 work.
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
| `nirmaan_stack/api/outflow_import/cashbook.py` | `confirm_cashbook_import`, `resume_cashbook_import`, `_enqueue_worker`, `_cashbook_worker`, `_lock_pending_line`, `_write_one`, `_write_failed`, `_mark_if_still_pending`, `_plan_claiming_reopens`, `_build_plan`, `_already_imported`, `_already_booked`, `_booked_index`, `_stage` |
| `nirmaan_stack/api/outflow_import/cashbook_lines.py` | `lock_line_if` (the row lock `_lock_pending_line` and the re-open claim take), `line_values` (which status a staged line gets: `Pending match run` for a spend, open `Mismatched` for a Collect payment) |
| `nirmaan_stack/api/outflow_import/cashbook_reopen.py` | `wrong_skips`, `claim_reopens`, `reopen_lines` -- #1596 re-opens an earlier own-balances skip in place, never to `Pending match run` |
| `nirmaan_stack/api/outflow_import/cashbook_bills.py` | `copy_created_line_bills`, `attach_late_bills`, `store_collect_bills` / `_set_stored_bill` -- checked, not modelled: they write an Expense's invoice and a line's `stored_bill` / `bill_problem`, never an Expense, a `payment_ref` or a `row_status` |
| `nirmaan_stack/api/outflow_import/expenses.py` | `create_expense`, `_refuse_as_already_imported`, `already_imported_sentence`, `refuse_link_of_a_held_txn_id`, `settle_row` / `_settle_and_commit`, `_load_settleable_row`, `guard_not_an_own_import_line`, `guard_collect_payment_choice`, `_guard_money_not_recorded` |
| `nirmaan_stack/api/outflow_import/link_lines.py` | `link_rows_to_expense`, `_load_linkable_row` -- the second hand-Link path |
| `nirmaan_stack/services/outflow_import/row_settlement.py` | `record_settlement`, `line_source` -- the hand Create / Link match row and its `source`, which C's index reads |
| `nirmaan_stack/services/outflow_import/cashbook.py` | `plan_statement`, `_decide` (a Collect payment opens, never creates) |
| `nirmaan_stack/services/outflow_import/cashbook_reopen.py` | `claim_wrong_skips`, `earlier_sightings` (a re-opening line is not a repeat) |
| `nirmaan_stack/services/outflow_import/skip_origin.py` | `own_import_refusal` -- phase 1 gate B: a Cashbook line is refused by hand while `Pending match run` |
| `nirmaan_stack/services/outflow_import/sources.py` | `CASHBOOK_SOURCE`, `CREATE_GATED_SOURCES`, `line_waits_for_its_own_create` |
| `nirmaan_stack/services/outflow_import/settle.py` | `create_expense_from_row` (writes `payment_ref`), the 1:1 Link `payment_ref` write |
| `nirmaan_stack/services/outflow_import/candidates.py` | `prior_import_sightings` (which stored lines count as already imported: every status) |
| `nirmaan_stack/api/outflow_import/card_create.py` | `_create_one` -- the locking prior art the spec copies |
| `nirmaan_stack/nirmaan_stack/doctype/outflow_row_match/outflow_row_match.py` | `ensure_one_import_created_expense_per_transfer` (rule 3's index); `ensure_settled_target_unique` never fires for a Cashbook create |
| `nirmaan_stack/services/outflow_import/import_created_expense.py` | `IMPORT_CREATED_EXPENSE_INDEX`, `IMPORT_CREATED_EXPENSE_PREDICATE`, `is_import_created_expense_refusal`, `import_created_expense_holding` |
| any new unique index or advisory lock on expenses, `payment_ref` or Cashbook lines; any new writer of an Expense, a `payment_ref`, an `Outflow Row Match` or a Cashbook line's `row_status` | changes a rule or a step of the model |

**Sync commit: `5830c8599`** (spec #1585 through #1601 and its review fixes, on `spec/1585`). At this commit
every `phase1*` config was confirmed against the code above, step by step. The `before_1585*` configs describe
the code before Phase 1 (`cd1ce4e74`) and are kept on record. See whether the covered code moved since:

```bash
git log --oneline 5830c8599..HEAD -- nirmaan_stack/api/outflow_import/cashbook.py nirmaan_stack/api/outflow_import/cashbook_lines.py nirmaan_stack/api/outflow_import/cashbook_reopen.py nirmaan_stack/api/outflow_import/cashbook_bills.py nirmaan_stack/api/outflow_import/expenses.py nirmaan_stack/api/outflow_import/link_lines.py nirmaan_stack/services/outflow_import/row_settlement.py nirmaan_stack/services/outflow_import/cashbook.py nirmaan_stack/services/outflow_import/cashbook_reopen.py nirmaan_stack/services/outflow_import/skip_origin.py nirmaan_stack/services/outflow_import/sources.py nirmaan_stack/services/outflow_import/settle.py nirmaan_stack/services/outflow_import/candidates.py nirmaan_stack/api/outflow_import/card_create.py nirmaan_stack/nirmaan_stack/doctype/outflow_row_match/outflow_row_match.py nirmaan_stack/services/outflow_import/import_created_expense.py
```

Any commit listed means the model may no longer describe the code. Re-read the changed functions against
the step table below before trusting a result. Move the sync commit forward (edit it here) only after you
have confirmed that every step in the table still matches the code at the new commit.

## Run it

```bash
scripts/formal/cashbook_one_expense/run.sh            # the model: every config, exit 0 = all as expected
DEVENV up                                              # once per checkout; the race test needs a DB
DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_one_expense_race   # about 10 s
```

`DEVENV` is the dev-env script named in the local `CLAUDE.md`. `run.sh` downloads FizzBee v0.5.4 once
(checked by SHA-256) into `~/.cache/fizzbee/`, needs `curl` and `python3`, and writes nothing in the repo.
`run.sh phase1 before_1585` runs only the named configs. The configs run in parallel, so the run lasts as long
as `phase1`: about 4 minutes on an Apple-silicon Mac, about 15 on contabo. Run it in the background.

## Read the result

Each `.cfg` states its expected outcome on its first line. `run.sh` prints one row per config and exits 1 if
any row says `UNEXPECTED`. Expected at the sync commit:

```
 config                     expected  why
 before_1585                FAIL      the code before Phase 1, every scenario at once
 before_1585_two_jobs       FAIL      gap A: two job runs on one batch
 before_1585_person         FAIL      gap B: a person's Create/Link on a Pending line
 before_1585_overlap        FAIL      gap C: two overlapping confirms at once
 before_1585_crash_rerun    PASS      a crash, then a re-run after it, was safe before Phase 1
 phase1                     PASS      spec #1585 Phase 1 as built (A, B, C's index), every scenario at once; person Creates
 phase1_two_batches         PASS      two staged batches with one Txn Id, both jobs at once: C's index refuses the second
 phase1_link                PASS      a person's Link of a Txn Id's twin line while the other job creates it (#1601)
 phase1_link_before_1601    FAIL      the same on #1588's index as first built, which did not see a Link (Findings 4)
 phase1_open                PASS      #1595: twin open Collect lines, two people Creating; a spend's Error line Linked
 phase1_reopen              PASS      #1596: two confirms re-opening one own-balances skip, two people Creating on it
```

`phase1` takes 257 s on an Apple-silicon Mac at the sync commit (874 s on contabo at `f36a74ce`); the others
take seconds.

The race test FAILED on the code before Phase 1 (its first two classes), and `TestALinkAndAJobOnOneTxnId`
FAILED before #1601 (`ee069d11c`, red on purpose). All 5 tests PASS from the sync commit on (measured on env
`spec-1585`): a red race test is a regression. Its failure message lists the Txn Ids that got two expenses.

A FAIL prints the shortest bad sequence of steps, e.g. `before_1585_person`:

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
   the predicate `import_created_expense.IMPORT_CREATED_EXPENSE_PREDICATE` (Settled, an Expense target, and
   `created_by_import = 1 OR source = 'Cashbook'`), every writer of a Cashbook line's match row still sets
   `source` from the line, and no unique index covers `payment_ref`.
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
3. Phase 1 C (#1588), widened by #1601: the partial unique index `ofm_match_import_created_expense_unique`
   refuses a second Settled Expense match row for one `transfer_id` among rows the import CREATED (any
   source) or of a Cashbook line (`Outflow Row Match.source` 'Cashbook', so a person's Link too). The match
   row goes in with its Expense (or its Link's `payment_ref` write), in one transaction, so the second write
   rolls back whole. In the model: `index_rows`; `LINK_HOLDS_TXN_ID` False is the index before #1601. The
   owner accepted (2026-11-03) that the index keys on the Txn Id alone, so a Cashbook Link is also refused
   when another source's created Expense holds the same Txn Id.

⚠️ Only a connection's FIRST transaction runs at REPEATABLE READ. After a `frappe.db.commit()`, Frappe's
`START TRANSACTION` runs at the server default, READ COMMITTED (measured; `cashbook._lock_pending_line`'s
docstring), so the job's lines after the first run at READ COMMITTED. The model treats every transaction as
REPEATABLE READ. For the phase 1 job this changes no outcome: at READ COMMITTED the `FOR UPDATE` waits and
returns the line as the other writer left it, and the status check refuses it where the model's rule 2
does; `_mark_if_still_pending`'s `WHERE` likewise matches nothing; and rule 3 is a unique index, which
holds at any isolation level.

Line numbers are at the sync commit. A line's status in the model: `Pending` (`Pending match run`), `Open`
(`Mismatched`, an open line), `Settled`, `Error`, `Skipped`, `OwnSkip` (Skipped as own balances, #1596).

| Model step | Code | Indivisible because |
|---|---|---|
| `Job.ListPendingLines` | `cashbook.py:360` pending-lines query in `_cashbook_worker` (`:329`); the `bill_work` and statement-URL reads before it share its snapshot | one statement; the job's first snapshot, shared with its first line |
| `Job.ReadLine` | the start of the `FOR UPDATE` in `cashbook_lines.lock_line_if` (`:48`), called by `_lock_pending_line` (before Phase 1: a plain `get_value`, `cashbook.py:271` at `cd1ce4e74`) | one statement; snapshot of each later line's transaction |
| `Job.LockLine` | phase 1 A, `cashbook.py:466` `_lock_pending_line`: 40001 or not `Pending match run` -> `None`, `_write_one` returns `False`, rollback | the `FOR UPDATE` returning (after any wait) |
| `Job.WriteOne` | `cashbook.py:488` `_write_one` (match insert `:548`, `source` 'Cashbook', `created_by_import` 1) + the commit at `:378`; phase 1 C: the match insert refused by the index. Then `cashbook_bills.copy_created_line_bills` (`:379`) in transactions of its own: no step, it writes only the Expense's invoice and the line's `bill_problem` | one transaction |
| `Job.MarkError` | phase 1: `cashbook.py:393` `_write_failed` -> `:434` `_mark_if_still_pending` (index refusal -> "Already imported" skip, else Error; the log commits first, on its own) | one statement + commit |
| `Job.Crash` | worker killed; Postgres rolls back. (After its lines the job copies late and Collect bills, `attach_late_bills` / `store_collect_bills`: no step, see below) | -- |
| `Confirm.Plan` | `cashbook.py:166` `_plan_claiming_reopens` (`:642`) -> `_build_plan` (`:671`) -> `_already_imported` `:695` (every stored line of the Txn Id), `_already_booked` `:718`, `cashbook_reopen.wrong_skips` (`:46`); `services/outflow_import/cashbook.py` `plan_statement` / `claim_wrong_skips`: a Collect payment on an own-balances skip re-opens it | reads one snapshot |
| `Confirm.StageAndEnqueue` | `save_file` `cashbook.py:182`, the re-open claim again `:185` (`cashbook_reopen.claim_reopens` `:105`, row locks to the commit), `_stage` `:898` (`cashbook_lines.line_values`: a spend `Pending match run`, a Collect payment `Mismatched`; `cashbook_reopen.reopen_lines` `:76` writes the claimed line), commit `:208`, `_enqueue_worker` `:317` | one transaction after `save_file`'s commit |
| `Person.OpenLine` | `expenses.py:1174` `_load_settleable_row` / `link_lines.py:184` `_load_linkable_row` (gate B: `guard_not_an_own_import_line` `expenses.py:1217` -> `skip_origin.own_import_refusal`) + `expenses.py:1297` `_guard_money_not_recorded` | reads one snapshot |
| `Person.CreateOrLink` | Create: `create_expense` `expenses.py:1057` -> `row_settlement.record_settlement` (`:41`, `source` from `line_source` `:107`; `created_by_import` 1); refused -> `_refuse_as_already_imported` `expenses.py:1127`. Link: `settle_row` `expenses.py:298` / `link_lines.link_rows_to_expense` `:65` (writes `payment_ref`; match row `created_by_import` 0, `source` 'Cashbook'); refused -> `refuse_link_of_a_held_txn_id` `expenses.py:223` (`AlreadyImportedError` naming the holder). A Collect line refuses Link (`guard_collect_payment_choice` `expenses.py:1239`) | one transaction |

Checked and not modelled, because each can only refuse or delay a write, never add an Expense:
`cashbook_bills._set_stored_bill` UPDATEs an open Collect line's `stored_bill` under its row lock, so a
person whose snapshot predates it loses the race (rule 2) and tries again; `_attach_invoice` saves an
Expense's `invoice_attachment` only. When confirm re-opens, it plans again after `save_file`; that later read
can only see more lines and expenses, so it stages no Txn Id the model's `Plan` did not.

`save_file` commits in production (`frappe_gcp_attachment` `file_upload_to_gcs` calls `frappe.db.commit()`),
so `_stage` runs in a new transaction. A dev env with the upload off does not commit there; the race test
patches `save_file` to commit, as production does.

## Bounds and what is NOT covered

Checked exhaustively within: 2 Txn Ids; up to 2 statements (one overlapping the other by one Txn Id);
2 job runs on batch 0 and 1 on batch 1; one person action (two people, one action each, in `phase1_open` and
`phase1_reopen`); crashes and write errors at every step (no crash in the link, open and reopen configs).
A pass covers this model at these bounds, not the system. Assumed or left out:

- A second job run may overlap the first (stronger than Frappe's dedupe, which is check-then-act).
- Line identity is the Txn Id alone; `_already_imported` also compares amount and date, so a repeat whose
  amount or date disagrees is staged again (and a lost re-open claim then stages a new line). That path is
  out of the model; C's index is what stands behind it.
- Expenses keyed in by hand with the Txn Id, Partially Allocated lines, Allocate / Split, Unreconcile (which
  frees the index's key), Skip / Unskip, refunds and wallet credits (money in, never an Expense), card spends,
  and a Link of two twin lines in one `link_rows_to_expense` call (the index refuses the second match row, so
  it books nothing twice) are not modeled.
- Liveness (gap F: a crashed job's lines stay Pending until someone re-runs; a bill copy still owed) is not
  checked, only safety.
- The race test forces one interleaving per scenario with a held snapshot; the model covers the rest. It
  measured that every match insert takes the `OFM-.YY.-` naming-series row `FOR UPDATE`, so two transactions
  that overlap and both insert a match row are serialised by accident (the later one fails with a
  serialization failure). The model does not rely on it: every write is one atomic step, so the double
  booking it looks for needs one write to commit before the other's transaction begins, which the naming
  series does not stop. The race test has no case for an open Collect line or a re-open; the model has.

## Findings at the sync commit

Measured at `5830c8599` with `run.sh`: every config came out as expected (exit 0), and the race test passed
5 of 5 on env `spec-1585`.

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
4. **C's index did not see a Link** (#1588; **closed by #1601**). Confirms are not serialised, so two
   overlapping confirms can stage one Txn Id twice. If one of those lines became workable by hand (Error,
   or reopened) and a person Linked it to an existing expense, the other line's job still created the Txn Id:
   the Link's match row had `created_by_import` 0. #1601 widened the index to a Cashbook line's Link
   (`source` 'Cashbook'): `phase1_link` now PASSES, and `phase1_link_before_1601`, the same config with
   `LINK_HOLDS_TXN_ID` False, FAILS as kept on record. Race test: `TestALinkAndAJobOnOneTxnId`, red at
   `ee069d11c`, green from #1601.
5. **Open lines and re-opens (#1594-#1596) book nothing twice** (`phase1_open`, `phase1_reopen`). Confirm now
   stages a Collect payment as an open line that only a person decides, and re-opens an earlier own-balances
   skip in place. Twin open lines from two overlapping confirms are each Created by a person; C's index
   refuses the second. Breaks, measured: `index_refuses` -> `False` turns `phase1_open`, `phase1_link` and
   `phase1_two_batches` red; `phase1_reopen` stays green without the index (the claim keeps one line, and two
   people on one line meet rule 2), and goes red only when the re-open also stages a new line for its Txn Id.

## When the code changes on purpose

- **Edit the matching step** in `CashbookOneExpense.fizz` (keep one step = one statement or one transaction),
  update the step table and its line numbers, run `run.sh`, and update the expected outcomes only when the
  change is meant to alter them. A new status a line can be staged at, or a new writer of an Expense or a
  match row, needs a step or a config of its own (as #1595's open lines got `COLLECT` and `phase1_open`).
- **Before trusting a new PASS, break the guard it relies on and watch the config fail.** Measured:
  `index_refuses` -> `False` fails `phase1_two_batches`, `phase1_link` and `phase1_open`. In the real code,
  removing the status re-check from a `FOR UPDATE`'d `_write_one` turns `TestTwoJobsOnOneBatch` red, and
  without the index `TestTwoOverlappingConfirms` is red; before #1601's widened predicate
  `TestALinkAndAJobOnOneTxnId` was red.

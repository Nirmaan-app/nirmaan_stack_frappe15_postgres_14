# 22. Unreconcile and unskip

Date: 2026-09-15

## Status

**Accepted** (owner grilling session 2026-09-15, Q1–Q19; spec #1270). Being built in slices; this
record grows with them. Built so far: the one decision module and write path (#1271), one-line
matching (#1272), Skip by hand with a skipped-by-hand marker (#1273), Unskip (#1274), **Unreconcile for
Project Payments (#1275)** and its **post-write clean-up** (#1276: vendor credit, CEO Hold, latest payment
date, statement file), **Unreconcile for existing expenses (#1277)** and **Unreconcile for records the
import created (#1278)**. Still to come: part-payment un-split, Confirm by hand.

As-built detail: `.claude/context/domain/outflow-import.md` § *#1271*, *#1272*, *#1273*, *#1274*, *#1275*,
*#1276*, *#1277*, *#1278*.
Approved mockups: https://claude.ai/artifact/K6vEJXGoALunzfdqTfrVVt

## Context

On Bulk Import Transactions nothing an accountant does can be taken back from the screen:

- a matched line can never be un-matched, for any kind of match — the only undo reverses one payment
  leg, and only while the line is Partially Allocated;
- a person cannot skip a line that has nothing to link, because the Skip button is hidden;
- a skipped line — skipped by the system or by a person — cannot be brought back. The documented fix
  is an admin editing the row in Desk, which leaves the import's status stale and silently releases
  duplicate claims.

## Decision

Three actions on the screen — **Unreconcile**, **Skip** and **Unskip** — each on one line at a time,
each with a typed reason, each available only to **Admin and Accountant Lead**.

### Rulings this reverses

Recorded so later work does not bring "no undo" back by mistake.

| Ruling | Where | What replaces it |
|---|---|---|
| **Q9 — no undo of a settle from inside the import** | Bulk Import Outflow owner rulings; domain doc | **reversed by #1275 for Project Payments, and by #1277 for existing expenses**: Unreconcile, per record or Reverse all, all-or-nothing |
| **AR3 — an import-created inflow cannot be undone** | [ADR-0016](0016-bank-statement-import-creates-inflows.md) | **reversed by #1278**: an untouched import-created record (Project Inflow, Non-Project Inflow, or an expense the import created) is deleted by Unreconcile |
| **R6 — `SHOW_SKIP_ROW` stays off; a line with nothing to link has no manual terminal state** | [ADR-0016](0016-bank-statement-import-creates-inflows.md) | **reversed by #1273**: the "Nothing to link?" Skip box |
| **The 2026-08-10 hidden-skip ruling** (`DecisionDialog.tsx`, "hidden, not deleted") | owner ruling, 2026-08-10 | **reversed by #1273**: `SHOW_SKIP_ROW` is deleted |
| **A split payment is refused outright; only payments can be reversed** (B2, "reverse is payments only") | [ADR-0020](0020-one-transfer-many-payments.md) | **the payments-only half is reversed by #1277**: an existing Project Expense or Non-Project Expense reverts to Approved. Still to come: an untouched part payment is un-split |
| **Skips are final** | domain doc (several places); `expenses.SKIPPED_ROW_REFUSAL` ("correct it in Desk") | **reversed by #1274, for hand skips only**: Unskip from the Skipped popup; a system skip stays final |

### Access (Q1)

A second, narrower check, `permissions.require_outflow_undo_access`: the `Administrator` user, `Nirmaan
Admin Profile`, `Nirmaan Accountant Lead Profile`. It is **layered on** the module check — someone
outside the module reads the module's sentence — the Pricing Module's read/write split. It guards Skip,
Unskip, Unreconcile and the existing single-leg Reverse. A plain Accountant keeps matching and
confirming. The frontend mirrors the set (`outflowImportStatus.OUTFLOW_UNDO_PROFILES`) for convenience
only, pinned by `outflowUndoAccessParity.test.ts`.

### Skip by hand, and who skipped (Q7, Q8, Q16, Q17) — built at #1273

- `Outflow Import Row.skip_origin` — blank / **System** / **Manual**. **Only a Manual skip may ever be
  unskipped.** A system skip is a duplicate, money the bank never moved, an exclusion rule or a repeat
  of an earlier statement; bringing one back is how the same money gets recorded twice.
- **Every skip the software derives is System** — a property of `status.RowOutcome`, so upload
  staging, the gateway match run and the ICICI contains-guard cannot land a skip without it; the
  Cashbook writer stamps it too. **Manual is written in exactly one place**, `review.skip_row`.
- `skip_row` refuses any line that is not open (**including an already Skipped line**, which the old
  endpoint accepted and which would have relabelled a system skip as a hand skip) and any Cashbook
  line. It locks the line, saves through the document layer (a Version row), makes the typed reason the
  line's displayed note, and adds a comment.
- **Back-fill (Q17):** `patches/v3_0/backfill_outflow_skip_origin.py`. Manual only when a person is on
  the line, neither note is a system skip sentence, the line is not Cashbook, **and the bank says the
  transfer succeeded**. The last condition is added to the spec's rule on purpose: a refused transfer
  re-skipped by hand lost its sentence to the typed reason, and would otherwise become unskippable
  (story 59). Every doubt resolves to System.

### Unskip (Q8, Q9) — built at #1274

- `review.unskip_row(row, reason)`, undo access, one line. Refused unless the line is **Skipped**, its
  source is **not Cashbook**, and `skip_origin` is **Manual** (`skip_origin.unskip_refusal`; a blank
  origin is refused like System).
- Through the document layer, back to `Pending match run`, clearing `skip_origin`, `skip_reason`,
  `outcome_note`, the decision stamps and `duplicate_basis`; a comment carries the reason. Then the
  matcher re-checks **that one line** (`match_line`, #1272) **in the same transaction**, which also
  refreshes the import's rollup, so a Completed import reopens.
- It lands Not-Matched, Matched (with its suggestion), or **skipped again as System** when the money was
  recorded since — and a System skip can never be unskipped, so Unskip cannot open a duplicate path.
- A released line's duplicate claim goes with it: a claim is only read off a Skipped line.
- The Skipped popup shows an Unskip column to the undo roles: live for a hand skip, disabled with the
  cause in words for every other line; the result notice is built from the re-check's answer.

### Unreconcile a Project Payments line (Q4, Q6, Q10, Q13, Q18) — built at #1275

- Two endpoints, undo access: **`get_unreconcile_plan(row)`** (read only — each Settled leg's verdict, its
  "what happens" sentence or its refusal) and **`unreconcile_row(row, legs | "all", reason)`** (the one write;
  `reverse_allocation` wraps it). The write re-reads every fact under its locks; the plan is never trusted.
- Covers a confirmed suggestion, a hand Link and a Split: each payment goes `Paid -> Approved` with UTR and
  payment date cleared, each leg is stamped Reversed (kept, ADR-0020 D3), and the line is re-derived — open
  again, keeping its previous suggestion — or Partially Allocated when legs remain.
- **All or nothing:** one refused leg in a Reverse all writes nothing and returns that leg's sentence; the
  screen turns Reverse all off in advance with "Reverse all is off because one record can't be undone.
  Nothing changes unless every record can be undone."
- **Cashbook** is refused by the decision module first ("Cashbook rows can't be unreconciled yet."), and the
  table shows that sentence instead of the button.
- **Audit:** `Outflow Row Match` now tracks changes, so the reversed leg has a Version row beside the
  payment's; the line gets a comment naming who, why and which records came off.
- **TDS on Approved (owner ruling):** putting a Service Request payment back to Approved may withhold TDS and
  net its amount. That is left as it is; the response reports `amount_after` and the notice states the new
  figure. Recorded under Known limits in the domain doc.

### Unreconcile an existing expense (Q4, Q6) — built at #1277

- **ADR-0020 B2's "reverse is payments only" is reversed.** Its allocation half — a Split lists payments
  only — is unchanged.
- New verdict **`revert_expense`** for a Settled leg on a `Project Expenses` / `Non Project Expenses` record
  the import did not create: `Paid -> Approved`, payment date and payment reference cleared, and "paid by"
  cleared on a Project Expense (Non-Project Expenses has no such field). Through `doc.save()`, so the
  Version row and the cashflow hook still happen; the statement attachment and its `File` row come off as
  for payments, and a Project Expense's project has its cashflow-gap hold re-synced once, after every write.
- **Refusals** ("Changed elsewhere", fix on the Expenses screen): the amount differs from the leg's, the
  status is no longer Paid, or the payment reference is not one of the line's settlement references.
- **An expense the import created must be deleted, never put back to Approved** — built at #1278 (below),
  which **replaced the proof rule that follows with the stored flag**. As built at #1277: until the stored
  "created by the import" flag exists, an expense counts as existing ONLY ON PROOF,
  and anything unproven is refused as "can't be undone yet". Proof is either (a) the expense is older than
  the statement upload, or (b) a Version row dated no later than the match shows its status was once not
  Paid. Both are impossible for a created expense: the import inserts it already Paid, and an insert writes
  no Version row. The bound in (b) matters — a created expense edited Paid -> Approved -> Paid after the
  match would otherwise read as existing. **Accepted cost:** an existing expense settled before slice X1
  (when the settle wrote with `set_value` and left no Version) and younger than its upload stays refused
  until the stored flag arrives.
- The dialog line reads "Goes back to Approved. Payment date, reference and 'paid by' are cleared." on a
  Project Expense, and "Goes back to Approved. Payment date and reference are cleared." on a Non-Project
  Expense, which has no "paid by" to clear.

### Unreconcile a record the import created (Q4, Q6) — built at #1278

- **ADR-0016 AR3 ("an import-created inflow cannot be undone") is reversed.**
- **Which records are "created":** `Outflow Row Match.created_by_import`, a stored Check written in the
  leg's insert by every Create path (create expense, create inflow, create non-project inflow) and the
  Cashbook writer, and frozen with every other field. **An inflow leg is always treated as created**,
  whatever its flag — the import has no other way to reach an inflow. Older expense legs are back-filled by
  `patches/v3_0/backfill_outflow_match_created_flag.py`: created only when the expense was written within a
  minute before its leg, by the leg's own user, is not older than the upload, and no Version up to the match
  shows it was ever not Paid. **Unresolved stays "not created" — the safe revert path.** On the local
  database this split 237 legs cleanly: 222 created (0–5 s, same user, no Version), 15 hand Links (minutes to
  days older, with a Version); the patch prints its counts so production can be read the same way.
- **The stored flag replaces #1277's proof rule.** An unflagged expense now reverts to Approved even with no
  history to prove it existed — including the "settled before X1, younger than its upload" case that #1277
  accepted as refused.
- New verdict **`delete_created`**: the record is deleted with `frappe.delete_doc(force=True)` — the kept
  Reversed leg's Dynamic Link would otherwise block it. **The leg is never deleted** (ADR-0020 D3); it is
  stamped Reversed *before* the delete, since its save checks the link.
- **Refused when someone edited it after the import made it:** a Version dated after the leg's match that
  changes any field other than the statement attachment the import writes (`payment_attachment`,
  `inflow_attachment`). Not the `modified` timestamp — the post-commit statement link and receipt adoption bump
  it. "Someone edited it on <date>, after the import made it. Delete or fix it on its own screen."
- **Three things the delete must not disturb:**
  - **The statement file.** Frappe deletes a record's attached `File` rows through the document layer, and
    the cloud attachment app's `on_trash` deletes the blob by `content_hash` — the import batch's statement,
    shared by everything that batch settled. The statement's link rows come off by raw delete *first*.
  - **The record's name.** Deleting the newest record of a naming series winds the counter back, so the
    next record would take the deleted one's name and the kept leg would point at a different, live record.
    The counter is put back after the delete.
  - **CEO Hold.** A Project Inflow's trash hook evaluates the gap before the row is gone; the project is
    re-synced once, after every write.
- **Re-recording a credit:** the "already created by the import" check counts Settled legs only, so a credit
  whose inflow was unreconciled can be recorded again.
- The dialog line is red: "Will be deleted." — plus "The project's cash position updates straight away." for
  a Project Inflow.

## Consequences

- A hand skip is reversible from the screen, and so is its reversal auditable (Version row, comment).
  A system skip still is not: "Not a duplicate" overrides stay out of scope.
- A hand skip is now an audited decision (Version row, comment, who and when) rather than two
  overwritable columns.
- **Known limit of the back-fill:** an OLD upload skip for a repeat or an exclusion that was later
  re-skipped by hand kept no trace of its first sentence and back-fills as Manual. On the dev database
  that shape does not occur (7 Manual, all genuine; 1,945 System). The patch prints its counts so
  production can be checked.
- `get_outflow_summary` now reports two related counts that differ on purpose: `manually_skipped_rows`
  (keys on a decider) and `skipped_by_hand_rows` (keys on `skip_origin = Manual`, what can be unskipped).

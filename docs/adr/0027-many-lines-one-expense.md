# ADR-0027 — Many bank lines settle one expense

- **Status:** Accepted, not built (owner grilling 2026-09-15 → 2026-09-17, Q3–Q22 and R1–R4; design confirmed 2026-09-17)
- **Date:** 2026-09-17
- **Amends:** [ADR-0020](0020-one-transfer-many-payments.md) D1 and B2, for expenses only
- **Feature:** Bulk Import Transactions (`outflow_import`)
- **Spec:** #1295
- **Approved mockups:** https://claude.ai/artifact/BYhxrcbkM12Us4XipJ3AJP

---

## Context

An ICICI salary or reimbursement run arrives as **N bank lines, one per employee**. The only thing
that ties them together is a bulk id in the remarks (`MMT/IMPS/<ref>/BULD75978325/<name>/<IFSC>`). The
word "salary" appears nowhere. The business records **ONE** Non Project Expense for the whole run.

Today one expense can be settled by exactly one line:

- `settle_existing_expense` compares the line with the whole record, always writes Paid, and overwrites
  the date, the reference and the amount.
- `allocate_row` (ADR-0020) goes the other way, one line → many records, and is Project Payments only
  (B2).
- Many lines → one Project Payment exists only by *splitting* the payment.

The measured case is NPE `toj650dsqd`, ₹1,60,113 (Staff Welfare, "Reimbursement for july 2026"). It
equals the 33 debits of the 18-Aug-2026 run (₹1,64,745) minus 3 bounced transfers (1,905 + 1,905 + 822).
July salary (58 lines, ₹32,35,376) has no expense at all. **This is the evidence B2 asked for before the
expense scope could widen**, in the many-lines → one-record direction only.

## Decision

**An expense (Project Expenses and Non Project Expenses alike, Q4) can be settled by many bank lines.
Each link is one `Outflow Row Match` slip. The expense's linked total is the SUM of its live Settled
slips — always derived from the slips, never stored and never incremented (Q3).**

### Status is derived from the linked total (Q19)

| Linked total | Expense status | `payment_date` |
|---|---|---|
| Below amount − ₹5 | **Reconciliation Pending** | blank |
| Within ₹5 of amount | **Paid** | date of the latest linked line |

`Paid` stays the only status that counts as spend. `AMOUNT_TOLERANCE` (₹5) is the one window: the
cumulative check reads the same constant as the matcher pool and the settle guard, never a copy.

### Sub-decisions

| # | Decision | Rejected alternative |
|---|---|---|
| **Q3** | Links are slips in `Outflow Row Match`. **No child table on the expense.** | A child table of transactions on the expense: the link would live twice (child rows + the match rows the import still needs) and drift; 1→many and many→1 would be two mechanisms; every link would be an expense `doc.save` (Version row each); undo would have to fix both copies. ERPNext, Odoo and Oracle all use one allocation table. |
| **Q2** | The expense stays **one record**. | Splitting it like a Project Payment. Owner: "I have to map all the transactions within a single expense entry." |
| **Q6/Q7 + R1** | A bounced transfer is **never linked**, not even as a negative, and no expense amount is raised to cover it. Its **out** line is skipped by hand with the reason "bounced". Its **back** line is left under the existing system skip kind *Failed payment bounced back*. **No new skip kind, no migrate.** | Linking the bounce as a negative. Linking everything and raising the amount. A new "Bounced" skip kind (migrate, and a second name for what the bank rule already names). |
| **Q8** | Lines that don't add up are fixed by editing the **expense amount** through the normal edit. Status re-derives on save. | A "Finish anyway / mark Paid with reason" button. |
| **Q10** | `payment_ref` is left alone. If it is blank, the bulk id is written. | Joining every line's reference into `payment_ref`. |
| **Q13** | **One code path.** Linking one line is the N=1 case. Its extras — snap the amount to the bank figure within ₹5, write the line's reference — apply only while the expense has a single slip. | Keeping today's 1:1 settle as a separate path. |
| **R4 (open item 4)** | No extra rule for "a snapped expense later gets a second line". A snap only happens when one line already fills the expense within ₹5, so that expense has no room; a second line is refused by Q16 unless someone first raises the amount (Q8), which is a deliberate edit. | A rule to un-snap on the second slip. |
| **Q16** | Linking is **all-or-nothing**. If the ticked lines exceed what is left + ₹5, nothing is linked. | "Link what fits". |
| **Q17 + R2** | A single late line can be linked from Decide to a Reconciliation Pending expense that still has room. The bulk "Link N to one expense" works on **one grid page at a time**: it is disabled, with a note, while any ticked line is on another page. A run longer than one 50-row page is linked in two goes. | Changing the page size. Summing ticks across pages server-side. |
| **Q12 / Q11 rule 2** | Marking Paid by hand is refused while the linked total is short. | Allowing a manual Paid on a part-linked expense. |
| **Q15** | Undo one line from the import screen with the existing Unreconcile dialog. The slip becomes Reversed; the expense re-derives (back to Reconciliation Pending if short, `payment_date` cleared). **On an expense with other live slips the reference and the amount are not touched.** There is no undo-all from the expense for now. | Undo-all from the expense page. |
| **Q21** | A multi-slip undo has **no exact "did someone change it" amount check** (linking never rewrote the amount, so there is nothing to put back). A single-slip undo keeps today's exact check. | Snapshotting the record amount on each slip — kept as a future improvement. |
| **Q20** | No new tab. The unified Payments "Payment Done / Reconciliation Pending" tab already lists expenses. | A Reconciliation Pending tab on the old expense list pages. |
| **R3** | The "already recorded" duplicate guards also look at **Reconciliation Pending expenses that have live slips**, not only Paid records. | Leaving them Paid-only: the Q16 over-limit refusal catches over-payment but not a duplicate line that still fits under the amount. |
| **R5 (screen 8)** | An expense's linked bank lines are shown read-only in a **click-to-open card on the Payments & Expenses table**, the same pattern as the Against / Vendor / Project cards. It renders only when the expense has at least one live slip. | A read-only section inside the Mark Reconciled dialog. |
| **UI** | The selection summary and "Link N to one expense" (and today's "Confirm decided") sit **in the row above the table, beside Export**. The floating bulk bar is removed. | The floating bottom bar. |

### `target_amount` is redefined

`Outflow Row Match.target_amount` means **the money that moved between this line and this record.** For
a 1:1 settle that equals the record's amount, as today. For a slip on a multi-line expense it is **the
line's own amount**. That is what makes the linked total a plain SUM, and what keeps the import row from
reading as *Partially Allocated*: `allocation.allocated_of` sums a row's slips and compares them with the
line.

### Four server rules (Q11 + Q22)

Applied **only when the expense has live Settled slips**, in the expense doctypes' `validate` and
`on_trash`: wired in `hooks.py` → `integrations/controllers/`, logic in a pure `services/` module.

1. The amount cannot drop below the linked total.
2. Marking Paid by hand is refused while the linked total is short.
3. Delete is refused while live slips exist. "Live" is counted after a Reversed stamp, so Unreconcile's
   own delete of an import-created expense still works.
4. Every save re-derives Paid ⇄ Reconciliation Pending from the linked total.

Every write door goes through the document layer, so the rules cover all of them: Mark Reconciled on the
Payments tab, the old expense pages (Mark as Paid / Edit / Delete), Desk, Data Import, and the import's
own settle and unreconcile (both `doc.save()`, verified 2026-09-17). An endpoint-only guard was rejected
(Q22b) because it would leave Desk and the old pages open.

## Consequences

Found by re-reading the code at `a076d68d` after the grilling. Each one is part of the build, not a
choice:

- **Write order.** Today `_settle_and_commit` saves the expense first and inserts the slip after. Under
  rules 2 and 4 the save would not yet see its own slip, so it would flip the import's Paid back or refuse
  it. **The slip is inserted first, then the expense is saved.** The import's writes go through the same
  rules, with no bypass flag.
- **Settle guard.** `_lock_and_assert_settleable` compares the line with the whole record and raises
  `AlreadyPaidError` once Paid. It becomes a remaining-balance check: `amount − linked total`, with ₹5.
- **Unreconcile.** `_expense_verdict` requires the expense to be Paid, the stored `payment_ref` to be this
  line's reference, and `leg_amount == amount`. On a multi-slip expense all three refuse every line but
  one. It gains a multi-slip verdict. `_revert_expense` must not clear `payment_ref` while other slips stay
  live.
- **Pickers measure what is left.** `candidates.load_expense_targets`, `ledger_read` and
  `review.search_settleable_records` compare against the full amount. They compare against the remaining
  balance, and they list Reconciliation Pending expenses with room.
- **Readers of `target_amount`**, re-checked against the new meaning: `expenses._live_legs` /
  `allocation.allocated_of`, the row status refresh, `review` settled legs, the CSV export
  `_SETTLED_TARGET_AMOUNT_SQL`, the unreconcile dialog and verdict, and the inflow prior-sightings check.
- **Duplicate guards (R3)** — `contains_guard`, `review._recorded_money_group`,
  `expenses._guard_money_not_recorded`, `status._already_recorded_outcome`, `candidates.load_record_claims`
  — widen to Reconciliation Pending expenses with live slips, and compare a line with **that line's slip**,
  not with the whole expense.
- **CEO Hold gap** counts Paid only. A rule-4 flip moves it, which is correct (Paid is spend), but it is a
  side effect of an ordinary edit.
- **History.** On the dev database every one of the 323 expenses with Settled slips is Paid with one slip
  within ₹5 of its amount, so rule 4 flips none of them. Recount on production before release.
- **Held until the build is finished (owner instruction):** the `CONTEXT.md` glossary entry *Bounced
  transfer*, worded to say the back line is the system skip *Failed payment bounced back*; and the stale
  *Skipped by hand* entry, which ADR-0022 Amendment C already contradicts.
- **Future:** a snapshot of the record amount on each slip so multi-slip undo can check for drift (Q21);
  creating one expense from many ticked lines (Q9).

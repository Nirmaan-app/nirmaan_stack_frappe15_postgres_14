# ADR 0040 — An approved Reimbursement becomes a Non-Project Expense

**Status:** Accepted · 2026-10-23 (owner) · Supersedes [ADR-0041](0041-reimbursement-is-money-outside-the-ledgers.md)
decision "money of its own" and its "No Paid status yet" · Decisions 1 and 3 amended by
[Amendment B](#amendment-b-2026-10-28-owner----a-monthly-limit-per-person-not-a-cap-per-claim) (2026-10-28) ·
Decision 8, the Payments half of Amendment B point 4, and the Consequences on Export and on the Payments queue
replaced by [Amendment C](#amendment-c-2026-11-18-owner----every-step-on-the-reimbursements-page) (2026-11-18)

## Context

ADR-0041 kept a Reimbursement outside the expense ledgers: Approved was where a claim ended, the payers
exported the Approved claims and paid them through the bank, and nothing recorded that a claim was paid. Its
own Consequences named the cost: a claim could be exported, and paid, twice; reimbursement transfers showed as
unmatched lines in the bank-statement import; reimbursed money was missing from every outflow figure.

ADR-0041 rejected "a Reimbursement that creates a Non-Project Expense on approval" because the owner wanted a
self-contained screen with its own approval rule. This decision keeps that screen and that rule, and pays the
claim through the ledger.

## Decision

**Approving a claim creates the Non-Project Expense that pays it, in the same transaction.** Accounts pays the
expense from Project Payments & Expenses like any other; the claim follows only its endings.

1. **Who approves a claim is unchanged:** HR up to ₹2,000 (claims raised outside HR), Admin everything else
   (`services/reimbursements/rules.py`).
2. **The expense** (`services/reimbursements/convert.py`) has **no Expense Type** (owner, 2026-10-23): the
   claim link marks it, so it depends on no type, and the "Reimbursements" type can be deleted. A new
   read-only, indexed field `reimbursement` holds the claim's ID (`request_id` can only name an Expense
   Request). `amount`, the five `pay_to_*` fields and `invoice_attachment` (a link to the claim's merged
   receipts PDF, which stays private to the claim; left blank on a local-disk site, where Frappe would attach
   the file to the expense and open it to every expense reader) are copied; `description` is the claim in one line,
   `comment` names the approver; `invoice_ref` / `invoice_date` are the claim's ID and the day it was raised
   (the claim is the invoice: it has no bill number of its own, and may merge several bills); the expense's
   `owner` is the claimant.
3. **Its starting status is the expense auto-approve rule with the claim's APPROVER as the raiser**
   (`approval_tiers.initial_status_for_raiser`): HR's claims are auto-approved (they are all under ₹15,000);
   an Admin's approval clears L1, so up to ₹50,000 is Approved and above it is CEO Pending; the CEO's clears
   both. A claim already approved is not asked for L1 again.
4. **The claim follows only the endings** (`services/reimbursements/expense_link.py`): it stays Approved while
   the expense is Requested, CEO Pending, Approved or Reconciliation Pending. Expense Paid → claim **Paid** (a
   new status, set by nothing else). Expense Rejected in the Payments queue → claim Rejected, with the reason
   typed there. An undone bank match (Paid → back) puts the claim back to Approved.
5. **The expense may be edited freely** (amount, account through Change account, anything); an edit never
   changes the claim. **Rejected is final** (owner, 2026-10-23): a rejected expense can't move to any other
   status; to pay it after all, delete it (which deletes the claim) and the person raises a new reimbursement. The claim keeps the account it was approved with; a claimant changing their own account
   affects only their next claims.
6. **Deleting** (owner, 2026-10-23, revised the same day): deleting the expense, in any status, deletes the
   claim and its receipts, as deleting a request's expense deletes the Expense Request -- except that the claimant
   can't delete their OWN claim's expense unless it is Rejected. The claimant (a Project Manager, say) deletes
   their own claim only while it is Pending Approval or Rejected; a claim Rejected in
   Payments takes its expense with it only while that expense is still Rejected, so a revived (live or paid)
   expense is never deleted from the claim side.
7. **No new notifications** (owner, 2026-10-23): the HR / Admin Approved and Rejected bells stay; the claim
   turning Paid or Rejected in Payments sends nothing (a bell for it was added and removed the same day).
8. **The Reimbursements screen** drops the tick-and-Export on "Payment need to be paid" (a second place to pay a
   claim is how it gets paid twice); a claim's payment (expense, stage, UTR) shows in its detail sheet, not as a
   table column (owner, 2026-10-23); a new Paid tab.

### Amendment A (2026-10-27, owner) -- deleting from the claim side

Refines the claimant's part of decision 6. The claimant deletes their claim while it is Pending Approval or
Rejected, from Reimbursements; a claim rejected in Payments takes its Rejected expense with it. The claimant
never deletes their claim's expense directly. Deleting the expense, by anyone else and in any status, deletes
the claim, and every screen that deletes it says so. Both paths lock the expense before the claim, so they
cannot deadlock (code review 2026-10-27).

### Amendment B (2026-10-28, owner) -- a monthly limit per person, not a cap per claim

Replaces decision 1 and HR's part of decision 3. The ₹2,000 stops deciding who may approve a claim and becomes
the **monthly reimbursement limit**: ₹2,000 of **month total** per claimant (the claim in hand plus their other
Approved and Paid claims raised in the same calendar month). Only a total under ₹2,000 is within it: exactly
₹2,000 has reached the limit (owner, 2026-10-28, revised the same day from "₹2,000 is within").

1. **HR approves a claim of any amount** whose claimant is not in HR. Admin still decides every claim raised by
   someone in HR, and may decide their own.
2. **HR's approval finishes a claim only under the limit.** Under it, the expense is auto-approved as before.
   At or above it, the expense is born **Requested, even under ₹15,000**, and waits for L1 in Payment Pending Approval;
   L1's approval follows the normal rule (Approved up to ₹50,000, CEO Pending above it). This is the one place an
   expense under ₹15,000 is not auto-approved: the monthly limit is a per-person check that only HR's approval
   skipped, so above it the claim gets the L1 look an Admin would have given it.
3. **An Admin's approval is unchanged:** it counts as L1 (Approved up to ₹50,000, CEO Pending above it).
4. **Every approver sees the month total and is warned at or above the limit**: HR and Admin on the
   Reimbursements page, L1 and the CEO approving one reimbursement in Payments. At or above the limit they tick to
   confirm before Approve is enabled. On the Reimbursements page the server refuses an approval at or above the
   limit that the screen did not confirm. Bulk approve in Payments lists those reimbursements per person, with no
   tick.
   It is a warning, never a block.
5. **The total is worked out when it is read**, never stored, so it is always current (a claim later rejected or
   deleted drops out of it).

Accepted edge: two HR approvals of the same person's claims committed in the same moment can each miss the
other in their month total (PostgreSQL runs at REPEATABLE READ, so a lock would not make the second one see the
first), and both may auto-approve. Each is HR's approval of a claim that was under the limit on its own, and
L1 sees the true total on the person's next claim.

### Amendment C (2026-11-18, owner) -- every step on the Reimbursements page

Replaces decision 8, the Payments half of Amendment B point 4, and the Consequences "Payment need to be paid has
no Export" and "the Payments queue labels it". The claim still becomes a Non-Project Expense on its first
approval (decisions 2 to 7 stand), but nobody works a reimbursement from Project Payments & Expenses any more:
one claim had been split across two screens, and the Reimbursements page showed every claim after its first
approval as just "Approved".

1. **Reimbursement expenses leave Project Payments & Expenses.** Its queue skips every Non-Project Expense whose
   `reimbursement` is set, in every tab, count, filter, facet and export, Payment Raised By Me included. Every
   other row there is unchanged. Bulk Import Transactions still links bank lines to these expenses.
2. **The Reimbursements page does every step, one tab each**, in this order:

   | Tab | Holds | Acts |
   |---|---|---|
   | Pending Approval | claims at Pending Approval, nothing else | HR, Admin, CEO: approve / reject |
   | Pending L1 Approval | Approved claims whose expense is Requested | Admin, CEO: approve / reject |
   | Pending CEO Approval | Approved claims whose expense is CEO Pending | the CEO only, who alone sees the tab |
   | Payment need to be paid | Approved claims whose expense is Approved | Accounts, Admin: Export for Payment, Mark as Paid |
   | Reconciliation Pending | Approved claims whose expense is Reconciliation Pending | Accounts, Admin: Mark Reconciled |
   | Paid | Paid claims | view |
   | Reimbursement Raised By Me | the person's own claims | everyone; Edit / Delete as before |
   | All | every claim, Rejected included (the Rejected tab goes) | view |

   Admin, Accounts and HR see every tab but Pending CEO Approval; the CEO sees all eight; everyone else sees
   only Reimbursement Raised By Me. Seeing a tab is not acting on it: HR and the CEO only view the payment tabs,
   and Accounts only views the approval tabs.
3. **No new status and no new field.** The claim keeps Pending Approval, Approved, Paid and Rejected (owner: "use
   the old statuses only"); which tab an Approved claim sits in is read from its expense's status. The approval
   rule is Amendment B's, unchanged: HR under the limit, an Admin up to ₹50,000 and the CEO at any amount finish
   the approval; HR at or above the limit sends it to L1 (Admin or CEO); an Admin above ₹50,000 sends it to the CEO.
4. **L1, CEO approval, Mark as Paid and Mark Reconciled are the expense's own decisions**
   (`api/approvals/expense_actions.decide_expenses`), called from the Reimbursements page with the claim's
   expense, under the same rules and reasons as in Payments. The claim follows through the existing hook.
5. **Every approval tab decides in bulk**, as Payments does: tick up to 100 claims, Approve selected or Reject
   selected. The bulk confirm lists the people at or above the monthly limit with no tick (Amendment B point 4's
   bulk rule) and takes one reason for every rejection. Approving one claim keeps the tick at or above the limit.
6. **Export for Payment returns on Payment need to be paid**, the same bank file as Payments. Decision 8 removed
   it because a second place to pay a claim is how it gets paid twice; with reimbursements gone from Payments, this
   is again the only place.
7. **The claim shows its expense**: a Non-Project Expense column (its ID and its own status) on every tab after
   approval, and the full expense in the claim's view (created on, status, amount, description, invoice ref and
   date, pay-to account, receipts, paid on, UTR, payment source, and who approved, paid and reconciled it).
   This reverses decision 8's "not as a table column".

Rejected options: keeping L1 and the CEO in Payments (the two-screen split this removes); new claim statuses
"HR Approved" and "Admin Approved" (owner: old statuses only); no CEO step at all for an Admin's approval
(considered the same day and withdrawn: above ₹50,000 still needs the CEO).

Built 2026-11-19 (owner: "complete fully, then we test in one go"). The two readers left open were settled on the
recommended answers, to be confirmed: the Project Payments summary cards KEEP counting reimbursements in
non-project outflow (the money still went out; `get_project_payment_summary` is unchanged), and the Action
Center's pending finance item for a reimbursement's expense opens the Reimbursements page's Payment need to be paid
tab searched to the claim (`action_items/finance.reimbursement_pay_link`). The Project Payments queue leaves the
expense out in one place, its Non-Project branch (`get_approval_queue._expense_select`), so its tabs, counts, Type
facet and filter, export and Payment Raised By Me all drop it; the "Reimbursement" Type option is gone with the rows.

### Amendment D (2026-11-18, owner) -- a Project Manager's monthly cap

A Project Manager may not raise reimbursements adding up to more than ₹2,000 (`rules.PM_MONTHLY_CAP`) in a calendar
month. Unlike Amendment B's limit, which only warns the approver, this is a block, on the claimant's side:

1. Checked by the server when a claim is raised and when it is edited (`claims._check_cap`, rule
   `rules.cap_problem`), after taking the person's row, so two claims sent at once are counted one after the other.
   The refusal says what is left: "You can claim up to ₹500 more this month."
2. The month counts the claims that may still be paid: Pending Approval, Approved and Paid (`month_total.month_used`);
   a rejected or deleted claim frees its amount. An edit replaces the claim's own old amount.
3. Exactly ₹2,000 is allowed. Only the Project Manager profile is capped (`access.is_capped`); Project Lead and
   every other role keep Amendment B alone.
4. The Raise / Edit dialog reads the person's own month (`claims.get_my_month`, open to anyone, their own claims
   only: the month-total call stays Admin / HR / Accounts), shows what is left and keeps Submit off above it.

Points 2-4 were the recommended answers to the owner's four questions (pending counts? exactly ₹2,000? PM only?
edits too?), built as recommended on 2026-11-19 and to be confirmed.

### Amendment E (2026-11-19, owner) -- the claim carries its expense's status

Replaces Decision point 4 ("the claim follows only the endings") and Amendment C point 3 ("no new status"). With the
claim fixed at Approved from its first approval until it was paid, the Status column read "Approved" for a claim
waiting at L1, at the CEO or for reconciliation, while the tab and the totals showed the step. Two ways were put to
the owner: show the step on screen only, worked out from the expense (no schema change), or give the claim the
expense's statuses. The owner chose the second.

1. **The claim has the expense's statuses, by the same names, plus its own first one**: Pending Approval (HR's or
   Admin's first approval; there is no expense yet) · Requested · CEO Pending · Approved (waiting to be paid) ·
   Reconciliation Pending · Paid · Rejected. Three options were added to the doctype's `status`
   (`rules.CLAIM_STATUS_OF_EXPENSE`).
2. **Every change of the expense's status is copied onto the claim**, wherever it is made (`expense_link.follow_expense`,
   on the expense's insert too): L1 and CEO approval, Mark as Paid, a reconcile, a reject (with its reason) and an
   undone bank match (back to Reconciliation Pending). A Pending Approval or Rejected claim never moves.
3. **"Approved" in the rules now means one step**; where a rule meant "approved and may still be paid" it reads
   `rules.APPROVED_STEPS` (Requested, CEO Pending, Approved, Reconciliation Pending): the month total (Amendment B),
   the Project Manager cap (Amendment D, point 2) and the profile summary.
4. **Each step tab lists one claim status** (`rules.TAB_OF_STATUS`); the tab no longer reads the expense.
5. **Existing claims were moved once** by `patches/v3_0/reimbursement_status_from_expense`: an Approved claim whose
   expense is Requested, CEO Pending or Reconciliation Pending takes that status. Raw SQL on purpose, leaving
   `modified` as it was (owner); nothing is derived from the claim's status.
6. **The tab sets per role changed the same day** (Amendment C named Admin, Accounts and HR as seeing every tab):
   HR sees Pending Approval, Reconciliation Done / Paid, All and Raised By Me; Accounts sees Payment need to be paid,
   Reconciliation Pending, Reconciliation Done / Paid, All and Raised By Me; Admin every tab but the CEO's. "Paid" is
   shown as "Reconciliation Done / Paid".

The price: the claim's status and the expense's are the same fact kept twice. Point 2 is what keeps them equal; a
write to the expense that skips its hooks would leave the claim behind.

## Considered options

- **Reimbursement as a fifth kind of payment on the Project Payments screens**, the claim holding its own
  payment fields and statuses. One record per claim, no Expense Type, but the payments queue, the bank import
  (a fixed list of three ledgers), cheques, holds and every outflow report would each have to learn a fourth
  record. Rejected for its size.
- **A new Expense Type "Employee Reimbursement"**, or mapping Travel / Food / Others to existing types.
  Rejected: the type already existed; no existing travel type fits a cab or auto claim.
- **The expense created Requested**, so the expense bands apply in full. Rejected: an Admin-approved claim
  would wait for L1 a second time.

## Consequences

- Reimbursements now count in non-project outflow from go-live. Bulk Import Transactions settles them like any
  Non-Project Expense: never suggested automatically (expense matching needs a project named in the bank remark,
  and a Non-Project Expense has none), so Accounts links the bank line to the expense by hand once it is
  Reconciliation Pending ("Link to expense"). Its Paid, and an Unreconcile, move the claim through the same hook.
  The 29 earlier reimbursements booked as Staff Welfare and Salaries stay where they are.
- Travel / Food / Others is text on the expense; a report that needs it reads it from the claim through
  `reimbursement`.
- The Expense Type's roles still let HR and Project Managers raise a reimbursement as an Expense Request, which
  skips the HR ₹2,000 rule. Accepted by the owner (2026-10-23): the roles stay.
- "Payment need to be paid" has no Export at all (owner, 2026-10-23): its file carried every approved claim's
  bank account, a ready list to pay from outside Project Payments. The other tabs keep their Export.
  **Reversed by Amendment C (2026-11-18):** the tab now has Export for Payment (the bank file) and Mark as Paid,
  because it is now the only place a claim is paid.
- The receipts PDF opens only for people who can open the claim (the claimant, Admin, HR, Accounts); a PM or PMO
  viewing the expense cannot open it.
- The expense is as open to edit as any Non-Project Expense: every role with write on the doctype (Project
  Manager, Procurement and others) can change its amount or delete it, and the claimant is its owner. Accepted by
  the owner (2026-10-23, code review finding 4): the `reimbursement` link ties every expense to its claim, so a
  change is checked against the claim rather than blocked. The owner gives no extra rights (no owner-only rules).
- A reimbursement's expense has no Expense Type, so reports that group spend by type show it under a blank type;
  the Payments queue labels it by its claim link: a "Non Project Expense" pill with a "Reimbursement" tag beside
  it, as a GST payment carries "GST" (export and filter: "Reimbursement / Non Project Expense"). The old
  "Reimbursements" Expense Type is to be deleted (owner, 2026-10-23).
  Since Amendment C the Payments queue no longer lists it at all.
- Nothing migrates: the feature had not shipped, so no claim predates this decision.

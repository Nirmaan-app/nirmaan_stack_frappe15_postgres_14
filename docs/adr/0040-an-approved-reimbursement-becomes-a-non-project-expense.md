# ADR 0040 — An approved Reimbursement becomes a Non-Project Expense

**Status:** Accepted · 2026-10-23 (owner) · Supersedes [ADR-0039](0039-reimbursement-is-money-outside-the-ledgers.md)
decision "money of its own" and its "No Paid status yet"

## Context

ADR-0039 kept a Reimbursement outside the expense ledgers: Approved was where a claim ended, the payers
exported the Approved claims and paid them through the bank, and nothing recorded that a claim was paid. Its
own Consequences named the cost: a claim could be exported, and paid, twice; reimbursement transfers showed as
unmatched lines in the bank-statement import; reimbursed money was missing from every outflow figure.

ADR-0039 rejected "a Reimbursement that creates a Non-Project Expense on approval" because the owner wanted a
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
- The receipts PDF opens only for people who can open the claim (the claimant, Admin, HR, Accounts); a PM or PMO
  viewing the expense cannot open it.
- The expense is as open to edit as any Non-Project Expense: every role with write on the doctype (Project
  Manager, Procurement and others) can change its amount or delete it, and the claimant is its owner. Accepted by
  the owner (2026-10-23, code review finding 4): the `reimbursement` link ties every expense to its claim, so a
  change is checked against the claim rather than blocked. The owner gives no extra rights (no owner-only rules).
- A reimbursement's expense has no Expense Type, so reports that group spend by type show it under a blank type;
  the Payments queue labels it by its claim link ("Reimbursement / Non Project Expense"). The old
  "Reimbursements" Expense Type is to be deleted (owner, 2026-10-23).
- Nothing migrates: the feature had not shipped, so no claim predates this decision.

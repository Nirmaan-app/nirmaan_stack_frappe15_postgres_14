# ADR 0039 — A Reimbursement is money outside the expense ledgers

**Status:** Accepted · 2026-10-22 (owner)

## Context

Nirmaan users spend their own money for work (a cab to site, safety shoes, a courier) and had no way to
claim it back in the app. The app already has an Expense Request (ADR-0016): an *ask* that, once approved,
creates a Project or Non-Project Expense, which Accounts pays in the Payments queue and the bank-statement
import settles. A reimbursement could have been built the same way.

## Decision

**A new `Reimbursement` doctype that is money of its own.** It never becomes an Expense, so it counts in no
financial figure (project outflow, the cashflow gap / CEO-Hold, the Outflow reports) and the bank-statement
import does not match it. It has its own screen, from raising to exporting the approved claims for payment.

1. **Statuses:** Pending Approval → Approved | Rejected (final, with a reason). **No Paid status yet**:
   Approved is where a claim ends, and the payers (Admin, HR, Accounts) tick Approved claims and export
   them to pay through the bank.
2. **Who decides:** HR (Executive or Lead) a claim of ₹2,000 or less (inclusive) raised outside HR; Admin
   everything else, every HR claim included, and an Admin may approve their own. Approval is for the full
   amount. The decision saves only `approved_by`, or the `rejection_reason`.
3. **Where it is paid:** into the claimant's own bank account: the one Payee named in the `payee` field of the
   person's Nirmaan Users row (one account per person), so Payee keeps its shape
   (ADR-0033 Amendment A). The claim copies the account, as an Expense does; nothing points back.
4. **Receipts:** any files; PDFs and pictures are merged into one PDF on submit.
5. **The claimant is saved on the claim** (`claimant_name`, `claimant_role`) when it is raised, as the bank account is: a claim never depends on the user record still existing.

## Considered options

- **An Expense Request of a "reimbursement" type, or a Reimbursement that creates a Non-Project Expense on
  approval.** It would reuse the Payments queue, the bank file and the bank-statement match, and count in
  outflow. Rejected by the owner for a self-contained screen with its own approval rule, which the Expense
  ledgers' amount tiers (₹15,000 / ₹50,000, CEO) do not express.

## Consequences

- **Nothing records that an Approved claim was paid.** Exporting changes nothing, so a claim can be exported,
  and paid, twice. Accepted "for now"; a Paid status is the expected next step.
- **Reimbursement transfers appear as unmatched lines in the bank-statement import**, and reimbursed money is
  missing from every outflow figure. Moving reimbursements into the ledgers later needs a migration of every
  claim, which is why this is recorded.

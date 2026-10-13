# 32. A Vendor Refund is the only record of refunded money

Date: 2026-10-12

## Status

**Accepted** 2026-10-14, built under #1396 (owner grilling session 2026-10-09 to 2026-10-12). Supersedes the *Deferred* note
"Vendor Refund from a bank credit" and accepted risk AR1 in
[ADR-0016](0016-bank-statement-import-creates-inflows.md).

## Context

Money a vendor sends back against a Purchase Order could be recorded through two doors, and
neither knew about the other:

- **Bulk Import** made a `Vendor Refunds` record from a bank credit line. It lowered the PO's paid
  amount, but it never touched the PO Adjustment, so the adjustment stayed *Pending* and the PO
  stayed payment-locked.
- **"Adjust Payments" → Vendor refund** made a negative, already-*Paid* `Project Payments` row and
  an "RA Vendor" *Return* term. It cleared the adjustment, but no bank line was behind it, and the
  import's duplicate check for credit lines never reads `Project Payments`.

Both lower `amount_paid`, so the same money recorded through both doors lowered it twice.
PO/005/00107/26-27 showed this: a ₹28,886 bank refund (VRF-26-00004) on 23-Sep, an adjustment
still asking for ₹25,488 on 9-Oct, and only an admin write-off to get out.

## Decision

1. **The `Vendor Refunds` record is the only record of refunded money.** "Adjust Payments" no
   longer creates a negative payment for a refund. An adjustment entry *points at* a Vendor Refund
   to settle part of its balance.
2. **A Vendor Refund may be recorded before its bank line.** It is then *Reconciliation Pending*.
   A bank credit line matched to it makes it *Received*. One made straight from a bank line starts
   at *Received*.
3. **Only a Received refund counts.** A *Reconciliation Pending* refund lowers no paid amount and
   clears no adjustment balance. It **holds back** its amount of the PO's overpaid credit, so no
   revision increase, credit push or credit pull spends it. The hold is applied in
   `usable_po_credit`, the one reader every spender goes through.
4. **Linking is automatic.** When a Received refund and a negative adjustment balance meet on the
   same PO, the system links them up to the balance, whichever arrived first. A refund larger than
   the balance keeps the rest unlinked, with a warning on the PO. Unreconciling a refund removes
   its link and the balance returns.
5. **A refund that never matches** ends *Cancelled* (counts for nothing, holds nothing), or an Admin
   marks it *Received* with no bank line and a typed reason. That one shows "No bank proof" and
   stays matchable, so a late bank line is linked to it and never makes a second refund.
   **Amended 2026-10-13 (owner):** a *Cancelled* refund may be **deleted** by an Admin or
   Procurement, unless a bank line was ever matched to it (its reversed match records are bank
   history and must keep naming it). Deleting it moves no money, because it never counted. Its VRF
   number is never reused. This replaces "kept for history" from the grilling.
6. **Bulk Import suggests, never decides.** It suggests a waiting refund only when the line's bank
   account + IFSC belong to the vendor and exactly one waiting refund of that vendor has the same
   amount (±₹1), or when the bank reference equals a UTR typed on waiting refunds. It never groups
   refunds because their amounts add up (owner ruling 2026-08-07). Otherwise the decision dialog
   lists the vendor's waiting refunds, and the accountant picks or splits by hand. "Create a vendor
   refund" warns when the vendor has waiting refunds.
7. **Scope.** Waiting refunds exist for Purchase Orders only. Anyone who may use "Adjust Payments"
   may record one, and the server checks that role. Only the bank match (accounts) makes it
   Received. While *Reconciliation Pending*, its creator or an Accountant may change its amount or
   PO; after *Received*, only Unreconcile can.

## Considered options

- **Keep the negative payment and teach Bulk Import to match it.** Rejected: two kinds of refund
  record would stay alive, and the credit-line duplicate guard, Unreconcile and the Work Order flow
  would each need to learn the second kind.
- **Count a waiting refund at once (unlock the PO before the bank line).** Rejected: every other
  money figure moves only on bank proof, and a refund that never arrives would leave the books wrong
  with nothing to flag it.
- **Clear the adjustment now, lower the paid amount later.** Rejected: the adjustment and the paid
  amount would disagree for days, and the overpaid-credit cap reads both.

## Consequences

- A PO with a waiting refund stays payment-locked until accounts match the bank line. In practice
  little is blocked: a negative balance only remains once every unpaid term has been absorbed.
- If a revision raises the PO while a refund waits, the increase becomes a new term; the held
  credit is not spent. If the vendor then refunds a different amount, someone edits the waiting
  refund.
- A waiting refund unmatched for more than 15 days shows a warning on the PO and a filter in the
  Vendor Refunds list.
- Saving or deleting a Vendor Refund now recounts the vendor's credit, as payments already do.
- The 3 refunds made earlier through "Adjust Payments" (₹16,643) are converted to Vendor Refunds
  marked *Received* with no bank line, reason "migrated from Adjust Payments"; their money figures
  do not change.

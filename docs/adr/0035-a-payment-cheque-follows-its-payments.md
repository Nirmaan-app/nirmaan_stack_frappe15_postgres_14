# 35. A Payment cheque follows its payments, and clearing it pays them

Date: 2026-10-17

## Status

**Accepted** 2026-10-16 (owner grilling session). Not built yet. Supersedes parts of spec #1407.

## Context

Spec #1407 made a Cheque its own record but kept it beside the money: a Cheque moved no money figure,
started Issued whatever its payments' state, moved freely between Issued, Cleared and Cancelled, and
only people could clear it, never the bank import. Cancelling it touched no payment. In use this meant
a cheque could read Issued while its payment was still Requested, one cheque's payments could be
half approved, approved cheque payments sat in the accountants' Reconciliation Pending pile beside
online money, and every cheque was cleared twice: the import settled the payment, then someone
clicked Cleared. Deposit cheques, which nobody cashes, looked the same as paying ones.

## Decision

1. **Two cheque types.** A *Payment cheque* is cashed by the bank and pays PO payments only (no Work
   Order payments, no Expenses; made out to a Vendor). A *Security Deposit cheque* is held as a
   guarantee, pays no payment, may name the POs or Work Orders it secures, is only Issued or
   Cancelled, and is never matched to a bank line.
2. **A Payment cheque's status is its payments' status.** Pending while they wait for approval,
   Issued once approved (the issue date), Cleared once Paid (the clearance date, which becomes each
   payment's payment date), Cancelled when they are Rejected. The two sides move in the same request.
3. **One cheque, one decision.** Its payments are approved together or rejected together; the
   cheque's total decides whether L1 or the CEO approves. Rejecting one rejects all and cancels the
   cheque; cancelling the cheque rejects all its payments.
4. **Clearing pays.** Clearing a Payment cheque, by hand (Accounts or Admin, Issued only) or by a
   bank-statement line carrying its number and amount, makes its payments Paid. The import clears a
   cheque at any status: a Pending one has its payments approved by the import, and a Cancelled
   one has its Rejected payments made Paid, with a history note and a double-payment warning.
5. **No undo by hand.** Cleared cannot be cancelled; Issued does not go back to Pending; hold, Revert
   to Approved and payment split are refused for cheque payments. Cancelling the cheque is the undo.

## Considered options

- **Keep the cheque beside the money (spec #1407).** Rejected: it is what produced the
  double clearing and the out-of-step statuses above.
- **Cancel keeps the payments alive (back to Approved, Online).** Rejected by the owner: a cancelled
  cheque's payments are Rejected, and the vendor is paid again through a new payment.
- **Make the import flag Pending or Cancelled cheques for a person to confirm.** Rejected by the
  owner: the bank line proves the money left, so the import records it at once.

## Consequences

- "A Cheque moves no money figure" and "only people decide a cheque is Cleared" no longer hold.
- Bank-import code now writes Cheques and may approve a payment; every such move is in the cheque's
  history.
- Old cheques that pay Expenses, have no lines, or name a typed payee are kept as *Old-type cheques*
  and can only be cleared or cancelled by hand.

# 35. A Payment cheque follows its payments, and clearing it pays them

Date: 2026-10-17

## Status

**Accepted** 2026-10-16 (owner grilling session). Built by spec #1477 (#1478–#1487). Supersedes parts of spec #1407.

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

## Amendment A — only the bank import clears a cheque, and a new cheque pays one PO payment (2026-10-20)

**Accepted** (owner grilling session, 2026-10-20). Reverses the "by hand" half of Decision 4, the Work Orders
in Decision 1, and the last Consequence: Old-type cheques are no longer cleared by hand.

### Context

After #1477 a cheque could be made and cleared in two places each. The Cheque Tracker's Add Cheque made
Payment cheques across several POs and Security Deposit cheques, while the PO page made one cheque per
payment request. Accounts could clear a cheque by hand, and the bank import also cleared it. So a cheque
could still be cleared twice, or cleared by hand on a date the bank never paid it. A cheque also carried
three dates (cheque, issue, clearance), and people read the wrong one. Work Orders are never paid by
cheque, so a deposit cheque that secures one had no reason to be there.

### Decision

1. **Only a bank-statement line clears a Payment cheque.** The Clear and Clear selected actions are
   removed. Old-type cheques are cleared by the import too, and every line on one is paid in full.
2. **A Payment cheque is drawn on ICICI Bank,** the only bank whose statement the import reads. "Others"
   stays allowed for a Security Deposit cheque, which is never cleared.
3. **A new Payment cheque pays exactly one PO payment, and is made with it on the PO page.** Add Cheque is
   removed from the Cheque Tracker, along with its Security Deposit button. The tracker views, cancels and
   edits a cheque's number, bank, date and photo, but never its PO. Older cheques that pay several POs stay
   as they are.
4. **Pending is renamed Approval Pending,** both the stored value and the label.
5. **The cheque date and the clearance date are one Cheque/Payment date.** It holds the paper date until the
   import clears the cheque. Then it holds the day the bank paid, and the paper date is not kept. The issue
   date stays.
6. **A Security Deposit cheque secures POs only.** Existing Work Order links are dropped and the cheques are
   kept. The Work Order page shows no cheque card.

### Considered options

- **Keep clearing by hand for Old-type or non-ICICI cheques.** Rejected: the owner wants one way to clear.
  Non-ICICI Payment cheques are no longer made instead.
- **Keep the paper date in the cheque's history when it is overwritten.** Rejected by the owner.
- **Keep a way to put several POs on one cheque.** Rejected: one cheque per PO payment is enough from now on.
- **Delete deposit cheques that secured Work Orders.** Rejected: the paper cheque is still held until it
  comes back.

### Consequences

- A cheque that the import never matches stays Issued until it is cancelled.
- "Cleared by" is no longer shown. It stays on old cheques as history.
- A Project Payment still keeps its own copy of the cheque's paper date.

## Amendment B — a cheque payment is Paid only with its cheque (2026-10-23)

**Accepted** (owner, 2026-10-23, while checking spec #1514). Extends Decision 4 and Amendment A Decision 1, and
withdraws the Old-type exception that let a person pay one of an Old-type cheque's payments by hand.

### Context

After #1514 every screen refused to pay a cheque payment on its own, except for payments on Old-type cheques, which
a person could still settle by hand from Bulk Import or fulfil from Project Payments. A direct edit of the
payment's status (Desk, the REST API) was refused nowhere. Either way a cheque could read Issued while one of its
payments read Paid, which says the bank paid half a cheque.

### Decision

1. **A cheque payment becomes Paid only when its cheque is cleared by an imported bank-statement line,** together
   with every other payment on that cheque. Nothing else moves a cheque payment to Paid or away from it.
2. **Old-type cheques follow the same rule.** Their payments are no longer paid by hand.
3. **A payment in Cheque mode always has its cheque.** One without a cheque line is refused, except an older
   one already Paid or Rejected that the first cheque backfill could not put on a cheque (owner, 2026-10-23):
   it is settled history, nothing can pay it or set it back, and it may still be saved.

### Consequences

- An Old-type cheque that already has some payments Paid still clears at the import, which leaves those as they are.
- The rule sits on the payment's own save, so it holds for every path, including ones added later.

## Amendment C — a Security Deposit cheque may secure a Work Order again (2026-10-30)

**Accepted** (owner, 2026-10-30). Reverses Amendment A Decision 6 only. Every other part of Amendment A stands,
and Work Order payments stay Online.

### Context

Amendment A dropped Work Orders from deposit cheques because Work Orders are never paid by cheque. But a deposit
cheque pays nothing: it is a guarantee the vendor holds, and how the order is paid has no bearing on it. Work
Order vendors may hold a guarantee cheque the same as PO vendors, and the Work Order page had no way to record one.
When this amendment was written, no Work Order payment had ever been made by cheque and no deposit cheque existed
on the local copy of production data, so nothing recorded under Amendment A needed changing.

### Decision

1. **A Security Deposit cheque may name the POs and Work Orders it secures.** A Work Order line gets the same
   checks as a PO line: the Work Order exists, is the cheque's Vendor's, and is in the project named. A cheque
   made out to a typed payee names neither.
2. **The Secures picker offers the Vendor's open POs, then its Work Orders that are Approved or in Amendment.**
3. **The Work Order page shows the deposit card again,** after Transaction Details and WO Options, to the same
   people as on the PO page (Admin, Accounts, Procurement; never a Project Manager). It lists only deposit
   cheques, and "Add Security Deposit Cheque" starts one made out to the Work Order's Vendor naming that Work
   Order. It shows on Approved and Amendment Work Orders only.
4. **Work Order payments stay Online.** A Payment cheque still pays PO payments only
   (`payment_rules.cheque_mode_problem` is unchanged).

### Consequences

- The one-time patch `v3_0.drop_work_order_deposit_lines` has already run and never runs again. It stays in
  `patches.txt` as history.
- A deposit that secures a PO and a Work Order shows on both pages, each naming the other under "Also for".

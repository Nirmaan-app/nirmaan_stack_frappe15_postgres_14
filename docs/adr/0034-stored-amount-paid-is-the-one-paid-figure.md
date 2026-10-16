# 34. Stored Amount Paid is the one paid figure

Date: 2026-10-15

## Status

**Accepted** 2026-10-15 (owner grilling session, after Vendor Refunds (ADR-0032) showed up on some screens
and not on others).

## Context

What an order has been paid was worked out in about twenty places, each its own way: some read the
order's stored `amount_paid`, most added up `Project Payments` again in the browser or in a report.
When Received Vendor Refunds started lowering `amount_paid` (ADR-0032), only the first kind took them
off; the Vendor Ledger, the project PO / WO summaries, the Work Order page, the payment pop-ups and
several reports kept showing the refund as still paid. The stored figure itself was not proven either:
a check found 15 POs (₹1.7 lakh) where it no longer matched its payments, from Desk edits of Paid
payments that the payment hook does not watch, values typed by hand, and a backfill that skipped
Merged POs.

## Decision

1. **The stored `amount_paid` of a PO or Work Order is the one paid figure.** It is that order's Paid
   payments less its Received Vendor Refunds; Reconciliation Pending counts for nothing yet. Every
   screen, report and total that shows what an order or a set of orders has been paid reads it (or
   `amount_due`, built from it) and never adds up payments again. On a Work Order it excludes TDS
   withheld, which is shown beside it.
2. **It is written only by the system, from source.** Every change to a Paid payment's amount, order
   or status, and to a refund, recounts the order(s) it leaves and joins. `amount_paid` and
   `amount_due` are read-only in Desk. PO merge is refused while any of the POs has a payment that is
   not Rejected, or a Vendor Refund.
3. **It is checked in the open.** Reports → PO and Reports → WO each have an *Amount Paid Mismatch*
   report, worked out live, listing every order whose stored figure differs from its source by ₹1 or
   more (paisa rounding is not a mismatch), for Amount Paid and Amount Due. A mismatch is reported,
   never fixed silently: a Recount button on the row (Admin, Accountant Lead) sets it from source, and
   a wrong payment is fixed on the payment.
4. **Lists add up to it.** A list of one order's or one vendor's payments (the Vendor Ledger, the
   payments pop-up, the Work Order page) also lists its Received refunds as minus rows, on the
   refund's own date.
5. **Project outflow counts cash, not orders**: every Paid payment on the project, whatever its order
   is now, less Received refunds, plus Paid expenses; one server figure for Financials, the cashflow
   gap / CEO Hold, the CEO approval screen and the reports. **Current Liabilities** leave out Merged,
   Cancelled and Inactive POs everywhere.

Unchanged on purpose: the payment caps ("left to request", the server caps) still ignore refunds (an
overpayment is settled through PO Adjustment, ADR-0032), and bank cash-out lists (Outflow report, WO
Payment Voucher) list payments only.

## Considered options

- **Add up payments live everywhere, from one shared helper.** Rejected: every screen would still load
  payment rows (several loaded the whole table), and the sum would still need refunds, TDS and the
  status rules taught to it; the stored figure already carries all three.
- **A nightly job that repairs drift on its own.** Rejected: a mismatch means a path that skipped the
  recount; fixing it quietly hides that path. A live report keeps it visible.
- **An Action Center item instead of a report.** Rejected by the owner: the figures belong beside the
  other PO and WO reports.

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

## Amendment A — a Work Order's Amount Paid includes the TDS withheld from the vendor (2026-10-20)

**Accepted** (owner grilling session, 2026-10-19/20). Reverses one sentence of Decision 1: *"On a Work Order
it excludes TDS withheld, which is shown beside it."*

### Context

Decision 1 made a Work Order's Amount Paid what the vendor's bank received. The WO page, which before #1459
showed one Amount Paid of payment plus TDS, then showed three tiles: Amount Paid, TDS withheld and Amount
Due. To the owner the tax withheld is the vendor's money, paid to the tax office for them, so it is settled
against the order exactly as a bank transfer is. A paid figure that leaves it out reads as if the vendor is
still owed it.

### Decision

1. **A Work Order's stored Amount Paid is its Paid payments plus the TDS withheld from the vendor on them,
   less its Received refunds.** It is still the one paid figure: every screen, report and total keeps
   reading it and none adds the tax back on its own. The part that reached the vendor's bank is *Paid to
   vendor*, shown only as a breakdown.
2. **Tax the company pays on top** (a Miscellaneous / Transportation Work Order, a deduction borne by the
   Company) **is not part of it.** The vendor was never owed it. It is shown beside Amount Paid.
3. **A Work Order's Amount Due becomes `total_amount − amount_paid`.** The tax is no longer taken off
   separately, because it is now inside Amount Paid.
4. **Project outflow counts the TDS on the project's Paid Work Order payments, both kinds**, on the
   payment's own date. Withheld tax and company-borne tax are both money the company pays out; a challan
   covers many projects and a whole year, so its date cannot place the tax on one project. The cashflow gap,
   CEO Hold, Financials, the Projects list and the Cash Sheet move with it.
5. **The bank cash-out lists stay as they are.** The Outflow report lists bank transfers; the tax reaches it
   later as a *TDS Payment* expense. The WO Payment Voucher keeps its own TDS column.
6. **A list that adds up to Amount Paid shows the tax.** The Vendor Ledger (screen and PDF) shows each WO
   payment row as payment plus the vendor's TDS, with "incl. TDS ₹x" in its details; the per-order payments
   pop-up gains a TDS column. The WO lists drop their separate "Total TDS" column.
7. **The mismatch judge reads the tax from the deduction records**, not from the order's stored TDS total,
   so a drifted total is reported too. Every Work Order is recounted once by a patch run by hand on
   production, preview first; the preview also lists the projects that the larger outflow would newly put on
   CEO Hold.

### Consequences

- *TDS Payment* is a non-project expense type, so project outflow does not count the tax twice. A
  company-wide total that added project outflow to non-project outflow would count it twice. None exists
  today; one built later must leave the *TDS Payment* expenses out, or leave the WO tax out of project
  outflow.
- The payment caps do not change: they already count before TDS.
- Balances that read Amount Paid (the WO popover's Balance, the Vendor report's Balance Payable, the Vendor
  Ledger's closing balance, a customer's Total Amount Due) stop showing the withheld tax as still owed,
  without code of their own.

### Considered options

- **Add the tax on each screen and keep the stored figure net.** Rejected: it puts back the scattered sums
  this ADR removed, and the ratchet cannot see tax arithmetic.
- **Date the tax by its challan.** Rejected: a challan has no single project.

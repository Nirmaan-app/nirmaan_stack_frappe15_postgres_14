# ADR-0030 — Work Order GST is paid as its own payment, released by approved invoice GST

- **Status:** Accepted, not built (owner grilling 2026-09-30, Q1–Q15)
- **Date:** 2026-09-30
- **Feature:** Work Orders (Service Requests) / Project Payments / Vendor Invoices
- **Replaces:** the ex-GST payment cap on GST-on Work Orders (`050443674`, 2026-09-16, carried into
  the payment summary by `ea2e7dbb5`, 2026-09-21)

---

## Context

A GST-on Work Order's total includes 18% GST. Since 2026-09-16 the Request Payment dialog has capped
such a Work Order at its base value, sending the GST to the Accountant by hand. The cap was
screen-only: `create_payment_request_for_service` still accepted up to the total incl. GST.

The owner wants the GST payable in the app, but only once the vendor has billed it and we have
approved that bill. TDS must be withheld on **base value only**. Today TDS is taken on the whole
payment amount, and nothing on a payment says how much of it is GST.

## Decision

1. **A Work Order payment is either a base payment or a GST payment, never a mix.** No TDS is
   withheld from a GST payment. Every existing payment is a base payment.
2. **Every Vendor Invoice carries an Invoice Base Amount and an Invoice GST Amount** beside the
   existing total (`invoice_amount`, meaning unchanged). Extraction fills them; the user confirms
   them. They are required on upload for Purchase Order and Work Order invoices alike.
3. **The Work Order stores GST Invoiced**: the sum of Invoice GST Amount over its Approved invoices,
   recomputed from source by the Vendor Invoices doc events, like `amount_invoiced`.
4. **The limit on a GST-on Work Order:**
   - base payments (counted before TDS) ≤ the Work Order's base value;
   - GST payments ≤ min(GST Invoiced, the Work Order's own GST);
   - all payments ≤ the total incl. GST.
   It is enforced on the server, at request and on the Accountant's direct paid entry.
5. **A Work Order invoice total is capped** at the Work Order total + ₹10 (Pending + Approved), as
   Purchase Orders already are.
6. **GST cannot be switched off** on a Work Order that has a GST payment that is not deleted.

## Considered options

- **One payment carrying a `gst_amount`, TDS on `amount − gst_amount`.** Rejected. At least five
  paths assume the whole amount is taxable: approval, bulk approval, the amount-edit restatement,
  the CEO part-approve split, and the frontend forecast. Each would need new arithmetic, and a split
  would have to divide the GST between two halves. With a separate GST payment, each path needs one
  "skip a GST payment" check and a split simply copies the flag.
- **Plain revert of the cap (pay up to the total incl. GST at once).** Rejected. GST would be paid
  before any bill exists, and it would be taxed as if it were base.
- **GST tied to one invoice.** Rejected. Base payments are not tied to invoices either; a pool at
  Work Order level is enough.

## Consequences

- **The `min(…, Work Order GST)` cap is what keeps TDS safe, not a tidy-up.** Without it, an invoice
  whose GST is over-stated (the Q5 cap checks only the total) would let base value go out as a
  "GST payment" and skip TDS. Do not remove it.
- GST Invoiced can fall below GST already paid (an approved invoice rejected, edited or deleted).
  GST left then reads 0. Nothing already paid is undone.
- A leftover from a CEO part-approval or a Bulk Import split inherits the GST flag.
- Old invoices are backfilled from the saved extraction entities where present **and** each figure's
  saved confidence is at least 0.70 — the bar the upload form uses before pre-filling (owner,
  2026-10-01). Many low-confidence GST reads were exactly half the GST (one of CGST / SGST), and a
  wrong GST figure would release GST never billed. The rest unlock no GST until an Admin fills them in. "Required" is enforced at upload, not as a doctype `reqd`, so
  old Pending invoices stay approvable.
- `amount_due` on a Work Order is unchanged (`total_amount − amount_paid − total_tds`).

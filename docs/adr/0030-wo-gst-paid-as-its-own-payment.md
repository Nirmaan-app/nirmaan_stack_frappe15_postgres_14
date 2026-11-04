# ADR-0030 — Work Order GST is paid as its own payment, released by approved invoice GST

- **Status:** Accepted, built (owner grilling 2026-09-30, Q1–Q15). Amended 2026-11-04: see *Amendment A*
  (a GST payment waits for the Accountant as a GST Payment Request)
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

## Amendment A — a Work Order GST payment waits for the Accountant (2026-11-04)

**Accepted** (owner, 2026-11-04; built on `fixes/04-11`, `1658f2357` + `c447545bd`). Changes *how* a GST
payment comes to exist; decisions 1–6 above stand unchanged.

### Context

Once GST became payable in the app, anyone who could request a Work Order payment could raise a GST
payment straight into the approval queue. The owner wants every Work Order GST payment checked by an
Accountant first, since only accounts can see whether the vendor's GST has been filed and what is still
owed, before any payment exists.

### Decision

1. **A GST request is its own record, the `GST Payment Request`** (`GPR-.YY.-.#####`; Work Order,
   project, vendor, amount; status Pending / Approved / Rejected / Paid; reviewer, review time, reason, and
   the Project Payment it created). Choosing GST in Request Payment makes one, marked "Send to Accountant",
   Online only. Project Payments' own statuses are unchanged.
2. **Only an Accountant, an Accountant Lead or an Admin decides it** (`PAYMENT_SETTLE_PROFILES`), and only
   on a project they can see. Approval keeps the amount asked for and creates the payment through Request
   Payment's own insert, routed by amount as any payment is. A rejection needs a reason and creates nothing.
3. **Nobody's GST payment is approved by raising it**, an Accountant's or Admin's own included. A GST
   payment is born only from an approved request, with three exceptions that are not a person asking for
   money: a split of one that already was, a decider's Paid entry, and the `Administrator` system account.
   Those get their request written beside them, already decided, so every GST payment has one.
4. **An approved request follows its payment:** Paid while the payment is Paid, Approved otherwise.
   Deleting the payment deletes the request. A decider may delete a Pending or Rejected request; nothing
   else deletes one.
5. **A Pending request holds its amount** in the Work Order limit (GST left, total left, the invoice
   check), so the same GST cannot be asked for twice. A rejection frees it. The Work Order row is locked
   and touched on request and approval, so of two people asking for the last of the GST at once the second
   is refused.
6. **GST cannot be switched off** on a Work Order with a Pending request (decision 6 and *Match GST to
   vendor* count requests as well as payments). Deleting a Work Order deletes its requests.
7. Only the request endpoints write a request (`DECIDING_FLAG`); Desk and REST are refused, because
   System Manager sits on six role profiles and the doctype's permissions are not the boundary.

### Consequences

- The deciders work from a **GST Requests** tab on Payments & Expenses (Admin, Accountant, Accountant
  Lead), with a badge of Pending requests. The Work Order page shows a Pending or Rejected request as one
  line in Transaction Details until its payment replaces it.
- The project's Accountants and Accountant Leads are notified when a request is raised; the raiser is
  notified of the decision.
- No old GST payment is touched or backfilled: the rule applies from the next request.
- Needs `bench migrate` on every site but localhost (new doctype).

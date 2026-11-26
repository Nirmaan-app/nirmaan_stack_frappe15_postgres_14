# ADR 0050 — Work Order invoices are approved by the System by three rules

**Status:** Accepted · 2026-11-24 (grill with the owner; every point decided) · built 2026-11-25 (branch wo/inv-auto) · amends ADR-0014 (Amendment C) and the
signed-copy rule of #1547 ("its Vendor Invoice is created Pending, no auto-approval")

Until now every Work Order (WO) invoice waited for an invoice approver: PO auto-approval refuses anything that is not a
Purchase Order (gate `not_procurement_order`), and a generated invoice's signed copy was built to create a Pending
Vendor Invoice. On a test copy all 527 approved WO invoices were approved by hand. The owner wants the System to approve
a WO invoice when one of three rules matches, so Accountants only see the rest.

We decided:

1. **Rule 1, signed copy (GST-off WOs only).** A WO invoice that is the signed copy of a generated invoice is approved
   by the System, **always**: rules 2 and 3 are not checked for it, even when it bills ahead of Amount Paid. The owner
   accepts that such an approval opens later payments under the invoice check (#1488). "Signed copy" means either path:
   - **Upload signed copy** (`generated_invoices.upload_signed_copy`): trusted as signed; the file is not checked.
   - **Add Invoice** whose AI-read invoice number matches a generated invoice on the same WO. It is treated as that
     generated invoice's signed copy (linked to it, so the amount counts once) only when the generated invoice is still
     *Generated*, the number was read by the AI (not typed), and the amount matches within ± ₹1. A number whose
     generated invoice is already Signed or Approved is refused as a duplicate. While reading a file for a GST-off WO
     with a generated invoice still Generated (and no other file), the AI also checks the printed "Authorized
     Signature" box: signed or stamped → approved by the System. Not signed → linked, and judged
     by rules 2 and 3 like any WO invoice: approved by the System when one matches, else left Pending for an invoice
     approver with the reason "Generated invoice not signed" beside theirs (owner, 2026-11-25). The
     Add Invoice dialog warns above its button that the copy looks unsigned; it never blocks.
   The approval runs **after** the record moves to *Signed* and is linked, in the same save, so
   `follow_generated_invoice` then moves it to *Approved*. Approved earlier, the record would stay *Signed* for ever.
2. **Rule 2, Total Amount.** Approved WO invoices + this one = the WO's total amount (GST included), ± ₹1. **Kept as
   first written: it approves even when only part is paid.**
3. **Rule 3, Amount Paid.** Approved WO invoices + this one = the WO's Amount Paid, which includes vendor TDS:
   **exactly equal, ± ₹1**, not "not more than Amount Paid".
   On a GST-on WO it compares the **base** parts only (base paid vs base invoiced; GST payments left out), because a GST
   payment can be requested only after an invoice is approved (ADR-0030).
4. **"Approved WO invoices" means Approved only**, not Pending ones, so a Pending invoice that is later rejected never
   carries another one through.
5. **When it runs:** at upload, and again in the existing 05:00 daily invoice re-check, which takes WO invoices too.
   Its first run also checks WO invoices already Pending. Re-check on Pending Invoice Approvals › WO (the queue, or one
   row) runs the same check now, preview first; on the PO tab Re-check stays the PO checks (owner, 2026-11-25). A
   signed copy whose WO turned GST-on after its upload gets no rule 1 there: rules 2 and 3 judge it.
6. **The System needs no role.** Its approval carries the server-only `SYSTEM_DECISION_FLAG`, as PO auto-approval does,
   so the WO decision guard lets it through whoever uploaded (ADR-0014 Amendment C). Approved by = "System",
   `auto_approved` = 1.
7. **Rules 2 and 3 compare amounts only.** No check on the uploaded file (AI read it, not typed by hand, invoice
   number not a duplicate): a typed amount that matches is approved. The owner accepts this (open point C, 2026-11-24).
8. **Why not; which rule only in Re-check's preview.** Nothing stored records which rule approved a WO invoice
   ("Auto-approved", approved by "System"); Re-check's preview names the rule that matches each invoice it will
   approve, with the two figures it compared (owner, 2026-11-25). When none matches, `auto_approve_skip_reasons` says why, shown in the existing *Not Auto-Approved
   Reason* column with the figures: WO total amount vs Approved invoices + this one; Amount Paid vs the same (base
   amounts on a GST-on WO); a generated invoice's copy not signed (Add Invoice path), before the other two. These replace
   `not_procurement_order` for WO invoices, and the daily check rewrites them, because they go stale as payments move.
9. **No "waiting for approval" notice for an approved signed copy.** After a signed copy upload, the project's
   Accountants are told only when the WO invoice is still Pending; when the System approved it, no notice is sent.
10. **Nothing else changes.** PO auto-approval, the invoice check, the WO payment limits, the Generate Invoice amount
   range, who may upload, generate, edit or approve by hand: all as before.

## Considered options

- **Rule 2 only up to Amount Paid.** Chosen first in the grill, then reversed by the owner: limited that way it can only
  match when the WO is fully paid, where rule 3 already matches, so it would add nothing.
- **Rule 1 only up to Amount Paid** (3 of 24 signed copies since June were ahead, by ₹400, ₹5,000 and ₹6,000).
  Rejected: the owner trusts the signed copy.
- **Rule 3 as "not more than Amount Paid"** (145 WO invoices since June against 117 for "equal"). Rejected by the
  owner: the invoices must match what is paid, ± ₹1; anything else goes to an invoice approver.
- **Pending + Approved invoices in the sums.** Rejected: an invoice could be approved on the back of Pending ones that
  are later rejected.
- **The PO safety gates for rules 2 and 3.** Most WO invoices are GST-off; their vendors have no GSTIN and print no tax
  lines, so two gates fail every time (66 of 242 invoices would pass instead of about 174). A smaller set (AI read
  it, not changed by hand, no duplicate number) was also declined (decision 7).

## Consequences

- About 78% of WO invoices since June (207 of 266, counted at upload) would be approved by the System; the daily
  check adds more.
- **Payments can open before the money is paid.** Rules 1 and 2 can approve an invoice ahead of Amount Paid; Total
  Amount Invoiced then rises and every payment after the first passes the invoice check with no Accountant having seen
  the invoice. Since June, 90 rule-2 invoices were ahead of Amount Paid (₹27.35 lakh). L1 / CEO approval of each
  payment by amount, and the Accountant's GST request approval, are unchanged.
- One person (Admin, PMO, Project Lead or a procurement profile) can generate an invoice and upload its signed copy,
  and with rule 1 it is approved with no second person.
- Add Invoice uploads of generated PDFs (4 on the test copy, left *Generated* and counted twice in the generate range)
  are linked from now on; old ones are not repaired by this decision.
- When it is built, the as-built docs change with it: `service-requests.md` (the #1547 invariant "no auto-approval"),
  `invoice-autofill.md` (gate 2), and GLOSSARY *Invoice approver* / *Generated invoice*.

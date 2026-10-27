# 40. A generated invoice's type follows its amount, and a deleted one keeps its RA number

Date: 2026-10-27

## Status

**Accepted** (owner, working session 2026-10-27). Built on branch `workorders`. Changes two rules of #1546 / #1547
(spec #1528): the type is no longer picked, and a generated invoice may now be deleted. Terms: `GLOSSARY.md`
§ *Generated invoice*, *RA number*. Delete rights on Vendor Invoices stay as [ADR-0014](./0014-invoice-mutation-permissions.md).

## Context

On a GST-off Work Order the company drafts the vendor's invoice (a *WO Generated Invoice*). The Generate dialog
asked for the type first: **RA**, or **FINAL**, which was offered only once the Work Order was fully paid and
billed whatever was left. A record was never deleted, and the Vendor Invoice its signed upload created could
not be deleted either ("reject it instead"), so a voided or wrong record stayed in the list for good.

The owner wanted the amount entered first, the FINAL recognised from the amount, and a way to remove a voided
record and to delete an uploaded invoice outright. Printed invoice numbers still must never repeat.

## Decision

1. **The type follows the amount.** `generate_invoice(work_order, invoice_date, amount)` takes no type. The
   invoice that brings what is billed (Pending + Approved Vendor Invoices + records still *Generated*) to the
   Work Order's amount, to within ₹10 (`FULLY_PAID_TOLERANCE`), is the **FINAL**; any other is the next **RA**
   (`services/wo_generated_invoices.is_final`). The amount limit is unchanged, so only a fully paid Work Order
   can reach its FINAL. The dialog previews the type (`utils/generatedInvoices.isFinalAmount`, pinned to the
   server by shared cases); the server decides.
2. **Amount opens empty.** A **Put Paid ₹X** button beside it fills in what is paid (incl. TDS) but not yet
   invoiced (`left`). The percentage box stays.
3. **Admin deletes a Voided record, in the app only** (`generated_invoices.delete_generated_invoice`). Desk and
   REST are refused for everyone, Administrator included: the record's `on_trash` needs `flags.deleted_in_app`.
4. **Deleting the Vendor Invoice a signed upload created deletes its generated invoice too**, whatever its
   status (`controllers/vendor_invoices.delete_generated_invoice_with_it`, on `on_trash`, before Frappe's link
   check). Who may delete that Vendor Invoice is unchanged (ADR-0014).
5. **An RA number is never given again**, a deleted record's included. Every delete leaves a Deleted Document
   copy; numbering reads those copies too (`_deleted_records`, `ra_number_of_record`), for the RA sequence and
   for the FINAL-n count. No schema change.

## Considered options

- **Reuse a deleted record's number** (next = highest live + 1). Rejected: two different printed invoices
  could carry the same RA number, and the deleted one may already be with the vendor.
- **Store burned numbers on the Work Order.** Rejected: a new field for what Deleted Document already keeps.
- **Let Desk delete a Voided record too.** Rejected by the owner: deleting is the Work Order page's.
- **Let the Generate roles delete** (Admin, PMO, Procurement, Project Lead). Rejected: Admin only.
- **Amount pre-filled with what is left when the dialog opens.** Built, then reversed the same day by the
  owner: the user fills it with the button.

## Consequences

- **The Deleted Document copies are load-bearing.** Clearing a Work Order's copies by hand would let a number
  repeat. A Work Order whose invoices were all deleted continues at the next number (e.g. RA-4 after RA-1…3).
- A FINAL deleted with its Vendor Invoice frees the Work Order: Generate is offered again, and the next FINAL
  prints FINAL-2.
- A browser still showing the old dialog sends `invoice_type`; `frappe.call` drops it and the amount decides.
- Frappe winds a naming series back when the newest record of it is deleted, so a new Vendor Invoice can take
  the name of one just deleted (seen: `VI-2026-05669`). It does not touch RA numbering; it only means a Deleted
  Document copy and a live invoice can share a name.

# Invoice mutation permissions — admin-only for Approved; enforcement varies by operation and surface

A Vendor Invoice at status *Approved* is financially committed (it counts toward the PO/WO invoiced total and drives billing status), so mutating one must be restricted. We decided that **editing or deleting an _Approved_ invoice is admin-only** (Admin = the `Administrator` user or a `Nirmaan Admin Profile` holder, per `GLOSSARY.md`), while *Pending* / *Rejected* invoices stay broadly mutable by the operational roles that manage a PO/WO. Two asymmetries follow, and **both are deliberate, not oversights**:

1. **Enforcement differs by operation.** *Delete* of an Approved invoice is enforced in **both** the UI (the button is hidden from non-admins via `canDeleteInvoice`) and the server (`delete_invoice_entry` returns a `{status: 403}` object for a non-admin *before* the transaction). *Edit* is enforced in the **UI only** — `update_invoice_data`'s field-update path (`invoice_no` / `invoice_date` / `invoice_amount` / `is_credit_note`) has no status or admin guard; only the line-mapping *rebuild* is admin-gated (`_admin_can_rebuild`). Rationale: a delete is irreversible (hard-deletes the invoice + its attachments + line mappings, then recomputes the PO `invoice_qty`), so a direct-API bypass is a real risk worth a server guard; a field edit is recoverable and captured in Frappe version history, so the UI gate is deemed sufficient.

2. **Permissions differ by surface.** On the **PO/WO detail page** delete follows the status rule (Pending/Rejected: any non-Estimates role; Approved: admin only). On the **PO/WO Invoices reconciliation tables** — a cross-project financial-oversight view — the entire edit/delete Actions column is admin-only regardless of status. Rationale: the reconciliation view must not expose casual invoice mutation to line roles; the detail page is the day-to-day operational surface where accountants manage a specific document's invoices.

The one invariant that holds on both surfaces is what the commits actually enforce: **mutating an _Approved_ invoice is admin-only.**

## Considered Options

- **Guard the edit path server-side too (symmetry with delete)** — rejected for now as scope creep: edits are recoverable and version-logged, and the UI gate covers the real workflow. Left as a documented gap (see Consequences).
- **Block deletion of Approved invoices entirely (no admin exception)** — rejected: admins legitimately need to remove a wrongly-approved or duplicate invoice, and a hard block forces DB surgery.
- **A full Frappe DocPerm role matrix** — rejected: overkill for a two-tier (admin vs not) rule, and production DocPerms are hand-tuned and must not be shipped via fixtures.
- **Mirror the detail page's broader Pending/Rejected permissions on the recon tables** — rejected: the recon view is oversight, not operations; admin-only is the safer default there.

## Consequences

- The "Approved invoice = admin-mutable" invariant is **fully enforced for delete, UI-only for edit**. A non-admin could still change an Approved invoice's amount via a direct `update_invoice_data` call — an accepted residual gap; close it by adding the same admin/status guard to the edit path if it ever becomes a real risk.
- "Admin" here is exactly `{Administrator, Nirmaan Admin Profile}` — the same pair used by `_admin_can_rebuild` (backend) and `isNirmaanAdmin` (frontend). Do not broaden it to PMO / Accountant Lead without revisiting this ADR.
- Invoice deletion is a **hard delete** (invoice + attachments + line mappings) followed by a PO `invoice_qty` recompute; there is no soft-delete or audit trail for the deletion itself.
- Credit Notes remain **PO-only**: the "Add Credit" affordance is hidden on WO/SR surfaces, and the credit flag is forced false for Service Requests.

## Amendment A — the edit gap is closed for Work Order invoices (2026-10-21)

**Accepted** (owner, decision record *Work Order Life After Creation*, Q3-A, T1-B and T2-B; spec #1528, #1531).
Purchase Order invoices are unchanged: everything above still describes them.

### Context

An approved Work Order invoice sets Total Amount Invoiced and GST Invoiced, which unlock payment requests and the
GST payment limit. Any logged-in user could approve or reject one through the API, and anyone could change an
approved one's amount through `update_invoice_data` or Desk while it stayed Approved: a wrong figure there lets
more money go out. The "accepted residual gap" in Consequences is no longer accepted for Work Orders.

### Decision

For a Vendor Invoice on a Work Order, checked on the server:

1. **Approve and reject** take an invoice-approval role (Admin, Accountant, Accountant Lead: the Pending queue's
   roles). An *Approved* Work Order invoice may also be rejected, which is how it is corrected by anyone who may
   not edit it: reject it and upload it again.
2. **Edit** (number, date, amounts, and the edit dialog as a whole) takes an Accountant or Admin.
3. **An Approved invoice's amount, number and date** may be changed only by Admin (`Administrator` or the
   Admin profile), as this ADR always said. It is now enforced, not just hidden in the UI.

Uploading a new invoice is not narrowed. Delete keeps the rule above.

The rule is the pure `services/work_order_invoice_access.change_problem`, applied by the Vendor Invoices
`validate` hook (`integrations/controllers/vendor_invoices.guard_work_order_invoice`), so the endpoints, Desk and
REST obey one check. The role sets are `role_profiles.WO_INVOICE_DECIDE_PROFILES`, `WO_INVOICE_EDIT_PROFILES`
and `WO_APPROVED_INVOICE_EDIT_PROFILES`. `update_invoice_data` also refuses the whole edit for anyone outside
the edit set, because a re-save with the same figures can still swap the attached bill.

### Considered options

- **Lock an Approved invoice for everyone, Admin too** (Q3-A as first answered). Rejected in T1: Admin can fix a
  typo without redoing the approval, and the server now enforces who Admin is.
- **The same rules for PO invoices** (T2-A). Not now: PO invoice permissions are out of spec #1528's scope.

### Consequences

- For Work Orders the invariant "mutating an Approved invoice is admin-only" is enforced for edit as well as
  delete, on every surface.
- No screen offers *Reject* on an Approved Work Order invoice yet; the server allows it for the approval roles.
- A new path that writes a Work Order invoice (the generated-invoice upload, #1547) runs as the session user and
  passes the same hook.

# Invoice mutation permissions — admin-only for Approved; enforcement varies by operation and surface

A Vendor Invoice at status *Approved* is financially committed (it counts toward the PO/WO invoiced total and drives billing status), so mutating one must be restricted. We decided that **editing or deleting an _Approved_ invoice is admin-only** (Admin = the `Administrator` user or a `Nirmaan Admin Profile` holder, per `CONTEXT.md`), while *Pending* / *Rejected* invoices stay broadly mutable by the operational roles that manage a PO/WO. Two asymmetries follow, and **both are deliberate, not oversights**:

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

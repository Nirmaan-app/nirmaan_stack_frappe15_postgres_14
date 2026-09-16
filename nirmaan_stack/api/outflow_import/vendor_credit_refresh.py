# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Putting a vendor's credit right after this import moves a payment (#1289, parent #1283).

WHY IT IS DONE HERE AT ALL, ON BOTH DIRECTIONS OF TRAVEL. `controllers/project_payments.on_update`
recalculates vendor credit on exactly ONE transition: `Approved -> Paid`. Neither of this feature's
writes is that transition any more.

  * A SETTLE now goes `Reconciliation Pending -> Paid` (#1289), because `Approved` means sanctioned
    and the record only reaches this import once an Accountant has marked it done.
  * An UNRECONCILE goes `Paid -> Approved`, which that branch never watched either (#1276).

⚠️ THE CONTROLLER'S BRANCH IS DELIBERATELY LEFT ALONE. Widening it to every entry into `Paid` would
change behaviour for every screen that fulfils a payment by hand, on a ticket about a bank import;
and widening it to every DEPARTURE from `Paid` would fire on a delete, which already has its own
branch. One narrow watcher plus two explicit call sites is the smaller blast radius, and each call
site says at its own line why it is there.

⚠️ RECOMPUTED FROM SOURCE, NEVER NUDGED BY A DELTA (root `CLAUDE.md`). `recalculate_vendor_credit`
sums every eligible PO of the vendor, so calling it twice for one vendor only appends a second ledger
entry worth zero -- which is why the PO names are folded by vendor first.

⚠️ IT COMMITS NOTHING, and must not start: both callers run inside a per-row savepoint, and a commit
would end that isolation and leave half a statement written with no record of which half.
"""

import frappe

from nirmaan_stack.api.vendor_credit import recalculate_vendor_credit

PO_DOCTYPE = "Procurement Orders"

#: The ledger entry a SETTLE writes. The same words the manual fulfil path uses
#: (`controllers/project_payments.on_update`), because it is the same event seen from a bank
#: statement rather than from the Payments screen -- a vendor's credit ledger should not read as two
#: different histories depending on which door the money left by.
SETTLED_ENTRY_TYPE = "Payment Fulfilled"


def recompute_vendor_credit(po_names, entry_type: str) -> None:
    """One full recompute per vendor behind `po_names`. The ledger entry names every PO of that vendor.

    `po_names` may hold duplicates, blanks and POs of the same vendor; all three are folded away here
    so no caller has to think about it.
    """
    by_vendor: dict[str, list[tuple[str, str | None]]] = {}
    for po in sorted({name for name in po_names if name}):
        values = frappe.db.get_value(PO_DOCTYPE, po, ["vendor", "project"], as_dict=True)
        if values and values.vendor:
            by_vendor.setdefault(values.vendor, []).append((po, values.project))
    for vendor, pos in sorted(by_vendor.items()):
        po_ids = ", ".join(po for po, _ in pos)
        projects = {project for _, project in pos}
        recalculate_vendor_credit(
            vendor,
            entry_type,
            po_id=po_ids,
            project=projects.pop() if len(projects) == 1 else None,
            description=f"{entry_type} for {po_ids}",
        )


def recompute_for_settled_payment(payment_name: str) -> None:
    """Refresh the credit of the vendor behind a payment this import has just marked `Paid`.

    ⚠️ A PAYMENT AGAINST A SERVICE REQUEST HAS NO CREDIT TO REFRESH, and reads as a no-op rather than
    a failure: vendor credit is measured against Procurement Orders, so a payment whose parent is not
    one contributes nothing to the sum. The same is true of a payment whose PO has been deleted.

    ⚠️ IT IS READ FROM THE PAYMENT, NOT PASSED IN. The settle has just saved the document; asking the
    database which PO it belongs to is one query and cannot disagree with what was written.
    """
    parent = frappe.db.get_value(
        "Project Payments", payment_name, ["document_type", "document_name"], as_dict=True
    )
    if not parent or parent.document_type != PO_DOCTYPE or not parent.document_name:
        return
    recompute_vendor_credit([parent.document_name], SETTLED_ENTRY_TYPE)

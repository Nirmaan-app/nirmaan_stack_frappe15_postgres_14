# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor Refunds -- what a refund may be recorded against, in one home.

A `Vendor Refund` names a vendor, a project, and what the amount was refunded against: ONE PO or Work
Order of that vendor on that project, or a MISC. EXPENSE -- no document at all (owner, 2026-09-17). A
bank credit split across three POs and the rest as misc becomes four records. Two rules:

  * `refund_document_problem` -- ONE record. Against a PO / WO: the document is that vendor's, on the
    chosen project when one is chosen, not a Merged PO, has been PAID something, and the amount is more than 0 and no more than
    is still refundable on it (paid, less what earlier refunds already took). A Misc. Expense names no
    document and has no cap -- only an amount more than 0. Asked by `Vendor Refunds.validate` on every
    save, and by the rule below for each part.
  * `refund_allocation_problem` -- ONE bank credit: a vendor, at least one part, no
    document twice and at most one Misc. Expense, every part passing the rule above, and the parts
    adding up EXACTLY (to the paisa) to the credit. Asked by
    `services/outflow_import/settle.create_vendor_refund_from_row` first.

`refund_documents` is the list the Bulk Import dialog offers, built from the SAME field map, status
exclusions and paid rule, so it cannot offer a document the write then refuses.

⚠️ A REFUND LOWERS ITS PO'S / WO'S `amount_paid` (owner, 2026-09-17, reversing the same day's "moves no
paid amount"). The stored field is `amount_paid_of`: the document's Paid `Project Payments` LESS its
Vendor Refunds -- recomputed from source, never decremented. EVERY writer of the field asks it
(`Project Payments.update_parent_amount_paid`, `_payment_utils._recalculate_amount_paid`, and the refund
hook in `integrations/controllers/vendor_refunds`), so a payment settling after a refund cannot write
the refund back out. It creates no `Project Payment`. Because the stored figure is now NET, `paid_of`
adds the refunds back to get what was PAID -- the cap would otherwise subtract every refund twice.

⚠️ THE PROJECT IS OPTIONAL (owner, 2026-09-17). With none chosen the lists cover the vendor's documents
on EVERY project, and a PO / WO refund records its DOCUMENT'S project (`document_project`) -- never a
guess. A Misc. Expense records the chosen project, or none.
"""

from decimal import ROUND_HALF_UP, Decimal

import frappe
from frappe.utils import flt

VENDOR_REFUNDS = "Vendor Refunds"
PROCUREMENT_ORDERS = "Procurement Orders"
SERVICE_REQUESTS = "Service Requests"

#: The `document_type` of a refund against NO document -- the part of a credit no PO or Work Order
#: takes. Not a DocType: `document_name` stays blank, so the Dynamic Link is never resolved.
MISC_EXPENSE = "Misc. Expense"

#: Each document type a refund may point at -> (its vendor field, its project field).
REFUND_DOCUMENT_FIELDS: dict[str, tuple[str, str]] = {
    PROCUREMENT_ORDERS: ("vendor", "project"),
    SERVICE_REQUESTS: ("vendor", "project"),
}

#: Statuses a refund may not be recorded against. A MERGED PO's payments moved to its master PO, so a
#: refund of that money belongs on the master. Cancelled and Inactive POs stay: an advance refunded on
#: a cancelled order is exactly the case a refund exists for.
EXCLUDED_STATUSES: dict[str, tuple[str, ...]] = {PROCUREMENT_ORDERS: ("Merged",)}

#: The columns each list reads, beyond `name` and `status` -- the table's own, plus what the PO / WO
#: details panel shows.
_LIST_FIELDS: dict[str, list[str]] = {
    PROCUREMENT_ORDERS: [
        "total_amount", "amount", "tax_amount", "amount_paid", "amount_invoiced", "amount_due",
        "po_amount_delivered", "latest_payment_date", "creation", "project",
    ],
    SERVICE_REQUESTS: [
        "total_amount", "amount_paid", "amount_invoiced", "amount_due", "creation", "project",
    ],
}

_PAISA = Decimal("0.01")


def money(value) -> Decimal:
    """A money figure as a Decimal rounded to the paisa -- the one precision every rule compares at."""
    return Decimal(str(value or 0)).quantize(_PAISA, rounding=ROUND_HALF_UP)


def paid_of(document_type: str, document, refunded: Decimal) -> Decimal:
    """How much has been paid on this document -- THE one definition of "paid" for a refund.

    The stored `amount_paid` is NET of the document's refunds (`amount_paid_of`), so `refunded` -- EVERY
    refund stored against it, a record being re-saved included -- is added back.
    """
    return money(document.get("amount_paid")) + refunded


def amount_paid_of(document_type: str, document_name: str, exclude_payment: str | None = None) -> float:
    """THE stored `amount_paid` of a PO / Work Order: its `Paid` Project Payments LESS its Vendor Refunds.

    `exclude_payment` is a payment being trashed -- still in the table while its `on_trash` runs. With
    no refund against the document this is exactly the plain sum of its Paid payments.
    """
    filters = {"document_type": document_type, "document_name": document_name, "status": "Paid"}
    if exclude_payment:
        filters["name"] = ["!=", exclude_payment]
    total_paid = sum(
        flt(p.amount) for p in frappe.get_all("Project Payments", filters=filters, fields=["amount"])
    )
    refunded = refunded_on(document_type, [document_name]).get(document_name)
    return total_paid - float(refunded) if refunded else total_paid


def refunded_on(document_type: str, names, exclude_refund: str | None = None) -> dict[str, Decimal]:
    """What earlier `Vendor Refunds` already took off each document, by name."""
    names = [n for n in (names or []) if n]
    if not names:
        return {}
    filters = {"document_type": document_type, "document_name": ["in", names]}
    if exclude_refund:
        filters["name"] = ["!=", exclude_refund]
    totals: dict[str, Decimal] = {}
    for refund in frappe.get_all(
        VENDOR_REFUNDS, filters=filters, fields=["document_name", "amount"], limit_page_length=0
    ):
        totals[refund.document_name] = totals.get(refund.document_name, Decimal("0")) + money(
            refund.amount
        )
    return totals


def document_project(document_type: str, document_name: str) -> str | None:
    """The project a PO / WO is on -- the project its refund records. None for a Misc. Expense."""
    if document_type not in REFUND_DOCUMENT_FIELDS or not document_name:
        return None
    return frappe.db.get_value(document_type, document_name, REFUND_DOCUMENT_FIELDS[document_type][1])


def refund_documents(vendor: str, project: str | None = None) -> dict[str, list[dict]]:
    """Every PAID document of this vendor a refund may point at, newest first, per type -- on `project`
    when one is given, on every project otherwise.

    Each row carries `paid`, `refunded` (what earlier refunds took off it) and `refundable` -- the most
    a new refund against it may be -- plus `project` and `project_name`.
    """
    project = (project or "").strip()
    result: dict[str, list[dict]] = {}
    for document_type, (vendor_field, project_field) in REFUND_DOCUMENT_FIELDS.items():
        filters: dict = {vendor_field: vendor}
        if project:
            filters[project_field] = project
        excluded = EXCLUDED_STATUSES.get(document_type)
        if excluded:
            filters["status"] = ["not in", list(excluded)]
        filters["amount_paid"] = [">", 0]
        rows = frappe.get_all(
            document_type,
            filters=filters,
            fields=["name", "status", *_LIST_FIELDS[document_type]],
            order_by="creation desc",
            limit_page_length=0,
        )
        refunded = refunded_on(document_type, [row.name for row in rows])
        for row in rows:
            already = refunded.get(row.name, Decimal("0"))
            paid = paid_of(document_type, row, already)
            row["paid"] = float(paid)
            row["refunded"] = float(already)
            row["refundable"] = float(max(paid - already, Decimal("0")))
        result[document_type] = rows

    # One read for every project named, so a vendor-wide list can say where each document is.
    project_ids = sorted({row.project for rows in result.values() for row in rows if row.project})
    names = (
        dict(
            frappe.get_all(
                "Projects",
                filters={"name": ["in", project_ids]},
                fields=["name", "project_name"],
                as_list=True,
                limit_page_length=0,
            )
        )
        if project_ids
        else {}
    )
    for rows in result.values():
        for row in rows:
            row["project_name"] = names.get(row.project) or row.project
    return result


def refund_document_problem(
    vendor, project, document_type, document_name, amount, exclude_refund: str | None = None
) -> str | None:
    """Why ONE refund of `amount` against this document cannot be recorded, or None.

    `project` is optional: when given, a PO / WO must be on it. `exclude_refund` is the record being
    re-saved, so its own amount does not count as an earlier refund.
    """
    if not (vendor or "").strip():
        return "A vendor is required to record a vendor refund."
    project = (project or "").strip()
    document_type = (document_type or "").strip()
    document_name = (document_name or "").strip()
    if document_type == MISC_EXPENSE:
        # Against no document, so nothing to own, pay or cap -- the credit's own total is the check.
        if document_name:
            return "A Misc. Expense refund is not against a PO or Work Order; leave the document blank."
        if money(amount) <= 0:
            return "Enter an amount greater than 0 for the Misc. Expense."
        return None
    if document_type not in REFUND_DOCUMENT_FIELDS:
        return "A refund can only be against a PO, a Work Order or a Misc. Expense."
    if not document_name:
        return f"Choose the {_noun(document_type)} the refund is against."

    vendor_field, project_field = REFUND_DOCUMENT_FIELDS[document_type]
    fields = [vendor_field, project_field, "status", "amount_paid"]
    document = frappe.db.get_value(document_type, document_name, fields, as_dict=True)
    if not document:
        return f"{_noun(document_type)} '{document_name}' not found."
    if document.get(vendor_field) != vendor:
        return f"{document_name} is not {vendor}'s {_noun(document_type)}."
    if project and document.get(project_field) != project:
        return f"{document_name} is not on project {project}."
    if document.get("status") in EXCLUDED_STATUSES.get(document_type, ()):
        return f"{document_name} is {document.get('status')}; record the refund on its master PO."

    stored = refunded_on(document_type, [document_name]).get(document_name, Decimal("0"))
    paid = paid_of(document_type, document, stored)
    if paid <= 0:
        return f"Nothing has been paid on {document_name}, so nothing can be refunded against it."
    amount = money(amount)
    if amount <= 0:
        return f"Enter an amount greater than 0 for {document_name}."
    already = (
        refunded_on(document_type, [document_name], exclude_refund).get(document_name, Decimal("0"))
        if exclude_refund
        else stored
    )
    refundable = max(paid - already, Decimal("0"))
    if amount > refundable:
        return (
            f"{document_name} was paid {paid}"
            + (f" and {already} of it is already refunded" if already else "")
            + f", so no more than {refundable} can be refunded against it."
        )
    return None


def refund_allocation_problem(vendor, project, allocations, refund_amount) -> str | None:
    """Why this bank credit cannot be split into these refunds, or None.

    `allocations` is a list of mappings with `document_type`, `document_name`, `amount`. `project` is
    optional -- see `refund_document_problem`.
    """
    if not (vendor or "").strip():
        return "A vendor is required to record a vendor refund."
    allocations = list(allocations or [])
    if not allocations:
        return "Choose at least one PO, Work Order or Misc. Expense the refund is against."

    seen: set[tuple[str, str]] = set()
    total = Decimal("0")
    for allocation in allocations:
        document_type = (allocation.get("document_type") or "").strip()
        document_name = (allocation.get("document_name") or "").strip()
        # A Misc. Expense has no name, so its key is ("Misc. Expense", "") -- one per credit.
        if (document_name or document_type == MISC_EXPENSE) and (document_type, document_name) in seen:
            return f"{document_name or MISC_EXPENSE} is chosen twice."
        seen.add((document_type, document_name))
        problem = refund_document_problem(
            vendor, project, document_type, document_name, allocation.get("amount")
        )
        if problem:
            return problem
        total += money(allocation.get("amount"))

    refund = money(refund_amount)
    if total != refund:
        return f"The amounts add up to {total}, but the refund is {refund}. They must match."
    return None


def _noun(document_type: str) -> str:
    return {
        PROCUREMENT_ORDERS: "PO",
        SERVICE_REQUESTS: "Work Order",
    }.get(document_type, document_type)

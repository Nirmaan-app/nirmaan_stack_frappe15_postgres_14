# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE AMOUNT PAID RULE of a PO / Work Order, and the Amount Due built on it (ADR-0034).

The stored `amount_paid` is the order's *Paid* Project Payments, PLUS the TDS withheld from the vendor
on them, LESS its *Received* Vendor Refunds (`amount_paid_of`; a waiting or cancelled refund lowers
nothing, ADR-0032; the tax, ADR-0034 Amendment A for a Work Order, Amendment B for a PO's recorded tax) -- recomputed from source, never
decremented. ONE writer stores it (`write_amount_paid`), with a Work Order's `total_tds` and the
order's Amount Due (`recompute_document_amount_due`, from `amount_due_from`). The callers: the payment save
(`integrations/controllers/project_payments.recount_orders`), the PO Adjustment recompute
(`_payment_utils._recalculate_amount_paid`), the refund hook (`integrations/controllers/vendor_refunds`)
and the mismatch judge's recount (`services/amount_paid_drift`), so a payment settling after a refund
cannot write the refund back out.

Pure (no `frappe.db`): `paid_money`, `orders_moved_by`, `amount_due_from`, `amount_due_columns`.
The rest read or write the database.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.vendor_refunds import LOWERS_PAID_STATUSES, refunded_on

# The two doctypes use DELIBERATELY DIFFERENT Amount Due formulas (owner decision 2026-08-19):
#   Procurement Orders   amount_invoiced - amount_paid   -> billed to us, not yet paid
#   Service Requests     total_amount    - amount_paid   -> ordered value, not yet paid
# The SR screens have always shown ordered-minus-paid and say so in their own footnote
# ("Amount Due = Total WO Value - Amt Paid"); switching them to invoiced-minus-paid
# would move 761 of 862 rows (measured 2026-08-19). Do NOT "harmonise" the two.
#
# ⚠️ A WORK ORDER'S TAX IS NOT A SUBTRAHEND (ADR-0034 Amendment A, #1509). The TDS withheld from the
# vendor is already inside its `amount_paid` (`amount_paid_of`), so taking `total_tds` off as well
# would count it twice; the tax the company paid on top was never owed to the vendor and is in neither.
#: Each order doctype -> (minuend, subtrahends) of its Amount Due. THE one source: the writer below and
#: the mismatch judge (`services/amount_paid_drift`) both read it.
AMOUNT_DUE_OPERANDS: dict[str, tuple[str, tuple[str, ...]]] = {
    "Procurement Orders": ("amount_invoiced", ("amount_paid",)),
    "Service Requests": ("total_amount", ("amount_paid",)),
}


def paid_money(payment) -> tuple | None:
    """What one Project Payment adds to an order's Amount Paid: `(document_type, document_name, amount)`
    while it is Paid, None otherwise (or with no payment). Pure."""
    if payment is None or payment.get("status") != "Paid":
        return None
    return (payment.get("document_type"), payment.get("document_name"), flt(payment.get("amount")))


def orders_moved_by(before, after) -> list[tuple[str, str]]:
    """The orders whose Amount Paid a payment save moves: none when its paid money is unchanged, else
    the order it leaves AND the order it joins (#1453, ADR-0034). Pure.

    THE WATCHED FIELDS of a payment are its status (in or out of Paid), `amount`, `document_type` and
    `document_name`. Watching status alone left an order stale whenever a Paid payment's amount was
    edited or it was moved to another order (15 POs on 2026-10-15). `before` is the payment as it was
    (None on insert), `after` as saved.
    """
    if paid_money(before) == paid_money(after):
        return []
    orders = []
    for payment in (before, after):
        order = (payment.get("document_type"), payment.get("document_name")) if payment is not None else None
        if order and all(order) and order not in orders:
            orders.append(order)
    return orders


def amount_due_columns(document_type: str) -> tuple[str, ...]:
    """The order columns its Amount Due is built from besides `amount_paid`. Pure."""
    minuend, subtrahends = AMOUNT_DUE_OPERANDS[document_type]
    return tuple(col for col in (minuend, *subtrahends) if col != "amount_paid")


def amount_due_from(document_type: str, values) -> float:
    """THE Amount Due of one PO / Work Order from its operands (`values` maps each column named in
    `AMOUNT_DUE_OPERANDS` to its figure). Pure: the writer below and the Amount Paid mismatch judge
    (`services/amount_paid_drift`, which passes the CORRECT paid figure) share it.

    A Work Order's is `total_amount - amount_paid`, its `amount_paid` already holding the TDS withheld
    from the vendor (Rs 10,000 order, Rs 9,800 paid + Rs 200 withheld -> 0 due). The tax the company
    paid on top is in neither figure (Rs 800 order, Rs 800 paid, Rs 16 on top -> 0 due).
    """
    minuend, subtrahends = AMOUNT_DUE_OPERANDS[document_type]
    return flt(values.get(minuend)) - sum(flt(values.get(col)) for col in subtrahends)


def amount_paid_of(document_type: str, document_name: str, exclude_payment: str | None = None) -> float:
    """THE stored `amount_paid` of a PO / Work Order: its `Paid` Project Payments, PLUS the TDS withheld
    from the vendor on them (their `Vendor`-borne deductions, ADR-0034 Amendments A and B), LESS its
    RECEIVED Vendor Refunds (a waiting or cancelled refund lowers nothing, ADR-0032).

    A vendor-borne payment is stored net of its tax (`services/payment_tds.write_deduction`), and that
    tax was paid to the tax office for the vendor, so it is settled against the order as the bank
    transfer is: Rs 10,000 gross, Rs 9,800 paid, Rs 200 withheld -> Rs 10,000. Tax the company paid ON
    TOP (`borne_by` Company, the payment kept whole) is not the vendor's and is left out. The tax comes
    from the one source the mismatch judge also reads (`payment_tds.borne_tds_by_order`). A PO takes no
    deductions, but the tax recorded on its old payments counts the same way once each is netted
    (Amendment B, `patches/v3_0/net_po_payments_with_tds`); one still stored gross holds it already.

    `exclude_payment` is a payment being trashed -- still in the table while its `on_trash` runs; its
    tax leaves with it.
    """
    filters = {"document_type": document_type, "document_name": document_name, "status": "Paid"}
    if exclude_payment:
        filters["name"] = ["!=", exclude_payment]
    total_paid = sum(
        flt(p.amount) for p in frappe.get_all("Project Payments", filters=filters, fields=["amount"])
    )
    tds = payment_tds.borne_tds_by_order(document_type, [document_name], exclude_payment).get(document_name)
    if tds:
        total_paid += tds.vendor
    refunded = refunded_on(document_type, [document_name], LOWERS_PAID_STATUSES).get(document_name)
    return total_paid - float(refunded) if refunded else total_paid


def write_amount_paid(document_type: str, document_name: str, exclude_payment: str | None = None) -> None:
    """THE WRITER of a PO's / Work Order's stored `amount_paid` and the figures built on it: its
    `total_tds` (a Work Order's; both are sums over the same Paid payments, so they move together)
    and its `amount_due`. Recomputed from source, so writing it twice changes nothing.

    Every path that moves a Paid payment's money or its tax calls it: the payment save and delete, a
    refund, and a deduction created or restated on a Paid payment (`payment_tds._recount_parent`).

    `set_value`, so no Procurement Orders / Service Requests `doc_events` fire: saving the order
    would run its own hooks on every payment. Each caller runs the recomputes that hang off it
    (vendor credit, refund links, CEO Hold). Commits nothing.
    """
    if not document_type or not document_name:
        return
    frappe.db.set_value(
        document_type, document_name, "amount_paid",
        amount_paid_of(document_type, document_name, exclude_payment=exclude_payment),
    )
    payment_tds.sync_total_tds(document_type, document_name, exclude_payment=exclude_payment)
    recompute_document_amount_due(document_type, document_name)


def recompute_document_amount_due(document_type: str, document_name: str) -> None:
    """Re-derive `amount_due` on ONE Procurement Order / Service Request.

    Called from every place that writes one of its operands -- there is no single
    owner, because the operands are maintained by different subsystems:

        amount_invoiced  <- api/invoices/_item_billing_sync.recompute_document_amount_invoiced
        total_amount     <- the Service Request's own save
        amount_paid      <- write_amount_paid (above)

    A Postgres GENERATED column was tried first and REJECTED: `bench migrate`
    re-asserts the type of every Currency column, and Postgres refuses to alter a
    column that a generated column depends on, so every migrate would fail.
    A `validate` hook was rejected too -- both operands are written with
    `db.set_value`, which bypasses the document lifecycle, so such a field would be
    stale on arrival.

    Reads the operands straight back from the row (same transaction, so it sees the
    write that triggered it) and lets `set_value` stamp `modified` / `modified_by`,
    matching `amount_invoiced` and `amount_paid`. Does NOT commit.
    """
    operands = AMOUNT_DUE_OPERANDS.get(document_type)
    if not operands or not document_name:
        return
    minuend, subtrahends = operands

    # Column and table names come from the constant above, never from a caller.
    projected = ", ".join('COALESCE("{0}", 0) AS "{0}"'.format(col) for col in (minuend, *subtrahends))
    row = frappe.db.sql(
        'SELECT {0} FROM "tab{1}" WHERE name = %(n)s'.format(projected, document_type),
        {"n": document_name}, as_dict=True,
    )
    if not row:
        return
    frappe.db.set_value(document_type, document_name, "amount_due", amount_due_from(document_type, row[0]))

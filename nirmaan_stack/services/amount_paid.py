# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE AMOUNT PAID RULE of a PO / Work Order, and the Amount Due built on it (ADR-0034).

The stored `amount_paid` is the order's *Paid* Project Payments LESS its *Received* Vendor Refunds
(`amount_paid_of`; a waiting or cancelled refund lowers nothing, ADR-0032) -- recomputed from source,
never decremented. ONE writer stores it (`write_amount_paid`), with the order's TDS withheld and its
Amount Due (`recompute_document_amount_due`, from `amount_due_from`). The callers: the payment save
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
#: Each order doctype -> (minuend, subtrahends) of its Amount Due. THE one source: the writer below and
#: the mismatch judge (`services/amount_paid_drift`) both read it.
AMOUNT_DUE_OPERANDS: dict[str, tuple[str, tuple[str, ...]]] = {
    "Procurement Orders": ("amount_invoiced", ("amount_paid",)),
    "Service Requests": ("total_amount", ("amount_paid", "total_tds")),
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


def amount_due_from(document_type: str, values, company_borne: bool) -> float:
    """THE Amount Due of one PO / Work Order from its operands (`values` maps each column named in
    `AMOUNT_DUE_OPERANDS` to its figure). Pure: the writer below and the Amount Paid mismatch judge
    (`services/amount_paid_drift`, which passes the CORRECT paid figure) share it.

    ⚠️ A LIST OF SUBTRAHENDS RATHER THAN ONE, BECAUSE A SERVICE REQUEST HAS TWO.
    `Project Payments.amount` on an SR is stored NET of tax withheld (services/payment_tds.py),
    so `total_amount - amount_paid` alone would report the withheld tax as still owed on every
    settled SR. Subtracting `total_tds` as well is the other half of that change and is not
    optional -- see the module docstring in `services/payment_tds.py`. Procurement Orders keep a
    single subtrahend and have no `total_tds` column to read.

    ⚠️ A COMPANY-BORNE WORK ORDER (Miscellaneous / Transportation only) KEEPS ITS PAYMENTS GROSS
    -- the tax is paid on top, not taken out -- so `amount_paid` already covers the whole order
    and subtracting `total_tds` as well would read it overpaid by its own tax (Rs 800 order,
    Rs 800 paid, Rs 16 TDS -> -16). The rule lives in `services/payment_tds.is_company_borne`.
    """
    minuend, subtrahends = AMOUNT_DUE_OPERANDS[document_type]
    if company_borne:
        subtrahends = tuple(col for col in subtrahends if col != "total_tds")
    return flt(values.get(minuend)) - sum(flt(values.get(col)) for col in subtrahends)


def amount_paid_of(document_type: str, document_name: str, exclude_payment: str | None = None) -> float:
    """THE stored `amount_paid` of a PO / Work Order: its `Paid` Project Payments LESS its RECEIVED
    Vendor Refunds (a waiting or cancelled refund lowers nothing, ADR-0032).

    `exclude_payment` is a payment being trashed -- still in the table while its `on_trash` runs. With
    no refund against the document this is exactly the plain sum of its Paid payments.
    """
    filters = {"document_type": document_type, "document_name": document_name, "status": "Paid"}
    if exclude_payment:
        filters["name"] = ["!=", exclude_payment]
    total_paid = sum(
        flt(p.amount) for p in frappe.get_all("Project Payments", filters=filters, fields=["amount"])
    )
    refunded = refunded_on(document_type, [document_name], LOWERS_PAID_STATUSES).get(document_name)
    return total_paid - float(refunded) if refunded else total_paid


def write_amount_paid(document_type: str, document_name: str, exclude_payment: str | None = None) -> None:
    """THE WRITER of a PO's / Work Order's stored `amount_paid` and the figures built on it: its
    `total_tds` (a Work Order's; both are sums over the same Paid payments, so they move together)
    and its `amount_due`. Recomputed from source, so writing it twice changes nothing.

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
        total_tds        <- services/payment_tds (a deduction restated)

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
    frappe.db.set_value(
        document_type, document_name, "amount_due",
        amount_due_from(document_type, row[0], payment_tds.is_company_borne(document_type, document_name)),
    )

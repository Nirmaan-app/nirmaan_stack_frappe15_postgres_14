# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE JUDGE of "is this order's stored Amount Paid right" (ADR-0034), and its recount.

An order is a PO or a Work Order. Its source is THE rule every writer shares: Paid Project Payments less
Received Vendor Refunds (`services/amount_paid.amount_paid_of`); its Amount Due is built from that with
the order's own formula (`services/amount_paid.amount_due_from`: PO invoiced - paid, WO total - paid - TDS
withheld from the vendor). An order is a MISMATCH when its stored `amount_paid` or `amount_due` is ₹1 or more off
(paisa rounding is not a mismatch). A mismatch means some path skipped the recount; it is reported,
never fixed silently.

  * `mismatches(doctype, names=None)` -- every mismatched order of one doctype (or of `names`), worked
    out live in ONE set-based query. Reads only.
  * `recount(doctype, name, credit_entry_type)` -- set one order from source. A PO goes through the
    refund sync step (`api/po_adjustments/refund_links.sync_po_refund_links`: paid, due, refund links,
    and its vendor's credit under `credit_entry_type`); a Work Order through the one writer
    (`services/amount_paid.write_amount_paid`: paid, TDS withheld, due). No CEO Hold re-check: a repair
    should not put a project on hold by itself; the project's next payment or refund re-checks it.

The integrity tests use `mismatches` as their judge: each performs an action and asserts it finds nothing
on the orders involved. The Amount Paid Mismatch report reads and recounts through it
(`api/reports/amount_paid_mismatch`).
"""

from typing import NamedTuple

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.api.po_adjustments.refund_links import sync_po_refund_links
from nirmaan_stack.services.amount_paid import amount_due_columns, amount_due_from, write_amount_paid
from nirmaan_stack.services.payment_tds import company_borne_tds_by_order
from nirmaan_stack.services.vendor_refunds import LOWERS_PAID_STATUSES, PROCUREMENT_ORDERS, SERVICE_REQUESTS

#: The orders that store an Amount Paid.
ORDER_DOCTYPES = (PROCUREMENT_ORDERS, SERVICE_REQUESTS)
#: A stored figure this far or more from its source is a mismatch; less is paisa rounding.
THRESHOLD = 1.0
#: The Vendor Credit Ledger entry type a PO recount writes its vendor's credit under (the Recount
#: button of the Amount Paid Mismatch report; the 2026-10-15 patch spells the same word itself).
RECOUNT_CREDIT_ENTRY = "Amount Paid Recount"


class Mismatch(NamedTuple):
    doctype: str
    name: str
    project: str | None
    vendor: str | None
    status: str | None
    stored_paid: float
    correct_paid: float
    stored_due: float
    correct_due: float

    @property
    def paid_difference(self) -> float:
        """What the stored Amount Paid is short of its source (negative: it reads too much)."""
        return flt(self.correct_paid - self.stored_paid, 2)


def mismatches(doctype: str, names=None) -> list[Mismatch]:
    """Every order of `doctype` (only those in `names` when given) whose stored Amount Paid or Amount
    Due is ₹1 or more off its source, sorted by name. One query, plus one for a Work Order's
    company-borne tax (`payment_tds.company_borne_tds_by_order`); writes nothing."""
    _assert_order_doctype(doctype)
    names = None if names is None else sorted({n for n in names if n})
    if names == []:
        return []
    due_columns = ", ".join(f'o."{col}"' for col in amount_due_columns(doctype))
    # Table and column names come from the constants above, never from a caller.
    rows = frappe.db.sql(
        f"""
        SELECT o.name, o.project, o.vendor, o.status,
               COALESCE(o.amount_paid, 0) AS stored_paid,
               COALESCE(o.amount_due, 0) AS stored_due,
               COALESCE(p.paid, 0) - COALESCE(r.refunded, 0) AS correct_paid,
               {due_columns}
        FROM "tab{doctype}" o
        LEFT JOIN (
            SELECT document_name, SUM(amount) AS paid FROM "tabProject Payments"
            WHERE document_type = %(doctype)s AND status = 'Paid'
            GROUP BY document_name
        ) p ON p.document_name = o.name
        LEFT JOIN (
            SELECT document_name, SUM(amount) AS refunded FROM "tabVendor Refunds"
            WHERE document_type = %(doctype)s AND status IN %(lowers)s
            GROUP BY document_name
        ) r ON r.document_name = o.name
        {"WHERE o.name IN %(names)s" if names else ""}
        ORDER BY o.name
        """,
        {"doctype": doctype, "lowers": tuple(LOWERS_PAID_STATUSES), "names": tuple(names or ())},
        as_dict=True,
    )
    company_borne_tds = company_borne_tds_by_order(doctype, names)
    found = []
    for row in rows:
        correct_paid = flt(row.correct_paid, 2)
        correct_due = flt(
            amount_due_from(doctype, {**row, "amount_paid": correct_paid}, company_borne_tds.get(row.name)), 2
        )
        stored_paid, stored_due = flt(row.stored_paid, 2), flt(row.stored_due, 2)
        if abs(stored_paid - correct_paid) >= THRESHOLD or abs(stored_due - correct_due) >= THRESHOLD:
            found.append(Mismatch(
                doctype, row.name, row.project, row.vendor, row.status,
                stored_paid, correct_paid, stored_due, correct_due,
            ))
    return found


def recount(doctype: str, name: str, credit_entry_type: str) -> Mismatch | None:
    """Set one order's Amount Paid and Amount Due from source (a PO's vendor credit too, under
    `credit_entry_type`). Returns the mismatch as found before, or None when the order was already
    right, which is then not written. Throws if it still differs after. Commits nothing."""
    changed = _recount(doctype, [name], credit_entry_type)
    return changed[0] if changed else None


def _recount(doctype: str, names, credit_entry_type: str) -> list[Mismatch]:
    found = mismatches(doctype, names)
    if not found:
        return []
    names = [m.name for m in found]
    if doctype == PROCUREMENT_ORDERS:
        sync_po_refund_links(names, credit_entry_type)
    else:
        for name in names:
            write_amount_paid(doctype, name)
    still = mismatches(doctype, names)
    if still:
        frappe.throw(_("Amount Paid still differs from source after the recount: {0}").format(still))
    return found


def _assert_order_doctype(doctype: str) -> None:
    if doctype not in ORDER_DOCTYPES:
        frappe.throw(_("{0} does not store an Amount Paid.").format(doctype))


# ── the 2026-10-15 recount patch ────────────────────────────────────────────────────────────────
# `patches/v3_0/recount_drifted_po_amount_paid` (append-only) calls these two by name and reads
# `name`, `stored` and `source` off each row. They are the judge above, PO-only.


class Drift(NamedTuple):
    name: str
    stored: float
    source: float


def drifted_pos(po_names) -> list[Drift]:
    """The POs among `po_names` the judge finds wrong, with their stored and source Amount Paid."""
    return [_drift(m) for m in mismatches(PROCUREMENT_ORDERS, po_names)]


def recount_pos(po_names, credit_entry_type: str) -> list[Drift]:
    """`recount` for many POs at once: one credit entry per vendor. Returns what it changed."""
    return [_drift(m) for m in _recount(PROCUREMENT_ORDERS, po_names, credit_entry_type)]


def _drift(m: Mismatch) -> Drift:
    return Drift(m.name, m.stored_paid, m.correct_paid)

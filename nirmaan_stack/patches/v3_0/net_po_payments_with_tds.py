# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Cut the old PO payments that carry a tax record to net, so their tax counts once (spec #1528, #1534).

WHY
    `backfill_po_payment_tds_deductions` (2026-09) wrote a vendor-borne `Payment TDS Deduction` beside 86
    Paid PO payments (Rs 1,39,503 of tax, 2026-10-08 copy) and left each payment at its GROSS with the
    legacy `Project Payments.tds` box filled in. Spec #1508 then counted every payment's recorded tax on
    top of its amount in the Vendor Ledger and the Vendor report, so those 86 counted their tax twice.

    ADR-0034 Amendment B (owner, 2026-10-21): a PO's recorded tax counts in its Amount Paid as a Work
    Order's does, and these payments are cut to what the vendor got. Until a payment is cut its tax counts
    nowhere on top (`services/payment_tds.counted_deductions_sql`: a PO payment still carrying the legacy
    box is stored gross); this patch cuts it and clears the box, and from then its tax counts on top. So
    every figure reads the same before and after: Amount Paid = net + tax = the old gross.

WHAT IT DOES, per PO payment with a tax record that still carries the legacy box
    * cuts `amount` to `gross_amount - tds_amount` and clears `tds` (no `modified` stamp: no person
      edited it);
    * SKIPS AND LISTS (owner, V2): a payment matched to a bank line (its amount may already be the bank's
      net figure, and a match cannot be un-matched cleanly once its amount moves); tax of Rs 5 or less
      (within the bank import's settle window, so it may already be net); and, as guards, a payment not
      Paid or whose amount is no longer the recorded gross. A skipped payment keeps its box, so its tax
      still counts nowhere on top and its figures stay as they were;
    * recounts each touched PO from source through the refund sync step (`sync_po_refund_links`: paid,
      due, refund links, and its vendor's credit under one "PO TDS Netting" ledger entry), then re-checks
      CEO Hold on each touched project (`recheck_after_recount`; a no-op under `bench migrate`).

THE "NOTHING MOVED" CHECK
    Before writing, it snapshots every touched PO's stored Amount Paid and Amount Due, every touched
    vendor's credit used as its POs give it (`api/vendor_credit._compute_credit_used`; a stored credit
    already stale for another reason is refreshed by the recount, which this cut did not cause) and every
    touched project's outflow (`services/project_money`).
    After the recount it reads them again. If any differs by a paisa or more it rolls back and throws,
    naming each one: nothing is written. The cut is exact (`gross - tax`, unrounded), so net + tax is the
    gross to the paisa.

HOOKS
    The cut is a `set_value`, so no Project Payments `doc_events` fire. Each recompute that hangs off a
    Paid payment's amount is run here instead: the PO's Amount Paid and Amount Due, its refund links, its
    vendor's credit and the project's CEO Hold. The deduction rows, their challans and the Work Orders are
    not touched: the tax figures do not change.

RUN BY HAND, preview first
    bench --site <site> execute nirmaan_stack.patches.v3_0.net_po_payments_with_tds.preview
    bench --site <site> execute nirmaan_stack.patches.v3_0.net_po_payments_with_tds.execute
`preview` only reads. `bench execute` commits after `execute` returns; on a throw it writes nothing. The
`patches.txt` line then makes `migrate` run it again, which finds nothing to cut. A second run changes
nothing: a cut payment has no box, so it is never selected again.
"""

from typing import NamedTuple

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.api.po_adjustments.refund_links import sync_po_refund_links
from nirmaan_stack.api.vendor_credit import _compute_credit_used
from nirmaan_stack.services.payment_tds import PAID, PAYMENT_DOCTYPE, PROCUREMENT_ORDER_DOCTYPE, TDS_DOCTYPE
from nirmaan_stack.services.project_money import project_money

TAG = "net_po_payments_with_tds"
CREDIT_ENTRY = "PO TDS Netting"
#: Tax at or below this is left alone: the bank import's settle window (Rs 5) may already have netted it.
TINY_TAX = 5.0
#: A figure this far or more from its snapshot has moved.
PAISA = 0.01

SKIP_BANK_MATCHED = "matched to a bank line"
SKIP_TINY_TAX = "tax of Rs 5 or less"
SKIP_NOT_PAID = "not Paid"
SKIP_NOT_GROSS = "amount is no longer the recorded gross"


class Payment(NamedTuple):
    """One PO payment with a tax record still stored gross, and why it is skipped (None: it is cut)."""

    payment: str
    po: str
    project: str | None
    vendor: str | None
    amount: float
    gross: float
    tds: float
    reason: str | None

    @property
    def net(self) -> float:
        return flt(self.gross - self.tds, 6)


class Plan(NamedTuple):
    cut: list[Payment]
    skipped: list[Payment]


def plan(pos=None) -> Plan:
    """What `execute` would cut and skip (only payments on `pos` when given). Reads only."""
    if pos is not None and not pos:
        return Plan([], [])
    rows = frappe.db.sql(
        f"""
        SELECT p.name AS payment, p.document_name AS po, p.project, p.vendor, p.status,
               p.amount, d.gross_amount AS gross, d.tds_amount AS tds,
               EXISTS (
                   SELECT 1 FROM "tabOutflow Row Match" m
                   WHERE m.target_doctype = %(payment_doctype)s AND m.target_name = p.name
                     AND m.reversed_at IS NULL
               ) AS bank_matched
        FROM "tab{TDS_DOCTYPE}" d
        INNER JOIN "tab{PAYMENT_DOCTYPE}" p ON p.name = d.project_payment
        WHERE p.document_type = %(po_doctype)s
          AND COALESCE(TRIM(p.tds), '') <> ''
          {"AND p.document_name IN %(pos)s" if pos is not None else ""}
        ORDER BY p.document_name, p.name
        """,
        {"payment_doctype": PAYMENT_DOCTYPE, "po_doctype": PROCUREMENT_ORDER_DOCTYPE, "pos": tuple(pos or ())},
        as_dict=True,
    )
    cut, skipped = [], []
    for row in rows:
        payment = Payment(row.payment, row.po, row.project, row.vendor, flt(row.amount), flt(row.gross),
                          flt(row.tds), _skip_reason(row))
        (skipped if payment.reason else cut).append(payment)
    return Plan(cut, skipped)


def _skip_reason(row) -> str | None:
    if row.status != PAID:
        return SKIP_NOT_PAID
    if row.bank_matched:
        return SKIP_BANK_MATCHED
    if flt(row.tds) <= TINY_TAX:
        return SKIP_TINY_TAX
    if abs(flt(row.amount) - flt(row.gross)) >= PAISA or flt(row.tds) >= flt(row.gross):
        return SKIP_NOT_GROSS
    return None


def preview(pos=None) -> Plan:
    """Print what `execute` would cut and skip. Writes nothing."""
    found = plan(pos)
    _print("would cut", found)
    return found


def execute(pos=None) -> Plan:
    """Cut each payment of `plan(pos)` to net, recount, and check that nothing moved. Returns the plan."""
    found = plan(pos)
    _print("cut", found)
    if not found.cut:
        return found

    touched_pos = sorted({p.po for p in found.cut})
    before = _figures(touched_pos)
    for p in found.cut:
        frappe.db.set_value(PAYMENT_DOCTYPE, p.payment, {"amount": p.net, "tds": None}, update_modified=False)
    sync_po_refund_links(touched_pos, CREDIT_ENTRY)
    moved = _moved(before, _figures(touched_pos))
    if moved:
        frappe.db.rollback()
        frappe.throw(_("{0}: aborted, nothing written. These moved: {1}").format(TAG, "; ".join(moved)))

    # Local: the controller module pulls in the notification stack.
    from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import recheck_after_recount

    for project in sorted({p.project for p in found.cut if p.project}):
        recheck_after_recount(project)
    return found


def _figures(pos) -> dict:
    """`{label: figure}` for the "nothing moved" check: each PO's stored Amount Paid and Amount Due, each
    of their vendors' credit used, and each of their projects' outflow."""
    figures = {}
    rows = frappe.get_all(
        PROCUREMENT_ORDER_DOCTYPE, filters={"name": ["in", pos]},
        fields=["name", "vendor", "project", "amount_paid", "amount_due"],
    )
    for row in rows:
        figures[f"{row.name} Amount Paid"] = flt(row.amount_paid)
        figures[f"{row.name} Amount Due"] = flt(row.amount_due)
    # Worked out from the POs, not read off the vendor: a stored credit already stale for some other
    # reason is refreshed by the recount, and that is not a move this cut caused.
    for vendor in sorted({row.vendor for row in rows if row.vendor}):
        figures[f"vendor {vendor} credit used"] = flt(_compute_credit_used(frappe.get_doc("Vendors", vendor)))
    projects = sorted({row.project for row in rows if row.project})
    money = project_money(projects) if projects else {}
    for project in projects:
        figures[f"project {project} outflow"] = flt(money[project].outflow) if project in money else 0.0
    return figures


def _moved(before: dict, after: dict) -> list[str]:
    return [
        f"{label} {before.get(label, 0):,.2f} -> {after.get(label, 0):,.2f}"
        for label in sorted(set(before) | set(after))
        if abs(flt(before.get(label)) - flt(after.get(label))) >= PAISA
    ]


def _print(verb, found: Plan):
    print(f"{TAG}: {verb} {len(found.cut)} PO payments, Rs {sum(p.tds for p in found.cut):,.2f} of tax "
          f"on {len({p.po for p in found.cut})} POs")
    for p in found.cut:
        print(f"  {p.payment:<18} {p.po:<22} {p.gross:>14,.2f} -> {p.net:>14,.3f}  tax {p.tds:>10,.3f}")
    print(f"{TAG}: skipped {len(found.skipped)} PO payments, Rs {sum(p.tds for p in found.skipped):,.2f} of tax")
    for p in found.skipped:
        print(f"  {p.payment:<18} {p.po:<22} {p.amount:>14,.2f}  tax {p.tds:>10,.3f}  ({p.reason})")

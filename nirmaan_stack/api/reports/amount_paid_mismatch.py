# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Amount Paid Mismatch report (Reports → PO and Reports → WO, #1455, ADR-0034).

Thin doors onto the judge, `services/amount_paid_drift`: it decides what is a mismatch (stored Amount
Paid, Amount Due or a WO's Total TDS ₹1 or more off Paid payments, plus a WO's TDS withheld from the
vendor, less Received refunds) and how an order is recounted. Nothing here re-states that rule.

    nirmaan_stack.api.reports.amount_paid_mismatch.get_amount_paid_mismatches
        doctype="Procurement Orders"            (or "Service Requests")
        -> [{doctype, name, project, project_name, vendor, vendor_name, status,
             stored_paid, correct_paid, paid_difference, stored_due, correct_due,
             stored_tds, correct_tds}, ...]          (the two TDS figures 0 on a PO)
        worked out live on every call, sorted by order name

    nirmaan_stack.api.reports.amount_paid_mismatch.recount_amount_paid      (POST)
        doctype="Procurement Orders", name="PO/001/00001/25-26"
        -> {"recounted": True, "before": {...the row as it was}}   or {"recounted": False, "before": None}
        when the order was already right (nothing is written then)

A PO's recount also recounts its refund links and its vendor's credit (one "Amount Paid Recount"
ledger entry). No CEO Hold re-check: a repair does not put a project on hold by itself.

Both are for Admin and Accountant Lead only (`services/role_profiles.AMOUNT_PAID_MISMATCH_PROFILES`),
checked here: this is the enforcement boundary, the report's place in the dropdown is display only.
"""

import frappe
from frappe import _

from nirmaan_stack.services.amount_paid_drift import RECOUNT_CREDIT_ENTRY, Mismatch, mismatches, recount
from nirmaan_stack.services.role_profiles import assert_amount_paid_mismatch_access


@frappe.whitelist()
def get_amount_paid_mismatches(doctype: str) -> list[dict]:
    """Every order of `doctype` whose stored Amount Paid or Amount Due differs from source by ₹1+."""
    assert_amount_paid_mismatch_access(frappe.session.user)
    found = mismatches(doctype)
    projects = _names("Projects", "project_name", {m.project for m in found})
    vendors = _names("Vendors", "vendor_name", {m.vendor for m in found})
    return [
        {**_row(m), "project_name": projects.get(m.project), "vendor_name": vendors.get(m.vendor)}
        for m in found
    ]


@frappe.whitelist(methods=["POST"])
def recount_amount_paid(doctype: str, name: str) -> dict:
    """Set one order's Amount Paid and Amount Due from source (a PO's refund links and vendor credit
    too). Commits. `recounted` is False when the order was already right; nothing is written then."""
    assert_amount_paid_mismatch_access(frappe.session.user)
    if not frappe.db.exists(doctype, name):
        frappe.throw(_("{0} {1} not found.").format(doctype, name), frappe.DoesNotExistError)
    before = recount(doctype, name, RECOUNT_CREDIT_ENTRY)
    frappe.db.commit()
    return {"recounted": before is not None, "before": _row(before) if before else None}


def _names(doctype: str, field: str, names: set) -> dict:
    names = [n for n in names if n]
    if not names:
        return {}
    return dict(frappe.get_all(doctype, filters={"name": ["in", names]}, fields=["name", field], as_list=True))


def _row(m: Mismatch) -> dict:
    return {**m._asdict(), "paid_difference": m.paid_difference}

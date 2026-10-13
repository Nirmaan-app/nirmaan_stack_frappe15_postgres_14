# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Add Cheque dialog's line pickers (spec #1407, #1410, #1411). Thin: check who is asking, then read.

Who: `CHEQUE_ACCESS_PROFILES`, the same as adding a Cheque. The lists themselves are
`services/cheques/pickers.py`.
"""

import frappe
from frappe import _

from nirmaan_stack.services.cheques import pickers
from nirmaan_stack.services.cheques.rules import EXPENSE_LINE_TYPES, RECORD_DOCTYPES
from nirmaan_stack.services.role_profiles import assert_cheque_access


@frappe.whitelist()
def get_vendor_records(vendor: str) -> list[dict]:
    """The Vendor's POs and Work Orders that can hold a payment, each with its project."""
    assert_cheque_access(frappe.session.user)
    return pickers.vendor_records(vendor)


@frappe.whitelist()
def get_eligible_payments(record_doctype: str, record_name: str, cheque: str | None = None) -> dict:
    """The PO / Work Order's payments that may go on a Cheque, and counts of what was hidden.

    `cheque` is the Cheque being edited, if any: its own payments stay offered.
    """
    assert_cheque_access(frappe.session.user)
    if record_doctype not in RECORD_DOCTYPES:
        frappe.throw(_("Pick a PO or Work Order."))
    return pickers.eligible_payments(record_doctype, record_name, exclude_cheque=cheque or None)


@frappe.whitelist()
def get_eligible_expenses(line_type: str, project: str | None = None, cheque: str | None = None) -> dict:
    """The expenses an expense line may name, and the ones hidden for being on a live Cheque (#1411).

    `line_type` is "Project Expense" (then `project` picks whose) or "Non-project Expense". `cheque`
    is the Cheque being edited, if any: its own expenses stay offered.
    """
    assert_cheque_access(frappe.session.user)
    if line_type not in EXPENSE_LINE_TYPES:
        frappe.throw(_("Pick a Project Expense or Non-project Expense line."))
    return pickers.eligible_expenses(line_type, project or None, exclude_cheque=cheque or None)

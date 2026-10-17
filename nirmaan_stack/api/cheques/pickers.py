# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Add Cheque dialog's line pickers (spec #1407, #1410; #1482). Thin: check who is asking, then read.

Who: `CHEQUE_ACCESS_PROFILES`, the same as adding a Cheque. The lists themselves are
`services/cheques/pickers.py`.
"""

import frappe
from frappe import _

from nirmaan_stack.services.cheques import pickers
from nirmaan_stack.services.cheques.rules import PO_DOCTYPE
from nirmaan_stack.services.role_profiles import assert_cheque_access


@frappe.whitelist()
def get_vendor_records(vendor: str) -> list[dict]:
    """The Vendor's open POs, each with its project."""
    assert_cheque_access(frappe.session.user)
    return pickers.vendor_records(vendor)


@frappe.whitelist()
def get_securable_records(vendor: str) -> list[dict]:
    """The Vendor's open POs and Work Orders, each with its project: what a Security Deposit cheque may
    name as secured (#1486)."""
    assert_cheque_access(frappe.session.user)
    return pickers.securable_records(vendor)


@frappe.whitelist()
def get_eligible_payments(
    record_doctype: str, record_name: str, cheque: str | None = None, other_payments=None
) -> dict:
    """The PO's payments that may go on a Payment cheque, and counts of what was hidden.

    `cheque` is the Cheque being edited, if any: its own payments stay offered. `other_payments` (a
    list or its JSON) are the payments on the cheque's other lines: only their step is offered.
    """
    assert_cheque_access(frappe.session.user)
    if record_doctype != PO_DOCTYPE:
        frappe.throw(_("Pick a PO: a Payment cheque pays PO payments only."))
    others = frappe.parse_json(other_payments) if isinstance(other_payments, str) else other_payments
    return pickers.eligible_payments(record_name, exclude_cheque=cheque or None, other_payments=others or ())

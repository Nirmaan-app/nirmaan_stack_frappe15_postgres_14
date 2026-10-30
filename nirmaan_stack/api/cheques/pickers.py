# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Security Deposit cheque form's "Secures" picker (#1486). Thin: check who is asking, then read.

Who: `CHEQUE_ACCESS_PROFILES`, the same as recording a Cheque. The list itself is
`services/cheques/pickers.py`. A Payment cheque's lines have no picker: the Tracker makes no Payment cheque
and never changes its lines (spec #1514).
"""

import frappe

from nirmaan_stack.services.cheques import pickers
from nirmaan_stack.services.role_profiles import assert_cheque_access


@frappe.whitelist()
def get_securable_records(vendor: str) -> list[dict]:
    """The Vendor's open POs and Work Orders, each with its project: what a Security Deposit cheque may name
    as secured (#1486; Work Orders again since ADR-0035 Amendment C)."""
    assert_cheque_access(frappe.session.user)
    return pickers.securable_records(vendor)

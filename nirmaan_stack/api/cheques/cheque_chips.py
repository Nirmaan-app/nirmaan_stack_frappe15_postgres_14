# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The cheque chip's facts for a page of payments (#1415, spec #1407).

A list that reads Project Payments through the generic list endpoint (Vendor › Payments) or as plain
docs (the Transaction Details cards, #1416) gets each payment's `cheque` link only. One call per page
turns those names into the chip's number and status. The payment queues need no call: their rows
already carry both (`api/approvals/get_approval_queue`).

Who: anyone who can read Project Payments. The chip shows only what the payment row already implies
(its cheque number) plus the Cheque's status, so it is not held to the Cheque report's roles; opening
the Cheque itself (`cheque_detail.get_cheque`) still is.
"""

import json

import frappe
from frappe import _

from nirmaan_stack.services.cheques.writer import CHEQUES

MAX_CHEQUES = 500


@frappe.whitelist()
def get_cheque_chips(cheques) -> dict:
    """`{cheque name: {cheque_no, status}}` for the named Cheques; a name that is not a Cheque is left out.

    `cheques` is a list of Cheque names, or that list as JSON.
    """
    if not frappe.has_permission("Project Payments", "read"):
        raise frappe.PermissionError(_("You are not allowed to see payments."))
    if isinstance(cheques, str):
        cheques = json.loads(cheques or "[]")
    names = sorted({n for n in cheques or [] if n})[:MAX_CHEQUES]
    if not names:
        return {}
    rows = frappe.get_all(CHEQUES, filters={"name": ["in", names]}, fields=["name", "cheque_no", "status"])
    return {r.name: {"cheque_no": r.cheque_no, "status": r.status} for r in rows}

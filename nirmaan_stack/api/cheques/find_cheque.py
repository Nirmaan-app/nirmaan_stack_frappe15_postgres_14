# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Is this bank + cheque number already recorded? Asked by the Request Payment dialog (#1414).

A PO / Work Order Request Payment in Cheque mode always makes a new Cheque, so the dialog asks as soon
as it has a bank and number and shows the refusal (with a link to that Cheque) before Submit. The
request endpoints refuse the same on Submit (`api/payments/payment_cheque`); this only spares the
round trip. Read-only.

Who: anyone who may request a payment (create on Project Payments) or use Cheques.
"""

import frappe
from frappe import _

from nirmaan_stack.services.cheques.rules import bank_label, parse_header, request_duplicate_problem
from nirmaan_stack.services.cheques.writer import CHEQUES, existing_cheque
from nirmaan_stack.services.role_profiles import can_use_cheques


@frappe.whitelist(methods=["GET"])
def find_cheque(bank: str, cheque_no: str, bank_name: str | None = None) -> dict | None:
    """The Cheque already recorded with this bank + cheque number, or None.

    Returns `{cheque, cheque_no, bank_label, status, message}`; `message` is the Request Payment
    refusal, word for word as Submit would give it.
    """
    user = frappe.session.user
    if not (can_use_cheques(user) or frappe.has_permission("Project Payments", "create", user=user)):
        raise frappe.PermissionError(_("You are not allowed to look up cheques."))
    header = parse_header({"bank": bank, "bank_name": bank_name, "cheque_no": cheque_no})
    if not header.bank or not header.cheque_no:
        return None
    name = existing_cheque(header.bank, header.bank_name, header.cheque_no)
    if not name:
        return None
    found = frappe.db.get_value(CHEQUES, name, ["cheque_no", "bank", "bank_name", "status"], as_dict=True)
    return {
        "cheque": name,
        "cheque_no": found.cheque_no,
        "bank_label": bank_label(found.bank, found.bank_name),
        "status": found.status,
        "message": request_duplicate_problem(header),
    }

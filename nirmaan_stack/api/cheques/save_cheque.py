# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Save a Cheque from Reports -> Payments -> Cheque Payments -> Add Cheque (spec #1407).

Thin: check who is asking, call the cheques service (`services/cheques/writer.py`), commit, publish.
The rules (photo, one payee, the description an Ad-hoc cheque needs, bank + number uniqueness) are
the service's and the `validate` controller's.

Who: `CHEQUE_ACCESS_PROFILES` (Admin, Accountant, Accountant Lead and the Procurement profiles).

#1408 creates a Cheque with no lines (an Ad-hoc cheque). Lines (#1410, #1411) and editing (#1418)
are added to this same endpoint.
"""

import frappe
from frappe import _

from nirmaan_stack.services.cheques.rules import MADE_FROM_REPORT, parse_header
from nirmaan_stack.services.cheques.writer import create_cheque
from nirmaan_stack.services.role_profiles import can_use_cheques

#: Published after every Cheque write; the Cheque Payments report refetches on it.
CHEQUES_CHANGED_EVENT = "cheques:changed"


def assert_cheque_access(user: str) -> None:
    """Refuse a user outside `CHEQUE_ACCESS_PROFILES` (Project Managers included)."""
    if not can_use_cheques(user):
        raise frappe.PermissionError(_("You are not allowed to view or add cheques."))


@frappe.whitelist(methods=["POST"])
def save_cheque(
    bank: str,
    cheque_no: str,
    cheque_date: str,
    amount,
    bank_name: str | None = None,
    vendor: str | None = None,
    payee_name: str | None = None,
    description: str | None = None,
    attachment: str | None = None,
) -> dict:
    """Record a new Cheque, made from the report, at Issued.

    `bank` is "ICICI Bank" or "Others" (then `bank_name` is required). Exactly one of `vendor` or
    `payee_name`. `attachment` is the uploaded photo's file URL. `description` is required while
    the Cheque has no lines.

    Returns `{cheque, status}`.
    """
    user = frappe.session.user
    assert_cheque_access(user)
    header = parse_header({
        "bank": bank,
        "bank_name": bank_name,
        "cheque_no": cheque_no,
        "cheque_date": cheque_date,
        "amount": amount,
        "vendor": vendor,
        "payee_name": payee_name,
        "description": description,
        "attachment": attachment,
    })
    doc = create_cheque(header, user=user, made_from=MADE_FROM_REPORT)
    frappe.db.commit()
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheque": doc.name})
    return {"cheque": doc.name, "status": doc.status}

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Change a Cheque's status from the Cheque Payments report: one, or many from the bulk bar (#1412).

Thin: check who is asking, call the cheques service (`services/cheques/status.py`), commit, publish.
The rules (Cancel needs a note, Cancel refused while a payment is Paid, leaving Cancelled refused
while a payment is on another live Cheque) are the service's.

Who: `CHEQUE_ACCOUNTS_PROFILES` (Admin, Accountant, Accountant Lead). Procurement may add a Cheque
but never change its status.
"""

import frappe
from frappe import _

from nirmaan_stack.api.cheques.save_cheque import CHEQUES_CHANGED_EVENT
from nirmaan_stack.services.cheques.status import change_status, change_statuses
from nirmaan_stack.services.role_profiles import CHEQUE_ACCOUNTS_PROFILES, has_role_profile


def _assert_can_change_status(user: str) -> None:
    if not has_role_profile(user, CHEQUE_ACCOUNTS_PROFILES):
        raise frappe.PermissionError(_("Only Admin, Accountant and Accountant Lead can change a cheque's status."))


@frappe.whitelist(methods=["POST"])
def change_cheque_status(cheque: str, status: str, note: str | None = None) -> dict:
    """Move one Cheque to `status` (Issued, Cleared or Cancelled) with an optional note (required
    to Cancel). Returns `{cheque, status}`; a forbidden move is refused with the reason."""
    user = frappe.session.user
    _assert_can_change_status(user)
    doc = change_status(cheque, status, user=user, note=note)
    frappe.db.commit()
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheque": doc.name})
    return {"cheque": doc.name, "status": doc.status}


@frappe.whitelist(methods=["POST"])
def change_cheque_statuses(cheques, status: str, note: str | None = None, dry_run=False) -> dict:
    """Move each of `cheques` (a list or its JSON) to `status`, one note for all.

    Returns `{changed: [{cheque, cheque_no, from_status, reconciliation_pending}], skipped: [{cheque,
    cheque_no, reason}]}`. `dry_run` writes nothing: the dialog's preview of what would move.
    """
    user = frappe.session.user
    _assert_can_change_status(user)
    names = frappe.parse_json(cheques) if isinstance(cheques, str) else cheques
    preview = dry_run is True or str(dry_run).lower() in ("1", "true")
    result = change_statuses(names or [], status, user=user, note=note, dry_run=preview)
    if preview:
        frappe.db.rollback()
        return result
    frappe.db.commit()
    if result["changed"]:
        frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheques": [c["cheque"] for c in result["changed"]]})
    return result

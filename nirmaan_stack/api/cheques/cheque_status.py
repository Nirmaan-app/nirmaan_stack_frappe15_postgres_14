# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Cancel a Cheque from the Cheque Tracker (#1484, spec #1477, ADR-0035).

Thin: check who is asking, call the cheques service (`services/cheques/status.py`), commit. The rules
(Cancel needs a note, rejects every payment, refused once Cleared; a Security Deposit cheque is only ever
Cancelled, with a note, #1486) are the service's. The free "Change status" of #1412 is gone, and so is
clearing by hand (#1516, ADR-0035 Amendment A): only an imported bank-statement line clears a cheque
(`services/cheques/bank_import.py`).

Who: `CHEQUE_ACCOUNTS_PROFILES` (Admin, Accountant, Accountant Lead). Procurement never cancels one.
"""

import frappe
from frappe import _

from nirmaan_stack.services.cheques.rules import CHEQUE_TYPE_SECURITY_DEPOSIT
from nirmaan_stack.services.cheques.status import cancel, cancel_deposit
from nirmaan_stack.services.cheques.writer import CHEQUES
from nirmaan_stack.services.role_profiles import CHEQUE_ACCOUNTS_PROFILES, has_role_profile


def _assert_accounts(user: str) -> None:
    if not has_role_profile(user, CHEQUE_ACCOUNTS_PROFILES):
        raise frappe.PermissionError(_("Only Admin, Accountant and Accountant Lead can cancel a cheque."))


@frappe.whitelist(methods=["POST"])
def cancel_cheque(cheque: str, note: str) -> dict:
    """Cancel one Pending or Issued Payment cheque: every payment on it is Rejected with `note` as the
    reason. An Issued Security Deposit cheque (it came back) just becomes Cancelled, with `note` in its
    history (`status.cancel_deposit`). Returns `{cheque, cheque_no, payments, rejected, status}`; refused
    without a note or once Cleared or Cancelled."""
    user = frappe.session.user
    _assert_accounts(user)
    is_deposit = frappe.db.get_value(CHEQUES, cheque, "cheque_type") == CHEQUE_TYPE_SECURITY_DEPOSIT
    out = (cancel_deposit if is_deposit else cancel)(cheque, note=note, user=user)
    frappe.db.commit()
    return out

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Clear and Cancel a Cheque from the Cheque Tracker (#1484, spec #1477, ADR-0035).

Thin: check who is asking, call the cheques service (`services/cheques/status.py`), commit, publish. The
rules (Clear by hand from Issued only, pays every payment; Cancel needs a note, rejects every payment,
refused once Cleared; a Security Deposit cheque is only ever Cancelled, with a note, #1486) are the
service's. The free "Change status" of #1412 is gone.

Who: `CHEQUE_ACCOUNTS_PROFILES` (Admin, Accountant, Accountant Lead). Procurement may add a Cheque but
never clear or cancel one.
"""

from types import SimpleNamespace

import frappe
from frappe import _

from nirmaan_stack.services.cheques import pickers
from nirmaan_stack.services.cheques.rules import CHEQUE_TYPE_SECURITY_DEPOSIT, CLEARED_BY_HAND, PAYMENT_DOCTYPE
from nirmaan_stack.services.cheques.status import cancel, cancel_deposit, clear, clear_many
from nirmaan_stack.services.cheques.writer import CHEQUES
from nirmaan_stack.services.outflow_import.row_settlement import link_statement_file_to_target
from nirmaan_stack.services.role_profiles import CHEQUE_ACCOUNTS_PROFILES, has_role_profile


def _assert_accounts(user: str) -> None:
    if not has_role_profile(user, CHEQUE_ACCOUNTS_PROFILES):
        raise frappe.PermissionError(_("Only Admin, Accountant and Accountant Lead can clear or cancel a cheque."))


@frappe.whitelist()
def get_bank_lines(cheque: str) -> list[dict]:
    """The imported bank lines that may clear `cheque`: unmatched ICICI debits carrying its number
    (leading zeros ignored) and amount (within ₹5). What the Clear dialog offers to link."""
    _assert_accounts(frappe.session.user)
    return pickers.bank_lines_for(cheque)


@frappe.whitelist(methods=["POST"])
def clear_cheque(cheque: str, clearance_date: str, bank_line: str | None = None, note: str | None = None) -> dict:
    """Clear one Issued Payment cheque by hand on `clearance_date`, optionally linking an imported
    `bank_line`: every payment becomes Paid on that date. Returns `{cheque, cheque_no, status, payments,
    bank_line}`; a cheque that cannot be cleared is refused with the reason."""
    user = frappe.session.user
    _assert_accounts(user)
    out = clear(cheque, clearance_date=clearance_date, user=user, bank_line=bank_line or None,
                cleared_by=CLEARED_BY_HAND, note=(note or "").strip() or None)
    frappe.db.commit()
    if out["statement_file_url"]:
        # After the commit, as the import does: the File insert commits on its own.
        for payment in out["payments"]:
            link_statement_file_to_target(
                out["statement_file_url"], SimpleNamespace(doctype=PAYMENT_DOCTYPE, name=payment)
            )
    return {k: out[k] for k in ("cheque", "cheque_no", "status", "payments", "bank_line")}


@frappe.whitelist(methods=["POST"])
def clear_cheques(cheques, clearance_date: str, dry_run=False) -> dict:
    """Clear each of `cheques` (a list or its JSON) by hand on one `clearance_date`.

    Returns `{changed: [{cheque, cheque_no, payments}], skipped: [{cheque, cheque_no, reason}]}`.
    `dry_run` writes nothing: it runs the same clear and rolls it all back, the dialog's preview.
    """
    user = frappe.session.user
    _assert_accounts(user)
    names = frappe.parse_json(cheques) if isinstance(cheques, str) else cheques
    result = clear_many(names or [], clearance_date=clearance_date, user=user)
    if dry_run is True or str(dry_run).lower() in ("1", "true"):
        frappe.db.rollback()
        return result
    frappe.db.commit()
    return result


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

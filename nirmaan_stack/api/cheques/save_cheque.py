# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Save a Cheque from Reports -> Payments -> Cheque Payments -> Add Cheque (spec #1407).

Thin: check who is asking, call the cheques service (`services/cheques/writer.py`), commit, publish.
The rules (photo, one payee, the description an Ad-hoc cheque needs, bank + number uniqueness) are
the service's and the `validate` controller's.

Who: `CHEQUE_ACCESS_PROFILES` (Admin, Accountant, Accountant Lead and the Procurement profiles).

A Cheque with no lines is an Ad-hoc cheque. PO/WO Payment lines (#1410) put their payments on the
Cheque: an Online payment becomes a Cheque payment, and once the save is committed each linked
payment that is Approved and not on hold moves on to Reconciliation Pending through the same move
every approval route uses. Expense lines (#1411) name a Project Expense or Non Project Expense and
change nothing on it; a cheque with a typed payee takes expense lines only.

With `name` it saves the report's Edit of that Cheque (#1418). Admin, Accountant and Accountant Lead
(`CHEQUE_ACCOUNTS_PROFILES`) edit any Cheque; Procurement only the Issued Cheques they created. What
may change depends on the status and where the Cheque was made (`services/cheques/rules.edit_problem`).
"""

import frappe
from frappe import _

from nirmaan_stack.api.payments.project_payments import _move_cheque_to_reconciliation
from nirmaan_stack.services.cheques.rules import MADE_FROM_REPORT, parse_header, parse_line
from nirmaan_stack.services.cheques.writer import CHEQUES_CHANGED_EVENT, create_cheque, edit_cheque, line_payments
from nirmaan_stack.services.role_profiles import CHEQUE_ACCOUNTS_PROFILES, can_use_cheques, has_role_profile


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
    lines=None,
    name: str | None = None,
) -> dict:
    """Record a new Cheque, made from the report, at Issued; or, with `name`, save the Edit of that Cheque.

    `bank` is "ICICI Bank" or "Others" (then `bank_name` is required). Exactly one of `vendor` or
    `payee_name`. `attachment` is the uploaded photo's file URL. `description` is required while
    the Cheque has no lines. `lines` is a list (or its JSON) of `{line_type, project, record_doctype,
    record_name, payment_name?, amount?}`; an expense line's expense goes in `payment_name`, and a
    line with a payment or expense and no amount takes its amount. On an edit the whole Cheque is
    sent back as the user left it; `lines` left out keeps the lines as they are.

    Returns `{cheque, status, payments}`, `payments` being each linked payment's `{name, status}`
    after the move.
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
    raw_lines = frappe.parse_json(lines) if isinstance(lines, str) else lines
    parsed = None if raw_lines is None else [parse_line(line) for line in raw_lines]
    if name:
        doc = edit_cheque(
            name, header, parsed, user=user, any_cheque=has_role_profile(user, CHEQUE_ACCOUNTS_PROFILES)
        )
    else:
        doc = create_cheque(header, user=user, made_from=MADE_FROM_REPORT, lines=parsed or [])
    frappe.db.commit()
    payments = line_payments(doc)
    for payment in payments:
        _move_cheque_to_reconciliation(payment)  # no-op unless Approved and not on hold
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheque": doc.name})
    return {
        "cheque": doc.name,
        "status": doc.status,
        "payments": [
            {"name": p, "status": frappe.db.get_value("Project Payments", p, "status")} for p in payments
        ],
    }

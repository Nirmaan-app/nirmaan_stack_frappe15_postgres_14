# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Save a Payment cheque from the Cheque Tracker's Add Cheque, or its Edit (spec #1407, #1482).

Thin: check who is asking, call the cheques service (`services/cheques/writer.py`), commit, publish.
The rules are the service's and the `validate` controller's.

Who: `CHEQUE_ACCESS_PROFILES` (Admin, Accountant, Accountant Lead and the Procurement profiles).

A Payment cheque (spec #1477) is made out to a Vendor and carries PO lines only: each line names one of
the Vendor's POs and one of its payments, or "No payment yet" with a typed amount. Picked payments are
at Requested, CEO Pending or Approved, all at one step. The cheque saves Pending; its payments switch to
Cheque. Once the save is committed each linked payment that is Approved moves on to Reconciliation
Pending through the same move every approval route uses, and the last one's move issues the cheque.

With `name` it saves the Edit of that Cheque (#1418). Admin, Accountant and Accountant Lead
(`CHEQUE_ACCOUNTS_PROFILES`) edit any Cheque; Procurement only the Pending Cheques they created. Lines
change only while Pending; an Issued, Cleared or Cancelled cheque changes only its photo
(`services/cheques/rules.edit_problem`). A payment whose line an edit takes off goes back to Online,
its status unchanged.
"""

import frappe

from nirmaan_stack.services.cheque_payments import commit_move_to_reconciliation
from nirmaan_stack.services.cheques.rules import PAYMENT_DOCTYPE, parse_header, parse_line
from nirmaan_stack.services.cheques.writer import (
    CHEQUES,
    CHEQUES_CHANGED_EVENT,
    add_payment_cheque,
    edit_cheque,
    line_payments,
)
from nirmaan_stack.services.role_profiles import CHEQUE_ACCOUNTS_PROFILES, assert_cheque_access, has_role_profile


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
    """Record a new Payment cheque at Pending; or, with `name`, save the Edit of that Cheque.

    `bank` is "ICICI Bank" or "Others" (then `bank_name` is required). A new cheque names its `vendor`;
    `payee_name` is only sent back unchanged when editing an Old-type cheque. `attachment` is the
    uploaded photo's file URL. `lines` is a list (or its JSON) of `{line_type, project, record_doctype,
    record_name, payment_name?, amount?}`; a line with a payment and no amount takes its amount. On an
    edit the whole Cheque is sent back as the user left it; `lines` left out keeps the lines as they are.

    Returns `{cheque, status, payments}` after the moves, `payments` being each linked payment's
    `{name, status}`.
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
        doc = add_payment_cheque(header, parsed or [], user=user)
    frappe.db.commit()
    payments = line_payments(doc)
    for payment in payments:
        commit_move_to_reconciliation(payment)  # no-op unless Approved and not on hold; may issue the cheque
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheque": doc.name})
    return {
        "cheque": doc.name,
        "status": frappe.db.get_value(CHEQUES, doc.name, "status"),
        "payments": [
            {"name": p, "status": frappe.db.get_value(PAYMENT_DOCTYPE, p, "status")} for p in payments
        ],
    }

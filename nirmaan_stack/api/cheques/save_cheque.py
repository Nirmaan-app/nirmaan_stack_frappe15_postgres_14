# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Save a Cheque from the Cheque Tracker's Add Cheque, or its Edit (spec #1407, #1482, #1486).

Thin: check who is asking, call the cheques service (`services/cheques/writer.py`), commit, publish.
The rules are the service's and the `validate` controller's.

Who: `CHEQUE_ACCESS_PROFILES` (Admin, Accountant, Accountant Lead and the Procurement profiles).

A Payment cheque (spec #1477) is made out to a Vendor and carries PO lines only: each line names one of
the Vendor's POs and one of its payments, or "No payment yet" with a typed amount. Picked payments are
at Requested, CEO Pending or Approved, all at one step. The cheque saves Pending; its payments switch to
Cheque. Once the save is committed each linked payment that is Approved moves on to Reconciliation
Pending through the same move every approval route uses, and the last one's move issues the cheque.

A Security Deposit cheque (`cheque_type`, #1486) is made out to a Vendor or a typed name, carries its
typed `issue_date` and is Issued as it is saved; its lines only name the Vendor's POs and Work Orders it
secures (none is fine). The Cheque Tracker and the PO / Work Order page's card both add one here.

With `name` it saves the Edit of that Cheque (#1418). Admin, Accountant and Accountant Lead
(`CHEQUE_ACCOUNTS_PROFILES`) edit any Cheque; Procurement only the Pending Payment cheques and Issued
deposit cheques they created. A Payment cheque's lines change only while Pending, a deposit's while
Issued; otherwise only the photo changes (`services/cheques/edit_rules.edit_problem`). A payment whose line an edit takes off goes back to Online,
its status unchanged.
"""

import frappe
from frappe import _

from nirmaan_stack.services.cheque_payments import commit_move_to_reconciliation
from nirmaan_stack.services.cheques.rules import (
    CHEQUE_TYPE_SECURITY_DEPOSIT,
    CHEQUE_TYPES,
    PAYMENT_DOCTYPE,
    parse_header,
    parse_line,
)
from nirmaan_stack.services.cheques.writer import (
    CHEQUES,
    CHEQUES_CHANGED_EVENT,
    add_deposit_cheque,
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
    cheque_type: str | None = None,
    issue_date: str | None = None,
) -> dict:
    """Record a new Payment cheque at Pending, or a new Security Deposit cheque at Issued; or, with
    `name`, save the Edit of that Cheque.

    `cheque_type` is "Payment" (the default) or "Security Deposit"; a new cheque's type is fixed, so an
    edit ignores it. `issue_date` is a deposit cheque's typed issue date (the day it was handed over),
    on add and on edit; a Payment cheque's comes from its payments' approval.

    `bank` is "ICICI Bank" or "Others" (then `bank_name` is required). A new cheque names its `vendor`;
    `payee_name` is only sent back unchanged when editing an Old-type cheque. `attachment` is the
    uploaded photo's file URL. `lines` is a list (or its JSON) of `{line_type, project, record_doctype,
    record_name, payment_name?, amount?}`; a line with a payment and no amount takes its amount. A deposit
    cheque's lines are `{line_type: "Secured PO/WO", record_doctype, record_name}`. On an
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
    if cheque_type and cheque_type not in CHEQUE_TYPES:
        frappe.throw(_("Choose the kind of cheque: {0}.").format(", ".join(CHEQUE_TYPES)))
    if name:
        doc = edit_cheque(
            name, header, parsed, user=user, any_cheque=has_role_profile(user, CHEQUE_ACCOUNTS_PROFILES),
            issue_date=issue_date,
        )
    elif cheque_type == CHEQUE_TYPE_SECURITY_DEPOSIT:
        doc = add_deposit_cheque(header, parsed or [], issue_date=issue_date, user=user)
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

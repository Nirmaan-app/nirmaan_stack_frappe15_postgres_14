# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Record a Security Deposit cheque from the PO page's card, or save a Cheque's Edit (spec #1407, #1486;
spec #1514).

Thin: check who is asking, call the cheques service (`services/cheques/writer.py`), commit, publish.
The rules are the service's and the `validate` controller's.

Who: `CHEQUE_ACCESS_PROFILES` (Admin, Accountant, Accountant Lead and the Procurement profiles).

It makes no Payment cheque (spec #1514, ADR-0035 Amendment A): a Payment cheque pays exactly one PO payment
and is made with it, by the PO's Request Payment in Cheque mode (`api/payments/payment_cheque.put_on_new_cheque`).

A Security Deposit cheque (`cheque_type`, #1486) is made out to a Vendor or a typed name, carries its
typed `issue_date` and is Issued as it is saved; its lines only name the Vendor's POs it secures (none is
fine).

With `name` it saves the Edit of that Cheque (#1418). Admin, Accountant and Accountant Lead
(`CHEQUE_ACCOUNTS_PROFILES`) edit any Cheque; Procurement only the Pending Payment cheques and Issued
deposit cheques they created. A Pending Payment cheque changes only its number, bank, date and photo, a
deposit changes while Issued; otherwise only the photo changes (`services/cheques/edit_rules.edit_problem`).
"""

import frappe
from frappe import _

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
    edit_cheque,
    line_payments,
)
from nirmaan_stack.services.role_profiles import CHEQUE_ACCOUNTS_PROFILES, assert_cheque_access, has_role_profile

#: The refusal of a new Payment cheque here.
PAYMENT_CHEQUE_NOT_HERE = (
    "A Payment cheque is made with its payment: use Request Payment in Cheque mode on the PO. "
    "Only a Security Deposit cheque is recorded here."
)


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
    """Record a new Security Deposit cheque at Issued; or, with `name`, save the Edit of that Cheque. A new
    cheque of any other type is refused (`PAYMENT_CHEQUE_NOT_HERE`).

    `cheque_type` must be "Security Deposit" for a new cheque; an edit ignores it, a cheque's type being
    fixed. `issue_date` is a deposit cheque's typed issue date (the day it was handed over), on add and on
    edit; a Payment cheque's comes from its payments' approval.

    `bank` is "ICICI Bank" or "Others" (then `bank_name` is required). `payee_name` is a deposit's typed
    payee, or sent back unchanged when editing an Old-type cheque. `attachment` is the uploaded photo's file
    URL. `lines` is a list (or its JSON) of `{line_type, project, record_doctype, record_name, payment_name?,
    amount?}`; a deposit cheque's are `{line_type: "Secured PO/WO", record_doctype, record_name}`. On an edit
    the whole Cheque is sent back as the user left it; `lines` left out keeps the lines as they are.

    Returns `{cheque, status, payments}`, `payments` being each linked payment's `{name, status}`.
    """
    user = frappe.session.user
    assert_cheque_access(user)
    if cheque_type and cheque_type not in CHEQUE_TYPES:
        frappe.throw(_("Choose the kind of cheque: {0}.").format(", ".join(CHEQUE_TYPES)))
    if not name and cheque_type != CHEQUE_TYPE_SECURITY_DEPOSIT:
        frappe.throw(_(PAYMENT_CHEQUE_NOT_HERE))
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
            name, header, parsed, user=user, any_cheque=has_role_profile(user, CHEQUE_ACCOUNTS_PROFILES),
            issue_date=issue_date,
        )
    else:
        doc = add_deposit_cheque(header, parsed or [], issue_date=issue_date, user=user)
    frappe.db.commit()
    frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheque": doc.name})
    return {
        "cheque": doc.name,
        "status": frappe.db.get_value(CHEQUES, doc.name, "status"),
        "payments": [
            {"name": p, "status": frappe.db.get_value(PAYMENT_DOCTYPE, p, "status")} for p in line_payments(doc)
        ],
    }

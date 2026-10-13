# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE cheques service: the only code that writes a Cheque (spec #1407).

Whitelisted endpoints (`api/cheques/`) check who is asking, call one function here, then commit and
publish. Nothing here commits: a caller may run it inside its own transaction or savepoint (the
Request Payment endpoints and the backfill patch do).

Built so far:

* `create_cheque` -- a new Cheque at Issued with its "created" history row. The report's Add
  Cheque (`MADE_FROM_REPORT`) uses it today; the one-line Cheque for a payment (#1414, #1416) and the
  backfill (#1419) are meant to call it too, with `made_from=MADE_FROM_PO_WO_PAGE`.
* `existing_cheque` -- the Cheque already recorded for a bank + cheque number, if any. The `validate`
  controller refuses a duplicate with it, so the rule holds on every write path; a Request Payment
  endpoint can ask it before inserting a payment.

To come, each beside these: editing a Cheque and its lines (#1410, #1411, #1418), status change for
one or many with history (#1412), switching a payment back to Online, the line pickers' eligible
lists, and detaching a Rejected or deleted payment's line (#1413).

A Cheque moves no money figure: amounts paid, amounts owed, TDS and vendor credit come from payments.
"""

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.services.cheques.rules import (
    ISSUED,
    MADE_FROM,
    ChequeHeader,
    bank_key,
    normalise_cheque_no,
)

CHEQUES = "Cheques"


def history_row(from_status: str | None, to_status: str, user: str, note: str | None = None) -> dict:
    """One `Cheque Status History` row: who moved the Cheque from what to what, when, and why."""
    return {
        "from_status": from_status or None,
        "to_status": to_status,
        "changed_by": user,
        "changed_at": now_datetime(),
        "note": (note or "").strip() or None,
    }


def existing_cheque(bank: str, bank_name: str | None, cheque_no: str, *, exclude: str | None = None) -> str | None:
    """The name of the Cheque already recorded with this bank + cheque number, at any status, or None.

    An Others bank's name matches ignoring case and repeated spaces (`rules.bank_key`).
    """
    filters = {"bank_key": bank_key(bank, bank_name), "cheque_no": normalise_cheque_no(cheque_no)}
    if exclude:
        filters["name"] = ["!=", exclude]
    return frappe.db.get_value(CHEQUES, filters, "name")


def create_cheque(header: ChequeHeader, *, user: str, made_from: str):
    """Insert a new Cheque from `header`, at Issued, with one "created" history row. Returns it.

    Every rule on the header (the photo, one payee, the description of an Ad-hoc cheque, the bank +
    number uniqueness) is enforced by the `validate` controller, so it holds for every writer.
    Writes with `ignore_permissions`: the endpoint's role-profile check is the boundary.
    """
    if made_from not in MADE_FROM:
        raise ValueError(f"unknown made_from {made_from!r}")
    doc = frappe.get_doc({
        "doctype": CHEQUES,
        "bank": header.bank,
        "bank_name": header.bank_name,
        "cheque_no": header.cheque_no,
        "cheque_date": header.cheque_date,
        "amount": header.amount,
        "vendor": header.vendor,
        "payee_name": header.payee_name,
        "description": header.description,
        "attachment": header.attachment,
        "status": ISSUED,
        "made_from": made_from,
        "status_history": [history_row(None, ISSUED, user)],
    })
    doc.insert(ignore_permissions=True)
    return doc

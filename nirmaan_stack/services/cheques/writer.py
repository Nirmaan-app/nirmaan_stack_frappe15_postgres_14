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
* `link_payments` -- puts each line's Project Payment on the Cheque: link, mode Cheque, number and
  date (#1410). `create_cheque` calls it; the caller then moves the payments on after its commit.
  An expense line's expense (#1411) is never written: linking an expense changes nothing on it.

To come, each beside these: editing a Cheque and its lines (#1418), status change for
one or many with history (#1412), switching a payment back to Online, and detaching a Rejected or deleted payment's line (#1413).

The line pickers' lists are read-only and live in `services/cheques/pickers.py`; the line rules
that read the database in `services/cheques/lines.py`.

A Cheque moves no money figure: amounts paid, amounts owed, TDS and vendor credit come from payments.
"""

from dataclasses import asdict

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.services.cheque_payments import MODE_CHEQUE
from nirmaan_stack.services.cheques.rules import (
    ISSUED,
    MADE_FROM,
    PAYMENT_DOCTYPE,
    ChequeHeader,
    ChequeLineInput,
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


def create_cheque(header: ChequeHeader, *, user: str, made_from: str, lines: list[ChequeLineInput] = ()):
    """Insert a new Cheque from `header` and `lines`, at Issued, with one "created" history row, and
    put each line's payment on it (`link_payments`). Returns it.

    Every rule on the header and lines (the photo, one payee, the description of an Ad-hoc cheque,
    the bank + number uniqueness, a payment on one live Cheque only) is enforced by the `validate`
    controller, so it holds for every writer. Writes with `ignore_permissions`: the endpoint's
    role-profile check is the boundary.

    ⚠️ THE CALLER MOVES THE PAYMENTS ON, AFTER ITS COMMIT. A linked payment that is Approved and not
    on hold goes to Reconciliation Pending through `cheque_payments.move_to_reconciliation`, which
    must run only once the link is on disk (the same rule as every approval route).
    """
    if made_from not in MADE_FROM:
        raise ValueError(f"unknown made_from {made_from!r}")
    _lock_payments([line.payment_name for line in lines if line.payment_doctype == PAYMENT_DOCTYPE])
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
        "lines": [asdict(line) for line in lines],
    })
    doc.insert(ignore_permissions=True)
    link_payments(doc)
    return doc


def line_payments(doc) -> list[str]:
    """The Project Payments the Cheque's lines name, in line order."""
    return [
        row.payment_name
        for row in doc.get("lines") or []
        if row.payment_doctype == PAYMENT_DOCTYPE and row.payment_name
    ]


def link_payments(doc) -> None:
    """Put each Project Payment on the Cheque's lines on it (spec #1407): link it, make it a Cheque
    payment (an Online one converts) and copy the cheque number and date onto it.

    Its status is left alone here; the caller's move after commit does the rest. Saved through the
    document so its `validate` (the mode rule, the hold) and `track_changes` run. A Cheque moves no
    money figure, so nothing is recomputed.
    """
    for name in line_payments(doc):
        pay = frappe.get_doc(PAYMENT_DOCTYPE, name)
        pay.update({
            "cheque": doc.name,
            "mode_of_payment": MODE_CHEQUE,
            "cheque_no": doc.cheque_no,
            "cheque_date": doc.cheque_date,
        })
        pay.save(ignore_permissions=True)


def _lock_payments(names: list[str]) -> None:
    """Row-lock the payments about to be put on a Cheque, in name order, so two Cheques saved at
    once cannot both take one payment: the second waits, then its `validate` sees the first."""
    names = sorted({n for n in names if n})
    if names:
        frappe.db.sql(
            'SELECT name FROM "tabProject Payments" WHERE name IN %(names)s ORDER BY name FOR UPDATE',
            {"names": tuple(names)},
        )

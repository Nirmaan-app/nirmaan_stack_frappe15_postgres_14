# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Print the open Payment cheques drawn on a bank other than ICICI Bank (#1516, ADR-0035 Amendment A).

WHY THIS PATCH EXISTS
    From #1516 only an imported bank-statement line clears a Payment cheque, and the import reads ICICI
    Bank statements only. A new Payment cheque must be drawn on ICICI Bank (`rules.header_problem`), but
    Payment cheques recorded on "Others" before that still exist. One that is neither Cleared nor
    Cancelled can never be cleared now: cancelling it, and raising its payment again on ICICI Bank, is
    the only way to close it. This patch names each one so Accounts can do that.

WHAT IT DOES
    It prints every Payment cheque on Others whose status is neither Cleared nor Cancelled, with its
    number, bank, status and amount. A Security Deposit cheque on Others is left out: it is never cleared
    and may stay on any bank.

IT CHANGES NOTHING
    It only reads. A second run prints the same list, less any cheque cancelled since.

Counts: check them on a fresh production copy before release.
"""

import frappe

from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    CHEQUE_TYPE_PAYMENT,
    CLEARED,
    OTHER_BANK,
    bank_label,
    rupees,
)
from nirmaan_stack.services.cheques.writer import CHEQUES

PATCH = "list_open_payment_cheques_on_others"


def execute():
    for line in summary(open_payment_cheques_on_others()):
        print(f"{PATCH}: {line}")
        frappe.logger("cheques").info(f"{PATCH}: {line}")


def open_payment_cheques_on_others(cheques: list[str] | None = None) -> list[dict]:
    """The Payment cheques on Others that are neither Cleared nor Cancelled, by name: every Cheque, or only
    `cheques` (what the tests pass, so they never read a Cheque they did not plant). Reads only.

    Returns `[{cheque, cheque_no, bank_name, status, amount}]`.
    """
    filters = {
        "cheque_type": CHEQUE_TYPE_PAYMENT,
        "bank": OTHER_BANK,
        "status": ["not in", [CLEARED, CANCELLED]],
    }
    if cheques is not None:
        if not cheques:
            return []
        filters["name"] = ["in", cheques]
    rows = frappe.get_all(
        CHEQUES, filters=filters, fields=["name", "cheque_no", "bank", "bank_name", "status", "amount"], order_by="name"
    )
    return [
        {"cheque": r.name, "cheque_no": r.cheque_no, "bank_name": bank_label(r.bank, r.bank_name),
         "status": r.status, "amount": r.amount}
        for r in rows
    ]


def summary(rows: list[dict]) -> list[str]:
    """What the patch prints: the count and what to do, then one line per cheque."""
    head = f"{len(rows)} open Payment cheque(s) on a bank other than ICICI Bank"
    if not rows:
        return [head]
    lines = [f"{head}: no statement import can clear them, so cancel each one and raise its payment again on "
             "ICICI Bank"]
    lines += [
        f"{r['cheque']} ({r['cheque_no']}) on {r['bank_name']}: {r['status']}, {rupees(r['amount'])}" for r in rows
    ]
    return lines

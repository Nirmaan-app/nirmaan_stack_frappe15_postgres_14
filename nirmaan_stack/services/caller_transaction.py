# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Saves that run inside their caller's savepoint, where a hook must not commit.

Two writers save a ledger row inside a per-row savepoint of their caller and set a request-level
flag around that save:

    OUTFLOW_IMPORT_SETTLING   services/outflow_import/settle.outflow_import_write (the bank import)
    EXPENSE_DECIDING          services/expense_decision.decide (Approve, Reject, Mark as Paid)

A `frappe.db.commit()` inside such a save ends the caller's savepoint, so the caller's rollback of a
failed row silently undoes nothing (production, 2026-10-05). A hook that would commit -- a bell
notification, the CEO-Hold release notice -- asks `caller_owns_the_commit()` first and leaves the
commit to the caller. A request-level flag, not `doc.flags`, because one of those hooks commits from
an inner helper that is never handed the document.
"""

import frappe

OUTFLOW_IMPORT_SETTLING = "outflow_import_settling"
EXPENSE_DECIDING = "expense_deciding"


def caller_owns_the_commit() -> bool:
    """Is this save inside a caller's savepoint (an import settle or an expense decision)?"""
    return bool(frappe.flags.get(OUTFLOW_IMPORT_SETTLING) or frappe.flags.get(EXPENSE_DECIDING))

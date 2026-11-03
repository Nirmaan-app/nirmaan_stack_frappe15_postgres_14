# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Fixtures for a hand Link of a Cashbook line (#1601): a planted Reconciliation Pending expense, a line opened by
hand, and what a Txn Id is Settled to. Shared by `test_cashbook_link_holds_txn_id` and
`test_cashbook_one_expense_race`. Every name it writes is made up."""

from decimal import Decimal

import frappe

from nirmaan_stack.services.outflow_import.ledgers import (
    EXPENSE_DOCTYPES,
    NON_PROJECT_EXPENSE_DOCTYPE,
    RECONCILIATION_PENDING,
)
from nirmaan_stack.services.outflow_import.settle import format_amount_for
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED

ROW_DOCTYPE = "Outflow Import Row"


def plant_pending_expense(amount, description="Link test: a made-up wallet spend") -> str:
    """A Non Project Expense at Reconciliation Pending for `amount`, committed. The caller deletes it
    (`delete_planted_expense`).

    The status is re-asserted after the insert: the controller auto-approves a small amount on create
    (see `test_expenses._make_expense`)."""
    doc = frappe.new_doc(NON_PROJECT_EXPENSE_DOCTYPE)
    doc.update(
        {
            "type": frappe.db.get_value("Expense Type", {"non_project": 1, "project": 0}, "name"),
            "status": RECONCILIATION_PENDING,
            "amount": format_amount_for(NON_PROJECT_EXPENSE_DOCTYPE, Decimal(str(amount))),
            "description": description,
        }
    )
    doc.insert(ignore_permissions=True)
    if doc.status != RECONCILIATION_PENDING:
        # TEST DATA ONLY, HOOKS SKIPPED ON PURPOSE: the planted expense must sit at Reconciliation Pending for a
        # Link to pick it, whatever the insert hooks set.
        frappe.db.set_value(
            NON_PROJECT_EXPENSE_DOCTYPE, doc.name, "status", RECONCILIATION_PENDING, update_modified=False
        )
    frappe.db.commit()
    return doc.name


def delete_planted_expense(name: str) -> None:
    """The planted expense and what a Link added to it (its statement File, its Version rows)."""
    frappe.db.rollback()
    frappe.db.delete("File", {"attached_to_doctype": NON_PROJECT_EXPENSE_DOCTYPE, "attached_to_name": name})
    frappe.db.delete("Version", {"ref_doctype": NON_PROJECT_EXPENSE_DOCTYPE, "docname": name})
    frappe.db.delete(NON_PROJECT_EXPENSE_DOCTYPE, {"name": name})
    frappe.db.commit()


def settled_expenses_for(txn_id) -> list:
    """Every Expense a Settled match row ties to this Txn Id, however it got there (create or Link)."""
    return frappe.db.sql(
        """SELECT DISTINCT target_name FROM "tabOutflow Row Match"
           WHERE transfer_id = %s AND match_kind = 'Settled' AND target_doctype IN %s
           ORDER BY target_name""",
        (txn_id, tuple(EXPENSE_DOCTYPES)),
        pluck=True,
    )


def open_line_by_hand(line_name: str, extra_rupees: int = 1) -> Decimal:
    """Make a staged Cashbook line workable by hand (Mismatched), `extra_rupees` above its staged amount, and
    return its new amount."""
    amount = Decimal(str(frappe.db.get_value(ROW_DOCTYPE, line_name, "amount"))) + extra_rupees
    # TEST DATA ONLY, HOOKS SKIPPED ON PURPOSE: this stands in for the job leaving the line Mismatched.
    frappe.db.set_value(
        ROW_DOCTYPE, line_name, {"row_status": ROW_MISMATCHED, "amount": float(amount)}, update_modified=False
    )
    frappe.db.commit()
    return amount

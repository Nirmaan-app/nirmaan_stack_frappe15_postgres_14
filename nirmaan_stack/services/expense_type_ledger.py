# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An Expense Type belongs in the ledger it is written to (spec #1494, #1496; ADR-0009).

A `Project Expenses` row takes a type flagged `project = 1`; a `Non Project Expenses` row takes one
flagged `non_project = 1`. A type flagged for both (Petty Cash, Material Transportation Charges) fits
either. ONE answer, asked by:
  * both ledgers' `validate` (`check_expense_type`), so every write is covered: the request intake,
    the bank-statement / cashbook / Porter imports, the PO-adjustment ad-hoc expense, Desk and data
    import;
  * the paths that want to refuse before they build anything (`expense_type_problem`): the import's
    `settle._assert_type_scope` and `po_adjustments.execute_adjustment`;
  * the import's type picker (`LEDGER_TYPE_FLAG`).

The ledger asks only when the row is new or its type changed, so an old row whose type was re-flagged
later is still editable.
"""

import frappe

from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE, PROJECT_EXPENSE_DOCTYPE

# The `Expense Type` flag each ledger requires.
LEDGER_TYPE_FLAG = {PROJECT_EXPENSE_DOCTYPE: "project", NON_PROJECT_EXPENSE_DOCTYPE: "non_project"}


def expense_type_problem(doctype: str, expense_type: str | None) -> str | None:
    """Why `expense_type` cannot be written to ledger `doctype`, or None when it can (or is blank)."""
    if not expense_type:
        return None
    if not frappe.db.get_value("Expense Type", expense_type, LEDGER_TYPE_FLAG[doctype]):
        return f"'{expense_type}' is not an expense type for {doctype}."
    return None


def check_expense_type(doc) -> None:
    """A ledger's `validate`: refuse a new row, or a changed type, that does not belong in `doc`'s ledger."""
    if not (doc.is_new() or doc.has_value_changed("type")):
        return
    problem = expense_type_problem(doc.doctype, doc.type)
    if problem:
        frappe.throw(problem, title="Wrong expense type")

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Expense each wallet refund's spend is booked on, as it is now (#1709, spec #1711, ADR-0015 Amendment D).

READ-ONLY. The Cashbook plan (`cashbook._build_plan`) and the open-refunds patch ask it; `cashbook_refund_expense`
decides with the answer. Owner decision 1: "has an Expense" is the only test, whatever the spend's date, and it
counts an Expense the spend's line was Linked to by hand (ADR-0015 Amendment A).

A spend's Expense is, in this order:
  1. the one its wallet Txn Id is held by: a Settled Expense match row the import created, or any Settled Expense
     match row of a Cashbook line, a Link included (`import_created_expense.IMPORT_CREATED_EXPENSE_PREDICATE`, the
     one-Expense-per-Txn-Id index's own rows, so there is at most one);
  2. else an Expense whose `payment_ref` is the Txn Id, above zero (one keyed in by hand, as the "already booked"
     check finds it), the first created.
"""

from __future__ import annotations

from typing import Iterable

import frappe

from nirmaan_stack.services.outflow_import.cashbook_refund_expense import SpendExpense
from nirmaan_stack.services.outflow_import.cashbook_refunds import refunded_spend_id
from nirmaan_stack.services.outflow_import.import_created_expense import IMPORT_CREATED_EXPENSE_PREDICATE
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES, PROJECT_EXPENSE_DOCTYPE


def refunds_spend_ids(transfer_ids: Iterable[str]) -> list[str]:
    """The spend Txn Ids the refunds among `transfer_ids` name (`REF-<Txn Id>`), each once."""
    return sorted({spend for spend in map(refunded_spend_id, transfer_ids) if spend})


def spend_expenses(spend_ids: Iterable[str]) -> dict[str, SpendExpense]:
    """{spend Txn Id: its Expense as it is now} for each of `spend_ids` that has one."""
    ids = tuple(sorted(set(spend_ids)))
    if not ids:
        return {}
    held = {
        row.transfer_id: (row.target_doctype, row.target_name)
        for row in frappe.db.sql(
            f"""SELECT transfer_id, target_doctype, target_name FROM "tabOutflow Row Match"
                WHERE transfer_id IN %(ids)s AND {IMPORT_CREATED_EXPENSE_PREDICATE}""",
            {"ids": ids},
            as_dict=True,
        )
    }
    rest = tuple(spend for spend in ids if spend not in held)
    for doctype in EXPENSE_DOCTYPES if rest else ():
        for row in frappe.db.sql(
            f"""SELECT BTRIM(payment_ref) AS spend, name FROM "tab{doctype}"
                WHERE BTRIM(COALESCE(payment_ref, '')) IN %(ids)s AND amount > 0
                ORDER BY creation ASC""",
            {"ids": rest},
            as_dict=True,
        ):
            held.setdefault(row.spend, (doctype, row.name))
    found = {}
    for spend, (doctype, name) in held.items():
        expense = _expense_now(doctype, name)
        if expense:
            found[spend] = expense
    return found


def _expense_now(doctype: str, name: str) -> SpendExpense | None:
    """The Expense's ledger, project and type as they are now; `None` when it no longer exists."""
    project_expense = doctype == PROJECT_EXPENSE_DOCTYPE
    row = frappe.db.get_value(doctype, name, ["type", "projects"] if project_expense else ["type"], as_dict=True)
    if not row:
        return None
    project = row.get("projects") if project_expense else None
    return SpendExpense(
        doctype=doctype,
        name=name,
        project=project,
        project_name=(frappe.db.get_value("Projects", project, "project_name") or "") if project else "",
        expense_type=row.type,
    )

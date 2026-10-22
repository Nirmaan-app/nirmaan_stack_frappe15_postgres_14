# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An Expense made from a request is raised by the requester (spec #1494, owner ruling 2026-10-20).

WHY THIS PATCH EXISTS
    Frappe stamps the session user as `owner` on insert, so an Expense a Reviewer's approval created
    was owned by the Reviewer: Project Payment & Expense showed the Reviewer under "Raised by" and
    listed the expense in the Reviewer's "Payment Raised By Me". `convert.create_ledger_row` now
    hands each new Expense to the request's owner. This patch fixes the ones made before that.

WHAT IT WRITES
    Every `Project Expenses` / `Non Project Expenses` row with a `request_id` whose `owner` differs
    from that Expense Request's `owner` gets the request's owner. A row with no request, or whose
    request is gone, is untouched.

IDEMPOTENT
    Only rows whose owner differs are written, so a second run writes nothing.

HOOKS
    A raw UPDATE that skips `doc_events` and leaves `modified` alone. That is correct: no hook reads
    an Expense's `owner` (the approval path reads the request's, `approval_raiser.expense_raiser`),
    and nothing derived from it is stored, so there is nothing to recompute.
"""

from __future__ import annotations

import frappe

LEDGERS = ("Project Expenses", "Non Project Expenses")


def execute():
    counts = backfill_expense_owners()
    print(f"backfill_expense_owner_from_request: owner set to the requester on {counts}")


def backfill_expense_owners(expenses: list[str] | None = None) -> dict[str, int]:
    """Hand each request-made Expense to its requester, or only those named in `expenses`.
    Returns how many rows of each ledger changed."""
    scope = "AND e.name IN %(expenses)s" if expenses is not None else ""
    params = {"expenses": tuple(expenses or ("",))}
    counts = {}
    for doctype in LEDGERS:
        where = f"""e.request_id = r.name AND COALESCE(r.owner, '') <> ''
                    AND e.owner IS DISTINCT FROM r.owner {scope}"""
        counts[doctype] = frappe.db.sql(
            f"""SELECT COUNT(*) FROM "tab{doctype}" e, "tabExpense Request" r WHERE {where}""",
            params,
        )[0][0]
        if counts[doctype]:
            # Raw on purpose; see HOOKS in the module docstring.
            frappe.db.sql(
                f"""UPDATE "tab{doctype}" e SET owner = r.owner
                    FROM "tabExpense Request" r WHERE {where}""",
                params,
            )
    return counts

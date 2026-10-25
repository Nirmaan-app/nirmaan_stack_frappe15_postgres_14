# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A card spend's expense type and the words on its Expense (ADR-0037 rulings 5 and 6, spec #1565). Pure.

Every card spend is one Non-Project Expense. Its type is held on the line (`suggested_expense_type`) with
where it came from (`type_source`, options = `TYPE_SOURCES`, pinned by test): until suggestion lands (#1569)
every spend starts at the fallback, *Misc. Expenses*, which Review marks "Check"; a person may change it on
Review (#1568). Create writes the type the line holds, never deciding again.
"""

from __future__ import annotations

from nirmaan_stack.services.outflow_import.card_statement import merchant_key
from nirmaan_stack.services.outflow_import.status import ROW_ERROR, ROW_MISMATCHED, ROW_PENDING_MATCH

#: The SPEND lines Create still writes, and Review may still retype: waiting, failed on an earlier run, or
#: reopened by Unreconcile. ⚠️ A CREDIT line is open at `Mismatched` too: callers ask the direction as well.
CREATE_LINE_STATUSES = (ROW_PENDING_MATCH, ROW_ERROR, ROW_MISMATCHED)

#: The type a spend gets when nothing better is known; it must stay a live `non_project` Expense Type
#: (it is in `fixtures/expense_type.json`, so a migrate cannot drop it).
FALLBACK_EXPENSE_TYPE = "Misc. Expenses"

TYPE_SOURCE_MEMORY = "Earlier statement"
TYPE_SOURCE_AI = "AI"
TYPE_SOURCE_FALLBACK = "Fallback"
TYPE_SOURCE_REVIEW = "Chosen on Review"
#: `Outflow Import Row.type_source` options, in order.
TYPE_SOURCES = (TYPE_SOURCE_MEMORY, TYPE_SOURCE_AI, TYPE_SOURCE_FALLBACK, TYPE_SOURCE_REVIEW)


def needs_check(type_source: str | None) -> bool:
    """A spend Review marks "Check": its type is the fallback, which nobody has chosen."""
    return type_source == TYPE_SOURCE_FALLBACK


def spend_description(details: str, holder: str) -> str:
    """The Expense's description: "Card spend at {merchant}, {holder}'s card" (ADR-0037 ruling 6)."""
    return f"Card spend at {merchant_key(details)}, {holder}'s card"

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A card spend's expense type and the words on its Expense (ADR-0037 rulings 5 and 6, spec #1565). Pure.

Every card spend is one Non-Project Expense. Its type is held on the line (`suggested_expense_type`) with
where it came from (`type_source`, options = `TYPE_SOURCES`, pinned by test). Every spend is staged at the
fallback, *Misc. Expenses*, which Review marks "Check"; the suggestion job (#1569, `card_suggest`) then gives
each spend a type by `choose_type`; a person may change it on Review (#1568). Create writes the type the line
holds, never deciding again.
"""

from __future__ import annotations

from typing import NamedTuple, Sequence

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


#: The least confidence (0..1, as the AI reports it) at which an AI answer is taken; below it, the fallback.
AI_MIN_CONFIDENCE = 0.7


class AiAnswer(NamedTuple):
    """What the AI said for one merchant: a type name (None when it would not say) and its confidence."""

    expense_type: str | None
    confidence: float


def choose_type(
    remembered: str | None, answer: AiAnswer | None, live_types: Sequence[str]
) -> tuple[str, str]:
    """A spend's type and its `type_source` (ADR-0037 ruling 5): the type a person confirmed for the merchant
    before, else a confident AI answer on the live Non-Project list, else the fallback (marked "Check").

    A remembered type that is no longer a live Non-Project type is ignored, as is an AI answer off the list.
    The AI naming the fallback itself is still the fallback: nobody has chosen it, so it is checked.
    """
    if remembered and remembered in live_types:
        return remembered, TYPE_SOURCE_MEMORY
    if (
        answer
        and answer.expense_type in live_types
        and answer.expense_type != FALLBACK_EXPENSE_TYPE
        and answer.confidence >= AI_MIN_CONFIDENCE
    ):
        return answer.expense_type, TYPE_SOURCE_AI
    return FALLBACK_EXPENSE_TYPE, TYPE_SOURCE_FALLBACK


def needs_check(type_source: str | None) -> bool:
    """A spend Review marks "Check": its type is the fallback, which nobody has chosen."""
    return type_source == TYPE_SOURCE_FALLBACK


def spend_description(details: str, holder: str) -> str:
    """The Expense's description: "Card spend at {merchant}, {holder}'s card" (ADR-0037 ruling 6)."""
    return f"Card spend at {merchant_key(details)}, {holder}'s card"

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Credit Card Statement import's Suggest step: an expense type for every card spend, in the background
after upload (#1569, spec #1565, ADR-0037 ruling 5).

    upload ─▶ (this job: card_import.suggest_job_id = `card-suggest-<batch>`) ─▶ Review ─▶ Create

PER MERCHANT (`card_statement.merchant_key`), EVERY SPEND OF IT ALIKE
--------------------------------------------------------------------
    1. merchant memory (`card_memory.recall`): the type a person confirmed for it before -> Earlier statement
    2. else ONE Gemini call for every merchant memory does not know, given the live Non-Project type list
       (`services/extraction/merchant_types`) -> AI, when the answer is on the list and confident
    3. else the fallback, *Misc. Expenses*, marked "Check" -- what the spend was staged with already
The choice is `card_types.choose_type`.

⚠️ AN AI FAILURE NEVER BLOCKS THE IMPORT. AI switched off, a failed call or a malformed reply is "no answer":
the spends stay at the fallback, and Review and Create go on.

⚠️ IT NEVER OVERWRITES A PERSON. Only a spend still at the fallback is written, and the write re-asks that in
its own WHERE: a type chosen on Review while Gemini was thinking stays. Skipped spends (a paired refund) are
typed too, so an unskipped one reaches Create with a type.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.card_import import non_project_expense_types
from nirmaan_stack.services.extraction.files import get_extraction_settings
from nirmaan_stack.services.extraction.merchant_types import gemini_type_merchants
from nirmaan_stack.services.outflow_import.card_memory import recall
from nirmaan_stack.services.outflow_import.card_statement import merchant_key
from nirmaan_stack.services.outflow_import.card_types import TYPE_SOURCE_FALLBACK, AiAnswer, choose_type
from nirmaan_stack.services.outflow_import.parser import DIRECTION_DEBIT
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED


def suggest_card_types(batch: str) -> None:
    """THE JOB: type every spend of the import still at the fallback. Re-running it is harmless."""
    lines = frappe.db.sql(
        """
        SELECT name, remarks FROM "tabOutflow Import Row"
        WHERE import_batch = %s AND direction = %s AND type_source = %s AND row_status != %s
        ORDER BY name
        """,
        (batch, DIRECTION_DEBIT, TYPE_SOURCE_FALLBACK, ROW_SETTLED),
        as_dict=True,
    )
    if not lines:
        return

    by_merchant: dict[str, list] = {}
    for line in lines:
        by_merchant.setdefault(merchant_key(line.remarks), []).append(line)
    live = non_project_expense_types()
    remembered = recall(by_merchant)
    answers = _ask_ai({m: spends[0].remarks for m, spends in by_merchant.items() if m not in remembered}, live)

    for merchant, spends in by_merchant.items():
        answer = answers.get(merchant)
        expense_type, source = choose_type(
            remembered.get(merchant), AiAnswer(*answer) if answer else None, live
        )
        if source == TYPE_SOURCE_FALLBACK:
            continue  # Staged so already.
        # Raw: `Outflow Import Row` has no doc_events, and its type is read, never derived from. The WHERE
        # re-asks "still at the fallback, not created", so a type chosen on Review meanwhile is kept.
        frappe.db.sql(
            """
            UPDATE "tabOutflow Import Row" SET suggested_expense_type = %s, type_source = %s
            WHERE name IN %s AND type_source = %s AND row_status != %s
            """,
            (expense_type, source, tuple(spend.name for spend in spends), TYPE_SOURCE_FALLBACK, ROW_SETTLED),
        )
    frappe.db.commit()


def _ask_ai(merchants: dict[str, str], live: list[str]) -> dict[str, tuple[str | None, float]]:
    """Gemini's answers for `merchants`; none when there is nothing to ask, AI is off, or the call failed."""
    if not merchants:
        return {}
    settings = get_extraction_settings()
    if not settings.get("enabled"):
        return {}
    return gemini_type_merchants(merchants, live, settings) or {}

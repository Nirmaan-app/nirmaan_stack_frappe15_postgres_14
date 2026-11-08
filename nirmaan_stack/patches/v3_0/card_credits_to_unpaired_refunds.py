# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move every card merchant credit still open on the main table back to its own Credit Card Statement import, as an
*Unpaired card refund* waiting for Create (#1673, spec #1653, ADR-0039 Amendment D decision 8).

WHAT IT MOVES
    A card line (source `ICICI Credit Card Statement`) that is a Credit, still open (`Pending match run`,
    `Mismatched` or `Error`), carries no Create plan yet (blank `match_basis`), has no live match record and no
    pick, and whose words are a merchant's (`card_credits.merchant_credit_words`: not a payment into the card,
    cashback or the bank's auto-debit). It gets the plan a card upload now stages a refund with
    (`card_upload.stage`): `Pending match run`, Non Project Expenses, basis `card statement`, the fallback type
    marked Check. Its import's next Create records it as a negative Paid Non-Project Expense.

WHAT IT LEAVES
    Every decided credit (Settled, Partially Allocated, Skipped, Internal Transfer) stays as it was decided. An open
    credit whose words are a payment, cashback or the auto-debit (one sent back to Mismatched by hand) stays on the
    main table. An open credit with a live match record or a pick is left and PRINTED, for a person to look at: it
    is neither clearly open nor clearly decided.

IDEMPOTENT
    A moved line carries the plan, so a second run reads nothing. It returns the lines it moved.

RAW LINE UPDATE, NOT `doc.save` -- AND WHY SKIPPING THE LIFECYCLE IS CORRECT HERE (CODING_STANDARDS rule 1)
    `Outflow Import Row` has no `doc_events`. The one derived value its status feeds, the batch's counters and
    status, is recomputed from source for every touched batch (`refresh_batch_rollup`).
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.card_upload import MATCH_BASIS, SPEND_DOCTYPE
from nirmaan_stack.services.outflow_import.allocation import MATCH_REVERSED
from nirmaan_stack.services.outflow_import.card_credits import merchant_credit_words
from nirmaan_stack.services.outflow_import.card_types import FALLBACK_EXPENSE_TYPE, TYPE_SOURCE_FALLBACK
from nirmaan_stack.services.outflow_import.parser import DIRECTION_CREDIT
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.sources import CARD_STATEMENT_SOURCE
from nirmaan_stack.services.outflow_import.status import ROW_ERROR, ROW_MISMATCHED, ROW_PENDING_MATCH

ROW_DOCTYPE = "Outflow Import Row"
OPEN_STATUSES = (ROW_PENDING_MATCH, ROW_MISMATCHED, ROW_ERROR)


def execute():
    move_open_card_credits()


def move_open_card_credits(batches: list[str] | None = None) -> list[str]:
    """Move the open card merchant credits (of `batches`, else of every card import) back to their import as
    unpaired refunds. Returns the lines moved."""
    batch_clause = "AND r.import_batch IN %(batches)s" if batches else ""
    lines = frappe.db.sql(
        f"""
        SELECT r.name, r.import_batch, r.remarks, r.suggested_name,
               EXISTS (SELECT 1 FROM "tabOutflow Row Match" m
                       WHERE m.import_row = r.name AND m.match_kind != %(reversed)s) AS has_live_match
        FROM "tabOutflow Import Row" r
        WHERE r.source = %(source)s AND r.direction = %(credit)s AND r.row_status IN %(open)s
          AND COALESCE(r.match_basis, '') = '' {batch_clause}
        ORDER BY r.name
        """,
        {
            "reversed": MATCH_REVERSED,
            "source": CARD_STATEMENT_SOURCE,
            "credit": DIRECTION_CREDIT,
            "open": OPEN_STATUSES,
            "batches": tuple(batches or ()),
        },
        as_dict=True,
    )
    moved, touched = [], set()
    for line in lines:
        if not merchant_credit_words(line.remarks):
            continue
        if line.has_live_match or line.suggested_name:
            print(f"card credits patch: left {line.name} ({line.import_batch}): it has a match record or a pick.")
            continue
        # Raw: see the module docstring. The batch rollup is recomputed below.
        frappe.db.set_value(
            ROW_DOCTYPE,
            line.name,
            {
                "row_status": ROW_PENDING_MATCH,
                "suggested_doctype": SPEND_DOCTYPE,
                "match_basis": MATCH_BASIS,
                "auto_matched": 1,
                "suggested_expense_type": FALLBACK_EXPENSE_TYPE,
                "type_source": TYPE_SOURCE_FALLBACK,
                "confirm_by_hand": 0,
            },
            update_modified=False,
        )
        moved.append(line.name)
        touched.add(line.import_batch)
        print(f"card credits patch: moved {line.name} back to {line.import_batch} as an unpaired card refund.")
    for batch in sorted(touched):
        refresh_batch_rollup(batch)
    frappe.db.commit()
    return moved

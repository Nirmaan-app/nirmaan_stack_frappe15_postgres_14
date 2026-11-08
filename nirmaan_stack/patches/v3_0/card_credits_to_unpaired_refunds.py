# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move every card merchant credit still open on the main table back to its own Credit Card Statement import, as an
*Unpaired card refund* waiting for Create (#1673, spec #1653, ADR-0039 Amendment D decision 8).

WHAT IT MOVES
    A card line (source `ICICI Credit Card Statement`) that is a Credit, still open (`Pending match run`,
    `Mismatched` or `Error`), carries no Create plan yet (blank `match_basis`), has no live match record and no
    pick, and whose words are a merchant's (`_merchant_credit_words`: not a payment into the card, cashback or the
    bank's auto-debit). It gets the plan a card upload now stages a refund with (`card_upload.stage`): `Pending
    match run`, Non Project Expenses, basis `card statement`, the fallback type marked Check. Then each touched
    import's type suggestion is queued, as upload queues it (`card_import.queue_type_suggestion`), so a merchant
    type a person confirmed before replaces the fallback. Its import's next Create records it as a negative Paid
    Non-Project Expense.

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

import re

import frappe

from nirmaan_stack.api.outflow_import.card_import import queue_type_suggestion
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup

# ⚠️ THE LINES THIS PATCH CHOOSES AND THE VALUES IT WRITES ARE SPELLED HERE, AS THEY WERE ON 2026-11-08 (#1673):
# a patch is history, and a later change to the live card rules must not change what it moves on a site that
# runs it late. The batch rollup and the type suggestion stay live: each derives from the lines as they stand.
ROW_DOCTYPE = "Outflow Import Row"
CARD_SOURCE = "ICICI Credit Card Statement"
CREDIT = "Credit"
OPEN_STATUSES = ("Pending match run", "Mismatched", "Error")
REVERSED = "Reversed"
PLAN = {
    "row_status": "Pending match run",
    "suggested_doctype": "Non Project Expenses",
    "match_basis": "card statement",
    "auto_matched": 1,
    "suggested_expense_type": "Misc. Expenses",
    "type_source": "Fallback",
    "confirm_by_hand": 0,
}

# `card_statement._MERCHANT_SUFFIXES`, `_CITY_PREFIXES` and `card_credits._AUTO_DEBIT`, `_PAYMENT`, `_CASHBACK`.
_MERCHANT_SUFFIXES = frozenset({"PVT", "PRIVATE", "P", "LTD", "LIMITED", "INDIA"})
_CITY_PREFIXES = frozenset({"NEW", "NAVI"})
_AUTO_DEBIT = re.compile(r"^AUTODEBIT PAYMENT RECD\b")
_PAYMENT = re.compile(r"\bPAYMENT (?:RECD|RECEIVED)\b|^AUTO DR RETN\b")
_CASHBACK = re.compile(r"\bCASH ?BACK\b")


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
            "reversed": REVERSED,
            "source": CARD_SOURCE,
            "credit": CREDIT,
            "open": OPEN_STATUSES,
            "batches": tuple(batches or ()),
        },
        as_dict=True,
    )
    moved, touched = [], set()
    for line in lines:
        if not _merchant_credit_words(line.remarks):
            continue
        if line.has_live_match or line.suggested_name:
            print(f"card credits patch: left {line.name} ({line.import_batch}): it has a match record or a pick.")
            continue
        # Raw: see the module docstring. The batch rollup is recomputed below.
        frappe.db.set_value(ROW_DOCTYPE, line.name, PLAN, update_modified=False)
        moved.append(line.name)
        touched.add(line.import_batch)
        print(f"card credits patch: moved {line.name} back to {line.import_batch} as an unpaired card refund.")
    for batch in sorted(touched):
        refresh_batch_rollup(batch)
    frappe.db.commit()
    for batch in sorted(touched):
        queue_type_suggestion(batch)
    return moved


def _merchant_credit_words(details: str | None) -> bool:
    """Whether a card credit's words are a merchant's: neither the bank's auto-debit, a payment into the card nor
    cashback, read on the merchant key as `card_credits.sort_card_lines` read them on 2026-11-08."""
    key = _merchant_key(details or "")
    return not (_AUTO_DEBIT.search(key) or _PAYMENT.search(key) or _CASHBACK.search(key))


def _merchant_key(details: str) -> str:
    """`card_statement.merchant_key` as of 2026-11-08."""
    words = details.split()
    if len(words) >= 3 and re.fullmatch(r"[A-Za-z]{2}", words[-1]):
        words = words[:-2]
        if len(words) >= 2 and words[-1].upper() in _CITY_PREFIXES:
            words = words[:-1]
    cleaned = re.sub(r"[^A-Z0-9]+", " ", " ".join(words).upper()).split()
    while len(cleaned) > 1 and cleaned[-1] in _MERCHANT_SUFFIXES:
        cleaned.pop()
    return " ".join(cleaned)

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Internal Transfer record of one Bulk Import line (spec #1619, ADR-0044).

GLOSSARY: *Internal Transfer*. One record per line whose status is `Internal Transfer`, saying where the money came
from and went (`services/outflow_import/internal_transfers`, the one category table). The record links to its line
(`import_row`, unique), so a line never has two. It is never edited, and it is counted in no expense, inflow or
payment figure: nothing that sums those ledgers reads this doctype.
"""

from __future__ import annotations

from decimal import Decimal

import frappe

from nirmaan_stack.services.outflow_import.internal_transfers import (
    CASHBOOK_INTERNAL_KINDS,
    TransferEnds,
    cashbook_transfer_money,
    record_direction,
)
from nirmaan_stack.services.outflow_import.sources import BANK_STATEMENT_SOURCES, CASHBOOK_SOURCE
from nirmaan_stack.services.outflow_import.status import ROW_INTERNAL_TRANSFER

INTERNAL_TRANSFER_DOCTYPE = "Internal Transfer"


def _same_move(line) -> tuple[str, list]:
    """The SQL test (on `r`) and its values for the lines of `line`'s move: its repeat identity -- source, Txn Id,
    amount and direction, plus the bank text on a bank statement, whose Txn Ids repeat across lines."""
    get = line.get
    source = (get("source") or "").strip()
    clause = "r.source = %s AND r.transfer_id = %s AND r.amount = %s AND TRIM(COALESCE(r.direction, '')) = %s"
    params = [source, get("transfer_id"), float(get("amount") or 0), (get("direction") or "").strip()]
    if source in BANK_STATEMENT_SOURCES:
        clause += " AND r.remarks = %s"
        params.append(get("remarks"))
    return clause, params


def move_already_recorded(line) -> bool:
    """Whether a line of the same move as `line` (an `Outflow Import Row` doc or dict; `_same_move`) already holds
    an Internal Transfer record.

    A repeat of an internal line makes no second record (spec #1619) -- but only when its earlier sighting holds
    one: an earlier sighting the wallet said FAILED, or one sent back to Mismatched, recorded nothing.
    """
    clause, params = _same_move(line)
    return bool(
        frappe.db.sql(
            f"""SELECT 1 FROM "tabOutflow Import Row" r JOIN "tabInternal Transfer" it ON it.import_row = r.name
                WHERE {clause} LIMIT 1""",
            tuple(params),
        )
    )


def record_for_line(
    line,
    ends: TransferEnds,
    made_by: str,
    *,
    amount=None,
    direction=None,
    marked_by=None,
    marked_at=None,
    reason=None,
) -> str:
    """Insert the Internal Transfer record of `line` (an `Outflow Import Row` doc or dict) and return its name.

    `amount` is the money moved when the line's own `amount` is not it (a Cashbook top-up carries its money in the
    statement's Credit column and stages 0, #1623); by default the line's amount. `direction` (`In` / `Out`) likewise,
    for a Cashbook line, which states no direction of its own; by default the line's. The unique index on
    `import_row` refuses a second record for the same line.
    """
    get = line.get
    added_on = get("added_on")
    doc = frappe.new_doc(INTERNAL_TRANSFER_DOCTYPE)
    doc.update(
        {
            "transfer_date": frappe.utils.getdate(added_on) if added_on else None,
            "amount": float(amount if amount is not None else (get("amount") or 0)),
            "direction": direction or record_direction(get("direction")),
            "from_place": ends.from_place,
            "to_place": ends.to_place,
            "detail": ends.detail or None,
            "source": get("source"),
            "import_row": get("name"),
            "reference": get("remarks") or get("settlement_reference") or get("transfer_id"),
            "made_by": made_by,
            "marked_by": marked_by,
            "marked_at": marked_at,
            "mark_reason": reason,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def record_cashbook_move(line, move) -> str:
    """Insert the record of a Cashbook Internal Transfer line (`line`, staged) for its `move`
    (`internal_transfers.CashbookMove`), and return its name."""
    return record_for_line(line, move.ends, made_by=move.rule, amount=move.money, direction=move.direction)


def zero_records_to_fill(rows) -> tuple[tuple[str, Decimal], ...]:
    """`(record, money)` for each Cashbook Internal Transfer record holding ₹0 that a line of this statement (parsed
    `rows`) repeats and can fill (owner decision 2, #1619). READ-ONLY.

    Imports before #1623 never stored a top-up's Credit, so its record holds 0. The statement's line of the same
    move -- the same Txn Id and the same stored amount, its repeat identity -- carries the money in whichever column
    it filled (`internal_transfers.cashbook_transfer_money`). A record holding any other amount is never read.
    """
    money_of = {}
    for raw in rows:
        money = cashbook_transfer_money(raw)
        if (getattr(raw, "row_kind", "") or "").strip() in CASHBOOK_INTERNAL_KINDS and raw.transfer_id and money > 0:
            money_of[(raw.transfer_id, Decimal(str(getattr(raw, "amount", None) or 0)))] = money
    if not money_of:
        return ()
    found = frappe.db.sql(
        """SELECT it.name, r.transfer_id, r.amount FROM "tabInternal Transfer" it
           JOIN "tabOutflow Import Row" r ON r.name = it.import_row
           WHERE r.source = %s AND r.transfer_id IN %s AND it.amount = 0
           ORDER BY it.name""",
        (CASHBOOK_SOURCE, tuple(sorted({txn for txn, _ in money_of}))),
        as_dict=True,
    )
    return tuple(
        (row.name, money_of[key])
        for row in found
        if (key := (row.transfer_id, Decimal(str(row.amount or 0)))) in money_of
    )


def fill_zero_records(fills) -> None:
    """Give each ₹0 record of `fills` (`zero_records_to_fill`) its money. Nothing else on it changes.

    ⚠️ RAW (`set_value`), AND WHY SKIPPING THE LIFECYCLE IS CORRECT (CODING_STANDARDS rule 1): the record's controller
    refuses every save after insert ("never edited"), which this one sanctioned fill must pass. The record has no
    `doc_events`, and nothing stores a figure derived from its amount: the summary sums the records live.
    """
    for record, money in fills:
        frappe.db.set_value(INTERNAL_TRANSFER_DOCTYPE, record, "amount", float(money), update_modified=False)

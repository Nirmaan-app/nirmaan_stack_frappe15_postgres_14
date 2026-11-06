# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Internal Transfer record of one Bulk Import line (spec #1619, ADR-0044).

GLOSSARY: *Internal Transfer*. One record per line whose status is `Internal Transfer`, saying where the money came
from and went (`services/outflow_import/internal_transfers`, the one category table). The record links to its line
(`import_row`, unique), so a line never has two. It is never edited, and it is counted in no expense, inflow or
payment figure: nothing that sums those ledgers reads this doctype.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.outflow_import.internal_transfers import TransferEnds, record_direction
from nirmaan_stack.services.outflow_import.sources import BANK_STATEMENT_SOURCES
from nirmaan_stack.services.outflow_import.status import ROW_INTERNAL_TRANSFER

INTERNAL_TRANSFER_DOCTYPE = "Internal Transfer"
#: `made_by` on a record a person made (#1626); a rule's record carries its category id instead.
MADE_BY_HAND = "by hand"


def _same_move(line) -> tuple[str, list]:
    """The SQL test (on `r`) and its values for the lines of `line`'s move: its repeat identity -- source, Txn Id,
    amount and direction, plus the bank text on a bank statement, whose Txn Ids repeat across lines."""
    get = line.get if hasattr(line, "get") else lambda key: getattr(line, key, None)
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


def internal_transfer_lines_of_move(line, *, for_update: bool = False) -> list[str]:
    """Every Internal Transfer line of `line`'s move (`_same_move`), `line` itself included, by name.

    Send back to Mismatched sends them back together (review finding, #1619): the move's record sits on one of them,
    and a status-changed repeat left behind would be an Internal Transfer line with no record.
    """
    clause, params = _same_move(line)
    return frappe.db.sql_list(
        f"""SELECT r.name FROM "tabOutflow Import Row" r WHERE {clause} AND r.row_status = %s
            ORDER BY r.name{" FOR UPDATE" if for_update else ""}""",
        tuple(params + [ROW_INTERNAL_TRANSFER]),
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
    get = line.get if hasattr(line, "get") else lambda key: getattr(line, key, None)
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

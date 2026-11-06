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

from nirmaan_stack.services.outflow_import.internal_transfers import TransferEnds

INTERNAL_TRANSFER_DOCTYPE = "Internal Transfer"
#: `made_by` on a record a person made (#1626); a rule's record carries its category id instead.
MADE_BY_HAND = "by hand"
DIRECTION_OUT = "Out"
DIRECTION_IN = "In"


def record_direction(line_direction: str | None) -> str:
    """`In` for a line the statement calls a Credit, else `Out` -- the line's own direction, as stated."""
    return DIRECTION_IN if (line_direction or "").strip() == "Credit" else DIRECTION_OUT


def record_for_line(line, ends: TransferEnds, made_by: str, *, marked_by=None, marked_at=None, reason=None) -> str:
    """Insert the Internal Transfer record of `line` (an `Outflow Import Row` doc or dict) and return its name.

    The unique index on `import_row` refuses a second record for the same line.
    """
    get = line.get if hasattr(line, "get") else lambda key: getattr(line, key, None)
    added_on = get("added_on")
    doc = frappe.new_doc(INTERNAL_TRANSFER_DOCTYPE)
    doc.update(
        {
            "transfer_date": frappe.utils.getdate(added_on) if added_on else None,
            "amount": float(get("amount") or 0),
            "direction": record_direction(get("direction")),
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

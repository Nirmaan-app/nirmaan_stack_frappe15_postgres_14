# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""May a record a bank line settled be deleted? (ADR-0022 Amendment G.) Pure (B1).

`Outflow Row Match.target_name` is a Data field, so Frappe's delete check no longer sees a match
record at all. A Reversed one is history only and must never block the delete; a LIVE (`Settled`)
one must always block it, or the bank line would be left settling a record that is gone. This is
that refusal, for every doctype a bank line settles bar the two expense doctypes, which have their
own (`expense_links.delete_while_linked_refusal`, ADR-0027 rule 3) in the same sentence.

The lines come from `expense_links.list_expense_lines` -- the one definition of a live link, which
reads `Settled` only. That is what keeps Unreconcile's own deletes working: it stamps the match
record Reversed BEFORE it deletes the record the import created.
"""

from __future__ import annotations

from decimal import Decimal

from nirmaan_stack.services.outflow_import.amounts import to_decimal
from nirmaan_stack.services.outflow_import.expense_links import linked_lines_refusal


def delete_while_settled_refusal(name: str, lines: list[dict]) -> str | None:
    """The sentence refusing the delete while `lines` (live bank lines) settle the record, or `None`.

    Names where each line is: "(import OFR-…, 12-Oct-2026)" -- the import alone when the line has no
    bank date, nothing when its import row is gone.
    """
    if not lines:
        return None
    total = sum((to_decimal(line["target_amount"]) for line in lines), Decimal(0))
    where = "; ".join(filter(None, (_where(line) for line in lines)))
    return linked_lines_refusal(name, len(lines), total, where or None)


def _where(line: dict) -> str:
    if not line.get("import_batch"):
        return ""
    if line.get("added_on"):
        return f"import {line['import_batch']}, {line['added_on'].strftime('%d-%b-%Y')}"
    return f"import {line['import_batch']}"

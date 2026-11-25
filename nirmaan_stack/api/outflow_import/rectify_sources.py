# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What an import source plugs into the Rectify core, and the sources wired so far (#1754, spec #1753).

The core (`porter_rectify.plan_rectify` / `rectify_rows`) runs the same seven steps for every source; a
`RectifySource` says what differs. `PORTER` is the one source wired; Cashbook, card and bank sources are
added here by the spec's later tickets.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from frappe import _dict as Line
from frappe.model.document import Document

from nirmaan_stack.api.outflow_import.porter_matches import record_porter_match
from nirmaan_stack.api.outflow_import.porter_records import SOURCE as PORTER_SOURCE
from nirmaan_stack.services.outflow_import.porter import statement_line
from nirmaan_stack.services.outflow_import.porter_pdf import invoice_pdf_url
from nirmaan_stack.services.outflow_import.porter_wording import (
    booked_by,
    description_hand_edited,
    rectified_description,
)


@dataclass(frozen=True)
class RectifyWording:
    """Every sentence the core says about a source's lines, in that source's words ("order", "spend")."""

    not_this_source: str
    not_settled: str  # `{status}`
    not_found: str
    not_created: str
    unexpected: str
    already_non_project: str
    already_on: str  # `{name}`: the project's name
    nothing_ticked: str
    too_many: str  # `{limit}`, `{count}`
    too_many_title: str


@dataclass(frozen=True)
class Replacement:
    """What a source decides about the replacement Expense; the core copies the rest from the old one."""

    description: str
    payment_by: str | None
    #: The source's own `create_expense_from_row` keywords (Porter: `porter_order`).
    writer_fields: dict = field(default_factory=dict)
    #: Added to the line's result beside `from` and `to` (Porter: `description_kept`).
    result: dict = field(default_factory=dict)


@dataclass(frozen=True)
class RectifySource:
    """One import source plugged into the core. Each callable is handed the line as read with
    `line_fields` (plus the core's own fields)."""

    #: The `source` of the lines it accepts; any other line is refused with `wording.not_this_source`.
    source: str
    #: The Error Log title of an unexpected failure ("<title>: <row>").
    title: str
    #: The write endpoint's name, for the concurrent-writer log line.
    endpoint: str
    wording: RectifyWording
    line_fields: tuple[str, ...]
    #: `(line or None) -> dict`: on every plan line, refused or not.
    line_label: Callable[[Line | None], dict]
    #: `(line, expense, project_name) -> dict`: on a plan line that can move.
    plan_details: Callable[[Line, Document, str | None], dict]
    #: `(old_expense, line, from_project_name, to_project_name) -> Replacement`.
    replacement: Callable[[Document, Line, str | None, str | None], Replacement]
    #: `(line, new_expense, actor, origin) -> None`: the new Settled match.
    record_match: Callable[[Line, Document, str, str], None]
    #: `(old_expense) -> str | None`: a file URL whose `File` rows never move with the Expense.
    kept_file_url: Callable[[Document], str | None]


# --- Porter (#1449) ---------------------------------------------------------------------------------


def _porter_booker(line: Line) -> str:
    """Who booked the order, from its statement line (Create writes it as Paid by)."""
    return booked_by(statement_line(line.porter_line))


def _porter_replacement(old, line, from_name: str | None, to_name: str | None) -> Replacement:
    """Description rewritten unless hand-edited; Paid by kept, or on a move from Non-Project the booked-by
    name; the Porter Order kept."""
    booker = _porter_booker(line)
    return Replacement(
        description=rectified_description(old.description, booker, from_name, to_name),
        # Project side only: who booked it, kept as the old Project Expense had it.
        payment_by=old.get("payment_by") or booker or None,
        writer_fields={"porter_order": old.porter_order},
        result={"description_kept": description_hand_edited(old.description, booker, from_name)},
    )


def _porter_plan_details(line, expense, project_name: str | None) -> dict:
    booker = _porter_booker(line)
    return {
        "booked_by": booker,
        "description": expense.description,
        "description_edited": description_hand_edited(expense.description, booker, project_name),
    }


PORTER = RectifySource(
    source=PORTER_SOURCE,
    title="Porter Rectify",
    endpoint="rectify_porter_rows",
    wording=RectifyWording(
        not_this_source="Only an order from a Porter Statement import can be rectified.",
        not_settled="This order is {status} now, not Settled, so it has no expense to move.",
        not_found="This order no longer exists; its import may have been deleted.",
        not_created=(
            "This order's expense is not one its import created, so it cannot be rectified. "
            "Unreconcile it instead."
        ),
        unexpected="Something went wrong rectifying this order, so nothing on it was changed.",
        already_non_project="This order is already a Non-Project Expense.",
        already_on="This order is already on {name}.",
        nothing_ticked="Tick at least one Porter order to rectify.",
        too_many="At most {limit} orders can be rectified at once; {count} were sent.",
        too_many_title="Too many orders",
    ),
    line_fields=("transfer_id", "porter_line"),
    line_label=lambda line: {"crn": line.transfer_id if line else None},
    plan_details=_porter_plan_details,
    replacement=_porter_replacement,
    record_match=lambda line, new, actor, origin: record_porter_match(line, line.import_batch, new, actor, origin),
    kept_file_url=lambda old: invoice_pdf_url(old.porter_order),
)

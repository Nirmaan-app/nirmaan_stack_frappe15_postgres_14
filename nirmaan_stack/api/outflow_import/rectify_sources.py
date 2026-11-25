# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What an import source plugs into the Rectify core, and the sources wired so far (#1754, spec #1753).

The core (`porter_rectify.plan_rectify` / `rectify_rows`) runs the same seven steps for every source; a
`RectifySource` says what differs. `PORTER` (#1449), `CASHBOOK` (#1757), `CARD` (#1761), and `ICICI` and `CASHFREE`
(#1760: an expense a person created from a bank or Cashfree line with Create) are wired.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import frappe
from frappe import _dict as Line
from frappe.model.document import Document

from nirmaan_stack.api.outflow_import.card_create import record_card_match
from nirmaan_stack.api.outflow_import.card_upload import STATEMENT_DOCTYPE
from nirmaan_stack.api.outflow_import.cashbook_matches import record_cashbook_match
from nirmaan_stack.api.outflow_import.cashbook_refund_spends import spend_expenses
from nirmaan_stack.api.outflow_import.expenses import MATCH_DOCTYPE
from nirmaan_stack.api.outflow_import.porter_matches import record_porter_match
from nirmaan_stack.api.outflow_import.porter_records import ROW_DOCTYPE, line_names
from nirmaan_stack.api.outflow_import.porter_records import SOURCE as PORTER_SOURCE
from nirmaan_stack.services.card_invoices import card_line_details, statement_months
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE
from nirmaan_stack.services.outflow_import.card_statement import merchant_key
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.cashbook_refunds import (
    CREDIT_ROW_KINDS,
    REFUND_PREFIX,
    REFUND_ROW_KINDS,
    refunded_spend_id,
)
from nirmaan_stack.services.outflow_import.porter import statement_line
from nirmaan_stack.services.outflow_import.porter_pdf import invoice_pdf_url
from nirmaan_stack.services.outflow_import.porter_wording import (
    booked_by,
    description_hand_edited,
    rectified_description,
)
from nirmaan_stack.services.outflow_import.row_settlement import record_settlement
from nirmaan_stack.services.outflow_import.sources import (
    CARD_STATEMENT_SOURCE,
    CASHBOOK_SOURCE,
    CASHFREE_SOURCE,
    ICICI_STATEMENT_SOURCE,
    is_card_refund,
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
    #: A line settled to more than one record.
    split_line: str
    #: A line not moved because the line it moves with (`{txn}`) was refused (`{reason}`).
    partner_failed: str


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
    #: `(line) -> (rows, sentence)`: the lines this one moves with, in one transaction, and the refusal when they are
    #: not all ticked (with no rows: a standing refusal). Porter's lines move alone.
    partners: Callable[[Line], tuple[tuple[str, ...], str | None]] = lambda line: ((), None)
    #: A Move of its lines may learn a phrase as a project alias (#1758). Only a Cashbook remark names a project in
    #: the words the next upload reads; a phrase sent with any other source's lines refuses the write.
    learns_phrases: bool = False


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
        split_line=(
            "This order's expense is not one its import created, so it cannot be rectified. "
            "Unreconcile it instead."
        ),
        partner_failed="Not rectified: the order it moves with ({txn}) could not be. {reason}",
    ),
    line_fields=("transfer_id", "porter_line"),
    line_label=lambda line: {"crn": line.transfer_id if line else None},
    plan_details=_porter_plan_details,
    replacement=_porter_replacement,
    record_match=lambda line, new, actor, origin: record_porter_match(line, line.import_batch, new, actor, origin),
    kept_file_url=lambda old: invoice_pdf_url(old.porter_order),
)


# --- Cashbook (#1757) -------------------------------------------------------------------------------


def _cashbook_money_in(line: Line) -> bool:
    """A wallet refund or wallet credit: money back into the wallet, booked at minus itself (#1709, #1720)."""
    return (line.row_kind or "").strip() in CREDIT_ROW_KINDS


def _cashbook_spender(line: Line) -> str:
    """Who spent the money, as the import writes Paid by (`cashbook._write_one`): a spend's From, and on money coming
    back the To, the wallet holder."""
    return ((line.beneficiary_name if _cashbook_money_in(line) else line.added_by_raw) or "").strip()


def _cashbook_counterparty(line: Line) -> str:
    """The other end of the line: who was paid for a spend, who paid it back for money coming in."""
    return ((line.added_by_raw if _cashbook_money_in(line) else line.beneficiary_name) or "").strip()


def _cashbook_replacement(old, line, from_name: str | None, to_name: str | None) -> Replacement:
    """The description as it is; Paid by the spender from the statement; the wallet marker kept, and money coming back
    rebuilt from its positive amount with the writer's money-in option, so it stays negative."""
    return Replacement(
        description=old.description,
        payment_by=_cashbook_spender(line) or None,
        writer_fields={"cashbook_batch": old.cashbook_batch, "cashbook_money_in": float(old.amount or 0) < 0},
    )


def _cashbook_plan_details(line, expense, project_name: str | None) -> dict:
    """What the dialog shows of the wallet line (spec #1753 story 42): date, spender, who was paid, amount, Remark, and
    the expense's latest bill with its Bill check."""
    bill = frappe.db.get_value(
        BILL_DOCTYPE,
        {"expense_doctype": expense.doctype, "expense": expense.name, "is_latest": 1},
        ["bill_file", "bill_check", "bill_check_reason"],
        as_dict=True,
    )
    return {
        "date": str(line.added_on.date()) if line.added_on else None,
        "kind": (line.row_kind or "").strip(),
        "money_in": _cashbook_money_in(line),
        "spender": _cashbook_spender(line),
        "counterparty": _cashbook_counterparty(line),
        "remark": (line.remarks or "").strip(),
        "expense_type": expense.type,
        "bill": (
            {"file": bill.bill_file, "check": bill.bill_check, "check_reason": bill.bill_check_reason or ""}
            if bill
            else None
        ),
    }


def _cashbook_partners(line: Line) -> tuple[tuple[str, ...], str | None]:
    """A wallet spend and its refund move together or not at all (spec #1753 story 21): a spend's partners are the
    lines whose created refund names it (`REF-<Txn Id>`); a refund's, the line whose created spend it names. A refund
    whose spend is booked otherwise (keyed in by hand, or Linked) cannot move away from it."""
    txn = line.transfer_id or ""
    spend = refunded_spend_id(txn) if (line.row_kind or "").strip() in REFUND_ROW_KINDS else ""
    if not spend:
        refunds = _created_lines_holding(REFUND_PREFIX + txn)
        if not refunds:
            return (), None
        return tuple(row for row, _ in refunds), (
            f"Its refund {', '.join(t for _, t in refunds)} is booked beside it. "
            "Tick both, so the spend and its refund move together."
        )
    spends = _created_lines_holding(spend)
    if spends:
        return tuple(row for row, _ in spends), (
            f"Its spend {spend} is booked too. Tick both, so the spend and its refund move together."
        )
    held = spend_expenses([spend]).get(spend)
    if held:
        return (), (
            f"Its spend {spend} is {held.doctype} {held.name}, which its import did not create and a move cannot "
            "take, so the refund stays beside it."
        )
    return (), None


def _created_lines_holding(txn: str) -> list[tuple[str, str]]:
    """(line, Txn Id) of each Cashbook line whose live Settled match created an expense for wallet Txn Id `txn`."""
    return [
        (row.import_row, row.transfer_id)
        for row in frappe.get_all(
            MATCH_DOCTYPE,
            filters={"transfer_id": txn, "match_kind": MATCH_SETTLED, "source": CASHBOOK_SOURCE, "created_by_import": 1},
            fields=["import_row", "transfer_id"],
            order_by="import_row asc",
        )
    ]


CASHBOOK = RectifySource(
    source=CASHBOOK_SOURCE,
    title="Cashbook Move",
    endpoint="rectify_lines",
    wording=RectifyWording(
        not_this_source="Only a line from a Cashbook Statement import can be moved here.",
        not_settled="This line is {status} now, not Settled, so it has no expense to move.",
        not_found="This line no longer exists; its import may have been deleted.",
        not_created=(
            "This line's expense is not one its import created, so it cannot be moved. Unreconcile it instead."
        ),
        unexpected="Something went wrong moving this line, so nothing on it was changed.",
        already_non_project="This expense is already a Non Project Expense.",
        already_on="This expense is already on {name}.",
        nothing_ticked="Tick at least one Cashbook line to move.",
        too_many="At most {limit} lines can be moved at once; {count} were sent.",
        too_many_title="Too many lines",
        split_line="This line settled more than one record, so it cannot be moved in part.",
        partner_failed="Not moved, because the line it moves with ({txn}) could not be: {reason}",
    ),
    line_fields=("transfer_id", "row_kind", "added_by_raw", "beneficiary_name", "remarks", "added_on"),
    line_label=lambda line: {"txn_id": line.transfer_id if line else None},
    plan_details=_cashbook_plan_details,
    replacement=_cashbook_replacement,
    record_match=lambda line, new, actor, origin: record_cashbook_match(
        line.name, line.import_batch, line.transfer_id, new, actor, origin
    ),
    kept_file_url=lambda old: None,
    partners=_cashbook_partners,
    learns_phrases=True,
)


# --- Credit Card (#1761) ----------------------------------------------------------------------------


def _card_statement(expense) -> frappe._dict:
    """The expense's Credit Card Statement: its name, holder and period."""
    return frappe.db.get_value(
        STATEMENT_DOCTYPE,
        expense.credit_card_statement,
        ["name", "holder", "period_from", "period_to"],
        as_dict=True,
    ) or frappe._dict(name=expense.credit_card_statement)


def _card_replacement(old, line, from_name: str | None, to_name: str | None) -> Replacement:
    """The description as it is; Paid by the card holder (spec #1753 story 57); the statement link kept (story 55)."""
    return Replacement(
        description=old.description,
        payment_by=_card_statement(old).holder or None,
        writer_fields={"credit_card_statement": old.credit_card_statement},
    )


def _card_plan_details(line, expense, project_name: str | None) -> dict:
    """What the dialog shows of the card line (spec #1753 story 43): the holder, the merchant, the statement and the
    date; the core adds the amount."""
    statement = _card_statement(expense)
    details = card_line_details(expense.payment_ref)
    return {
        "date": str(line.added_on)[:10] if line.added_on else None,
        "holder": statement.holder or "",
        "merchant": merchant_key(details) if details else "",
        "details": details,
        "statement": statement.name,
        "statement_months": statement_months(statement.period_from, statement.period_to),
        "expense_type": expense.type,
    }


def _card_partners(line: Line) -> tuple[tuple[str, ...], str | None]:
    """A card refund moves nowhere (a standing refusal): the import books it Non Project at minus itself, and only a
    card spend may move to a project (ADR-0039 Amendment F)."""
    if is_card_refund(line.direction, line.match_basis):
        return (), "This is a card refund, which stays a Non Project Expense. Only a card spend can be moved."
    return (), None


CARD = RectifySource(
    source=CARD_STATEMENT_SOURCE,
    title="Card Move",
    endpoint="rectify_lines",
    wording=RectifyWording(
        not_this_source="Only a line from a Credit Card Statement import can be moved here.",
        not_settled="This line is {status} now, not Settled, so it has no expense to move.",
        not_found="This line no longer exists; its import may have been deleted.",
        not_created=(
            "This line's expense is not one its import created, so it cannot be moved. Unreconcile it instead."
        ),
        unexpected="Something went wrong moving this line, so nothing on it was changed.",
        already_non_project="This expense is already a Non Project Expense.",
        already_on="This expense is already on {name}.",
        nothing_ticked="Tick at least one card line to move.",
        too_many="At most {limit} lines can be moved at once; {count} were sent.",
        too_many_title="Too many lines",
        split_line="This line settled more than one record, so it cannot be moved in part.",
        partner_failed="Not moved, because the line it moves with ({txn}) could not be: {reason}",
    ),
    line_fields=("transfer_id", "direction", "match_basis", "added_on"),
    line_label=lambda line: {"txn_id": line.transfer_id if line else None},
    plan_details=_card_plan_details,
    replacement=_card_replacement,
    record_match=lambda line, new, actor, origin: record_card_match(
        line.name, line.import_batch, line.transfer_id, new, actor, origin
    ),
    kept_file_url=lambda old: None,
    partners=_card_partners,
)


# --- A bank or Cashfree line's Create (#1760) --------------------------------------------------------


def _bank_replacement(old, line, from_name: str | None, to_name: str | None) -> Replacement:
    """The description as it is; Paid by kept, or where the old expense has none (a Non Project Expense) the person who
    created it, as Create writes Paid by on a bank line (the person recording it)."""
    return Replacement(description=old.description, payment_by=old.get("payment_by") or old.owner or None)


def _bank_plan_details(line, expense, project_name: str | None) -> dict:
    """What the dialog shows of the bank line (spec #1753 story 44): date, UTR, beneficiary and remark (the amount is
    the plan's own), and the expense's type."""
    return {
        "date": str(line.added_on.date()) if line.added_on else None,
        "utr": (line.settlement_reference or line.bank_reference_no or line.transfer_id or "").strip(),
        "beneficiary": (line.beneficiary_name or "").strip(),
        "remark": (line.remarks or "").strip(),
        "expense_type": expense.type,
    }


def _bank_source(source: str) -> RectifySource:
    """A bank statement's or the payout gateway's lines: an expense a person created from one with Create. Its match
    is written by Create's own writer (`record_settlement`)."""
    return RectifySource(
        source=source,
        title=f"{source} Move",
        endpoint="rectify_lines",
        wording=RectifyWording(
            not_this_source=f"Only a line from a {source} import can be moved with these lines.",
            not_settled="This line is {status} now, not Settled, so it has no expense to move.",
            not_found="This line no longer exists; its import may have been deleted.",
            not_created=(
                "This line's record was Linked, not created with Create, so it cannot be moved. "
                "Unreconcile it instead."
            ),
            unexpected="Something went wrong moving this line, so nothing on it was changed.",
            already_non_project="This expense is already a Non Project Expense.",
            already_on="This expense is already on {name}.",
            nothing_ticked="Tick at least one line to move.",
            too_many="At most {limit} lines can be moved at once; {count} were sent.",
            too_many_title="Too many lines",
            split_line="This line settled more than one record, so it cannot be moved in part.",
            partner_failed="Not moved, because the line it moves with ({txn}) could not be: {reason}",
        ),
        line_fields=(
            "transfer_id", "added_on", "settlement_reference", "bank_reference_no", "beneficiary_name", "remarks",
            "match_basis", "suggested_name",
        ),
        line_label=lambda line: {"txn_id": line.transfer_id if line else None},
        plan_details=_bank_plan_details,
        replacement=_bank_replacement,
        record_match=lambda line, new, actor, origin: record_settlement(line, line, new, actor, origin=origin),
        kept_file_url=lambda old: None,
    )


ICICI = _bank_source(ICICI_STATEMENT_SOURCE)
CASHFREE = _bank_source(CASHFREE_SOURCE)


#: Every source Move is wired for, by its lines' `source`.
SOURCES = {source.source: source for source in (PORTER, CASHBOOK, CARD, ICICI, CASHFREE)}


def source_of(rows) -> RectifySource:
    """The source of the first ticked line (`rows`: a JSON list of line names); Porter when that line has none wired,
    so its lines are refused in Porter's words, as `porter_rectify` always refused them."""
    names = line_names(rows)
    first = frappe.db.get_value(ROW_DOCTYPE, names[0], "source") if names else None
    return SOURCES.get((first or "").strip(), PORTER)

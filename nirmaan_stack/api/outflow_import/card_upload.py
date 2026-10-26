# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Credit Card Statement upload, step by step (#1566, spec #1565, ADR-0039): what
`card_import.upload_card_statement` calls, in order.

    read_upload        the posted PDF's name and bytes (refuses anything but a .pdf)
    read_statement     the PDF's text, read and gated whole (`card_statement`), or refused
    refuse_same_period a second statement for the holder's billing period is refused, naming the first
    leave_out_repeats  lines whose SerNo is already imported are left out and counted; nothing new is refused
    stage              the batch, the Credit Card Statement and one line per new statement line

⚠️ NOTHING IS SAVED BEFORE THE WHOLE FILE IS READ. Every step before `stage` only reads or refuses: the
endpoint saves the PDF (which commits inside the request) between them and `stage`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import frappe

from nirmaan_stack.services.outflow_import.card_credits import skip_values, sort_card_lines
from nirmaan_stack.services.outflow_import.card_pdf import statement_text
from nirmaan_stack.services.outflow_import.card_statement import (
    CardLine,
    CardStatement,
    CardStatementError,
    line_reference,
    read_card_statement,
)
from nirmaan_stack.services.outflow_import.card_types import FALLBACK_EXPENSE_TYPE, TYPE_SOURCE_FALLBACK
from nirmaan_stack.services.outflow_import.parser import (
    BANK_SUCCESS_STATUS,
    DIRECTION_CREDIT,
    DIRECTION_DEBIT,
)
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.sources import CARD_STATEMENT_SOURCE
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED, ROW_PENDING_MATCH

BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"
STATEMENT_DOCTYPE = "Credit Card Statement"
SOURCE = CARD_STATEMENT_SOURCE

#: The basis a card spend's match record carries (`Outflow Row Match.match_basis`).
MATCH_BASIS = "card statement"
#: Every card spend becomes a Non-Project Expense (ADR-0039 decision 1).
SPEND_DOCTYPE = "Non Project Expenses"

_MAX_FILE_BYTES = 5 * 1024 * 1024


@dataclass(frozen=True)
class NewLines:
    """The statement's lines not already imported, and how many were left out as repeats."""

    lines: tuple[CardLine, ...]
    repeats_not_saved: int


def read_upload() -> tuple[str, bytes]:
    """The posted file's name and bytes. The werkzeug stream is read exactly once."""
    files = getattr(frappe.request, "files", None) or {}
    if "file" not in files:
        frappe.throw("No file uploaded.", title="Missing file")
    uploaded = files["file"]
    filename = uploaded.filename or ""
    _, ext = os.path.splitext(filename)
    if ext.lower() != ".pdf":
        frappe.throw(
            f"A Credit Card Statement is the bank's .pdf file. You uploaded a '{ext or 'file with no extension'}'.",
            title="Unsupported file type",
        )
    content = uploaded.read()
    if len(content) > _MAX_FILE_BYTES:
        frappe.throw(
            f"This file is {len(content) / (1024 * 1024):.1f} MB. Maximum is {_MAX_FILE_BYTES // (1024 * 1024)} MB.",
            title="File too large",
        )
    return filename, content


def read_statement(content: bytes) -> CardStatement:
    """The PDF's text, read and gated whole. A locked or unreadable PDF, another company's statement, a
    cash advance or lines that miss the statement's own totals are refused here."""
    try:
        return read_card_statement(statement_text(content))
    except CardStatementError as exc:
        frappe.throw(str(exc), title="Could not import this statement")


def refuse_same_period(statement: CardStatement) -> None:
    """One statement per holder per billing period (ADR-0039 decision 2)."""
    earlier = frappe.db.get_value(
        STATEMENT_DOCTYPE,
        {"holder": statement.holder, "period_from": statement.period_from, "period_to": statement.period_to},
        ["name", "import_batch"],
        as_dict=True,
    )
    if earlier:
        frappe.throw(
            f"{statement.holder}'s statement for {statement.period_from:%d-%b-%Y} to {statement.period_to:%d-%b-%Y} "
            f"is already imported, in {earlier.import_batch}. Open it from Import History, or discard it first.",
            title="Already imported",
        )


def leave_out_repeats(statement: CardStatement) -> NewLines:
    """Leave out every line whose SerNo a card import already holds (the SerNo is a line's identity, scoped
    to this source). A file holding nothing new is refused, naming the import that holds its lines."""
    sernos = [line.serno for line in statement.lines]
    held = dict(
        frappe.db.sql(
            """
            SELECT transfer_id, MIN(import_batch) FROM "tabOutflow Import Row"
            WHERE source = %s AND transfer_id IN %s
            GROUP BY transfer_id
            """,
            (SOURCE, tuple(sernos)),
        )
    )
    fresh = tuple(line for line in statement.lines if line.serno not in held)
    if not fresh:
        batches = ", ".join(sorted(set(held.values())))
        frappe.throw(
            f"This statement holds nothing new: every one of its {len(sernos)} lines is already imported, in "
            f"{batches}.",
            title="Already imported",
        )
    return NewLines(lines=fresh, repeats_not_saved=len(statement.lines) - len(fresh))


def stage(statement: CardStatement, new: NewLines, file_url: str, filename: str, user: str) -> tuple[str, str]:
    """The batch, the Credit Card Statement and one line per new statement line, in statement order.
    Returns (batch, statement)."""
    spends_total = sum((line.amount for line in new.lines if not line.is_credit), 0)
    batch = frappe.new_doc(BATCH_DOCTYPE)
    batch.update(
        {
            "source": SOURCE,
            # `source_file` is written after the statement claims the File (below), never on this insert:
            # Frappe's Attach hook would attach the File to the batch first, and then copy it for the
            # statement -- two Files for one PDF.
            "original_filename": filename,
            "period_from": statement.period_from,
            "period_to": statement.period_to,
            # What the card paid out: its spends. A credit (a payment into the card, a refund) is no outflow.
            "gross_amount": float(spends_total),
            "charges_amount": 0,
            "repeats_not_saved": new.repeats_not_saved,
            "uploaded_by": user,
            "uploaded_at": frappe.utils.now_datetime(),
            "status": "Draft",
        }
    )
    batch.insert(ignore_permissions=True)

    totals = statement.totals
    record = frappe.new_doc(STATEMENT_DOCTYPE)
    record.update(
        {
            "holder": statement.holder,
            "company": statement.company,
            "statement_date": statement.statement_date,
            "period_from": statement.period_from,
            "period_to": statement.period_to,
            "import_batch": batch.name,
            "statement_file": file_url,
            "previous_balance": float(totals.previous_balance),
            "purchases_charges": float(totals.purchases),
            "cash_advances": float(totals.cash_advances),
            "payments_credits": float(totals.payments),
            "total_amount_due": float(totals.total_due),
        }
    )
    record.insert(ignore_permissions=True)
    # Raw, and safe: the batch has no doc_events, and its stored URL is only the PDF the statement holds.
    frappe.db.set_value(BATCH_DOCTYPE, batch.name, "source_file", file_url, update_modified=False)

    # The credits are sorted over THIS import's lines (#1567): a refund pairs only with a spend staged here.
    sorts = sort_card_lines(new.lines)
    names: dict[str, str] = {}
    for line in new.lines:
        values = {
            "import_batch": batch.name,
            "source": SOURCE,
            "transfer_id": line.serno,
            "added_on": line.date,
            "amount": float(line.amount),
            "status_raw": BANK_SUCCESS_STATUS,
            "direction": DIRECTION_CREDIT if line.is_credit else DIRECTION_DEBIT,
            "beneficiary_name": line.details[:140],
            "remarks": line.details,
            # The Expense's payment reference (ADR-0039 decision 6), resolved once, here (README ruling 6).
            "settlement_reference": line_reference(line),
        }
        if line.is_credit:
            # An unpaired credit is open work on the main table (README ruling 4).
            values["row_status"] = ROW_MISMATCHED
        else:
            # A spend keeps its Create plan even when a refund cancels it, so an unskipped pair brings it
            # straight back as Create's work.
            values.update(
                {
                    "row_status": ROW_PENDING_MATCH,
                    "suggested_doctype": SPEND_DOCTYPE,
                    "match_basis": MATCH_BASIS,
                    "auto_matched": 1,
                    # Misc. Expenses, marked Check, until suggestion (#1569) or a person on Review says better.
                    "suggested_expense_type": FALLBACK_EXPENSE_TYPE,
                    "type_source": TYPE_SOURCE_FALLBACK,
                }
            )
        # A payment into the card, cashback and both lines of a refund pair are system skips.
        values.update(skip_values(sorts[line.serno]))
        doc = frappe.new_doc(ROW_DOCTYPE)
        doc.update(values)
        doc.insert(ignore_permissions=True)
        names[line.serno] = doc.name

    # Each line of a refund pair links the other, once both exist. Raw, and safe: the row has no doc_events,
    # and the link is written once here and cleared only by the pair's unskip.
    for serno, sort in sorts.items():
        if sort.partner is not None:
            frappe.db.set_value(
                ROW_DOCTYPE, names[serno], "card_refund_partner", names[sort.partner.serno], update_modified=False
            )

    refresh_batch_rollup(batch.name)
    return batch.name, record.name

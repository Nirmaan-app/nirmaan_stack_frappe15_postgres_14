# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A move to a project or Non-Project: the replacement Expense takes the old one's place (#1449, #1757; split out of
the Rectify core `porter_rectify` by #1762, which added the Internal Transfer destination, `rectify_transfer`).

Steps 2-6 of the core's per-line steps, the comments aside: run inside the core's savepoint, after the line's Settled
match is stamped Reversed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import frappe

from nirmaan_stack.api.outflow_import.porter_records import ROW_DOCTYPE
from nirmaan_stack.api.outflow_import.unreconcile_created import delete_created
from nirmaan_stack.services.expense_bills.receive import move_bills
from nirmaan_stack.services.outflow_import.settle import ExpenseInvoice, create_expense_from_row

if TYPE_CHECKING:
    from nirmaan_stack.api.outflow_import.rectify_sources import RectifySource, Replacement


#: `settlement_origin` of a rectified line: a person moved it off the import's plan.
_ORIGIN = "Suggestion overridden"


@dataclass(frozen=True)
class _ExpenseAsRow:
    """The old Expense, in the shape `create_expense_from_row` reads a bank line by attribute.

    ⚠️ THE REPLACEMENT IS BUILT FROM THE OLD EXPENSE, NOT FROM THE STATEMENT LINE. It must be identical to
    what it replaces; the line holds what the statement said, the Expense what the app recorded.
    """

    amount: object
    added_on_date: object
    settlement_reference: str
    beneficiary_name: str = ""
    remarks: str = ""


def replace_expense(
    source: RectifySource, line, old, new_doctype: str, project: str | None, expense_type: str | None,
    replacement: Replacement, actor: str,
) -> str:
    """Steps 2-6 (but the comments) of a move to a project or Non-Project: the replacement Expense takes the old one's
    place. Returns its name."""
    new = create_expense_from_row(
        _ExpenseAsRow(
            # Money coming back is stored at minus itself; the writer books it negative only through the
            # source's own money-in option (`Replacement.writer_fields`), from its positive amount.
            amount=abs(old.amount),
            added_on_date=old.payment_date,
            settlement_reference=old.payment_ref or "",
        ),
        doctype=new_doctype,
        expense_type=expense_type or old.type,
        actor=actor,
        project=project,
        description=replacement.description,
        vendor=old.get("vendor") if project else None,
        comment=old.comment,
        statement_file_url=None,
        payment_by=replacement.payment_by,
        blank_payment_by_is_actor=False,
        invoice=ExpenseInvoice(number=old.invoice_ref, date=old.invoice_date, file_url=old.invoice_attachment),
        **replacement.writer_fields,
    )
    _move_attachments(old, new.doctype, new.name, source.kept_file_url(old))
    # BEFORE the delete: its `on_trash` would retire every bill still on the old Expense.
    move_bills(old.doctype, old.name, new.doctype, new.name)
    delete_created(old.doctype, old.name, None)
    source.record_match(line, new, actor, _ORIGIN)
    _follow_on_the_line(line.name, new, project, expense_type or old.type, actor)
    return new.name


def _move_attachments(old, doctype: str, name: str, kept_file_url: str | None) -> None:
    """Carry over what a person attached to the old Expense, before the delete would take it.

    ⚠️ RAW, AND THAT IS THE POINT. `frappe.delete_doc` deletes every `File` attached to the old Expense
    through the document layer, and the storage app's `on_trash` then deletes the stored object -- a photo
    someone added would be lost. Re-pointing the `File` row keeps the object and its storage key (which is
    fixed at insert); `File` has no hook on these fields. The `payment_attachment` value is written after
    the insert for the reason `create_expense_from_row` writes `invoice_attachment` so: a save would make a
    second `File` row for it. Nothing is derived from either.

    ⚠️ NEVER A ROW FOR `kept_file_url` (Porter: the shared invoice PDF). That PDF's one File is its Porter
    Invoice's (`integrations/controllers/expense_files`); a copy an older save left on the old Expense stays
    there and goes with it, through the shared-bytes-safe delete, which leaves the PDF in place.
    """
    if old.get("payment_attachment"):
        frappe.db.set_value(doctype, name, "payment_attachment", old.payment_attachment, update_modified=False)
    frappe.db.sql(
        """UPDATE "tabFile" SET attached_to_doctype = %s, attached_to_name = %s
           WHERE attached_to_doctype = %s AND attached_to_name = %s
             AND file_url IS DISTINCT FROM %s""",
        (doctype, name, old.doctype, old.name, kept_file_url),
    )


def _follow_on_the_line(row: str, new, project: str | None, expense_type: str, actor: str) -> None:
    """The line's plan and pick follow the new Expense, so a later Unreconcile + Create re-creates it where
    it was rectified to. Its status stays Settled, so the batch rollup does not move.

    Raw: `Outflow Import Row` carries no doc_events.
    """
    frappe.db.set_value(
        ROW_DOCTYPE,
        row,
        {
            "suggested_doctype": new.doctype,
            "resolved_project": project,
            "suggested_expense_type": expense_type,
            "suggested_name": new.name,
            "outcome_note": f"Moved to {new.doctype} {new.name}.",
            "decided_at": frappe.utils.now_datetime(),
            "decided_by": actor,
            "settlement_origin": _ORIGIN,
        },
        update_modified=False,
    )

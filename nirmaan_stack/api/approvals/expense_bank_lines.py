"""The bank lines that settle one expense, read-only (#1303, ADR-0027 R5).

Backs the click-to-open Bank lines card on the Payments & Expenses table: the live slips (date,
beneficiary, reference, import batch, amount) and what they add up to against the expense's amount.

A thin orchestrator (ADR-0010 B4) -- gate, read, shape. Both reads belong to
`services/outflow_import/expense_links.py`, which owns what a live link IS: `load_expense_links`
totals them, `list_expense_lines` itemises the SAME slips. Neither is re-spelled here, so the figure
in the card's headline and the rows under it cannot come to disagree.

⚠️ THIS MODULE WRITES NOTHING, TAKES NO LOCK, AND OFFERS NO ACTION. Links are changed in ONE place --
Unreconcile on Bulk Import Transactions -- and the card says so. An "undo from here" would be a second
door onto a rule (`unreconcile._expense_verdict`) that exists precisely because there is only one.

⚠️ THE GATE IS "CAN YOU READ THIS EXPENSE", NOT THE BULK-IMPORT MODULE GATE. This card renders on the
approvals screen, whose readers include roles that never open Bulk Import Transactions. Someone who
may read the expense may see which bank lines paid it; someone who may not, gets nothing. Reusing
`require_outflow_access` here would hide the card from most of the people the screen is for.
"""

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.services.outflow_import.expense_links import (
    list_expense_lines,
    load_expense_links,
    remaining_balance,
)
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.outflow_import.normalize import normalize_amount


@frappe.whitelist()
def get_expense_bank_lines(doctype: str, name: str) -> dict:
    """Every live bank line linked to one expense, with the linked total and what is left.

    URL: /api/method/nirmaan_stack.api.approvals.expense_bank_lines.get_expense_bank_lines

    Returns the expense's own facts (`status`, `amount`, `payment_date`), the derived
    `linked_total` / `line_count` / `remaining`, and `lines` oldest first.

    ⚠️ `Reversed` SLIPS ARE NOT LISTED. A reversed slip is an undone link -- it contributes nothing to
    the linked total, so listing it would show a line the figure above it does not count.
    """
    if doctype not in EXPENSE_DOCTYPES:
        frappe.throw(
            _("Bank lines are only kept for an expense, not for '{0}'.").format(doctype),
            title=_("Not an expense"),
        )

    # ⚠️ THE PERMISSION TEST COMES BEFORE ANY READ OF THE NAME, and the order is the point: checked
    # after, the "not found" refusal answers "does this expense exist?" for somebody who may not read
    # a single one of them, which is an enumeration oracle. Asked at the DOCTYPE level, because a
    # document-level test needs the document loaded -- which is the read being gated.
    if not frappe.has_permission(doctype, "read"):
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    expense = frappe.db.get_value(
        doctype, name, ["name", "status", "amount", "payment_date"], as_dict=True
    )
    if not expense:
        frappe.throw(_("{0} '{1}' not found.").format(doctype, name), frappe.DoesNotExistError)

    # The document-level test on top: the doctype gate above admits the role, this one applies any
    # User Permission narrowing it to certain projects.
    if not frappe.has_permission(doctype, "read", name):
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    links = load_expense_links(doctype, name)
    amount = normalize_amount(expense.get("amount"))

    return {
        "doctype": doctype,
        "name": expense["name"],
        "status": expense.get("status") or "",
        "amount": float(amount),
        "payment_date": str(expense["payment_date"]) if expense.get("payment_date") else None,
        "linked_total": float(links.linked_total),
        "line_count": links.line_count,
        # ⚠️ THE ONE "WHAT IS LEFT" THE CARD READS. Computed here in Decimal, from the same aggregate
        # the settle guard measures room against, and rendered as sent -- the frontend does not
        # re-derive it from the amount, or the sentence under the bar could disagree with the write
        # that refuses the next link.
        "remaining": float(remaining_balance(amount, links.linked_total)),
        "lines": [_line(r) for r in list_expense_lines(doctype, name)],
    }


def _line(row) -> dict:
    """One slip as the card reads it.

    ⚠️ THE REFERENCE IS THE BANK'S, WITH `transfer_id` AS THE FALLBACK -- the same pair
    `unreconcile.get_unreconcile_plan` shows for the same line, so one bank line does not read as two
    different references on two screens.

    ⚠️ THE AMOUNT IS THE SLIP'S `target_amount`, NOT THE BANK ROW'S. Under ADR-0027 that field means
    "the money that moved between this line and this record", which is what makes the column add up
    to the linked total on a many-line expense.
    """
    return {
        "match": row.get("match_name"),
        "import_row": row.get("import_row") or "",
        "import_batch": row.get("import_batch") or "",
        "added_on": str(row["added_on"]) if row.get("added_on") else None,
        "beneficiary_name": (row.get("beneficiary_name") or "").strip(),
        "reference": (row.get("bank_reference_no") or "").strip()
        or (row.get("transfer_id") or "").strip(),
        "amount": flt(row.get("target_amount")),
    }

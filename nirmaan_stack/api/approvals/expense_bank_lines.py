"""The bank lines that settle one expense or one PO / SR payment, read-only (#1303, ADR-0027 R5).

A payment is read the same way. The one difference: a payment a bank line paid only PART of was
SPLIT (a Paid half + a Reconciliation Pending balance, `split_from`), so for a payment in such a
part-reconciled family the card reads the whole family -- every member's lines, the family's
reconciled total and its pending balance -- which is what the queue's Amount cell shows for it.

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
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES, PAYMENT_DOCTYPE
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.payment_split import part_reconciled_split_family_of

# Every ledger a bank line can settle. Named once, so the refusal and the gate read one list.
_BANK_LINE_DOCTYPES = (PAYMENT_DOCTYPE, *EXPENSE_DOCTYPES)


@frappe.whitelist()
def get_expense_bank_lines(doctype: str, name: str) -> dict:
    """Every live bank line linked to one expense or payment, with the linked total and what is left.

    URL: /api/method/nirmaan_stack.api.approvals.expense_bank_lines.get_expense_bank_lines

    Returns the expense's own facts (`status`, `amount`, `payment_date`), the derived
    `linked_total` / `line_count` / `remaining`, and `lines` oldest first.

    ⚠️ `Reversed` SLIPS ARE NOT LISTED. A reversed slip is an undone link -- it contributes nothing to
    the linked total, so listing it would show a line the figure above it does not count.
    """
    if doctype not in _BANK_LINE_DOCTYPES:
        frappe.throw(
            _("Bank lines are only kept for a payment or an expense, not for '{0}'.").format(doctype),
            title=_("Not a payment or expense"),
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

    if doctype == PAYMENT_DOCTYPE:
        family = part_reconciled_split_family_of(name)
        if family:
            return _family_card(expense, family)

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


def _family_card(payment, family: dict) -> dict:
    """The card for a payment in a part-reconciled split family: the whole request, not this half.

    `amount` is what the family still has to reconcile plus what it has -- the original request
    less any part never approved (a CEO part-approval's remainder is not waiting for the bank).
    `payment_date` is blank: the request is not fully paid, whatever this member's own date.
    """
    lines = [
        row
        for member in family["members"]
        for row in list_expense_lines(PAYMENT_DOCTYPE, member)
    ]
    # One run, oldest first, as `list_expense_lines` orders a single record's lines.
    lines.sort(key=lambda r: (r.get("added_on") is None, r.get("added_on") or "", r.get("match_name") or ""))
    return {
        "doctype": PAYMENT_DOCTYPE,
        "name": payment["name"],
        "status": payment.get("status") or "",
        "amount": family["reconciled"] + family["pending"],
        "payment_date": None,
        "linked_total": family["reconciled"],
        "line_count": family["line_count"],
        "remaining": family["pending"],
        "lines": [_line(r) for r in lines],
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
        # The bank line itself: when it is only PART used (split across several records), the
        # card says how much of it is reconciled and how much still waits in Bulk Import.
        "line_amount": flt(row.get("line_amount")),
        "line_status": row.get("line_status") or "",
        "line_reconciled": flt(row.get("line_reconciled")),
        "line_pending": flt(row.get("line_amount")) - flt(row.get("line_reconciled")),
    }

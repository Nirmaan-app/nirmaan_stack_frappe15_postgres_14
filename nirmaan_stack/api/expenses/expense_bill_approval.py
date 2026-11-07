# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Expense bill approval: Vendor Invoice Recon -> Pending Approval -> Cashbook / Credit Card (#1644, spec #1637,
GLOSSARY *Expense bill approval*, ADR-0045).

URLs: /api/method/nirmaan_stack.api.expenses.expense_bill_approval.<get_pending_expense_bills | approve_expense_bill |
reject_expense_bill | read_expense_bill_again>

Gate: the Vendor Invoice approvers (`role_profiles.INVOICE_APPROVAL_PROFILES`: Admin, Accountant, Accountant Lead),
checked here on the server, not only by the screen. Read again (#1645): Admin and Accountant Lead
(`role_profiles.READ_AGAIN_PROFILES`).
"""

from typing import NamedTuple

import frappe

from nirmaan_stack.api.expenses.cashbook_invoices import EXPENSE_DOCTYPES, NON_PROJECT_EXPENSE, PROJECT_EXPENSE

from nirmaan_stack.services.expense_bills import BILL_DOCTYPE, PENDING
from nirmaan_stack.services.expense_bills.approval import approve_bill, reject_bill
from nirmaan_stack.services.expense_bills.bill_check import CHECKING, MATCHED, MISMATCHED
from nirmaan_stack.services.expense_bills.reading import read_again
from nirmaan_stack.services.expense_invoices import require_profile
from nirmaan_stack.services.role_profiles import INVOICE_APPROVAL_PROFILES, READ_AGAIN_PROFILES


class Pill(NamedTuple):
    """One pill of expense bills: the ledgers its spends are on, and the SQL condition that puts a spend on it."""

    ledgers: tuple[str, ...]
    condition: str


#: The two pills: the Cashbook import's marker, or a card statement.
KINDS = {
    "cashbook": Pill(EXPENSE_DOCTYPES, "COALESCE(e.cashbook_batch, '') != ''"),
    "card": Pill((NON_PROJECT_EXPENSE,), "COALESCE(e.credit_card_statement, '') != ''"),
}

# `read_total` is a Currency column, 0 when nothing was read: only a compared bill shows one.
# A waiting bill: Pending, its Expense's latest, its Bill check done. The number and date offered are the bill's
# own, else what was typed on the Expense (a Mismatched or Not read bill fills none of its own).
_PENDING_SQL = f"""
    SELECT b.name, b.expense, b.expense_doctype, e.payment_date, b.line_amount,
           CASE WHEN b.bill_check IN ('{MATCHED}', '{MISMATCHED}') THEN b.read_total END AS read_total,
           b.bill_check, b.bill_check_reason,
           COALESCE(NULLIF(b.invoice_no, ''), e.invoice_ref) AS invoice_no,
           COALESCE(b.invoice_date, e.invoice_date) AS invoice_date,
           {{paid_by}} AS paid_by, {{project}} AS project, {{project_name}} AS project_name,
           b.uploaded_by, u.full_name AS uploaded_by_name, b.bill_file, b.creation
    FROM "tab{BILL_DOCTYPE}" b
    JOIN "tab{{doctype}}" e ON e.name = b.expense
    LEFT JOIN "tabOutflow Import Row" r ON r.name = b.statement_line
    LEFT JOIN "tabUser" u ON u.name = b.uploaded_by
    {{joins}}
    WHERE b.expense_doctype = %(doctype)s AND b.is_latest = 1
      AND b.status = '{PENDING}' AND b.bill_check != '{CHECKING}'
      AND {{kind}}
"""


def _pending_rows(kind: str, doctype: str) -> list[dict]:
    if kind == "card":
        parts = {
            "paid_by": "s.holder",
            "joins": 'LEFT JOIN "tabCredit Card Statement" s ON s.name = e.credit_card_statement',
        }
    else:
        # Who paid is the wallet holder on the statement line; else the Project Expense's own Paid by.
        payment_by = "e.payment_by" if doctype == PROJECT_EXPENSE else "NULL"
        parts = {"paid_by": f"COALESCE(NULLIF(BTRIM(r.added_by_raw), ''), {payment_by})", "joins": ""}
    if doctype == PROJECT_EXPENSE:
        parts.update(project="e.projects", project_name="p.project_name")
        parts["joins"] += ' LEFT JOIN "tabProjects" p ON p.name = e.projects'
    else:
        parts.update(project="NULL", project_name="NULL")
    sql = _PENDING_SQL.format(doctype=doctype, kind=KINDS[kind].condition, **parts)
    return frappe.db.sql(sql, {"doctype": doctype}, as_dict=True)


def _require_approver() -> str:
    return require_profile(INVOICE_APPROVAL_PROFILES, "Only an Admin or an Accountant can approve or reject an expense bill.")


@frappe.whitelist()
def get_pending_expense_bills(kind: str) -> list[dict]:
    """The expense bills waiting for a person on pill `kind` ("cashbook" or "card"), newest bill first.

    Each row: `name` (the Expense bill), `expense`, `expense_doctype`, `payment_date` (the spend date), `line_amount`, `read_total`
    (None unless the bill was compared: Matched or Mismatched), `bill_check` and `bill_check_reason`, `invoice_no` and `invoice_date` (to approve
    with), `paid_by` (the wallet holder or the card holder), `project` and `project_name` (None on a Non-Project
    spend), `uploaded_by` and `uploaded_by_name` (who attached it), `bill_file`.
    """
    _require_approver()
    if kind not in KINDS:
        frappe.throw(f"'{kind}' is not a Pending Approval pill of expense bills.")
    rows = [row for doctype in KINDS[kind].ledgers for row in _pending_rows(kind, doctype)]
    rows.sort(key=lambda r: (r["creation"], r["name"]), reverse=True)
    for row in rows:
        del row["creation"]
    return rows


@frappe.whitelist(methods=["POST"])
def approve_expense_bill(bill: str, invoice_no: str | None = None, invoice_date: str | None = None) -> dict:
    """Approve waiting Expense bill `bill` (Pending, latest, read). `invoice_no` and `invoice_date` (ISO, not in the
    future) are optional corrections; left out, the bill's own, else the ones typed on the Expense, are kept. Both
    are mirrored onto the Expense; `approved_by` and `approved_on` record who and when.

    Example: `{"bill": "EB-2026-00042", "invoice_no": "INV-9A", "invoice_date": "2026-09-08"}` ->
    `{"name": "EB-2026-00042"}`.
    """
    user = _require_approver()
    approve_bill(bill, invoice_no, invoice_date, user)
    frappe.db.commit()
    return {"name": bill}


@frappe.whitelist(methods=["POST"])
def reject_expense_bill(bill: str, reason: str) -> dict:
    """Reject waiting Expense bill `bill` for the typed `reason` (required). The Expense's invoice attachment, ref
    and date are cleared, so it waits again in its Pending Invoices Upload tab, showing the reason.

    Example: `{"bill": "EB-2026-00042", "reason": "Bill of another shop"}` -> `{"name": "EB-2026-00042"}`.
    """
    _require_approver()
    reject_bill(bill, reason)
    frappe.db.commit()
    return {"name": bill}


@frappe.whitelist(methods=["POST"])
def read_expense_bill_again(bill: str) -> dict:
    """Read again Expense bill `bill`, whose Bill check is Not read: it goes back to Checking and its reading is
    queued. Admin and Accountant Lead only.

    Example: `{"bill": "EB-2026-00042"}` -> `{"name": "EB-2026-00042"}`.
    """
    require_profile(READ_AGAIN_PROFILES, "Only an Admin or an Accountant Lead can read a bill again.")
    read_again(bill)
    frappe.db.commit()
    return {"name": bill}

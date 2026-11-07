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

import frappe

from nirmaan_stack.services.expense_bills import PENDING
from nirmaan_stack.services.expense_bills.approval import approve_bill, reject_bill
from nirmaan_stack.services.expense_bills.bill_check import CHECKING
from nirmaan_stack.services.expense_bills.bill_rows import KINDS, bill_rows_sql
from nirmaan_stack.services.expense_bills.reading import read_again
from nirmaan_stack.services.expense_invoices import require_profile
from nirmaan_stack.services.role_profiles import INVOICE_APPROVAL_PROFILES, READ_AGAIN_PROFILES


#: A waiting bill: Pending, its Expense's latest, its Bill check done -- or its reading stopped, which the rows show
#: as Not read so Read again can reach it (#1645). Its number and date are the ones to approve with.
_PENDING_SQL = f"""SELECT q.* FROM ({{rows}}) q
    WHERE q.is_latest = 1 AND q.approval = '{PENDING}' AND q.bill_check != '{CHECKING}'"""

#: The columns a waiting bill's row carries (`get_pending_expense_bills`).
_PENDING_COLUMNS = (
    "name", "expense", "expense_doctype", "payment_date", "line_amount", "read_total", "bill_check",
    "bill_check_reason", "invoice_no", "invoice_date", "paid_by", "project", "project_name", "uploaded_by",
    "uploaded_by_name", "bill_file", "approved_by", "approved_on", "rejected_by", "rejected_on",
)


def _require_approver() -> str:
    return require_profile(INVOICE_APPROVAL_PROFILES, "Only an Admin or an Accountant can approve or reject an expense bill.")


@frappe.whitelist()
def get_pending_expense_bills(kind: str) -> list[dict]:
    """The expense bills waiting for a person on pill `kind` ("cashbook" or "card"), newest bill first.

    Each row: `name` (the Expense bill), `expense`, `expense_doctype`, `payment_date` (the spend date), `line_amount`, `read_total`
    (None unless the bill was compared: Matched or Mismatched), `bill_check` and `bill_check_reason`, `invoice_no` and `invoice_date` (to approve
    with), `paid_by` (the wallet holder or the card holder), `project` and `project_name` (None on a Non-Project
    spend), `uploaded_by` and `uploaded_by_name` (who attached it), `bill_file`, and the decision record
    `approved_by`, `approved_on`, `rejected_by`, `rejected_on` (all None on a waiting bill).

    Example: `{"kind": "card"}` -> `[{"name": "EB-2026-00042", "expense": "NPE-0042", "bill_check": "Mismatched",
    "bill_check_reason": "The bill's total is ₹1,250.00; the statement line is ₹1,180.00.", "line_amount": 1180.0,
    "read_total": 1250.0, "invoice_no": "INV-9", "paid_by": "A Holder", ...}]`.
    """
    _require_approver()
    if kind not in KINDS:
        frappe.throw(f"'{kind}' is not a Pending Approval pill of expense bills.")
    rows_sql, params = bill_rows_sql(kind)
    rows = frappe.db.sql(_PENDING_SQL.format(rows=rows_sql), params, as_dict=True)
    rows.sort(key=lambda r: (r["creation"], r["name"]), reverse=True)
    return [{column: row[column] for column in _PENDING_COLUMNS} for row in rows]


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
    """Reject waiting Expense bill `bill` for the typed `reason` (required); `rejected_by` and `rejected_on` record
    who and when. The Expense's invoice attachment, ref and date are cleared, so it waits again in its Pending
    Invoices Upload tab, showing the reason.

    Example: `{"bill": "EB-2026-00042", "reason": "Bill of another shop"}` -> `{"name": "EB-2026-00042"}`.
    """
    user = _require_approver()
    reject_bill(bill, reason, user)
    frappe.db.commit()
    return {"name": bill}


@frappe.whitelist(methods=["POST"])
def read_expense_bill_again(bill: str) -> dict:
    """Read again Expense bill `bill`, whose Bill check is Not read (Pending, or approved by a person on Payment
    Done; never a Rejected or replaced one): it goes back to Checking and its reading is queued. Admin and
    Accountant Lead only.

    Example: `{"bill": "EB-2026-00042"}` -> `{"name": "EB-2026-00042"}`.
    """
    require_profile(READ_AGAIN_PROFILES, "Only an Admin or an Accountant Lead can read a bill again.")
    read_again(bill)
    frappe.db.commit()
    return {"name": bill}

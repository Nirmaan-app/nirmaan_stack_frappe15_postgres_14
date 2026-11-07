# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Expense bill approval by a person: approve or reject a waiting bill (#1644, spec #1637, GLOSSARY *Expense bill
approval*). The endpoints are `api/expenses/expense_bill_approval.py`; they check who may decide.

A bill waits while it is Pending, is its Expense's latest bill and has a Bill check result (Checking bills are
still being read), or its reading stopped (`reading.reading_stopped`; decided as Not read, #1645). Both decisions read the bill and its Expense `FOR UPDATE`, refuse any other state by name, and
save both through the document layer (`doc_events` run, `track_changes` keeps a Version). Neither commits.

* Approve: the number and date (a person's correction, else the bill's own, else what the Accountant typed on the
  Expense) go on the bill and are mirrored onto the Expense.
* Reject: the reason stays on the bill; the Expense's invoice attachment, ref and date are cleared, so it waits
  in its Pending Invoices Upload tab again, where the latest rejection's reason shows.
"""

from __future__ import annotations

import frappe
from frappe.utils import getdate, now_datetime, nowdate

from nirmaan_stack.services.card_invoices import FUTURE_INVOICE_DATE
from nirmaan_stack.services.expense_bills import APPROVED, BILL_DOCTYPE, PENDING, REJECTED
from nirmaan_stack.services.expense_bills.bill_check import CHECKING, NOT_READ
from nirmaan_stack.services.expense_bills.reading import READING_STOPPED, reading_stopped

REASON_REQUIRED = "Type the reason this bill is rejected."


def approve_bill(name: str, invoice_no: str | None, invoice_date: str | None, user: str) -> None:
    """Approve waiting bill `name` as `user`, with an optional corrected `invoice_no` and `invoice_date` (ISO)."""
    bill, expense = _lock_waiting(name)
    number = (invoice_no or "").strip() or bill.invoice_no or expense.invoice_ref or None
    day = getdate(invoice_date) if invoice_date else (bill.invoice_date or expense.invoice_date or None)
    if day and str(day) > nowdate():
        frappe.throw(FUTURE_INVOICE_DATE)
    bill.invoice_no = number
    bill.invoice_date = day
    bill.status = APPROVED
    bill.approved_by = user
    bill.approved_on = now_datetime()
    bill.save(ignore_permissions=True)
    expense.invoice_ref = number
    expense.invoice_date = day
    expense.save(ignore_permissions=True)


def reject_bill(name: str, reason: str | None, user: str) -> None:
    """Reject waiting bill `name` as `user` for the typed `reason`, recorded with who and when (`rejected_by`,
    `rejected_on`: fields of the bill's own, since a Vendor Invoice keeps no rejecter; story 35); its Expense waits
    for a new bill again."""
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(REASON_REQUIRED)
    bill, expense = _lock_waiting(name)
    bill.status = REJECTED
    bill.rejection_reason = reason
    bill.rejected_by = user
    bill.rejected_on = now_datetime()
    bill.save(ignore_permissions=True)
    expense.invoice_attachment = None
    expense.invoice_ref = None
    expense.invoice_date = None
    expense.save(ignore_permissions=True)


def correct_latest_bill(expense_doctype: str, expense: str, invoice_no: str | None, invoice_date) -> None:
    """Put a corrected `invoice_no` and `invoice_date` on Expense `expense`'s latest bill, through the document
    layer (a Version is kept): an approver (`role_profiles.PAID_BILL_APPROVER_PROFILES`) editing only the number and
    date on Payment Done, which lands no new bill (#1643). An Expense with no Expense bill is left alone. Does not
    commit."""
    name = frappe.db.get_value(BILL_DOCTYPE, {"expense_doctype": expense_doctype, "expense": expense, "is_latest": 1})
    if not name:
        return
    bill = frappe.get_doc(BILL_DOCTYPE, name, for_update=True)
    bill.invoice_no = (invoice_no or "").strip() or None
    bill.invoice_date = getdate(invoice_date) if invoice_date else None
    bill.save(ignore_permissions=True)


def last_rejection_sql(alias: str, doctype_sql: str) -> str:
    """A SQL expression: the rejection reason of Expense `alias`'s latest bill when that bill is Rejected, else
    NULL. `doctype_sql` is the SQL that names the Expense's doctype. The Pending Invoices Upload queues show it as
    "Last bill rejected: <reason>"."""
    return f"""(SELECT b.rejection_reason FROM "tab{BILL_DOCTYPE}" b
               WHERE b.expense_doctype = {doctype_sql} AND b.expense = {alias}.name
                 AND b.is_latest = 1 AND b.status = '{REJECTED}')"""


def _lock_waiting(name: str):
    """The bill and its Expense, both `FOR UPDATE`; refused unless the bill still waits for a person. A bill whose
    reading stopped is set Not read here (unsaved; the decision saves it), as Pending Approval showed it.

    The Expense is locked first, as `receive_bill`'s callers do before they touch its bills: a decision and a new
    bill landing on the same Expense then queue up instead of deadlocking."""
    expense_doctype, expense_name = frappe.db.get_value(BILL_DOCTYPE, name, ["expense_doctype", "expense"]) or (None, None)
    if not expense_doctype:
        frappe.throw(f"Expense bill {name} not found.", frappe.DoesNotExistError)
    expense = frappe.get_doc(expense_doctype, expense_name, for_update=True)
    bill = frappe.get_doc(BILL_DOCTYPE, name, for_update=True)
    if bill.status != PENDING:
        frappe.throw(f"Expense bill {name} is already {bill.status}.")
    if reading_stopped(bill.bill_check, bill.read_claimed_at):
        # Pending Approval shows it Not read (#1645); the decision keeps why it was not read.
        bill.bill_check = NOT_READ
        bill.bill_check_reason = READING_STOPPED
    if bill.bill_check == CHECKING:
        frappe.throw(f"Expense bill {name} is still being read; decide it once its Bill check is done.")
    if not bill.is_latest:
        frappe.throw(f"Expense bill {name} is no longer the latest bill of {bill.expense}.")
    return bill, expense

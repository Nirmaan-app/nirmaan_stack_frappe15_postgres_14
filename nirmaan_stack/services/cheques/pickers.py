# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What the Add Cheque dialog's line pickers offer (spec #1407, #1410). Reads only.

A PO/WO Payment line asks for a project, then one of the Vendor's POs or Work Orders in it, then
optionally one of its payments:

* `vendor_records` -- every PO and Work Order of the Vendor that can still hold a payment, with its
  project, so the dialog offers the projects the Vendor has work in and the records in each.
* `eligible_payments` -- the record's payments that may go on a Cheque: none on a live (not
  Cancelled) Cheque, none Rejected. It says what it hid and why, so the dialog can say so.

A Project Expense line asks for a project, then one of its Project Expenses; a Non-project Expense
line for a Non Project Expense only (#1411):

* `eligible_expenses` -- the expenses not on a live Cheque, and the ones it hid.

The same rules are enforced on save by `lines.lines_problem`; these lists only spare the user a
refusal.
"""

import frappe
from frappe.utils import cint, flt

from nirmaan_stack.services.cheques.lines import live_cheques_of
from nirmaan_stack.services.cheques.rules import (
    EXPENSE_LINE_TYPES,
    LINE_PAYMENT_DOCTYPES,
    PAYMENT_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
    PAYMENT_REJECTED,
    PO_DOCTYPE,
    RECORD_DOCTYPES,
    WORK_ORDER_DOCTYPE,
)

#: A PO in these statuses holds no payment of its own any more.
PO_CLOSED_STATUSES = ("Merged", "Cancelled")
#: A Work Order takes payments once it is approved.
WORK_ORDER_OPEN_STATUSES = ("Approved", "Amendment")


def vendor_records(vendor: str) -> list[dict]:
    """`[{doctype, name, project, project_name, status, total_amount}]`: the Vendor's POs, then its
    Work Orders, newest first."""
    pos = frappe.get_all(
        PO_DOCTYPE,
        filters={"vendor": vendor, "status": ["not in", PO_CLOSED_STATUSES]},
        fields=["name", "project", "status", "total_amount"],
        order_by="creation desc",
    )
    work_orders = frappe.get_all(
        WORK_ORDER_DOCTYPE,
        filters={"vendor": vendor, "status": ["in", WORK_ORDER_OPEN_STATUSES]},
        fields=["name", "project", "status", "total_amount"],
        order_by="creation desc",
    )
    projects = {r.project for r in pos + work_orders if r.project}
    project_names = dict(
        frappe.get_all("Projects", filters={"name": ["in", list(projects)]}, fields=["name", "project_name"], as_list=True)
    ) if projects else {}
    return [
        {
            "doctype": doctype,
            "name": r.name,
            "project": r.project,
            "project_name": project_names.get(r.project) or r.project,
            "status": r.status,
            "total_amount": flt(r.total_amount),
        }
        for doctype, rows in ((PO_DOCTYPE, pos), (WORK_ORDER_DOCTYPE, work_orders))
        for r in rows
    ]


def eligible_payments(record_doctype: str, record_name: str, *, exclude_cheque: str | None = None) -> dict:
    """The record's payments that may go on a Cheque, and what was hidden.

    Returns `{payments: [{name, amount, status, mode_of_payment, on_hold}], hidden: {on_cheque:
    [{payment, cheque, cheque_no, status}], rejected: int}}`. A payment only on Cancelled Cheques is
    offered. `exclude_cheque` is the Cheque being edited: its own payments are not "on a live Cheque".
    """
    if record_doctype not in RECORD_DOCTYPES:
        raise ValueError(f"not a PO or Work Order doctype: {record_doctype!r}")
    rows = frappe.get_all(
        PAYMENT_DOCTYPE,
        filters={"document_type": record_doctype, "document_name": record_name},
        fields=["name", "amount", "status", "mode_of_payment", "on_hold"],
        order_by="creation asc",
    )
    live = live_cheques_of(PAYMENT_DOCTYPE, [r.name for r in rows], exclude=exclude_cheque)

    payments, on_cheque, rejected = [], [], 0
    for r in rows:
        if (r.status or "").strip() == PAYMENT_REJECTED:
            rejected += 1
        elif r.name in live:
            on_cheque.append({"payment": r.name, **live[r.name]})
        else:
            payments.append({
                "name": r.name,
                "amount": flt(r.amount),
                "status": r.status,
                "mode_of_payment": (r.mode_of_payment or "").strip() or "Online",
                "on_hold": cint(r.on_hold),
            })
    return {"payments": payments, "hidden": {"on_cheque": on_cheque, "rejected": rejected}}


def eligible_expenses(line_type: str, project: str | None = None, *, exclude_cheque: str | None = None) -> dict:
    """The expenses an expense line may name, newest first, and what was hidden (#1411).

    A Project Expense line offers its project's Project Expenses (none until the project is picked);
    a Non-project Expense line every Non Project Expense. An expense on a live (not Cancelled) Cheque
    is hidden; one only on Cancelled Cheques is offered. `exclude_cheque` is the Cheque being edited:
    its own expenses are not "on a live Cheque".

    Returns `{expenses: [{name, amount, status, type, description, payment_date}], hidden:
    {on_cheque: [{payment, cheque, cheque_no, status}]}}`.
    """
    if line_type not in EXPENSE_LINE_TYPES:
        raise ValueError(f"not an expense line kind: {line_type!r}")
    doctype = LINE_PAYMENT_DOCTYPES[line_type]
    filters = {}
    if doctype == PROJECT_EXPENSE_DOCTYPE:
        if not project:
            return {"expenses": [], "hidden": {"on_cheque": []}}
        filters["projects"] = project
    rows = frappe.get_all(
        doctype,
        filters=filters,
        fields=["name", "amount", "status", "type", "description", "payment_date"],
        order_by="creation desc",
    )
    live = live_cheques_of(doctype, [r.name for r in rows], exclude=exclude_cheque)
    expenses = [
        {
            "name": r.name,
            "amount": flt(r.amount),
            "status": r.status,
            "type": r.type,
            "description": r.description,
            "payment_date": r.payment_date,
        }
        for r in rows
        if r.name not in live
    ]
    on_cheque = [{"payment": r.name, **live[r.name]} for r in rows if r.name in live]
    return {"expenses": expenses, "hidden": {"on_cheque": on_cheque}}

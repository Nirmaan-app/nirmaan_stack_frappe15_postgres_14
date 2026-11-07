# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook sub-tab of Vendor Invoice Recon -> Pending Invoices Upload (spec #1585, #1592, ADR-0015
Amendment B decision 4). The Credit Card sub-tab's twin (`card_invoices.py`).

URLs: /api/method/nirmaan_stack.api.expenses.cashbook_invoices.<get_cashbook_invoice_queue |
attach_cashbook_invoice | mark_cashbook_no_invoice>

A wallet spend waits here while it carries the Cashbook marker (`cashbook_batch`, set by the Cashbook job when it
creates the Expense), has no `invoice_attachment` and is not marked *No invoice*. Project and Non-Project
Expenses both wait, so both writes name the ledger. Older Cashbook Expenses carry no marker and never wait.
The gates, the refusals and the two writes are the Credit Card tab's: the list and attach follow
`PENDING_INVOICE_UPLOAD_PROFILES`, No invoice is `CARD_NO_INVOICE_PROFILES` (Admin, Accountant Lead), and both
writes re-read the Expense `FOR UPDATE` and save through the document layer.
"""

import frappe

from nirmaan_stack.services.card_invoices import CashbookExpenseFacts
from nirmaan_stack.services.expense_invoices import (
    require_profile,
    require_upload_access,
    save_invoice,
    save_no_invoice,
)
from nirmaan_stack.services.role_profiles import CARD_NO_INVOICE_PROFILES

PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"
EXPENSE_DOCTYPES = (PROJECT_EXPENSE, NON_PROJECT_EXPENSE)

# Who paid and the remark come from the statement line the Expense was created from (its Settled match record);
# a Non-Project Expense has no Paid by field of its own.
_QUEUE_SQL = """
    SELECT e.name, e.payment_date, e.amount, e.type AS expense_type, e.description, e.cashbook_batch,
           {project} AS project, {project_name} AS project_name, {payment_by} AS payment_by,
           r.added_by_raw, r.remarks
    FROM "tab{doctype}" e
    {project_join}
    LEFT JOIN "tabOutflow Row Match" m
      ON m.target_doctype = %(doctype)s AND m.target_name = e.name AND m.import_batch = e.cashbook_batch
    LEFT JOIN "tabOutflow Import Row" r ON r.name = m.import_row
    WHERE COALESCE(e.cashbook_batch, '') != ''
      AND COALESCE(e.invoice_attachment, '') = ''
      AND COALESCE(e.no_invoice_by, '') = ''
"""


def _queue_rows(doctype: str) -> list[dict]:
    if doctype == PROJECT_EXPENSE:
        parts = {
            "project": "e.projects",
            "project_name": "p.project_name",
            "payment_by": "e.payment_by",
            "project_join": 'LEFT JOIN "tabProjects" p ON p.name = e.projects',
        }
    else:
        parts = {"project": "NULL", "project_name": "NULL", "payment_by": "NULL", "project_join": ""}
    return frappe.db.sql(_QUEUE_SQL.format(doctype=doctype, **parts), {"doctype": doctype}, as_dict=True)


@frappe.whitelist()
def get_cashbook_invoice_queue() -> list[dict]:
    """Every marked wallet spend still waiting for its invoice, Project and Non-Project. Newest first.

    Each row: `name`, `doctype` (the ledger), `payment_date`, `amount`, `expense_type`, `paid_by` (the wallet
    holder: the statement's `From`), `remark` (the statement's remark, else the Expense's description),
    `project` and `project_name` (None on a Non-Project spend) and `cashbook_batch`.
    """
    require_upload_access()
    rows, seen = [], set()
    for doctype in EXPENSE_DOCTYPES:
        for row in _queue_rows(doctype):
            if row["name"] in seen:
                continue
            seen.add(row["name"])
            added_by, remarks, description = row.pop("added_by_raw"), row.pop("remarks"), row.pop("description")
            payment_by = row.pop("payment_by")
            row["doctype"] = doctype
            row["paid_by"] = (added_by or "").strip() or payment_by or None
            row["remark"] = (remarks or "").strip() or description or ""
            rows.append(row)
    rows.sort(key=lambda r: (str(r["payment_date"] or ""), r["name"]), reverse=True)
    return rows


def _locked_facts(expense: str, doctype: str):
    if doctype not in EXPENSE_DOCTYPES:
        frappe.throw(f"'{doctype}' is not an expense ledger.")
    doc = frappe.get_doc(doctype, expense, for_update=True)
    facts = CashbookExpenseFacts(
        name=doc.name,
        has_cashbook_marker=bool(doc.get("cashbook_batch")),
        invoice_attachment=doc.invoice_attachment,
        no_invoice_by=doc.no_invoice_by,
    )
    return doc, facts


@frappe.whitelist(methods=["POST"])
def attach_cashbook_invoice(
    expense: str,
    doctype: str,
    invoice_attachment: str,
    invoice_ref: str | None = None,
    invoice_date: str | None = None,
) -> dict:
    """File `invoice_attachment` (a File URL already uploaded against the expense) as wallet spend `expense`'s
    invoice, on ledger `doctype`; `invoice_ref` and `invoice_date` are optional. The spend then leaves the list.
    Refused: no file, a future date, no Cashbook marker, already invoiced or marked No invoice.

    Example: `{"expense": "PE-0042", "doctype": "Project Expenses", "invoice_attachment": "/private/files/b.pdf"}`
    -> `{"name": "PE-0042"}`.
    """
    user = require_upload_access()
    doc, facts = _locked_facts(expense, doctype)
    return save_invoice(doc, facts, invoice_attachment, invoice_ref, invoice_date, user)


@frappe.whitelist(methods=["POST"])
def mark_cashbook_no_invoice(expense: str, doctype: str, reason: str) -> dict:
    """Mark wallet spend `expense` (on ledger `doctype`) *No invoice* for the typed `reason`. Records who and
    when on the expense, which then leaves the list. Admin and Accountant Lead only.

    Example: `{"expense": "NPE-0042", "doctype": "Non Project Expenses", "reason": "Tea stall, no bill"}`
    -> `{"name": "NPE-0042"}`.
    """
    user = require_profile(
        CARD_NO_INVOICE_PROFILES, "Only an Admin or an Accountant Lead can mark a wallet spend No invoice."
    )
    doc, facts = _locked_facts(expense, doctype)
    return save_no_invoice(doc, facts, reason, user)

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Porter Expense as the expense screens show it (#1450, spec #1442, ADR-0032).

READ-ONLY. Two endpoints, both keyed on the EXPENSE, never on the Porter records:

- `get_porter_expense(doctype, name)`: the read-only Porter section of the expense dialogs (edit, the
  approval detail, the bank-lines card): CRN, booked by, from -> to, city, fare and reverse-charge GST
  from the Porter Order; invoice number and billing entity from the Porter Invoice; where the expense
  sits now. `None` for an expense the import did not create.
- `porter_invoice_pdf(doctype, name)`: that invoice's stored PDF, served inline.

⚠️ THE PERMISSION CHECKED IS THE EXPENSE'S. Porter Order and Porter Invoice are readable by Admin and the
Accountants only (Desk is their one screen), and the PDF is a private File attached to the Porter Invoice,
so a Project Manager who opens a Porter Expense would get a 403 on its own invoice (story 53). Anyone who
may read the expense already reads its amount, CRN (`payment_ref`), invoice number and booked-by name
on the record itself, so these facts are read without the Porter doctypes' own permission check, as
`api/approvals/expense_detail` reads the Expense Request behind a ledger row.
"""

from __future__ import annotations

from urllib.parse import urlencode

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.api.outflow_import.porter_records import INVOICE_DOCTYPE, ORDER_DOCTYPE
from nirmaan_stack.services.extraction.files import fetch_file_content
from nirmaan_stack.services.extraction.helpers import get_file_doc_by_url
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES, PROJECT_EXPENSE_DOCTYPE

PDF_METHOD = "nirmaan_stack.api.outflow_import.porter_expense.porter_invoice_pdf"


@frappe.whitelist()
def get_porter_expense(doctype: str, name: str) -> dict | None:
    """The expense's Porter section, or `None` when it has no Porter Order."""
    expense = _readable_expense(doctype, name)
    if not expense.porter_order:
        return None
    order = frappe.db.get_value(
        ORDER_DOCTYPE,
        expense.porter_order,
        ["crn", "booked_by", "from_address", "to_address", "city", "fare", "rcm_gst", "porter_invoice"],
        as_dict=True,
    ) or frappe._dict()
    invoice = frappe.db.get_value(
        INVOICE_DOCTYPE,
        order.porter_invoice,
        ["invoice_number", "billing_entity", "city", "invoice_file"],
        as_dict=True,
    ) if order.porter_invoice else None
    invoice = invoice or frappe._dict()
    project = expense.get("projects") or None
    return {
        "crn": order.crn or expense.porter_order,
        "booked_by": order.booked_by or "",
        "from_address": order.from_address or "",
        "to_address": order.to_address or "",
        "city": order.city or invoice.city or "",
        "fare": flt(order.fare),
        "rcm_gst": flt(order.rcm_gst),
        "invoice_number": invoice.invoice_number or "",
        "billing_entity": invoice.billing_entity or "",
        "pdf_url": (
            f"/api/method/{PDF_METHOD}?{urlencode({'doctype': doctype, 'name': name})}"
            if invoice.invoice_file else ""
        ),
        "project": project,
        "project_name": project and frappe.db.get_value("Projects", project, "project_name"),
    }


@frappe.whitelist()
def porter_invoice_pdf(doctype: str, name: str) -> None:
    """Serve the expense's Porter Invoice PDF inline, to anyone who may read the expense."""
    expense = _readable_expense(doctype, name)
    file_url = invoice_pdf_url(expense.porter_order)
    file_doc = file_url and get_file_doc_by_url(file_url)
    content = file_doc and fetch_file_content(file_doc, file_doc.name)
    if not content:
        raise frappe.DoesNotExistError(_("{0} has no Porter invoice PDF.").format(name))
    frappe.local.response.filename = file_doc.file_name or f"{expense.porter_order}.pdf"
    frappe.local.response.filecontent = content
    frappe.local.response.type = "pdf"


def invoice_pdf_url(porter_order: str | None) -> str | None:
    """The shared invoice PDF behind a Porter Order: its Porter Invoice's `invoice_file`, or None."""
    invoice = porter_order and frappe.db.get_value(ORDER_DOCTYPE, porter_order, "porter_invoice")
    return (invoice and frappe.db.get_value(INVOICE_DOCTYPE, invoice, "invoice_file")) or None


def is_invoice_pdf(file_url: str | None) -> bool:
    """Whether `file_url` is a Porter Invoice's stored PDF -- the one File every expense of it shares."""
    return bool(file_url) and bool(frappe.db.exists(INVOICE_DOCTYPE, {"invoice_file": file_url}))


def _readable_expense(doctype: str, name: str):
    if doctype not in EXPENSE_DOCTYPES:
        frappe.throw(_("Not an expense ledger: {0}").format(doctype))
    if not frappe.has_permission(doctype, "read", name):
        frappe.throw(_("Not permitted"), frappe.PermissionError)
    fields = ["name", "porter_order"] + (["projects"] if doctype == PROJECT_EXPENSE_DOCTYPE else [])
    expense = frappe.db.get_value(doctype, name, fields, as_dict=True)
    if not expense:
        raise frappe.DoesNotExistError(_("{0} {1} not found").format(doctype, name))
    return expense

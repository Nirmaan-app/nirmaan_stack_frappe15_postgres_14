# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Porter Expense as the expense screens show it (#1450, spec #1442, ADR-0032).

READ-ONLY. Two endpoints, both keyed on the EXPENSE, never on the Porter records:

- `get_porter_expense(doctype, name)`: the read-only Porter section of the expense dialogs (edit, the
  approval detail, the bank-lines card): CRN, booked by, from -> to, city, fare and reverse-charge GST
  from the Porter Order; invoice number and billing entity from the Porter Invoice; where the expense
  sits now, and the import line it came from (the "Move to another project" link, #1558). `None` for an
  expense the import did not create.
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

from nirmaan_stack.api.outflow_import.porter_records import ROW_DOCTYPE
from nirmaan_stack.services.extraction.files import fetch_file_content
from nirmaan_stack.services.extraction.helpers import get_file_doc_by_url
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES, PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.outflow_import.porter import INVOICE_DOCTYPE, ORDER_DOCTYPE
from nirmaan_stack.services.outflow_import.porter_pdf import invoice_pdf_url

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
        ["crn", "booked_by", "from_address", "to_address", "city", "fare", "rcm_gst", "porter_invoice", "import_row"],
        as_dict=True,
    ) or frappe._dict()
    import_batch = order.import_row and frappe.db.get_value(ROW_DOCTYPE, order.import_row, "import_batch")
    invoice = frappe.db.get_value(
        INVOICE_DOCTYPE,
        order.porter_invoice,
        ["invoice_number", "billing_entity", "city"],
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
        "pdf_url": pdf_url(doctype, expense),
        "project": project,
        "project_name": project and frappe.db.get_value("Projects", project, "project_name"),
        # #1558: the line "Move to another project" opens in Bulk Import (Rectify; its own access check).
        "import_batch": import_batch or None,
        "import_row": (import_batch and order.import_row) or None,
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


def pdf_url(doctype: str, expense) -> str:
    """Where a Porter Expense's invoice opens: `porter_invoice_pdf` keyed on the expense, or "" when it
    carries no invoice attachment.

    ⚠️ THE SAME RULE AND URL AS THE LIST PAGES' `utils/porterExpense.invoiceAttachmentUrl` (F1): a Porter
    Expense (one with a `porter_order`) WITH an `invoice_attachment`. Pinned on both sides by the same
    literal URL (`test_porter_expense`, `porterExpense.test.ts`), and the method name by a parity test.
    """
    if not (expense.porter_order and expense.invoice_attachment):
        return ""
    return f"/api/method/{PDF_METHOD}?{urlencode({'doctype': doctype, 'name': expense.name})}"


def _readable_expense(doctype: str, name: str):
    if doctype not in EXPENSE_DOCTYPES:
        frappe.throw(_("Not an expense ledger: {0}").format(doctype))
    if not frappe.has_permission(doctype, "read", name):
        frappe.throw(_("Not permitted"), frappe.PermissionError)
    fields = ["name", "porter_order", "invoice_attachment"] + (
        ["projects"] if doctype == PROJECT_EXPENSE_DOCTYPE else []
    )
    expense = frappe.db.get_value(doctype, name, fields, as_dict=True)
    if not expense:
        raise frappe.DoesNotExistError(_("{0} {1} not found").format(doctype, name))
    return expense

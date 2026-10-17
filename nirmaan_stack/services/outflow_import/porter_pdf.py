# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one stored invoice PDF every Porter Expense of a Porter Invoice shares (spec #1442 story 52, ADR-0032).

Reads only. The PDF is ONE `File`, attached to its Porter Invoice (`Porter Invoice.invoice_file`); each
expense of the invoice carries its URL in `invoice_attachment`. Asked by the expense screens' PDF endpoint
(`api/outflow_import/porter_expense`), Rectify (which never carries the PDF's File) and the expense File
hooks (`integrations/controllers/expense_files`).
"""

import frappe

from nirmaan_stack.services.outflow_import.porter import INVOICE_DOCTYPE, ORDER_DOCTYPE


def invoice_pdf_url(porter_order: str | None) -> str | None:
    """The shared invoice PDF behind a Porter Order: its Porter Invoice's `invoice_file`, or None."""
    invoice = porter_order and frappe.db.get_value(ORDER_DOCTYPE, porter_order, "porter_invoice")
    return (invoice and frappe.db.get_value(INVOICE_DOCTYPE, invoice, "invoice_file")) or None


def is_invoice_pdf(file_url: str | None) -> bool:
    """Whether `file_url` is a Porter Invoice's stored PDF -- the one File every expense of it shares."""
    return bool(file_url) and bool(frappe.db.exists(INVOICE_DOCTYPE, {"invoice_file": file_url}))

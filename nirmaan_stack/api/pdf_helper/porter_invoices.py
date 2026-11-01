"""Porter Invoices in Report Bulk Download (owner, 2026-10-28) -- Reports only, Porter Invoice data only.

One row per `Porter Invoice`: one PDF covers many trips, and every trip's expense copies the same file URL,
so the list (and the merged PDF) works per invoice, never per trip/expense. The table reads ONLY the Porter
Invoice record (no projects, no trip -> expense lookup) and lists every invoice that HAS its PDF, whatever
its validation status (the table filters on Validation Status).

Access: Admin / Accountant (+ Lead) only (`assert_reports_bulk_download_access`), the Report Bulk Download
tab's rule. `Porter Invoice` itself is readable only by Accountant / System Manager, so it is read with
`get_all` AFTER that check -- the same shape as `api/outflow_import/porter_expense.py`.
"""

import frappe

from nirmaan_stack.services.role_profiles import assert_reports_bulk_download_access

PORTER_INVOICE = "Porter Invoice"
LIST_FIELDS = [
    "name",
    "import_batch",
    "validation_status",
    "city",
    "completed_orders",
    "read_invoice_date",
    "fare_total",
    "tax_total",
    "creation",
]
# Oldest invoice first; an invoice whose date was never read goes last (PostgreSQL ASC puts NULL last).
ORDER = "read_invoice_date asc, creation asc"


def _has_pdf():
    return {"invoice_file": ["is", "set"]}


@frappe.whitelist()
def get_porter_invoices():
    """Every Porter Invoice that has its PDF, any validation status, oldest invoice date first."""
    assert_reports_bulk_download_access(frappe.session.user)
    return frappe.get_all(PORTER_INVOICE, filters=_has_pdf(), fields=LIST_FIELDS, order_by=ORDER, limit_page_length=0)


def porter_invoice_files(names):
    """The PDF of each given Porter Invoice that has one, oldest invoice date first, undated last; each once.
    A name that is not a Porter Invoice, or has no PDF, is dropped. The caller has checked access."""
    if not names:
        return []
    rows = frappe.get_all(
        PORTER_INVOICE,
        filters={**_has_pdf(), "name": ["in", list(dict.fromkeys(names))]},
        fields=["invoice_file"],
        order_by=ORDER,
        limit_page_length=0,
    )
    return [r.invoice_file for r in rows]

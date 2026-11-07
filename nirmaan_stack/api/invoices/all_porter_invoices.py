# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor Invoice Recon -> All Invoices -> Porter (#1646, spec #1637): one row per Porter Invoice -- one PDF covers
many trips, so never one per trip or expense -- with its Validate result (`validation_status` and its message) and
its PDF, paged, filtered and searched on the server.

URL: /api/method/nirmaan_stack.api.invoices.all_porter_invoices.get_all_porter_invoices, in the data-table contract
(`services/list_page.py`). Every Porter Invoice is listed, with or without its PDF (one whose download failed shows
Error and nothing to open). Porter keeps its own Validate step: no Bill check, no approval (spec #1637, out of scope).

Gate: Admin, Accountant, Accountant Lead, checked here: `Porter Invoice` is readable only by the Accountant roles, so
it is read raw after the check, as Report Bulk Download does (`api/pdf_helper/porter_invoices.py`).
"""

import frappe

from nirmaan_stack.services.expense_invoices import require_profile
from nirmaan_stack.services.list_page import ListSpec, page, split_filters
from nirmaan_stack.services.role_profiles import INVOICE_APPROVAL_PROFILES

_ROWS_SQL = """
    SELECT name, import_batch, validation_status, validation_message, city, completed_orders, read_invoice_date,
           fare_total, tax_total, COALESCE(fare_total, 0) + COALESCE(tax_total, 0) AS invoice_total,
           NULLIF(invoice_file, '') AS invoice_file, creation
    FROM "tabPorter Invoice"
"""

SPEC = ListSpec(
    filterable=frozenset({"validation_status", "import_batch", "city"}),
    dates=frozenset({"read_invoice_date", "creation"}),
    searchable=("name", "import_batch", "city"),
    sortable=frozenset({"name", "completed_orders", "fare_total", "tax_total", "invoice_total"}),
    default_order='q."creation" DESC, q."name" DESC',
)


@frappe.whitelist()
def get_all_porter_invoices(
    doctype=None,
    fields=None,
    filters=None,
    order_by=None,
    limit_start=0,
    limit_page_length=None,
    search_term=None,
    current_search_fields=None,
    for_export=False,
    **kwargs,
) -> dict:
    """One page of Porter Invoices, newest first unless `order_by` says otherwise.

    Each row: `name` (Porter's invoice number), `import_batch`, `validation_status` (Queued / Downloading / Reading /
    Comparing / Passed / Failed / Error) and `validation_message`, `city`, `completed_orders`, `read_invoice_date`,
    `fare_total`, `tax_total`, `invoice_total` (the two together), `invoice_file` (None until its PDF arrived),
    `creation`.

    Example: `filters=[["validation_status","in",["Failed"]]]` ->
    `{"data": [{"name": "MH1234567", "validation_status": "Failed", ...}], "total_count": 1, ...}`.
    """
    require_profile(INVOICE_APPROVAL_PROFILES, "Only an Admin or an Accountant can list Porter invoices.")
    _, rest = split_filters(filters, set())
    return page(SPEC, _ROWS_SQL, {}, rest, order_by, limit_start, limit_page_length, search_term,
                current_search_fields, for_export)

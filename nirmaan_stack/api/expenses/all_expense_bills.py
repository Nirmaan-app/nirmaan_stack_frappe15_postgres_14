# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor Invoice Recon -> All Invoices -> Cashbook / Credit Card (#1646, spec #1637, GLOSSARY *Expense bills*):
every Expense bill of the pill, latest and history, paged, filtered and searched on the server.

URL: /api/method/nirmaan_stack.api.expenses.all_expense_bills.get_all_expense_bills, in the data-table contract
(`services/list_page.py`). The pill comes as the filter `["kind", "=", "cashbook" | "card"]` (the hook refetches on a
filter change). Rows are `services/expense_bills/bill_rows.py`'s, the ones Pending Approval reads too.

Gate: the Vendor Invoice approvers (Admin, Accountant, Accountant Lead), as Pending Approval's pills.
"""

import frappe

from nirmaan_stack.services.expense_bills.bill_rows import KINDS, bill_rows_sql
from nirmaan_stack.services.expense_invoices import require_profile
from nirmaan_stack.services.list_page import ListSpec, page, split_filters
from nirmaan_stack.services.role_profiles import INVOICE_APPROVAL_PROFILES

SPEC = ListSpec(
    filterable=frozenset({"bill_check", "approval", "is_latest", "expense", "expense_doctype", "uploaded_by"}),
    dates=frozenset({"payment_date", "invoice_date", "creation"}),
    searchable=("paid_by", "invoice_no", "expense", "project_name", "uploaded_by_name", "name"),
    sortable=frozenset({"line_amount", "read_total", "invoice_no", "paid_by", "project_name", "uploaded_by_name", "name"}),
    default_order='q."creation" DESC, q."name" DESC',
)


@frappe.whitelist()
def get_all_expense_bills(
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
    """One page of the Expense bills on the pill `filters` names (`["kind", "=", "cashbook" | "card"]`), newest bill
    first unless `order_by` says otherwise.

    Each row: `name` (the Expense bill), `expense`, `expense_doctype`, `payment_date` (the spend date), `line_amount`,
    `read_total` (None unless compared), `bill_check` and `bill_check_reason`, `approval` (Auto-approved / Pending /
    Approved / Rejected) and `rejection_reason`, `is_latest`, `invoice_no` and `invoice_date`, `paid_by`, `project`
    and `project_name`, `uploaded_by` and `uploaded_by_name` (who attached it), `bill_file`, `creation`.

    Example: `filters=[["kind","=","card"],["bill_check","in",["Mismatched"]]]` ->
    `{"data": [{"name": "EB-2026-00042", "bill_check": "Mismatched", ...}], "total_count": 1, ...}`.
    """
    require_profile(INVOICE_APPROVAL_PROFILES, "Only an Admin or an Accountant can list expense bills.")
    own, rest = split_filters(filters, {"kind"})
    kind = own.get("kind")
    if kind not in KINDS:
        frappe.throw(f"'{kind}' is not an All Invoices pill of expense bills.")
    rows_sql, params = bill_rows_sql(kind)
    return page(SPEC, rows_sql, params, rest, order_by, limit_start, limit_page_length, search_term,
                current_search_fields, for_export)

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The tax withheld from Non-Project Expenses, for a screen that has only the Expense (spec #1522, #1527).

URL: /api/method/nirmaan_stack.api.approvals.expense_tds.get_withheld_tds

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE (section 194-I, rent), not a Technical Data Sheet.

READ-ONLY. The approval queue, the approve dialog and the request page serve `withheld_tds` in their
own answers; this serves it to the screens that read the Expense itself: the Non-Project Expense edit
dialog, which locks the amount of an Expense with a record (#1526's rule, shown before the server
refuses it), and the Non-Project Expenses page's amount column. The figures come from
`services/expense_tds.withheld_tds_of`, read without the record's own permission (why: there).
"""

import frappe
from frappe import _

from nirmaan_stack.api.expense_requests.standing import parse_names
from nirmaan_stack.services.expense_tds import withheld_tds_of
from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE


@frappe.whitelist()
def get_withheld_tds(names) -> dict[str, dict]:
    """For each named Non-Project Expense the caller may read that has a tax record:
    `{gross_amount, tds_percentage, tds_amount, tds_section}`. An Expense with none is absent, so an
    empty answer means nothing was withheld (before approval, or any type but Office Rent).

    Example: `{"NPE-0042": {"gross_amount": 100000, "tds_percentage": 10, "tds_amount": 10000,
    "tds_section": "194-I"}}`.
    """
    if not frappe.has_permission(NON_PROJECT_EXPENSE_DOCTYPE, "read"):
        frappe.throw(_("Not permitted"), frappe.PermissionError)
    # One page of a list: at most `standing.MAX_NAMES`.
    names = parse_names(names, "expenses")
    if not names:
        return {}
    # Only the ones the caller may read, under the ledger's own permission.
    readable = frappe.get_list(NON_PROJECT_EXPENSE_DOCTYPE, filters={"name": ["in", names]}, pluck="name",
                               limit_page_length=len(names))
    return withheld_tds_of(readable)

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Screens read a vendor's bank account from its Payee (#1428, spec #1420, ADR-0033).

Thin: check who is asking, call the Payee module (`services/payees/vendor_account`).

* `get_vendor_list` -- the vendor list (`useServerDataTable`'s contract), each row carrying its
  Payee's columns as `payee_account_name`, `payee_account_number`, `payee_ifsc`, `payee_bank_name`,
  `payee_bank_branch`.

Who: whoever may read Vendors, as with the old vendor bank fields. The Payee doctype itself stays
readable only by Accounts and Procurement; these endpoints show a vendor's account, not the Payees.
"""

import frappe
from frappe import _

from nirmaan_stack.api.data_table.search import get_list_with_count_enhanced_impl
from nirmaan_stack.services.payees.vendor_account import vendor_accounts

VENDORS = "Vendors"
_LIST_COLUMNS = ("account_name", "account_number", "ifsc", "bank_name", "bank_branch")


@frappe.whitelist()
def get_vendor_list(doctype: str = VENDORS, **kwargs) -> dict:
    """The data-table list of Vendors (`api/data-table.get_list_with_count_enhanced`), each row with
    its Payee's columns (None for a vendor with no Payee). `fields` must include `name`."""
    if doctype != VENDORS:
        frappe.throw(_("This list shows Vendors only."))
    kwargs.pop("cmd", None)
    result = get_list_with_count_enhanced_impl(doctype=VENDORS, **kwargs)
    accounts = vendor_accounts([row["name"] for row in result["data"]])
    for row in result["data"]:
        account = accounts.get(row["name"]) or {}
        row.update({f"payee_{column}": account.get(column) for column in _LIST_COLUMNS})
    return result

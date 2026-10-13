# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Test support: put a REAL vendor's credit back exactly as found.

Saving or deleting a Vendor Refund recounts its vendor's credit (#1398): `credit_used`,
`available_credit`, maybe `vendor_status`, and one more `Vendor Credit Ledger` row. A test that
records refunds against a real vendor and then purges them by raw delete runs no hook, so the
vendor would keep a figure and ledger rows for refunds that no longer exist. `snapshot` before,
`restore` after.
"""

import frappe

VENDORS = "Vendors"
LEDGER = "Vendor Credit Ledger"
_FIELDS = ["credit_used", "available_credit", "vendor_status", "modified", "modified_by"]


def snapshot(vendors) -> dict:
    """Each vendor's credit fields and the names of the ledger rows it already has."""
    return {
        vendor: (
            frappe.db.get_value(VENDORS, vendor, _FIELDS, as_dict=True),
            set(frappe.get_all(LEDGER, filters={"parent": vendor}, pluck="name")),
        )
        for vendor in {v for v in vendors if v}
    }


def restore(taken: dict) -> None:
    """Write the fields back and delete every ledger row added since. Commits nothing."""
    for vendor, (fields, ledger) in taken.items():
        added = [n for n in frappe.get_all(LEDGER, filters={"parent": vendor}, pluck="name") if n not in ledger]
        if added:
            frappe.db.delete(LEDGER, {"name": ["in", added]})
        if fields:
            frappe.db.set_value(VENDORS, vendor, fields, update_modified=False)

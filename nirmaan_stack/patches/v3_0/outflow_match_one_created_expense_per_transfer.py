# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Build the one-Expense-per-wallet-Txn-Id index on `Outflow Row Match` (spec #1585 C, #1588).

WHY A PATCH. The index lives in the controller's `on_doctype_update`, and a plain `bench migrate` does not
re-sync a doctype whose JSON is unchanged (see `outflow_match_partial_unique`).

REFUSE, NEVER HEAL. Unlike `outflow_match_partial_unique`, this patch demotes nothing. A Txn Id holding two
import-created Expenses is money booked twice, and which one to keep is an accountant's decision (Unreconcile
the wrong one), not a migration's. So it fails loudly, names every such Txn Id, and builds no index. Measured
on dev data 2026-11-02: 0 such Txn Ids across every source.

CALLS THE HOOK, DOES NOT RE-INLINE IT: the controller owns the index shape. No commit: the patch runner
commits after `execute`.
"""

import frappe

from nirmaan_stack.nirmaan_stack.doctype.outflow_row_match.outflow_row_match import (
    ensure_one_import_created_expense_per_transfer,
    transfers_with_two_import_created_expenses,
)


def execute():
    if not frappe.db.table_exists("Outflow Row Match"):
        return
    duplicated = transfers_with_two_import_created_expenses()
    if duplicated:
        frappe.throw(
            f"Cannot build the one-Expense-per-Txn-Id index: {len(duplicated)} Txn Id(s) already hold two "
            f"or more Settled Expenses created by the import: {', '.join(duplicated)}. Unreconcile the "
            "wrong Expense of each, then run the migration again.",
            title="Duplicate imported expenses",
        )
    ensure_one_import_created_expense_per_transfer()

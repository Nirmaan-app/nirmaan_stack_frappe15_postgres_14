# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Settled match a Cashbook line and its created Expense share: one writer, for the import job
(`cashbook._write_one`) and Move (`rectify_sources.CASHBOOK`, #1757), so the two never record a wallet spend
differently. Its `transfer_id` and `source` are what the one-Expense-per-Txn-Id index reads (#1588, #1601)."""

import frappe

from nirmaan_stack.api.outflow_import.cashbook_lines import MATCH_BASIS
from nirmaan_stack.api.outflow_import.expenses import MATCH_DOCTYPE
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE


def cashbook_line_of(doctype: str, expense: str) -> dict | None:
    """The Cashbook line whose live Settled match created Expense `expense`: `{import_batch, import_row,
    transfer_id}`, or `None` (an expense no Cashbook import created, or one a person Linked)."""
    match = frappe.db.get_value(
        MATCH_DOCTYPE,
        {"target_doctype": doctype, "target_name": expense, "match_kind": MATCH_SETTLED, "source": CASHBOOK_SOURCE,
         "created_by_import": 1},
        ["import_batch", "import_row", "transfer_id"],
        as_dict=True,
    )
    return dict(match) if match else None


def record_cashbook_match(row: str, batch: str, transfer_id: str, expense, actor: str, origin: str) -> None:
    """Insert the Settled `Outflow Row Match` of Cashbook line `row` and the Expense the import created for it.
    `expense` carries `doctype`, `name` and `amount`."""
    match = frappe.new_doc(MATCH_DOCTYPE)
    match.update(
        {
            "import_row": row,
            "import_batch": batch,
            "transfer_id": transfer_id,
            # #1601: the one-Expense-per-Txn-Id index reads it.
            "source": CASHBOOK_SOURCE,
            "target_doctype": expense.doctype,
            "target_name": expense.name,
            "target_amount": float(expense.amount),
            "match_kind": MATCH_SETTLED,
            "match_basis": MATCH_BASIS,
            "settlement_origin": origin,
            # #1278: the Cashbook writer only ever creates.
            "created_by_import": 1,
            "matched_at": frappe.utils.now_datetime(),
            "matched_by": actor,
        }
    )
    match.insert(ignore_permissions=True)

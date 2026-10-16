# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The match record a Porter line and its Expense share (ADR-0032, spec #1442): one writer, for Create
(`porter_create`) and Rectify (`porter_rectify`), so the two can never record a created order differently."""

import frappe

from nirmaan_stack.api.outflow_import.expenses import MATCH_DOCTYPE, target_snapshot
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.porter import MATCH_BASIS


def record_porter_match(row, batch: str, expense, actor: str, origin: str) -> None:
    """The Settled `Outflow Row Match` of a Porter line and the Expense written for it: `porter.MATCH_BASIS`,
    `created_by_import`, and the project snapshot (frozen after insert, for a later Rectify's history).
    Create's (#1445), and Rectify's for the replacement (#1449). `row` carries `name` and `transfer_id`; `expense`
    `doctype`, `name` and `amount`."""
    match = frappe.new_doc(MATCH_DOCTYPE)
    match.update(
        {
            "import_row": row.name,
            "import_batch": batch,
            "transfer_id": row.transfer_id,
            "target_doctype": expense.doctype,
            "target_name": expense.name,
            "target_amount": float(expense.amount),
            "match_kind": MATCH_SETTLED,
            "match_basis": MATCH_BASIS,
            "settlement_origin": origin,
            "created_by_import": 1,
            "matched_at": frappe.utils.now_datetime(),
            "matched_by": actor,
            **target_snapshot(expense.doctype, expense.name),
        }
    )
    match.insert(ignore_permissions=True)

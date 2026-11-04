# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One transfer settles one record once: the index's name, the line that holds a pair, and how a refusal by it is
recognised (#1606).

The index is built by its owner, `outflow_row_match.ensure_settled_target_unique`, for every source. This module
holds what a hand Link reads about it: `expenses.refuse_link_of_a_held_txn_id` turns a refusal into a sentence
naming the Expense and the line that already hold the pair, never the database error. It mirrors
`import_created_expense`, which does the same for the one-Expense-per-Txn-Id index.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.outflow_import.import_created_expense import is_unique_refusal_by_index

__all__ = ["SETTLED_TARGET_INDEX", "is_settled_target_refusal", "settled_target_holding"]

# ⚠️ THE NAME IS HOW A REFUSAL IS RECOGNISED (`is_settled_target_refusal`). It must equal the name
# `outflow_row_match.ensure_settled_target_unique` builds; renaming the index without renaming this would turn
# the Link's sentence back into a raw database error.
SETTLED_TARGET_INDEX = "ofm_match_settled_target_unique"


def is_settled_target_refusal(exc: BaseException) -> bool:
    """True only for a write refused by `SETTLED_TARGET_INDEX` -- recognised by the index's NAME, so no other
    database error (another unique key, a deadlock, a lost race) is ever relabelled."""
    return is_unique_refusal_by_index(exc, SETTLED_TARGET_INDEX)


def settled_target_holding(transfer_id: str, target_doctype: str, target_name: str):
    """The line whose Settled match row already ties this transfer to this record (`import_row`,
    `import_batch`), or `None`.

    ⚠️ READ IT AFTER A FULL ROLLBACK of the refused write: a holder committed after this request's snapshot is
    invisible inside it -- the refusal itself is the only sign of it."""
    rows = frappe.db.sql(
        """SELECT import_row, import_batch FROM "tabOutflow Row Match"
           WHERE transfer_id = %s AND target_doctype = %s AND target_name = %s AND match_kind = 'Settled'
           LIMIT 1""",
        (transfer_id, target_doctype, target_name),
        as_dict=True,
    )
    return rows[0] if rows else None

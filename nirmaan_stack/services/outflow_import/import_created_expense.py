# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One Expense per wallet Txn Id: the index's name, its rows, and how a refusal by it is recognised
(spec #1585 C, #1588; a Cashbook Link joined it at #1601).

The index itself is built by its owner, `outflow_row_match.ensure_one_import_created_expense_per_transfer`
(the controller's `on_doctype_update`, and the patches `v3_0.outflow_match_one_created_expense_per_transfer`
and `v3_0.outflow_match_one_expense_per_cashbook_txn`, which widened it). This module holds what the import's
writers read about it: the Cashbook job (`cashbook._write_failed`) and a hand Create (`expenses.create_expense`)
turn a refusal into "Already imported", and a hand Link of a Cashbook line (`expenses.refuse_link_of_a_held_txn_id`)
into a sentence; each names the holder.

⚠️ THE NAMES SAY "IMPORT-CREATED" AND PREDATE #1601. Since then the index also holds a Cashbook line's Link. The
index's name is how a refusal is recognised, and an append-only patch imports these functions from the controller,
so neither was renamed.
"""

from __future__ import annotations

import frappe
from psycopg2.errors import UniqueViolation

__all__ = [
    "IMPORT_CREATED_EXPENSE_INDEX",
    "IMPORT_CREATED_EXPENSE_PREDICATE",
    "import_created_expense_holding",
    "is_import_created_expense_refusal",
    "is_unique_refusal_by_index",
    "transfers_with_two_import_created_expenses",
]

# ⚠️ THE NAME IS HOW A REFUSAL IS RECOGNISED (`is_import_created_expense_refusal`). Renaming the index
# without renaming this would turn every "Already imported" into a raw database error.
IMPORT_CREATED_EXPENSE_INDEX = "ofm_match_import_created_expense_unique"
# The rows that count as a Txn Id's one Expense: a Settled Expense match row that the import CREATED (any
# source, #1588), or ANY Settled Expense match row of a Cashbook line -- a Link too (#1601). A wallet Txn Id is one
# spend, so whatever records it -- the job, a hand Create, a hand Link -- is its Expense. Other sources keep
# #1588's reach exactly: a bank transfer may still be Linked to several existing Expenses.
# ⚠️ `source` IS `Outflow Row Match.source`, a snapshot every writer of a match row sets from its line.
IMPORT_CREATED_EXPENSE_PREDICATE = """match_kind = 'Settled'
           AND target_doctype IN ('Project Expenses', 'Non Project Expenses')
           AND (created_by_import = 1 OR source = 'Cashbook')"""


def transfers_with_two_import_created_expenses() -> list[str]:
    """The Txn Ids that already hold more than one row the index would cover -- what stops it being built."""
    return frappe.db.sql(
        f"""SELECT transfer_id FROM "tabOutflow Row Match"
           WHERE {IMPORT_CREATED_EXPENSE_PREDICATE}
           GROUP BY transfer_id HAVING COUNT(*) > 1
           ORDER BY transfer_id""",
        pluck=True,
    )


def import_created_expense_holding(transfer_id: str):
    """The Expense that holds this Txn Id -- created by the import, or a Cashbook line's Link (#1601) -- and its
    batch (`target_doctype`, `target_name`, `import_batch`), or `None`.

    ⚠️ READ IT AFTER A FULL ROLLBACK of the refused write. Inside that transaction's snapshot the other
    Expense is invisible -- the refusal itself is the only sign of it."""
    rows = frappe.db.sql(
        f"""SELECT target_doctype, target_name, import_batch FROM "tabOutflow Row Match"
           WHERE transfer_id = %s AND {IMPORT_CREATED_EXPENSE_PREDICATE}
           LIMIT 1""",
        (transfer_id,),
        as_dict=True,
    )
    return rows[0] if rows else None


def is_import_created_expense_refusal(exc: BaseException) -> bool:
    """True only for a write refused by `IMPORT_CREATED_EXPENSE_INDEX` -- recognised by the index's NAME, so
    no other database error (another unique key, a deadlock, a lost race) is ever relabelled "Already
    imported"."""
    return is_unique_refusal_by_index(exc, IMPORT_CREATED_EXPENSE_INDEX)


def is_unique_refusal_by_index(exc: BaseException, index_name: str) -> bool:
    """True only for a `UniqueViolation` whose constraint is `index_name`. Follows the cause chain and Frappe's
    wrapping (`UniqueValidationError(doctype, name, exc)`). Shared with `settled_target_index` (#1606), so the
    two refusals are recognised one way."""
    seen = set()
    pending = [exc]
    while pending:
        current = pending.pop()
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, UniqueViolation):
            diag = getattr(current, "diag", None)
            if getattr(diag, "constraint_name", None) == index_name:
                return True
        pending.extend([current.__cause__, current.__context__])
        pending.extend(arg for arg in getattr(current, "args", ()) if isinstance(arg, BaseException))
    return False

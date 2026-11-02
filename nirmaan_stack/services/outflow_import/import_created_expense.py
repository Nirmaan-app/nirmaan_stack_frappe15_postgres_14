# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One Expense per wallet Txn Id: the index's name, its rows, and how a refusal by it is recognised
(spec #1585 C, #1588).

The index itself is built by its owner, `outflow_row_match.ensure_one_import_created_expense_per_transfer`
(the controller's `on_doctype_update`, and the patch `v3_0.outflow_match_one_created_expense_per_transfer`).
This module holds what the import's writers read about it: the Cashbook job (`cashbook._write_failed`) and a
hand Create (`expenses.create_expense`) turn a refusal into "Already imported", naming the holder.
"""

from __future__ import annotations

import frappe
from psycopg2.errors import UniqueViolation

__all__ = [
    "IMPORT_CREATED_EXPENSE_INDEX",
    "IMPORT_CREATED_EXPENSE_PREDICATE",
    "import_created_expense_holding",
    "is_import_created_expense_refusal",
    "transfers_with_two_import_created_expenses",
]

# ⚠️ THE NAME IS HOW A REFUSAL IS RECOGNISED (`is_import_created_expense_refusal`). Renaming the index
# without renaming this would turn every "Already imported" into a raw database error.
IMPORT_CREATED_EXPENSE_INDEX = "ofm_match_import_created_expense_unique"
IMPORT_CREATED_EXPENSE_PREDICATE = """match_kind = 'Settled' AND created_by_import = 1
           AND target_doctype IN ('Project Expenses', 'Non Project Expenses')"""


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
    """The Expense the import created for this Txn Id and its batch (`target_doctype`, `target_name`,
    `import_batch`), or `None`.

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
    imported". Follows the cause chain and Frappe's wrapping (`UniqueValidationError(doctype, name, exc)`)."""
    seen = set()
    pending = [exc]
    while pending:
        current = pending.pop()
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, UniqueViolation):
            diag = getattr(current, "diag", None)
            if getattr(diag, "constraint_name", None) == IMPORT_CREATED_EXPENSE_INDEX:
                return True
        pending.extend([current.__cause__, current.__context__])
        pending.extend(arg for arg in getattr(current, "args", ()) if isinstance(arg, BaseException))
    return False

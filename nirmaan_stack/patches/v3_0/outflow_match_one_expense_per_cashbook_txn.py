# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Widen the one-Expense-per-wallet-Txn-Id index to a Cashbook line's Link (spec #1585, #1601).

WHAT CHANGES. `ofm_match_import_created_expense_unique` (#1588) held only rows that CREATED an Expense. It now
also holds any Settled Expense match row of a Cashbook line (`Outflow Row Match.source` 'Cashbook'), so a
person's Link of a Cashbook line counts as the spend's one Expense. Other sources are covered exactly as before.

WHY DROP AND REBUILD. The controller builds the index with `CREATE UNIQUE INDEX IF NOT EXISTS`, which matches by
NAME: on a database that already has the narrower index it is a no-op. So this patch drops it and builds it again
from the controller (`ensure_one_import_created_expense_per_transfer`, the one owner of its shape).

THE BACKFILL. `Outflow Row Match.source` is new; every row written before it is blank. Each is filled from its
line's `source`, else its batch's. RAW SQL, ONE STATEMENT, and no hook is skipped that matters: the value is a
snapshot of what the line already says, so there is nothing to recompute and nothing to audit -- the same
reasoning `v3_0.backfill_outflow_row_source` gives for the line's own copy. The controller's freeze (`validate`)
is for edits by a person; a raw backfill of a new snapshot column is not one.

REFUSE, NEVER HEAL, as `v3_0.outflow_match_one_created_expense_per_transfer` does. A Txn Id already Settled to two
Expenses (two creates, or a create and a Cashbook Link) is money booked twice, and which one to keep is an
accountant's decision (Unreconcile the wrong one). The patch names every such Txn Id and fails; the patch runner
rolls the transaction back, the drop and the backfill with it, so the narrower index stays. Measured on dev data
2026-11-03 (backup of 2026-10-27): 0 such Txn Ids; 0 Cashbook Txn Ids that also appear on another source.

No commit: the patch runner commits after `execute`.
"""

import frappe

from nirmaan_stack.nirmaan_stack.doctype.outflow_row_match.outflow_row_match import (
    IMPORT_CREATED_EXPENSE_INDEX,
    ensure_one_import_created_expense_per_transfer,
    transfers_with_two_import_created_expenses,
)


def execute():
    if not frappe.db.table_exists("Outflow Row Match") or not frappe.db.has_column("Outflow Row Match", "source"):
        # The column ships with this patch's release; the next migrate, after the schema sync, runs it.
        return
    frappe.db.sql(f'DROP INDEX IF EXISTS "{IMPORT_CREATED_EXPENSE_INDEX}"')
    _backfill_source()
    duplicated = transfers_with_two_import_created_expenses()
    if duplicated:
        frappe.throw(
            f"Cannot widen the one-Expense-per-Txn-Id index: {len(duplicated)} Txn Id(s) are already Settled to "
            f"two or more Expenses (created by the import, or Linked from a Cashbook line): "
            f"{', '.join(duplicated)}. Unreconcile the wrong Expense of each, then run the migration again.",
            title="Duplicate expenses for one Txn Id",
        )
    ensure_one_import_created_expense_per_transfer()


def _backfill_source():
    """Every blank `source` from the match row's line, else its batch. A row whose source is set is left alone."""
    frappe.db.sql(
        """
        UPDATE "tabOutflow Row Match" AS m
        SET source = s.source
        FROM (
            SELECT m2.name, COALESCE(NULLIF(BTRIM(r.source), ''), b.source) AS source
            FROM "tabOutflow Row Match" AS m2
            LEFT JOIN "tabOutflow Import Row" AS r ON r.name = m2.import_row
            LEFT JOIN "tabOutflow Import Batch" AS b ON b.name = m2.import_batch
            WHERE COALESCE(m2.source, '') = ''
        ) AS s
        WHERE m.name = s.name AND COALESCE(s.source, '') <> ''
        """
    )

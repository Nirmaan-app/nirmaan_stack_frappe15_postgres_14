# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Apply the settled-ledger read index to already-deployed databases.

WHY THIS PATCH EXISTS
    `ledgers.SETTLED_LEDGER_SQL` is a SCALAR CORRELATED SUBQUERY over
    `Outflow Row Match`, keyed on `import_row`. It now feeds three surfaces of
    the Bulk Import Outflow screen: the `settled_ledger` value on every master
    table row, the column funnel that filters on it, and the summary panel's
    settled-by-ledger breakdown. The first probes this table ONCE PER ROW of
    whatever the screen has selected; `review.get_outflow_facet_values` does a
    DISTINCT over the whole filtered table on top of that.

    `Outflow Row Match.import_row` was a plain Link with NO index -- confirmed
    against `pg_indexes` on 2026-08-21, which returned only `_pkey`,
    `ofm_match_batch_idx`, `ofm_match_transfer_idx` and
    `ofm_match_target_unique`. Every probe was therefore a sequential scan, and
    the note on `SETTLED_LEDGER_SQL` asked for exactly this measurement before
    the expression was leaned on. `on_doctype_update()` now declares
    `ofm_match_import_row_idx`.

    That is a CONTROLLER-ONLY change to a doctype already synced everywhere, and
    a plain `bench migrate` does NOT re-sync a doctype whose JSON is unchanged --
    confirmed on a test-server deploy when the D3d BoQ indexes silently never
    landed. This patch calls the hook so the fix rides migrate.

CALLS THE HOOK, DOES NOT RE-INLINE IT
    Same construction as `add_outflow_master_index`, `add_outflow_stack_index`
    and `add_boq_read_indexes`, and for the same reason: the controller stays the
    single source of truth for the exact index shape, so this patch can never
    drift from the live schema-sync path.

    ⚠️ IT TARGETS A DIFFERENT DOCTYPE FROM ITS TWO SIBLINGS. The other two outflow
    index patches both call `Outflow Import Row`'s hook and are therefore
    interchangeable with each other; this one calls `Outflow Row Match`'s and is
    interchangeable with NEITHER. Running the other two does not apply this index.

IDEMPOTENT
    `frappe.db.add_index` no-ops when the index already exists, so this is safe on
    environments that already have it (a fresh site gets all three at first sync).
    Re-runs are no-ops. It re-declares the two older indexes and the unique
    constraint as a side effect of calling the hook, which is harmless -- and
    `add_unique` probes information_schema before issuing its ALTER TABLE -- and is
    the point of not re-inlining.

The corresponding patches.txt wiring
(`nirmaan_stack.patches.v3_0.add_outflow_match_import_row_index` under
[post_model_sync]) is added separately by the maintainer -- it is intentionally not
part of this patch.
"""

import frappe

from nirmaan_stack.nirmaan_stack.doctype.outflow_row_match.outflow_row_match import (
    on_doctype_update as _outflow_row_match_indexes,
)


def execute():
    if not frappe.db.table_exists("Outflow Row Match"):
        # A site that has never synced the doctype will create the table -- and fire the hook --
        # at its next schema sync. Nothing to do, and nothing to fail on.
        return
    _outflow_row_match_indexes()

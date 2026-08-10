# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Apply the X3 master-table read index to already-deployed databases.

WHY THIS PATCH EXISTS
    Slice X3 turned Bulk Import Outflow's screen from "one import's rows" into a
    master table ACROSS every import. The new read (`review.get_outflow_rows`)
    filters on `row_status` -- the three tabs are status sets -- and orders by
    `added_on`, with no `import_batch` constraint at all in the default view.

    The doctype's pre-existing composite index is `(import_batch, row_status)`,
    whose LEADING column is the one the master query does not constrain, so it
    cannot serve that read. `on_doctype_update()` therefore declares a third index,
    `(row_status, added_on)` -- equality column first, ordering column second, so
    the scope filter and the sort are one index scan.

    That is a CONTROLLER-ONLY change to a doctype already synced everywhere, and a
    plain `bench migrate` does NOT re-sync a doctype whose JSON is unchanged --
    confirmed on a test-server deploy when the D3d BoQ indexes silently never
    landed. This patch calls the hook so the fix rides migrate.

CALLS THE HOOK, DOES NOT RE-INLINE IT
    The controller stays the single source of truth for the exact index shape, so
    this patch can never drift from the live schema-sync path. Same construction as
    `add_boq_read_indexes`, and for the same reason.

IDEMPOTENT
    `frappe.db.add_index` no-ops when the index already exists, so this is safe on
    environments that already have all three (a fresh site gets them at first sync).
    Re-runs are no-ops. It re-declares the two older indexes as a side effect of
    calling the hook, which is harmless and is the point of not re-inlining.

The corresponding patches.txt wiring
(`nirmaan_stack.patches.v3_0.add_outflow_master_index` under [post_model_sync]) is
added separately by the maintainer -- it is intentionally not part of this patch.
"""

import frappe

from nirmaan_stack.nirmaan_stack.doctype.outflow_import_row.outflow_import_row import (
    on_doctype_update as _outflow_import_row_indexes,
)


def execute():
    if not frappe.db.table_exists("Outflow Import Row"):
        # A site that has never synced the doctype will create the table -- and fire the hook --
        # at its next schema sync. Nothing to do, and nothing to fail on.
        return
    _outflow_import_row_indexes()

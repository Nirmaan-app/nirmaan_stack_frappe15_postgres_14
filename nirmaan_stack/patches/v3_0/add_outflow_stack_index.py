# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Apply the chunk-E stack read index to already-deployed databases.

WHY THIS PATCH EXISTS
    `review._resolve_stacks` asks for every OPEN row in the WHOLE table whose
    `(normalized_account, amount)` matches one of the batch being matched. A stack
    spans imports by design -- three of six identical transfers may have arrived
    in last fortnight's statement -- so there is no `import_batch` to constrain
    on, and none of the three pre-existing indexes leads with the two columns
    this query compares for equality.

    `on_doctype_update()` therefore declares a fourth index,
    `(normalized_account, amount, row_status)`: the row-constructor `IN` reads
    the first two, and `row_status` trails as the narrowing filter rather than
    the access path.

    That is a CONTROLLER-ONLY change to a doctype already synced everywhere, and
    a plain `bench migrate` does NOT re-sync a doctype whose JSON is unchanged --
    confirmed on a test-server deploy when the D3d BoQ indexes silently never
    landed. This patch calls the hook so the fix rides migrate.

CALLS THE HOOK, DOES NOT RE-INLINE IT
    Same construction as `add_outflow_master_index` and `add_boq_read_indexes`,
    and for the same reason: the controller stays the single source of truth for
    the exact index shape, so this patch can never drift from the live
    schema-sync path.

    ⚠️ A USEFUL CONSEQUENCE OF THAT CHOICE: this patch and
    `add_outflow_master_index` are now INTERCHANGEABLE. Both call the same hook,
    so either one applies all four indexes. Running only one of them is
    survivable; that is the pay-off for not re-inlining, and it should not be
    "tidied up" into two narrower patches that each add only their own index.

IDEMPOTENT
    `frappe.db.add_index` no-ops when the index already exists. Re-runs are
    no-ops, and a fresh site gets all four at first sync.

The corresponding patches.txt wiring
(`nirmaan_stack.patches.v3_0.add_outflow_stack_index` under [post_model_sync]) is
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

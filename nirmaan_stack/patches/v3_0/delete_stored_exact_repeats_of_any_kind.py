# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Delete the exact repeats past imports stored under ANY skip kind (#1359, ADR-0031 Amendment B).

`delete_stored_exact_repeats` looked only at rows skipped as *Already imported* or *Repeated in same
file*. The old staging checked bank-exclusion rules, and Cashbook "not a spend", BEFORE "already
imported", so many repeats were stored under another kind -- *Cashfree wallet top-up*, *Cashbook
internal movement* and so on -- and in-flight copies were stored on every overlapping upload. That
patch has already run and `patches/` is append-only, so this is a new one.

It is that patch's planner and applier with `any_kind=True`: the same replay through the upload's
own walk (in-flight sightings included), the same linked-row guard, count, raw delete and recompute.
The candidates are every `Skipped` row with `skip_origin = System` and no `duplicate_basis` claim;
see ANY KIND in `delete_stored_exact_repeats`. A hand skip, a row with a claim, a linked row, a
status-changed repeat and every non-Skipped row are kept.

The owner takes a database backup before this runs in production.
"""

import frappe

from nirmaan_stack.patches.v3_0.delete_stored_exact_repeats import ROW_DOCTYPE, report, run_cleanup


def execute():
    if not frappe.db.table_exists(ROW_DOCTYPE):
        return
    plan = run_cleanup(any_kind=True)
    frappe.db.commit()
    message = report(plan, "delete_stored_exact_repeats_of_any_kind")
    print(message)
    frappe.logger("outflow_import").info(message)
